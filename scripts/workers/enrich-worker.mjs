#!/usr/bin/env node
/**
 * Hetzner Inline Enrichment Worker
 *
 * Generates summary+index and extracts chapters directly via Gemini API.
 * No Vercel route dependency — eliminates Cloudflare blocking issue.
 *
 * Architecture:
 * - Phase 6: Summary + Index (translate_complete -> summary_indexed)
 *   Batch-extracts themes/quotes/people/places/concepts per page batch,
 *   then synthesizes into a book summary. Writes book.index, book.summary,
 *   book.reading_summary.
 *
 * - Phase 7: Chapter Extraction (summary_indexed -> chapters_complete)
 *   Detects chapter headings from OCR+translation text, calls Gemini
 *   to structure them. Writes book.chapters.
 *
 * Runs standalone via cron or called from the orchestrator.
 *
 * CLI flags:
 *   --phase=6|7|all    Which phase to run (default: all)
 *   --limit=N          Max books per phase (default: 30 for phase 6, 50 for phase 7)
 *   --dry-run          Print what would be done, don't modify
 *   --book=ID          Process a single book (for debugging)
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── Config ──
const MONGODB_URI = process.env.MONGODB_URI;
const DEFAULT_MODEL = 'gemini-3-flash-preview';
const LITE_MODEL = 'gemini-3.1-flash-lite-preview';
const TARGET_BATCH_CHARS = 50000;
const MAX_RETRIES = 3;

// Model pricing per 1M tokens (USD)
const MODEL_PRICING = {
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3.1-flash-lite-preview': { input: 0.075, output: 0.30 },
  'default': { input: 0.10, output: 0.40 },
};

// ── CLI args ──
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const phaseArg = args.find(a => a.startsWith('--phase='))?.split('=')[1] || 'all';
const RUN_PHASE_6 = phaseArg === 'all' || phaseArg === '6';
const RUN_PHASE_7 = phaseArg === 'all' || phaseArg === '7';
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
const PHASE_6_LIMIT = limitArg ? parseInt(limitArg) : 30;
const PHASE_7_LIMIT = limitArg ? parseInt(limitArg) : 50;
const SINGLE_BOOK = args.find(a => a.startsWith('--book='))?.split('=')[1];

// ── Gemini API keys ──
const API_KEYS = [
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 9 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`]),
  process.env.GEMINI_API_KEY_TIER3,
].filter(Boolean);

if (API_KEYS.length === 0) {
  console.error('[ENRICH] No Gemini API keys configured');
  process.exit(1);
}

let currentKeyIndex = 0;
function getClient() {
  return new GoogleGenerativeAI(API_KEYS[currentKeyIndex % API_KEYS.length]);
}
function rotateKey() {
  currentKeyIndex++;
  console.log(`[ENRICH] Rotated to API key ${(currentKeyIndex % API_KEYS.length) + 1}/${API_KEYS.length}`);
}

// ── Utility ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function computeCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

async function logUsage(db, params) {
  const id = `gu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.collection('gemini_usage').insertOne({
    id,
    timestamp: new Date(),
    ...params,
    cost_usd: computeCost(params.model, params.input_tokens, params.output_tokens),
  });
}

// ── Pipeline status helpers ──
async function setPipelineStatus(db, bookId, status, extra = {}) {
  await db.collection('books').updateOne(
    { id: bookId },
    { $set: { 'pipeline_auto.status': status, 'pipeline_auto.updated_at': new Date(), updated_at: new Date(), ...extra } },
  );
}

async function markFailed(db, bookId, reason, retries) {
  await db.collection('books').updateOne(
    { id: bookId },
    {
      $set: {
        'pipeline_auto.status': 'failed',
        'pipeline_auto.failure_reason': reason,
        'pipeline_auto.retry_count': retries,
        'pipeline_auto.updated_at': new Date(),
        updated_at: new Date(),
      },
    },
  );
}

// ══════════════════════════════════════════════════════════════════════
// Phase 6: Summary + Index
// Faithful port of src/app/api/books/[id]/index/route.ts
// ══════════════════════════════════════════════════════════════════════

// ── Wikipedia research ──
async function researchBook(title, author) {
  const searchResults = [];

  try {
    const authorQuery = encodeURIComponent(author);
    const authorRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${authorQuery}`,
      { headers: { 'User-Agent': 'SourceLibrary/1.0' } }
    );
    if (authorRes.ok) {
      const data = await authorRes.json();
      if (data.extract && data.extract.length > 50) {
        searchResults.push(`About the author (${author}):\n${data.extract}`);
      }
    }
  } catch (e) {
    // Wikipedia lookup failure is non-critical
  }

  try {
    const titleQuery = encodeURIComponent(title.replace(/[^\w\s]/g, ''));
    const titleRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${titleQuery}`,
      { headers: { 'User-Agent': 'SourceLibrary/1.0' } }
    );
    if (titleRes.ok) {
      const data = await titleRes.json();
      if (data.extract && data.extract.length > 50) {
        searchResults.push(`About "${title}":\n${data.extract}`);
      }
    }
  } catch (e) {
    // Wikipedia lookup failure is non-critical
  }

  return searchResults.join('\n\n');
}

// ── Batch extraction ──
async function processBatch(pages, bookTitle, bookAuthor, bookLanguage) {
  const model = getClient().getGenerativeModel({
    model: LITE_MODEL,
    generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
  });

  const pageRange = {
    start: pages[0].page_number,
    end: pages[pages.length - 1].page_number,
  };

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
    return { pageRange, themes: [], quotes: [], people: [], places: [], concepts: [], summary: '', usage: null };
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
    {"text": "Copy the EXACT words from the text - a striking, memorable, or important sentence or passage", "page": 5, "context": "Brief note on why this quote matters"},
    {"text": "Another VERBATIM quote copied directly from the pages above", "page": 7, "context": "Its significance"}
  ],
  "people": ["Person Name 1", "Person Name 2"],
  "places": ["Place Name 1", "Place Name 2"],
  "concepts": ["Key concept 1", "Technical term 2"],
  "summary": "2-3 sentence summary of what these pages cover and their key arguments. No em-dashes. No filler like 'delves into' or 'rich tapestry'. Short, direct sentences."
}

CRITICAL for quotes:
- Copy EXACT text from the pages - do not paraphrase or summarize
- Find memorable, striking, or important passages readers would want to highlight
- Look for: bold claims, definitions, vivid descriptions, key arguments
- Include the page number where each quote appears
- 3-5 quotes per batch`;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const usageMetadata = result.response.usageMetadata;
    const usage = {
      input_tokens: usageMetadata?.promptTokenCount || 0,
      output_tokens: usageMetadata?.candidatesTokenCount || 0,
    };

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { pageRange, themes: [], quotes: [], people: [], places: [], concepts: [], summary: '', usage };
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
      usage,
    };
  } catch (e) {
    if (e.message?.includes('429') || e.message?.includes('RESOURCE_EXHAUSTED')) {
      rotateKey();
    }
    console.error(`  Batch processing error (pages ${pageRange.start}-${pageRange.end}):`, e.message);
    return { pageRange, themes: [], quotes: [], people: [], places: [], concepts: [], summary: '', usage: null };
  }
}

// ── Batch creation ──
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

function createBatchesFromChapters(chapterTexts, pages) {
  const pageMap = new Map();
  for (const p of pages) pageMap.set(p.page_number, p);

  const batches = [];
  for (const ct of chapterTexts) {
    const batch = [];
    for (let pn = ct.pageStart; pn <= ct.pageEnd; pn++) {
      const page = pageMap.get(pn);
      if (page && page.translation?.data) batch.push(page);
    }
    if (batch.length > 0) batches.push(batch);
  }
  return batches;
}

async function processAllBatches(pages, bookTitle, bookAuthor, bookLanguage, chapterTexts) {
  const pageBatches = chapterTexts && chapterTexts.length > 1
    ? createBatchesFromChapters(chapterTexts, pages)
    : createBatches(pages);
  if (pageBatches.length === 0) return [];

  const batchSource = chapterTexts && chapterTexts.length > 1 ? 'chapters' : 'char-count';
  console.log(`    Processing ${pageBatches.length} batches (${batchSource}) in parallel...`);

  const results = await Promise.all(
    pageBatches.map(batchPages => processBatch(batchPages, bookTitle, bookAuthor, bookLanguage))
  );
  return results;
}

// ── Concept index building ──
function extractTerms(text, tag) {
  const terms = [];
  const xmlTag = tag === 'vocabulary' ? 'vocab' : tag;
  const xmlPattern = new RegExp(`<${xmlTag}>([\\s\\S]*?)</${xmlTag}>`, 'gi');
  let match;
  while ((match = xmlPattern.exec(text)) !== null) {
    const items = match[1].split(',').map(t => t.trim()).filter(Boolean);
    terms.push(...items);
  }
  const bracketPattern = new RegExp(`\\[\\[${tag}:\\s*(.*?)\\]\\]`, 'gi');
  while ((match = bracketPattern.exec(text)) !== null) {
    const items = match[1].split(',').map(t => t.trim()).filter(Boolean);
    terms.push(...items);
  }
  return terms;
}

function buildConceptIndexFromBatches(batches, pages) {
  const peopleMap = new Map();
  const placesMap = new Map();
  const conceptsMap = new Map();

  for (const batch of batches) {
    const pageNumbers = Array.from(
      { length: batch.pageRange.end - batch.pageRange.start + 1 },
      (_, i) => batch.pageRange.start + i
    );
    for (const person of batch.people) {
      if (!peopleMap.has(person)) peopleMap.set(person, []);
      peopleMap.get(person).push(...pageNumbers);
    }
    for (const place of batch.places) {
      if (!placesMap.has(place)) placesMap.set(place, []);
      placesMap.get(place).push(...pageNumbers);
    }
    for (const concept of batch.concepts) {
      if (!conceptsMap.has(concept)) conceptsMap.set(concept, []);
      conceptsMap.get(concept).push(...pageNumbers);
    }
  }

  // Vocabulary + keywords from page tags
  const vocabMap = new Map();
  const keywordMap = new Map();
  for (const page of pages) {
    const pageNum = page.page_number;
    if (page.ocr?.data) {
      for (const term of extractTerms(page.ocr.data, 'vocabulary')) {
        if (!vocabMap.has(term)) vocabMap.set(term, []);
        vocabMap.get(term).push(pageNum);
      }
    }
    if (page.translation?.data) {
      for (const term of extractTerms(page.translation.data, 'keywords')) {
        if (!keywordMap.has(term)) keywordMap.set(term, []);
        keywordMap.get(term).push(pageNum);
      }
    }
  }

  const mapToEntries = (map) =>
    Array.from(map.entries())
      .map(([term, pgs]) => ({ term, pages: [...new Set(pgs)].sort((a, b) => a - b) }))
      .sort((a, b) => b.pages.length - a.pages.length);

  return {
    vocabulary: mapToEntries(vocabMap),
    keywords: mapToEntries(keywordMap),
    people: mapToEntries(peopleMap),
    places: mapToEntries(placesMap),
    concepts: mapToEntries(conceptsMap),
  };
}

// ── Page summaries ──
function extractSummary(text) {
  const xmlMatch = text.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (xmlMatch) return xmlMatch[1].trim();
  const bracketMatch = text.match(/\[\[summary:\s*(.*?)\]\]/i);
  return bracketMatch ? bracketMatch[1].trim() : undefined;
}

function extractPageSummaries(pages) {
  const summaries = [];
  for (const page of pages) {
    const text = page.translation?.data || '';
    let summary = extractSummary(text) || page.summary?.data;
    if (!summary && text.length > 50) {
      let cleanText = text
        .replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/gi, '')
        .replace(/\[\[[^\]]+\]\]/g, '')
        .replace(/^```(?:markdown)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();
      const paragraphs = cleanText.split(/\n\n+/).filter(p => p.trim().length > 30);
      if (paragraphs.length > 0) {
        summary = paragraphs[0].trim();
        if (summary.length > 300) {
          summary = summary.substring(0, 300).replace(/\s+\S*$/, '') + '...';
        }
      }
    }
    if (summary) summaries.push({ page: page.page_number, summary });
  }
  return summaries;
}

// ── Book summary generation ──
async function generateBookSummary(batchExtractions, bookTitle, bookAuthor, bookLanguage, researchContext, chapters) {
  const model = getClient().getGenerativeModel({ model: LITE_MODEL });

  if (batchExtractions.length === 0) {
    return {
      brief: researchContext ? `A text by ${bookAuthor}. ${researchContext.substring(0, 200)}...` : `A text by ${bookAuthor}. Process page translations to generate a detailed summary.`,
      abstract: researchContext || 'No page content available yet. Process translations to generate a summary based on the actual text.',
      detailed: researchContext || 'This book has not been processed yet. Generate OCR and translations for the pages, then regenerate this summary to see content-based analysis.',
      sections: [],
      usage: null,
    };
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

  const languageContext = bookLanguage ? ` The original text is in ${bookLanguage}.` : '';
  const researchSection = researchContext ? `\n## Wikipedia Context\n${researchContext}\n` : '';
  const hasChapters = chapters && chapters.length > 0;
  const chapterSection = hasChapters ? `\n## Detected Chapter Structure\n${chapters.map(c => `- Page ${c.pageNumber}: ${c.title}`).join('\n')}\n` : '';

  const prompt = `You're writing compelling copy to help readers discover "${bookTitle}" by ${bookAuthor}.${languageContext}

${researchSection}
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

**Writing style:**
- Write like a knowledgeable human, not an AI. Be direct and concrete.
- NEVER use em-dashes (—). Use commas, colons, semicolons, or separate sentences instead.
- NEVER use these AI-isms: "delves into", "rich tapestry", "fascinating exploration", "sheds light on", "offers a window into", "comprehensive", "intricate", "nuanced", "multifaceted", "groundbreaking", "seminal".
- Prefer short, clear sentences over long compound ones.
- Scholarly but accessible. Say what the text does, not how impressive it is.

1. **BRIEF** (2-3 punchy sentences):
   - Hook the reader - what's compelling about this text?
   - What questions does it tackle? What will readers discover?

2. **ABSTRACT** (1 paragraph, 4-6 sentences):
   - What makes this text worth reading?
   - What bold claims or intriguing ideas does it contain?
   - What's the author's unique perspective?

3. **DETAILED** (2-4 paragraphs):
   - Paint a picture of the journey through this text
   - Highlight the most striking ideas or arguments
   - Convey the texture and flavor of the writing

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
      "quotes": [
        {"text": "Exact quote", "page": 3, "significance": "Why this matters"}
      ],
      "concepts": ["Key Term", "Important Concept"]
    }
  ]
}

IMPORTANT: Use the actual quotes provided above. Don't invent new ones.`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();
  const usageMetadata = result.response.usageMetadata;
  const usage = {
    input_tokens: usageMetadata?.promptTokenCount || 0,
    output_tokens: usageMetadata?.candidatesTokenCount || 0,
  };

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse book summary JSON');

  const parsed = JSON.parse(jsonMatch[0]);

  const ensureString = (val) => {
    if (typeof val === 'string') return val;
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) return val.join('\n\n');
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  };

  return {
    brief: ensureString(parsed.brief),
    abstract: ensureString(parsed.abstract),
    detailed: ensureString(parsed.detailed),
    sections: Array.isArray(parsed.sections) ? parsed.sections : [],
    usage,
  };
}

// ── Quote grounding ──
function cleanTranslationText(text) {
  return text
    .replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/gi, '')
    .replace(/\[\[[^\]]+\]\]/g, '')
    .replace(/^```(?:markdown)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

function cleanExtractedQuote(text) {
  return text
    .replace(/^>\s*/gm, '')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/\*/g, '')
    .replace(/^\d{1,3}\s+/g, '')
    .replace(/\s+\d{1,3}\s*\*?\s*\*/g, '')
    .replace(/<\/?[a-z-]+\/?>/gi, '')
    .replace(/->/g, '')
    .replace(/<-/g, '')
    .replace(/^[IVX]+\s+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function snapToSentenceBoundaries(words, start, end) {
  const sentenceEnd = /[.!?]["'\u201d\u2019)]*$/;
  const maxExtend = 12;

  let newStart = start;
  let foundStart = false;
  for (let i = start - 1; i >= Math.max(0, start - maxExtend); i--) {
    if (sentenceEnd.test(words[i])) { newStart = i + 1; foundStart = true; break; }
  }
  if (!foundStart) {
    for (let i = start; i < Math.min(words.length, start + maxExtend); i++) {
      if (/^[A-Z\u201c\u201e"'(]/.test(words[i])) { newStart = i; break; }
    }
  }

  let newEnd = end;
  for (let i = end - 1; i < Math.min(words.length, end + maxExtend); i++) {
    if (sentenceEnd.test(words[i])) { newEnd = i + 1; break; }
  }

  return { start: newStart, end: newEnd };
}

function findBestMatch(quoteText, sourceText) {
  const quoteWords = quoteText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (quoteWords.length === 0) return null;

  const sourceWords = sourceText.split(/\s+/);
  if (sourceWords.length === 0) return null;

  const windowSize = Math.max(quoteWords.length, 5);
  const maxWindow = Math.min(windowSize + Math.ceil(windowSize * 0.5), sourceWords.length);

  let bestScore = 0, bestStart = 0, bestEnd = 0;

  for (let start = 0; start <= sourceWords.length - windowSize; start++) {
    for (let winSize = windowSize; winSize <= maxWindow && start + winSize <= sourceWords.length; winSize++) {
      const windowText = sourceWords.slice(start, start + winSize).join(' ').toLowerCase();
      const matchCount = quoteWords.filter(w => windowText.includes(w)).length;
      const score = matchCount / quoteWords.length;
      if (score > bestScore) { bestScore = score; bestStart = start; bestEnd = start + winSize; }
    }
  }

  if (bestScore < 0.8) return null;

  const snapped = snapToSentenceBoundaries(sourceWords, bestStart, bestEnd);
  let extractedText = sourceWords.slice(snapped.start, snapped.end).join(' ');
  extractedText = cleanExtractedQuote(extractedText);

  if (extractedText.length > 60 && !/[.!?]["'\u201d\u2019)]*$/.test(extractedText)) {
    const lastSentenceEnd = Math.max(extractedText.lastIndexOf('.'), extractedText.lastIndexOf('!'), extractedText.lastIndexOf('?'));
    if (lastSentenceEnd > extractedText.length * 0.4) {
      extractedText = extractedText.substring(0, lastSentenceEnd + 1);
    }
  }

  if (/^[a-z]/.test(extractedText)) {
    const firstSentenceStart = extractedText.search(/[.!?]\s+[A-Z]/);
    if (firstSentenceStart > 0 && firstSentenceStart < extractedText.length * 0.4) {
      extractedText = extractedText.substring(firstSentenceStart + 2).trim();
    }
  }

  if (extractedText.length < 30) return null;

  return { score: bestScore, extractedText };
}

const NON_CONTENT_PAGE_TYPES = new Set([
  'index', 'table_of_contents', 'title_page', 'blank_page', 'colophon', 'errata',
]);

function groundQuotes(quotes, pages) {
  const pageIndex = new Map();
  for (const page of pages) {
    if (page.translation?.data && !NON_CONTENT_PAGE_TYPES.has(page.page_type || '')) {
      pageIndex.set(page.page_number, {
        text: cleanTranslationText(page.translation.data),
        page_id: page.id,
      });
    }
  }

  const grounded = [];
  for (const quote of quotes) {
    if (!quote.text || quote.text.length < 30) continue;

    const specifiedPage = pageIndex.get(quote.page);
    if (specifiedPage) {
      const match = findBestMatch(quote.text, specifiedPage.text);
      if (match) {
        grounded.push({ text: match.extractedText, page: quote.page, page_id: specifiedPage.page_id, context: quote.context, significance: quote.significance });
        continue;
      }
    }

    let bestOverall = null;
    for (const [pageNum, pageData] of pageIndex) {
      if (pageNum === quote.page) continue;
      const match = findBestMatch(quote.text, pageData.text);
      if (match && (!bestOverall || match.score > bestOverall.score)) {
        bestOverall = { score: match.score, extractedText: match.extractedText, pageNum, pageId: pageData.page_id };
      }
    }

    if (bestOverall) {
      grounded.push({ text: bestOverall.extractedText, page: bestOverall.pageNum, page_id: bestOverall.pageId, context: quote.context, significance: quote.significance });
    }
  }

  return grounded;
}

// ── Entity sync ──
async function syncBookEntities(db, bookId, bookTitle, bookAuthor, conceptIndex, bookYear) {
  // Load alias resolver from entity_aliases collection
  const aliasDocs = await db.collection('entity_aliases')
    .find({})
    .project({ alias_lower: 1, canonical_name: 1, type: 1 })
    .toArray();

  const aliasMap = new Map();
  for (const doc of aliasDocs) {
    aliasMap.set(`${doc.type}:${doc.alias_lower}`, doc.canonical_name);
  }

  function resolve(name, type) {
    return aliasMap.get(`${type}:${name.toLowerCase()}`) || name;
  }

  const now = new Date();

  async function syncEntity(term, type, pages) {
    const canonicalName = resolve(term, type);
    const update = {
      $set: { updated_at: now },
      $setOnInsert: { name: canonicalName, type, created_at: now },
      $addToSet: {
        books: {
          book_id: bookId,
          book_title: bookTitle,
          book_author: bookAuthor,
          ...(bookYear ? { book_year: bookYear } : {}),
          pages,
        },
      },
    };
    if (term !== canonicalName) {
      update.$addToSet.aliases = term;
    }
    await db.collection('entities').updateOne({ name: canonicalName, type }, update, { upsert: true });
  }

  const promises = [];
  for (const person of conceptIndex.people) {
    if (!person.term) continue;
    promises.push(syncEntity(person.term, 'person', person.pages));
  }
  for (const place of conceptIndex.places) {
    if (!place.term) continue;
    promises.push(syncEntity(place.term, 'place', place.pages));
  }
  for (const concept of conceptIndex.concepts) {
    if (!concept.term) continue;
    promises.push(syncEntity(concept.term, 'concept', concept.pages));
  }
  await Promise.all(promises);

  // Update book_count + total_mentions
  const allTerms = [
    ...conceptIndex.people.filter(p => p.term).map(p => ({ name: resolve(p.term, 'person'), type: 'person' })),
    ...conceptIndex.places.filter(p => p.term).map(p => ({ name: resolve(p.term, 'place'), type: 'place' })),
    ...conceptIndex.concepts.filter(p => p.term).map(p => ({ name: resolve(p.term, 'concept'), type: 'concept' })),
  ];
  const uniqueTerms = [...new Map(allTerms.map(t => [`${t.type}:${t.name}`, t])).values()];

  for (const { name, type } of uniqueTerms) {
    const entity = await db.collection('entities').findOne({ name, type });
    if (entity) {
      const bookCount = entity.books?.length || 0;
      const totalMentions = (entity.books || []).reduce((sum, b) => sum + (b.pages?.length || 0), 0);
      await db.collection('entities').updateOne({ name, type }, { $set: { book_count: bookCount, total_mentions: totalMentions } });
    }
  }

  console.log(`    Synced ${promises.length} entities`);
}

// ── Main Phase 6 function ──
async function enrichBook(db, book) {
  const bookTitle = book.display_title || book.title;
  const bookAuthor = book.author || 'Unknown';
  const bookId = book.id;

  console.log(`  [Phase 6] ${bookTitle}`);

  // Get all pages
  const pages = await db.collection('pages')
    .find({ book_id: bookId })
    .sort({ page_number: 1 })
    .toArray();

  const translatedCount = pages.filter(p => p.translation?.data).length;
  console.log(`    ${translatedCount}/${pages.length} pages translated`);

  // Get chapters for section structure
  const chapters = (book.chapters || []).map(c => ({
    title: c.title,
    pageNumber: c.pageNumber,
    level: c.level || 1,
  }));

  // Fetch chapter texts for chapter-aligned batching
  const chapterTexts = await db.collection('chapter_texts')
    .find({ book_id: bookId })
    .sort({ chapter_index: 1, part: 1 })
    .toArray();
  const useChapters = chapterTexts.length > 1;

  // Research in parallel with batch processing
  const researchPromise = researchBook(bookTitle, bookAuthor).catch(() => '');

  // Process batches
  const batchExtractions = await processAllBatches(
    pages, bookTitle, bookAuthor, book.language || undefined,
    useChapters ? chapterTexts : undefined
  );

  const researchContext = await researchPromise;

  // Build concept index
  const conceptIndex = buildConceptIndexFromBatches(batchExtractions, pages);

  // Page summaries
  const pageSummaries = batchExtractions.flatMap(batch =>
    batch.summary ? [{ page: batch.pageRange.start, summary: batch.summary }] : []
  );

  // Generate final summary
  let bookSummary = { brief: '', abstract: '', detailed: '' };
  let sectionSummaries = [];
  let summaryUsage = null;

  if (batchExtractions.length > 0 || researchContext) {
    try {
      const generated = await generateBookSummary(
        batchExtractions, bookTitle, bookAuthor,
        book.language || undefined,
        researchContext || undefined,
        chapters.length > 0 ? chapters : undefined
      );
      bookSummary = { brief: generated.brief, abstract: generated.abstract, detailed: generated.detailed };
      sectionSummaries = generated.sections || [];
      summaryUsage = generated.usage;
    } catch (e) {
      console.error(`    Summary generation failed:`, e.message);
    }
  }

  // Ground quotes
  const allBatchQuotes = batchExtractions.flatMap(b => b.quotes);
  const groundedBatchQuotes = groundQuotes(allBatchQuotes, pages);
  const droppedBatch = allBatchQuotes.length - groundedBatchQuotes.length;
  if (droppedBatch > 0) {
    console.log(`    Quote grounding: dropped ${droppedBatch}/${allBatchQuotes.length} batch quotes`);
  }

  for (const section of sectionSummaries) {
    if (section.quotes && section.quotes.length > 0) {
      section.quotes = groundQuotes(section.quotes, pages);
    }
  }

  // Build index
  const index = {
    ...conceptIndex,
    pageSummaries,
    sectionSummaries,
    bookSummary,
    generatedAt: new Date(),
    pagesCovered: pageSummaries.length,
    totalPages: pages.length,
  };

  // Save to DB
  const updateData = { index, updated_at: new Date() };

  if (bookSummary.brief) {
    updateData.summary = {
      data: bookSummary.brief,
      generated_at: new Date(),
      page_coverage: Math.round((pageSummaries.length / pages.length) * 100),
      model: LITE_MODEL,
    };
    updateData.reading_summary = {
      overview: bookSummary.abstract || bookSummary.brief,
      detailed: bookSummary.detailed || '',
      themes: batchExtractions.flatMap(b => b.themes).filter((v, i, a) => a.indexOf(v) === i).slice(0, 20),
      quotes: groundedBatchQuotes.slice(0, 15),
      generated_at: new Date(),
      model: LITE_MODEL,
    };
  }

  await db.collection('books').updateOne(
    { id: bookId },
    { $set: updateData, $unset: { enrichment_stale: '' } }
  );

  // Log Gemini usage for batch extractions
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const batch of batchExtractions) {
    if (batch.usage) {
      totalInputTokens += batch.usage.input_tokens;
      totalOutputTokens += batch.usage.output_tokens;
    }
  }

  if (totalInputTokens > 0) {
    await logUsage(db, {
      type: 'index', mode: 'realtime', model: LITE_MODEL,
      book_id: bookId, book_title: bookTitle,
      page_count: translatedCount,
      input_tokens: totalInputTokens, output_tokens: totalOutputTokens,
      status: 'success', endpoint: 'worker/hetzner-enrich',
    });
  }

  if (summaryUsage) {
    await logUsage(db, {
      type: 'summary', mode: 'realtime', model: LITE_MODEL,
      book_id: bookId, book_title: bookTitle,
      page_count: batchExtractions.length,
      input_tokens: summaryUsage.input_tokens, output_tokens: summaryUsage.output_tokens,
      status: 'success', endpoint: 'worker/hetzner-enrich',
    });
  }

  // Sync entities (non-blocking)
  syncBookEntities(db, bookId, bookTitle, bookAuthor, conceptIndex, book.year || null).catch(err => {
    console.error(`    Entity sync failed:`, err.message);
  });

  console.log(`    Done — ${batchExtractions.length} batches, ${groundedBatchQuotes.length} quotes, ${sectionSummaries.length} sections`);
}


// ══════════════════════════════════════════════════════════════════════
// Phase 7: Chapter Extraction
// Faithful port of src/lib/chapter-extraction.ts
// ══════════════════════════════════════════════════════════════════════

function extractRawHeadings(text, pageNumber, source) {
  const headings = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (/^<(margin|meta|header|sig|page-num|language|page-type|columns|warning|summary|keywords)>/.test(trimmed)) continue;

    let title = null;
    let level = 2;

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      level = headingMatch[1].length;
      title = headingMatch[2].trim().replace(/^->/, '').replace(/<-$/, '').replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
    }

    if (!title) {
      const centeredMatch = trimmed.match(/^->\*(.+)\*<-$/);
      if (centeredMatch) { title = centeredMatch[1].trim(); level = 2; }
    }

    if (!title) {
      const boldMatch = trimmed.match(/^\*\*([A-Z][^*]{3,80})\*\*$/);
      if (boldMatch) { title = boldMatch[1].trim(); level = 1; }
    }

    if (!title || title.length < 3) continue;

    const contextLines = [];
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const cl = lines[j].trim();
      if (cl && !cl.startsWith('<') && cl.length > 10) contextLines.push(cl.slice(0, 100));
    }

    headings.push({
      title, level, pageNumber, source,
      context: contextLines.join(' | ').slice(0, 200) || undefined,
    });
  }

  return headings;
}

function buildExtractionPrompt(bookTitle, author, language, pageCount, rawHeadings, tocPages, sectionHints) {
  let prompt = `You are analyzing the structure of a digitized historical book to extract its table of contents.

**Book:** ${bookTitle}
**Author:** ${author}
**Language:** ${language}
**Total pages:** ${pageCount}

`;

  if (sectionHints.length > 0) {
    prompt += `## Prior Section Analysis\n\nA previous AI analysis identified these broad sections (use as hints, not gospel — page numbers may be approximate):\n\n`;
    for (const s of sectionHints) prompt += `- "${s.title}" (pp. ${s.startPage}–${s.endPage})\n`;
    prompt += '\n';
  }

  if (tocPages.length > 0) {
    prompt += `## Table of Contents Pages\n\nThe following pages appear to contain a printed table of contents:\n\n`;
    for (const toc of tocPages) prompt += `### Page ${toc.pageNumber}\n\`\`\`\n${toc.text.slice(0, 3000)}\n\`\`\`\n\n`;
  }

  const ocrHeadings = rawHeadings.filter(h => h.source === 'ocr');
  const translationHeadings = rawHeadings.filter(h => h.source === 'translation');
  const tocPageNumbers = new Set(tocPages.map(t => t.pageNumber));

  prompt += `## Headings Found in the Text

Below are headings from the OCR and translation, with context lines after each.
- If context shows body text (prose, arguments), the heading likely starts a real chapter.
- If context shows more chapter titles or page numbers, the heading is inside a table of contents.
- If a heading appears in the TOC AND later in the body, use the BODY page number.

`;

  const allByPage = new Map();
  for (const h of [...ocrHeadings, ...translationHeadings]) {
    const arr = allByPage.get(h.pageNumber) || [];
    arr.push(h);
    allByPage.set(h.pageNumber, arr);
  }

  const sortedPages = [...allByPage.keys()].sort((a, b) => a - b);
  for (const pageNum of sortedPages) {
    const pageHeadings = allByPage.get(pageNum);
    const isTocPage = tocPageNumbers.has(pageNum);
    const prefix = isTocPage ? '[TOC] ' : '';
    for (const h of pageHeadings) {
      prompt += `${prefix}p.${pageNum}: ${'#'.repeat(h.level)} ${h.title}\n`;
      if (h.context) prompt += `  → ${h.context}\n`;
    }
  }

  prompt += `

## Instructions

Return the real structural chapters as a JSON array. CRITICAL rules:
- "pageNumber" must be where chapter TEXT BEGINS in the body, NOT where it appears in a table of contents
- Headings marked [TOC] are from table of contents pages — use them to understand structure, but find the BODY page where each chapter actually starts
- Verify each chapter by checking context: does body text follow, or more chapter listings?

Each entry:
- "title": Clean chapter title in the original language (fix obvious OCR errors)
- "titleEn": English translation (concise — e.g., "Tractatus I: De Macrocosmi Historia" → "Treatise I: On the History of the Macrocosm"). Omit if already English.
- "pageNumber": Page where this chapter's TEXT begins (not TOC reference)
- "level": 1 = top-level (Tractatus/Part/Book/Tomus/Volume), 2 = chapter (Liber/Section/Caput), 3 = sub-chapter
- "confidence": "high"/"medium"/"low"

Guidelines:
- Look for the book's actual organizational structure (Parts, Books, Chapters, Sections, Tractatus, Liber, Caput, Tomus, Volumen, Band, etc.)
- For multi-volume works: use level 1 for volumes, level 2 for chapters within. Chapter numbering restarts per volume.
- SKIP: title pages, dedications, indices, running headers, image captions, colophons
- INCLUDE: prefaces/prologues if they are labeled sections
- A typical book has 5-50 chapters. Over 80 usually means noise.
- Cross-reference OCR and translation headings — prefer the cleaner version for "title"

Respond with ONLY a JSON array, no markdown fences, no explanation:
[{"title": "...", "titleEn": "...", "pageNumber": N, "level": N, "confidence": "high|medium|low"}, ...]

Empty array [] if no discernible structure.`;

  return prompt;
}

function computeEndPages(chapters, totalPages) {
  for (let i = 0; i < chapters.length; i++) {
    if (i < chapters.length - 1) {
      chapters[i].endPage = chapters[i + 1].pageNumber - 1;
    } else {
      chapters[i].endPage = totalPages;
    }
  }
  return chapters;
}

async function extractChaptersForBook(db, bookId) {
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) throw new Error('Book not found');

  const pages = await db.collection('pages')
    .find(
      { book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } },
      { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, page_type: 1 } }
    )
    .sort({ page_number: 1 })
    .toArray();

  if (pages.length === 0) throw new Error('No pages with OCR found');

  // Extract raw headings
  const rawHeadings = [];
  for (const page of pages) {
    rawHeadings.push(...extractRawHeadings(page.ocr?.data || '', page.page_number, 'ocr'));
    if (page.translation?.data) {
      rawHeadings.push(...extractRawHeadings(page.translation.data, page.page_number, 'translation'));
    }
  }

  // Identify TOC pages
  const tocPages = [];
  for (const page of pages) {
    const ocrText = (page.ocr?.data || '').toLowerCase();
    const isTocByType = page.page_type === 'table_of_contents' || page.page_type === 'index';
    const isTocByContent = /\b(tabula|index|contents|sommaire|inhalt|capitum|capitulorum)\b/i.test(ocrText)
      && page.page_number <= Math.min(30, pages.length * 0.1);
    if (isTocByType || isTocByContent) {
      tocPages.push({ pageNumber: page.page_number, text: page.ocr?.data || '' });
    }
  }

  // Section hints from book index
  const sectionHints = [];
  if (book.index?.sectionSummaries) {
    for (const section of book.index.sectionSummaries) {
      if (section.title && section.startPage) {
        sectionHints.push({ title: section.title, startPage: section.startPage, endPage: section.endPage || section.startPage });
      }
    }
  }

  // Call Gemini
  const modelId = DEFAULT_MODEL;
  const model = getClient().getGenerativeModel({ model: modelId });
  const prompt = buildExtractionPrompt(
    book.display_title || book.title,
    book.author || 'Unknown',
    book.language || book.original_language || 'Unknown',
    pages.length,
    rawHeadings,
    tocPages.slice(0, 5),
    sectionHints,
  );

  const result = await model.generateContent(prompt);
  const response = result.response;
  const responseText = response.text();
  const usageMetadata = response.usageMetadata;
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = usageMetadata?.candidatesTokenCount || 0;

  // Parse AI response
  let aiChapters;
  try {
    let cleaned = responseText.trim();
    const jsonBlockMatch = cleaned.match(/```json?\s*\n?([\s\S]*?)\n?```/);
    if (jsonBlockMatch) {
      cleaned = jsonBlockMatch[1].trim();
    } else {
      cleaned = cleaned.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    }
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) cleaned = arrayMatch[0];
    aiChapters = JSON.parse(cleaned);
  } catch {
    throw new Error(`AI returned unparseable response: ${responseText.slice(0, 500)}`);
  }

  // Validate and map chapters
  const pageByNumber = new Map();
  for (const page of pages) pageByNumber.set(page.page_number, page.id);

  const chapters = [];
  for (const ch of aiChapters) {
    if (!ch.title || !ch.pageNumber) continue;
    let pageId = pageByNumber.get(ch.pageNumber);
    if (!pageId) {
      for (let offset = 1; offset <= 2; offset++) {
        pageId = pageByNumber.get(ch.pageNumber + offset) || pageByNumber.get(ch.pageNumber - offset);
        if (pageId) break;
      }
    }
    if (!pageId) continue;

    const chapter = {
      title: ch.title,
      pageId,
      pageNumber: ch.pageNumber,
      level: Math.min(Math.max(ch.level || 1, 1), 3),
    };
    if (ch.titleEn) chapter.titleEn = ch.titleEn;
    if (ch.confidence === 'high' || ch.confidence === 'medium' || ch.confidence === 'low') {
      chapter.confidence = ch.confidence;
    }
    chapters.push(chapter);
  }

  chapters.sort((a, b) => a.pageNumber - b.pageNumber);
  computeEndPages(chapters, pages.length);

  // Save
  await db.collection('books').updateOne(
    { id: bookId },
    { $set: { chapters, chapters_extracted_at: new Date() } }
  );

  // Log usage
  await logUsage(db, {
    type: 'extract_chapters', mode: 'realtime', model: modelId,
    book_id: bookId, page_count: pages.length,
    input_tokens: inputTokens, output_tokens: outputTokens,
    status: 'success', endpoint: 'worker/hetzner-enrich',
  });

  const translationHeadingsCount = rawHeadings.filter(h => h.source === 'translation').length;
  console.log(`    ${chapters.length} chapters extracted (${rawHeadings.filter(h => h.source === 'ocr').length} OCR headings, ${translationHeadingsCount} translation headings, ${tocPages.length} TOC pages)`);

  return { chapters, inputTokens, outputTokens };
}


