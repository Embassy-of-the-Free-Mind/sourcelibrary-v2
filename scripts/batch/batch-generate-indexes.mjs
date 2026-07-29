#!/usr/bin/env node
/**
 * Batch generate summary + index for books
 *
 * Replicates the MapReduce logic from /api/books/[id]/index:
 *   1. Batch pages by ~50k chars of translation text
 *   2. Extract themes, quotes, people, places, concepts per batch
 *   3. Synthesize hierarchical book summary
 *   4. Build concept index
 *   5. Sync entities to cross-book collection
 *
 * Usage:
 *   node scripts/batch-generate-indexes.mjs --dry-run            # Preview what would run
 *   node scripts/batch-generate-indexes.mjs --apply               # Process books
 *   node scripts/batch-generate-indexes.mjs --apply --limit 100   # First 100
 *   node scripts/batch-generate-indexes.mjs --apply --book "Fludd" # Specific book
 *   node scripts/batch-generate-indexes.mjs --apply --force        # Re-generate existing
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import { buildPageTexts, attributeEntityPages, entityCounters } from '../lib/entity-page-match.mjs';

// ── Config ──────────────────────────────────────────────────────────

// Index extraction runs on flash-lite, matching the enrich-worker's Phase 6
// (the other writer of this same index). The prompt returns bare name lists and
// page attribution is done locally by attributeEntityPages(), so the preview
// model bought nothing here and cost ~7x more.
const MODEL = 'gemini-3.1-flash-lite';
const TARGET_BATCH_CHARS = 50000; // ~12k tokens per batch
const CONCURRENCY = 3; // Books processed concurrently (each book fires multiple parallel batches)
const DELAY_BETWEEN_BOOKS_MS = 1000;
const MIN_TRANSLATED_PAGES = 5; // Skip books with fewer translated pages

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// ── Env ─────────────────────────────────────────────────────────────

function loadEnv() {
  const env = {};
  try {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^=#]+)=(.*)$/);
      if (match) {
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        env[match[1].trim()] = value;
      }
    }
  } catch { /* no .env.local */ }
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB || 'bookstore';
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// API key rotation
function getApiKeys() {
  const keys = [];
  if (env.GEMINI_API_KEY) keys.push(env.GEMINI_API_KEY);
  for (let i = 2; i <= 10; i++) {
    if (env[`GEMINI_API_KEY_${i}`]) keys.push(env[`GEMINI_API_KEY_${i}`]);
  }
  return keys;
}

const apiKeys = getApiKeys();
if (apiKeys.length === 0) { console.error('No GEMINI_API_KEY configured'); process.exit(1); }
let keyIndex = 0;

function getModel() {
  const key = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  const client = new GoogleGenerativeAI(key);
  return client.getGenerativeModel({
    model: MODEL,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
  });
}

function getSummaryModel() {
  const key = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  const client = new GoogleGenerativeAI(key);
  return client.getGenerativeModel({
    model: MODEL,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
  });
}

// ── Cost tracking ────────────────────────────────────────────────────

// gemini-3.1-flash-lite pricing. Must stay in step with MODEL above and with
// the MODEL_COSTS table in scripts/workers/enrich-worker.mjs — these constants
// are what lands in gemini_usage.cost_usd, so a stale rate silently misreports
// every downstream spend estimate.
const INPUT_COST_PER_1M = 0.075;
const OUTPUT_COST_PER_1M = 0.30;

function calculateCost(inputTokens, outputTokens) {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_1M +
         (outputTokens / 1_000_000) * OUTPUT_COST_PER_1M;
}

// ── Batch extraction (MapReduce map phase) ──────────────────────────

