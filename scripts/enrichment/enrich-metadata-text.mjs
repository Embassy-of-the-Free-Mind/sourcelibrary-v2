#!/usr/bin/env node
/**
 * AI-powered book metadata enrichment using OCR TEXT (not images)
 *
 * 10-20x faster than enrich-metadata-vision.mjs because it reads
 * existing OCR text from MongoDB instead of downloading page images.
 *
 * For books WITHOUT OCR, falls back to title/author metadata only.
 *
 * Usage:
 *   node scripts/enrich-metadata-text.mjs --dry-run           # Preview changes
 *   node scripts/enrich-metadata-text.mjs --apply              # Write to DB
 *   node scripts/enrich-metadata-text.mjs --apply --limit 500  # First 500
 *   node scripts/enrich-metadata-text.mjs --apply --unknown-only  # Only Unknown language
 *   node scripts/enrich-metadata-text.mjs --apply --book "Agrippa"  # Specific book
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { MongoClient } from 'mongodb';
import fs from 'fs';

// ── Config ──────────────────────────────────────────────────────────

const MODEL = 'gemini-3.1-flash-lite-preview';
const PAGES_PER_BOOK = 10; // OCR text from first 10 pages is plenty
const CONCURRENCY = 10;    // Much higher than vision — text is fast
const DELAY_BETWEEN_BATCHES_MS = 500;

const CATEGORIES = [
  // Core esoteric traditions
  'alchemy', 'hermeticism', 'jewish-kabbalah', 'christian-cabala', 'neoplatonism',
  'rosicrucianism', 'freemasonry', 'natural-philosophy', 'astrology', 'natural-magic',
  'ritual-magic', 'theurgy', 'mysticism', 'theology', 'medicine', 'gnosticism',
  'theosophy', 'pythagoreanism', 'divination', 'ars-notoria', 'paracelsian',
  'spiritual-alchemy', 'christian-mysticism', 'prisca-theologia', 'florentine-platonism',
  // General knowledge
  'astronomy', 'mathematics', 'botany', 'chemistry', 'geography', 'history',
  'law', 'literature', 'linguistics', 'music', 'architecture', 'art',
  'military', 'politics', 'philosophy',
  // Non-Western traditions
  'sufism', 'vedanta', 'buddhism', 'daoism', 'biblical-studies',
];

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
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
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

function getClient() {
  const key = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  return new GoogleGenerativeAI(key);
}

// ── Prompt ───────────────────────────────────────────────────────────

function buildPrompt(book, ocrSamples) {
  const ocrSection = ocrSamples.length > 0
    ? `\n\nHere is the OCR text from ${ocrSamples.length} pages of this book:\n\n` +
      ocrSamples.map(s => `--- Page ${s.pageNumber} ---\n${s.text}`).join('\n\n')
    : '\n\n(No OCR text available — classify based on metadata only.)';

  return `You are a rare books librarian and translation scholar examining transcribed text from a historical book.

Book metadata:
- Title: "${book.display_title || book.title || 'Unknown'}"
- Author: ${book.author || 'Unknown'}
- Current language field: ${book.language || 'Unknown'}
- Published: ${book.published || 'Unknown'}
- Year: ${book.year || 'Unknown'}
${ocrSection}

Based on this text and metadata, classify the book AND assess whether an English translation has ever been published. Respond with JSON only — no markdown fences, no explanation.

{
  "language": "<primary language of the text, e.g. Latin, German, French, English, Chinese, Greek, Arabic, Hebrew, Italian, Dutch, Spanish, Sanskrit, Syriac, Armenian, Persian, Turkish, Japanese, Korean, etc.>",
  "secondary_languages": ["<any other languages present, e.g. Greek quotes in a Latin text>"],
  "script": "<writing system: Latin alphabet, Fraktur, Greek, Chinese characters, Hebrew, Arabic, Devanagari, etc.>",
  "categories": ["<1-4 subject tags from EXACTLY this list: ${CATEGORIES.join(', ')}>"],
  "estimated_year": "<best estimate of publication year as a number, e.g. 1617. null if truly impossible to determine>",
  "estimated_century": "<e.g. '17th century' or '15th-16th century' — fallback if exact year unclear>",
  "description": "<1-2 sentence scholarly description of what this book appears to be about>",
  "confidence": "<high, medium, or low — how confident are you in this classification>",
  "first_translation": {
    "status": "<one of: confirmed_first, likely_first, uncertain, has_partial, has_translation, not_applicable>",
    "reasoning": "<1-2 sentences explaining why you believe this has or hasn't been translated to English before>",
    "known_translations": ["<any known English translations>"],
    "confidence": "<high, medium, or low>"
  }
}

Rules:
- For language, identify the LANGUAGE OF THE TEXT, not the language of any modern library annotation
- If there are multiple languages (e.g. parallel Latin/Greek), list the primary one and put others in secondary_languages
- For categories, pick 1-4 using ONLY the exact slugs from the list above. Prefer specific esoteric tags (e.g. "alchemy", "hermeticism", "christian-cabala") over generic ones. A book by Jacob Boehme should be "christian-mysticism" not "theology".
- Most pre-1800 Latin, German, and other non-English texts on alchemy, Hermeticism, Kabbalah, astrology, and natural philosophy were NEVER translated to English.
- If the book IS already in English, set first_translation status to "not_applicable"`;
}

// ── Core classification ──────────────────────────────────────────────

async function classifyBook(book, ocrSamples) {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: MODEL,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  });

  const prompt = buildPrompt(book, ocrSamples);
  const startTime = Date.now();
  const result = await model.generateContent(prompt);
  const durationMs = Date.now() - startTime;

  const response = result.response;
  const candidates = response.candidates || [];
  const allParts = candidates[0]?.content?.parts || [];
  const fullText = allParts.map(p => p.text || '').join('');
  const text = fullText.trim() || response.text().trim();
  const usage = response.usageMetadata || {};

  // Parse JSON response
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e1) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        return { error: 'parse_failed', raw_response: text.substring(0, 500), pages_checked: ocrSamples.length, usage, duration_ms: durationMs };
      }
    } else {
      return { error: 'parse_failed', raw_response: text.substring(0, 500), pages_checked: ocrSamples.length, usage, duration_ms: durationMs };
    }
  }

  return {
    ...parsed,
    pages_checked: ocrSamples.length,
    usage: {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: usage.candidatesTokenCount || 0,
      total_tokens: usage.totalTokenCount || 0,
    },
    duration_ms: durationMs,
  };
}

// ── Cost ──────────────────────────────────────────────────────────────

function calculateCost(usage) {
  const inputCostPer1M = 0.15;
  const outputCostPer1M = 0.60;
  return (
    (usage.input_tokens / 1_000_000) * inputCostPer1M +
    (usage.output_tokens / 1_000_000) * outputCostPer1M
  );
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const unknownOnly = args.includes('--unknown-only');
  const datelessOnly = args.includes('--dateless');
  const useWarehouse = args.includes('--warehouse');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 500;
  const pagesPerBook = args.includes('--pages') ? parseInt(args[args.indexOf('--pages') + 1]) : PAGES_PER_BOOK;
  const specificBook = args.includes('--book') ? args[args.indexOf('--book') + 1] : null;
  const ocrOnly = args.includes('--ocr-only'); // Only process books that have OCR

  const booksCollectionName = useWarehouse ? 'books_warehouse' : 'books';
  const pagesCollectionName = useWarehouse ? 'pages_warehouse' : 'pages';

  console.log(`=== Book Metadata Enrichment via OCR Text ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (use --apply to write)' : 'APPLYING CHANGES'}`);
  console.log(`Collection: ${booksCollectionName}`);
  console.log(`Model: ${MODEL}`);
  console.log(`OCR pages per book: ${pagesPerBook}`);
  console.log(`API keys: ${apiKeys.length}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Limit: ${limit}\n`);

  const mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await mongoClient.connect();
  const db = mongoClient.db(MONGODB_DB);

  // Build query
  const filter = {};
  if (unknownOnly) {
    filter.language = 'Unknown';
  }
  if (datelessOnly) {
    filter.year = { $exists: false };
    filter['ai_metadata.enriched_at'] = { $exists: true };
  } else {
    filter['ai_metadata.enriched_at'] = { $exists: false };
  }
  if (specificBook) {
    filter.$or = [
      { title: { $regex: specificBook, $options: 'i' } },
      { author: { $regex: specificBook, $options: 'i' } },
      { id: specificBook },
    ];
  }

  const books = await db.collection(booksCollectionName)
    .find(filter)
    .sort({ pages_count: -1 })
    .limit(limit)
    .toArray();

  console.log(`Found ${books.length} books to process`);

  // If --ocr-only, filter to books with OCR pages
  let booksToProcess = books;
  if (ocrOnly) {
    // Quick check which books have OCR
    const bookIds = books.map(b => b.id);
    const booksWithOcr = await db.collection(pagesCollectionName).aggregate([
      { $match: { book_id: { $in: bookIds }, 'ocr.data': { $exists: true, $ne: '' } } },
      { $group: { _id: '$book_id' } }
    ]).toArray();
    const ocrBookIds = new Set(booksWithOcr.map(b => b._id));
    booksToProcess = books.filter(b => ocrBookIds.has(b.id));
    console.log(`Filtered to ${booksToProcess.length} books with OCR data`);
  }

  console.log();

  if (booksToProcess.length === 0) {
    await mongoClient.close();
    return;
  }

  // Stats
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let totalCost = 0;
  const languageCounts = {};
  const categoryCounts = {};
  const ftCounts = {};

  // Process in batches
  for (let i = 0; i < booksToProcess.length; i += CONCURRENCY) {
    const batch = booksToProcess.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(batch.map(async (book) => {
      // Fetch OCR text from first N pages
      const pages = await db.collection(pagesCollectionName)
        .find(
          { book_id: book.id, 'ocr.data': { $exists: true, $ne: '' } },
          { projection: { page_number: 1, 'ocr.data': 1 } }
        )
        .sort({ page_number: 1 })
        .limit(pagesPerBook)
        .toArray();

      // Build OCR samples (truncate each to ~2000 chars to stay within limits)
      const ocrSamples = pages.map(p => ({
        pageNumber: p.page_number,
        text: (p.ocr?.data || '').substring(0, 2000),
      }));

      try {
        const result = await classifyBook(book, ocrSamples);
        return { book, result };
      } catch (err) {
        return { book, error: err.message };
      }
    }));

    // Process results
    for (const r of results) {
      processed++;
      if (r.status === 'rejected') {
        failed++;
        console.log(`  [${processed}/${booksToProcess.length}] FAIL ${r.reason}`);
        continue;
      }

      const { book, result, error } = r.value;
      const shortTitle = (book.display_title || book.title || '').substring(0, 50);

      if (error) {
        failed++;
        console.log(`  [${processed}/${booksToProcess.length}] SKIP ${shortTitle} — ${error}`);
        continue;
      }

      if (result.error) {
        failed++;
        console.log(`  [${processed}/${booksToProcess.length}] SKIP ${shortTitle} — ${result.error}`);
        continue;
      }

      succeeded++;

      const cost = result.usage ? calculateCost(result.usage) : 0;
      totalCost += cost;

      // Track stats
      if (result.language) languageCounts[result.language] = (languageCounts[result.language] || 0) + 1;
      if (result.categories) {
        for (const cat of result.categories) categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      }
      if (result.first_translation?.status) ftCounts[result.first_translation.status] = (ftCounts[result.first_translation.status] || 0) + 1;

      const langChanged = result.language && result.language !== book.language;
      const ft = result.first_translation;
      const ftStatus = ft?.status || '?';
      const marker = langChanged ? '*' : ' ';
      const yearInfo = result.estimated_year ? `Year: ${result.estimated_year}` : (result.estimated_century || '?');
      console.log(`${marker} [${processed}/${booksToProcess.length}] ${shortTitle}`);
      console.log(`    Lang: ${book.language || 'Unknown'} -> ${result.language || '?'} | ${yearInfo} | Cat: ${(result.categories || []).join(', ')} | ${result.confidence} | $${cost.toFixed(4)}`);
      console.log(`    FT: ${ftStatus} | ${ft?.reasoning?.substring(0, 100) || ''}`);

      // Apply changes
      if (!dryRun) {
        const enrichment = {
          language: result.language,
          secondary_languages: result.secondary_languages || [],
          script: result.script,
          categories: result.categories || [],
          estimated_century: result.estimated_century,
          description: result.description,
          confidence: result.confidence,
          first_translation: result.first_translation || null,
          model: MODEL,
          pages_checked: result.pages_checked,
          enriched_at: new Date(),
          enrichment_method: 'text', // Distinguish from image-based
          changes: [],
        };

        const updates = { updated_at: new Date() };

        // Language: update if Unknown and AI is not low confidence
        if (book.language === 'Unknown' && result.language && result.confidence !== 'low') {
          updates.language = result.language;
          enrichment.changes.push({ field: 'language', previous: book.language, new_value: result.language });
        }

        // Year: set if missing
        if (!book.year && result.estimated_year) {
          const year = parseInt(result.estimated_year);
          if (!isNaN(year) && year > 0 && year < 2100) {
            updates.year = year;
            enrichment.changes.push({ field: 'year', previous: null, new_value: year });
            if (!book.published || book.published === 'Unknown') {
              updates.published = String(year);
              enrichment.changes.push({ field: 'published', previous: book.published || null, new_value: String(year) });
            }
          }
        }

        // Categories: merge with existing
        if (result.categories?.length > 0) {
          const existing = book.categories || [];
          const merged = [...new Set([...existing, ...result.categories])];
          if (merged.length !== existing.length) {
            updates.categories = merged;
            enrichment.changes.push({ field: 'categories', previous: existing, new_value: merged, ai_suggested: result.categories });
          }
        }

        // Description: set if missing
        if (result.description && !book.description) {
          updates.description = result.description;
          enrichment.changes.push({ field: 'description', previous: null, new_value: result.description });
        }

        updates.ai_metadata = enrichment;

        // Field provenance
        const now = new Date();
        const aiSource = {
          source: 'ai_enrichment',
          model: MODEL,
          date: now,
          confidence: result.confidence,
          pages_checked: result.pages_checked,
          script: 'enrich-metadata-text.mjs',
        };
        const provenance = book.field_provenance || {};
        if (result.language) {
          if (updates.language) {
            provenance.language = { ...aiSource, previous_value: book.language };
          } else if (!provenance.language) {
            provenance.language = { source: 'import', note: `AI confirmed as "${result.language}" (${result.confidence})`, ai_confirmed_at: now };
          }
        }
        if (updates.year) provenance.year = { ...aiSource, previous_value: null };
        if (updates.published) provenance.published = { ...aiSource, previous_value: book.published || null };
        if (updates.categories) {
          provenance.categories = { ...aiSource, previous_value: book.categories || [], ai_suggested: result.categories, note: book.categories?.length ? 'merged with existing' : 'ai_enrichment' };
        }
        if (result.description) provenance.description = aiSource;
        if (result.first_translation) provenance.first_translation = { ...aiSource, status: result.first_translation.status };
        updates.field_provenance = provenance;

        try {
          await db.collection(booksCollectionName).updateOne({ id: book.id }, { $set: updates });
          await db.collection('gemini_usage').insertOne({
            timestamp: new Date(),
            type: 'other',
            mode: 'realtime',
            model: MODEL,
            book_id: book.id,
            book_title: book.display_title || book.title,
            page_count: result.pages_checked,
            input_tokens: result.usage?.input_tokens || 0,
            output_tokens: result.usage?.output_tokens || 0,
            cost_usd: cost,
            status: 'success',
            duration_ms: result.duration_ms,
            endpoint: 'script/enrich-metadata-text',
          });
        } catch (dbErr) {
          console.log(`    [DB ERROR] ${dbErr.message}`);
          failed++;
          succeeded--;
        }
      }
    }

    // Delay between batches
    if (i + CONCURRENCY < booksToProcess.length) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Processed: ${processed}`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed/Skipped: ${failed}`);
  console.log(`Total cost: $${totalCost.toFixed(2)}`);
  console.log(`Avg cost/book: $${succeeded > 0 ? (totalCost / succeeded).toFixed(4) : '0'}`);

  if (Object.keys(languageCounts).length > 0) {
    console.log('\n--- Languages ---');
    for (const [lang, count] of Object.entries(languageCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${lang}: ${count}`);
    }
  }
  if (Object.keys(categoryCounts).length > 0) {
    console.log('\n--- Categories ---');
    for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${cat}: ${count}`);
    }
  }
  if (Object.keys(ftCounts).length > 0) {
    console.log('\n--- First Translation ---');
    for (const [status, count] of Object.entries(ftCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${status}: ${count}`);
    }
  }

  if (dryRun) console.log('\n(Dry run — use --apply to write to DB.)');
  await mongoClient.close();
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