// ══════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════

async function main() {
  if (!MONGODB_URI) { console.error('[ENRICH] MONGODB_URI not set'); process.exit(1); }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(`[ENRICH] ${new Date().toISOString()} — phase=${phaseArg}, dry-run=${DRY_RUN}`);

  let enriched = 0;
  let chaptersExtracted = 0;
  let errors = [];

  // ── Phase 6: Summary + Index ──
  if (RUN_PHASE_6) {
    console.log('\n=== Phase 6: Summary + Index ===');

    let books;
    if (SINGLE_BOOK) {
      const book = await db.collection('books').findOne({ id: SINGLE_BOOK });
      books = book ? [book] : [];
    } else {
      books = await db.collection('books')
        .find({ 'pipeline_auto.status': 'translate_complete' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, display_title: 1, author: 1, language: 1, year: 1, chapters: 1, 'pipeline_auto.retry_count': 1, 'image_source.provider': 1 })
        .limit(PHASE_6_LIMIT)
        .toArray();
    }

    console.log(`  Books ready: ${books.length}`);

    for (const book of books) {
      try {
        if (DRY_RUN) { console.log(`  Would enrich: ${book.title}`); continue; }

        await setPipelineStatus(db, book.id, 'summarizing');

        await enrichBook(db, book);

        await setPipelineStatus(db, book.id, 'summary_indexed', { 'pipeline_auto.retry_count': 0 });
        enriched++;
      } catch (err) {
        const retries = book.pipeline_auto?.retry_count || 0;
        if (retries >= MAX_RETRIES) {
          await markFailed(db, book.id, `Summary+Index: ${err.message}`, retries);
        } else {
          await setPipelineStatus(db, book.id, 'translate_complete', { 'pipeline_auto.retry_count': retries + 1 });
        }
        errors.push(`Summary+Index ${book.id}: ${err.message}`);
        console.error(`  ERROR [${book.title}]:`, err.message);
      }
    }
    console.log(`  Enriched: ${enriched}`);
  }

  // ── Phase 7: Chapter Extraction ──
  if (RUN_PHASE_7) {
    console.log('\n=== Phase 7: Chapter Extraction ===');

    let books;
    if (SINGLE_BOOK) {
      const book = await db.collection('books').findOne({ id: SINGLE_BOOK });
      books = book ? [book] : [];
    } else {
      books = await db.collection('books')
        .find({ 'pipeline_auto.status': 'summary_indexed' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.retry_count': 1 })
        .limit(PHASE_7_LIMIT)
        .toArray();
    }

    console.log(`  Books ready: ${books.length}`);

    for (const book of books) {
      try {
        if ((book.pages_count || 0) < 10) {
          if (!DRY_RUN) await setPipelineStatus(db, book.id, 'chapters_complete', { 'pipeline_auto.retry_count': 0 });
          console.log(`  Skipped (< 10 pages): ${book.title}`);
          continue;
        }

        if (DRY_RUN) { console.log(`  Would extract chapters: ${book.title}`); continue; }

        await setPipelineStatus(db, book.id, 'chapters');

        await extractChaptersForBook(db, book.id);

        await setPipelineStatus(db, book.id, 'chapters_complete', { 'pipeline_auto.retry_count': 0 });
        chaptersExtracted++;
      } catch (err) {
        if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) rotateKey();

        const retries = book.pipeline_auto?.retry_count || 0;
        if (retries >= MAX_RETRIES) {
          // Non-critical, skip
          if (!DRY_RUN) await setPipelineStatus(db, book.id, 'chapters_complete', { 'pipeline_auto.retry_count': 0 });
        } else {
          if (!DRY_RUN) await setPipelineStatus(db, book.id, 'summary_indexed', { 'pipeline_auto.retry_count': retries + 1 });
        }
        errors.push(`Chapters ${book.id}: ${err.message}`);
        console.error(`  ERROR [${book.title}]:`, err.message);
      }
    }
    console.log(`  Chapters extracted: ${chaptersExtracted}`);
  }

  // Summary
  console.log(`\n[ENRICH] Done — enriched=${enriched}, chapters=${chaptersExtracted}, errors=${errors.length}`);
  if (errors.length > 0) {
    console.log('  Errors:');
    for (const err of errors.slice(0, 10)) console.log(`    ${err}`);
  }

  await client.close();
}

main().catch(err => {
  console.error('[ENRICH] Fatal:', err);
  process.exit(1);
});