function createBatches(pages) {
  const translatedPages = pages.filter(p => p.translation?.data);
  if (translatedPages.length === 0) return [];

  const batches = [];
  let currentBatch = [];
  let currentSize = 0;

  for (const page of translatedPages) {
    const pageSize = (page.translation?.data || '').length;
    if (currentSize + pageSize > TARGET_BATCH_CHARS && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }
    currentBatch.push(page);
    currentSize += pageSize;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}

async function processBatch(pages, bookTitle, bookAuthor, bookLanguage) {
  const model = getModel();
  const pageRange = { start: pages[0].page_number, end: pages[pages.length - 1].page_number };

  const batchContent = pages
    .filter(p => p.translation?.data)
    .map(p => {
      const cleanText = (p.translation?.data || '')
        .replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/gi, '')
        .replace(/\[\[[^\]]+\]\]/g, '')
        .replace(/^```(?:markdown)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();
      return `[Page ${p.page_number}]\n${cleanText}`;
    })
    .join('\n\n---\n\n');

  if (!batchContent.trim()) {
    return { pageRange, themes: [], quotes: [], people: [], places: [], concepts: [], summary: '', tokens: { input: 0, output: 0 } };
  }

  const prompt = `You are analyzing pages ${pageRange.start}-${pageRange.end} of "${bookTitle}" by ${bookAuthor}${bookLanguage ? ` (translated from ${bookLanguage})` : ''}.

## Pages to analyze:
${batchContent}

## Task
Extract structured information from these pages.

Output as JSON:
{
  "themes": ["Main theme 1", "Main theme 2"],
  "quotes": [
    {"text": "Copy the EXACT words from the text - a striking, memorable, or important sentence or passage", "page": 5, "context": "Brief note on why this quote matters"}
  ],
  "people": ["Person Name 1", "Person Name 2"],
  "places": ["Place Name 1", "Place Name 2"],
  "concepts": ["Key concept 1", "Technical term 2"],
  "summary": "2-3 sentence summary of what these pages cover and their key arguments."
}

CRITICAL for quotes:
- Copy EXACT text from the pages - do not paraphrase or summarize
- Find memorable, striking, or important passages readers would want to highlight
- 3-5 quotes per batch`;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const usage = result.response.usageMetadata;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { pageRange, themes: [], quotes: [], people: [], places: [], concepts: [], summary: '', tokens: { input: usage?.promptTokenCount || 0, output: usage?.candidatesTokenCount || 0 } };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      pageRange,
      themes: Array.isArray(parsed.themes) ? parsed.themes : [],
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
      people: Array.isArray(parsed.people) ? parsed.people : [],
      places: Array.isArray(parsed.places) ? parsed.places : [],
      concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      tokens: { input: usage?.promptTokenCount || 0, output: usage?.candidatesTokenCount || 0 },
    };
  } catch (e) {
    console.error(`    Batch ${pageRange.start}-${pageRange.end} error: ${e.message}`);
    return { pageRange, themes: [], quotes: [], people: [], places: [], concepts: [], summary: '', tokens: { input: 0, output: 0 } };
  }
}

// ── Summary synthesis (MapReduce reduce phase) ──────────────────────

async function generateBookSummary(batchExtractions, bookTitle, bookAuthor, bookLanguage, chapters) {
  const model = getSummaryModel();

  if (batchExtractions.length === 0) {
    return { brief: `A text by ${bookAuthor}.`, abstract: '', detailed: '', sections: [], tokens: { input: 0, output: 0 } };
  }

  const allThemes = [...new Set(batchExtractions.flatMap(b => b.themes))];
  const allQuotes = batchExtractions.flatMap(b => b.quotes);
  const allPeople = [...new Set(batchExtractions.flatMap(b => b.people))];
  const allPlaces = [...new Set(batchExtractions.flatMap(b => b.places))];
  const allConcepts = [...new Set(batchExtractions.flatMap(b => b.concepts))];

  const batchSummariesText = batchExtractions
    .map(b => `Pages ${b.pageRange.start}-${b.pageRange.end}: ${b.summary}`)
    .join('\n');

  const quotesText = allQuotes.slice(0, 15)
    .map(q => `- "${q.text}" (p. ${q.page})${q.context ? ` — ${q.context}` : ''}`)
    .join('\n');

  const hasChapters = chapters && chapters.length > 0;
  const chapterSection = hasChapters
    ? `\n## Detected Chapter Structure\n${chapters.map(c => `- Page ${c.pageNumber}: ${c.title}`).join('\n')}\n`
    : '';

  const prompt = `You're writing compelling copy to help readers discover "${bookTitle}" by ${bookAuthor}.${bookLanguage ? ` The original text is in ${bookLanguage}.` : ''}
${chapterSection}
## Extracted from the text:

**Themes:** ${allThemes.join(', ')}
**Key People:** ${allPeople.join(', ') || 'None identified'}
**Key Places:** ${allPlaces.join(', ') || 'None identified'}
**Key Concepts:** ${allConcepts.join(', ')}

## Section-by-section summaries:
${batchSummariesText}

## Notable quotes extracted:
${quotesText}

## Your Task
Synthesize the above into compelling summaries that make readers WANT to explore this text.

1. **BRIEF** (2-3 punchy sentences): Hook the reader.
2. **ABSTRACT** (1 paragraph, 4-6 sentences): What makes this text worth reading?
3. **DETAILED** (2-4 paragraphs): Paint a picture of the journey through this text.
4. **SECTIONS**: ${hasChapters ? 'Use the detected chapter structure.' : 'Group into 5-8 thematic sections.'} For each:
   - Title and page range
   - What it covers (2-3 sentences)
   - 2-4 notable quotes with page numbers and significance
   - Key concepts

Output as JSON:
{
  "brief": "...",
  "abstract": "...",
  "detailed": "...",
  "sections": [
    {
      "title": "Section Title",
      "startPage": 1,
      "endPage": 10,
      "summary": "What this section covers...",
      "quotes": [{"text": "Exact quote", "page": 3, "significance": "Why this matters"}],
      "concepts": ["Key Term", "Important Concept"]
    }
  ]
}

IMPORTANT: Use the actual quotes provided above. Don't invent new ones.`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();
  const usage = result.response.usageMetadata;

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse summary JSON');

  const parsed = JSON.parse(jsonMatch[0]);
  const ensureString = (val) => {
    if (typeof val === 'string') return val;
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) return val.join('\n\n');
    return String(val);
  };

  return {
    brief: ensureString(parsed.brief),
    abstract: ensureString(parsed.abstract),
    detailed: ensureString(parsed.detailed),
    sections: Array.isArray(parsed.sections) ? parsed.sections : [],
    tokens: { input: usage?.promptTokenCount || 0, output: usage?.candidatesTokenCount || 0 },
  };
}

// ── Concept index building ──────────────────────────────────────────

function extractTerms(text, tag) {
  const terms = [];
  const xmlTag = tag === 'vocabulary' ? 'vocab' : tag;
  const xmlPattern = new RegExp(`<${xmlTag}>([\\s\\S]*?)</${xmlTag}>`, 'gi');
  let match;
  while ((match = xmlPattern.exec(text)) !== null) {
    terms.push(...match[1].split(',').map(t => t.trim()).filter(Boolean));
  }
  const bracketPattern = new RegExp(`\\[\\[${tag}:\\s*(.*?)\\]\\]`, 'gi');
  while ((match = bracketPattern.exec(text)) !== null) {
    terms.push(...match[1].split(',').map(t => t.trim()).filter(Boolean));
  }
  return terms;
}

function buildConceptIndex(batches, pages) {
  const peopleMap = new Map();
  const placesMap = new Map();
  const conceptsMap = new Map();

  // Twin of buildConceptIndexFromBatches in scripts/workers/enrich-worker.mjs —
  // keep both sides in step. Gemini names the entities in a ~50k-char batch but
  // is never asked which page each sits on, so we verify against page text
  // instead of crediting the whole batch range (#3361).
  const pagesByNumber = new Map(pages.map(p => [p.page_number, p]));

  const accumulate = (map, term, batchPageTexts) => {
    if (!term) return;
    const attribution = attributeEntityPages(term, batchPageTexts);
    const prev = map.get(term);
    if (!prev) {
      map.set(term, attribution);
      return;
    }
    const merged_pages = [...new Set([...prev.pages, ...attribution.pages])].sort((a, b) => a - b);
    const ranges = [prev.page_range, attribution.page_range].filter(Boolean);
    const merged = { pages: merged_pages, page_precision: merged_pages.length > 0 ? 'page' : 'section' };
    if (merged.page_precision === 'section' && ranges.length > 0) {
      merged.page_range = {
        start: Math.min(...ranges.map(r => r.start)),
        end: Math.max(...ranges.map(r => r.end)),
      };
    }
    map.set(term, merged);
  };

  for (const batch of batches) {
    const batchPages = [];
    for (let n = batch.pageRange.start; n <= batch.pageRange.end; n++) {
      const p = pagesByNumber.get(n);
      if (p) batchPages.push(p);
    }
    const batchPageTexts = buildPageTexts(batchPages);

    for (const person of batch.people) accumulate(peopleMap, person, batchPageTexts);
    for (const place of batch.places) accumulate(placesMap, place, batchPageTexts);
    for (const concept of batch.concepts) accumulate(conceptsMap, concept, batchPageTexts);
  }

  // Extract vocabulary/keywords from page tags
  const vocabMap = new Map();
  const keywordMap = new Map();
  for (const page of pages) {
    if (page.ocr?.data) {
      for (const term of extractTerms(page.ocr.data, 'vocabulary')) {
        if (!vocabMap.has(term)) vocabMap.set(term, []);
        vocabMap.get(term).push(page.page_number);
      }
    }
    if (page.translation?.data) {
      for (const term of extractTerms(page.translation.data, 'keywords')) {
        if (!keywordMap.has(term)) keywordMap.set(term, []);
        keywordMap.get(term).push(page.page_number);
      }
    }
  }

  // vocabulary/keywords are extracted from per-page tags, so they were always
  // page-exact.
  const mapToEntries = (map) =>
    Array.from(map.entries())
      .map(([term, pgs]) => ({ term, pages: [...new Set(pgs)].sort((a, b) => a - b), page_precision: 'page' }))
      .sort((a, b) => b.pages.length - a.pages.length);

  const attributionToEntries = (map) =>
    Array.from(map.entries())
      .map(([term, attribution]) => ({ term, ...attribution }))
      .sort((a, b) => b.pages.length - a.pages.length);

  return {
    vocabulary: mapToEntries(vocabMap),
    keywords: mapToEntries(keywordMap),
    people: attributionToEntries(peopleMap),
    places: attributionToEntries(placesMap),
    concepts: attributionToEntries(conceptsMap),
  };
}

// ── Entity sync ─────────────────────────────────────────────────────

async function syncBookEntities(db, bookId, bookTitle, bookAuthor, conceptIndex) {
  const now = new Date();
  const promises = [];

  const syncEntity = async (term, type, entry) => {
    if (!term) return;
    const bookEntry = {
      book_id: bookId,
      book_title: bookTitle,
      book_author: bookAuthor,
      pages: entry.pages || [],
      page_precision: entry.page_precision || 'section',
      ...(entry.page_range ? { page_range: entry.page_range } : {}),
    };
    // Replace this book's entry, don't append another. See the same fix in
    // enrich-worker.mjs — `$addToSet` on a whole subdocument duplicated books.
    await db.collection('entities').updateOne(
      { name: term, type },
      { $set: { updated_at: now }, $setOnInsert: { name: term, type, created_at: now } },
      { upsert: true }
    );
    await db.collection('entities').updateOne({ name: term, type }, { $pull: { books: { book_id: bookId } } });
    await db.collection('entities').updateOne({ name: term, type }, { $push: { books: bookEntry } });
  };

  for (const p of conceptIndex.people) promises.push(syncEntity(p.term, 'person', p));
  for (const p of conceptIndex.places) promises.push(syncEntity(p.term, 'place', p));
  for (const c of conceptIndex.concepts) promises.push(syncEntity(c.term, 'concept', c));

  await Promise.all(promises);

  // Update counts
  const allTerms = [
    ...conceptIndex.people.map(p => ({ name: p.term, type: 'person' })),
    ...conceptIndex.places.map(p => ({ name: p.term, type: 'place' })),
    ...conceptIndex.concepts.map(p => ({ name: p.term, type: 'concept' })),
  ];
  for (const { name, type } of allTerms) {
    const entity = await db.collection('entities').findOne({ name, type }, { projection: { books: 1 } });
    if (entity) {
      await db.collection('entities').updateOne({ name, type }, { $set: entityCounters(entity.books) });
    }
  }
}

// ── Process one book ────────────────────────────────────────────────

async function processBook(db, book) {
  const bookTitle = book.display_title || book.title;
  const bookAuthor = book.author || 'Unknown';
  const bookLanguage = book.language || undefined;

  // Get all pages
  const pages = await db.collection('pages')
    .find({ book_id: book.id })
    .sort({ page_number: 1 })
    .project({ page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'summary.data': 1 })
    .toArray();

  const translatedCount = pages.filter(p => p.translation?.data).length;
  if (translatedCount < MIN_TRANSLATED_PAGES) {
    return { skipped: true, reason: `only ${translatedCount} translated pages` };
  }

  // Get chapters if they exist
  const chapters = (book.chapters || []).map(c => ({
    title: c.title,
    pageNumber: c.pageNumber,
    level: c.level || 1,
  }));

  // Step 1: Batch extraction (parallel)
  const pageBatches = createBatches(pages);
  const batchResults = await Promise.all(
    pageBatches.map(batch => processBatch(batch, bookTitle, bookAuthor, bookLanguage))
  );

  // Aggregate token usage
  let totalInput = 0;
  let totalOutput = 0;
  for (const b of batchResults) {
    totalInput += b.tokens?.input || 0;
    totalOutput += b.tokens?.output || 0;
  }

  // Step 2: Build concept index
  const conceptIndex = buildConceptIndex(batchResults, pages);

  // Step 3: Generate summary
  const summary = await generateBookSummary(batchResults, bookTitle, bookAuthor, bookLanguage, chapters);
  totalInput += summary.tokens?.input || 0;
  totalOutput += summary.tokens?.output || 0;

  // Step 4: Build page summaries from batches
  const pageSummaries = batchResults.flatMap(batch =>
    batch.summary ? [{ page: batch.pageRange.start, summary: batch.summary }] : []
  );

  // Step 5: Save to DB
  const index = {
    ...conceptIndex,
    pageSummaries,
    sectionSummaries: summary.sections,
    bookSummary: { brief: summary.brief, abstract: summary.abstract, detailed: summary.detailed },
    generatedAt: new Date(),
    pagesCovered: translatedCount,
    totalPages: pages.length,
  };

  const updateData = { index, updated_at: new Date() };
  if (summary.brief) {
    updateData.summary = {
      data: summary.brief,
      generated_at: new Date(),
      page_coverage: Math.round((translatedCount / pages.length) * 100),
      model: MODEL,
    };
  }

  await db.collection('books').updateOne({ id: book.id }, { $set: updateData });

  // Step 6: Sync entities (non-blocking)
  syncBookEntities(db, book.id, bookTitle, bookAuthor, conceptIndex).catch(err => {
    console.error(`    Entity sync failed for ${book.id}: ${err.message}`);
  });

  // Step 7: Log AI usage
  const cost = calculateCost(totalInput, totalOutput);
  await db.collection('gemini_usage').insertOne({
    timestamp: new Date(),
    type: 'index',
    mode: 'realtime',
    model: MODEL,
    book_id: book.id,
    book_title: bookTitle,
    page_count: translatedCount,
    input_tokens: totalInput,
    output_tokens: totalOutput,
    cost_usd: cost,
    status: 'success',
    endpoint: 'script/batch-generate-indexes',
  });

  return {
    batches: pageBatches.length,
    translatedPages: translatedCount,
    sections: summary.sections?.length || 0,
    people: conceptIndex.people.length,
    concepts: conceptIndex.concepts.length,
    tokens: { input: totalInput, output: totalOutput },
    cost,
  };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const force = args.includes('--force');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 200;
  const specificBook = args.includes('--book') ? args[args.indexOf('--book') + 1] : null;

  console.log(`=== Batch Index + Summary Generation ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLYING'}`);
  console.log(`Model: ${MODEL}`);
  console.log(`API keys: ${apiKeys.length}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Limit: ${limit}\n`);

  const mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await mongoClient.connect();
  const db = mongoClient.db(MONGODB_DB);

  // Find books needing indexes
  const filter = {};
  if (!force) {
    filter['index.generatedAt'] = { $exists: false };
  }
  if (specificBook) {
    filter.$or = [
      { title: { $regex: specificBook, $options: 'i' } },
      { author: { $regex: specificBook, $options: 'i' } },
      { id: specificBook },
    ];
  }

  // Only books with some translated pages
  filter.pages_translated = { $gte: MIN_TRANSLATED_PAGES };

  const books = await db.collection('books')
    .find(filter)
    .sort({ pages_translated: -1 }) // Most translated first
    .limit(limit)
    .toArray();

  console.log(`Found ${books.length} books to process\n`);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let totalCost = 0;

  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(batch.map(async (book) => {
      const shortTitle = (book.display_title || book.title || '').substring(0, 55);
      const idx = books.indexOf(book) + 1;

      if (dryRun) {
        const translatedCount = book.pages_translated || 0;
        console.log(`  [${idx}/${books.length}] WOULD process: ${shortTitle} (${translatedCount} translated pages)`);
        return { book, dryRun: true };
      }

      try {
        console.log(`  [${idx}/${books.length}] Processing: ${shortTitle}...`);
        const result = await processBook(db, book);

        if (result.skipped) {
          console.log(`  [${idx}/${books.length}] SKIP ${shortTitle} — ${result.reason}`);
          return { book, skipped: true };
        }

        console.log(`  [${idx}/${books.length}] OK ${shortTitle} — ${result.batches} batches, ${result.sections} sections, ${result.people} people, ${result.concepts} concepts | $${result.cost.toFixed(4)}`);
        return { book, result };
      } catch (err) {
        console.log(`  [${idx}/${books.length}] FAIL ${shortTitle} — ${err.message}`);
        return { book, error: err.message };
      }
    }));

    for (const r of results) {
      processed++;
      if (r.status === 'rejected') { failed++; continue; }
      const { result, error, skipped: wasSkipped, dryRun: wasDryRun } = r.value;
      if (wasDryRun) continue;
      if (wasSkipped) { skipped++; continue; }
      if (error) { failed++; continue; }
      if (result) {
        succeeded++;
        totalCost += result.cost || 0;
      }
    }

    if (i + CONCURRENCY < books.length) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BOOKS_MS));
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Processed: ${processed}`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total cost: $${totalCost.toFixed(2)}`);
  console.log(`Avg cost/book: $${succeeded > 0 ? (totalCost / succeeded).toFixed(4) : '0'}`);

  if (dryRun) console.log('\n(Dry run — use --apply to write to DB.)');
  await mongoClient.close();
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
