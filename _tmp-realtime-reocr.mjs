#!/usr/bin/env node
/**
 * Realtime re-OCR script for Hetzner.
 * Re-OCRs pages that have old OCR (no prompt_version or old prompt_version)
 * using the current v5 prompt with gemini-3-flash-preview.
 *
 * Creates a revision of the old OCR before overwriting.
 * Extracts page_type, columns, detected_images from new OCR output.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node _tmp-realtime-reocr.mjs
 *   node _tmp-realtime-reocr.mjs --dry-run
 *   node _tmp-realtime-reocr.mjs --concurrency=5 --limit=50
 *   node _tmp-realtime-reocr.mjs --book-id=abc123
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';

// ── Config ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CONCURRENCY = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '5');
const BOOK_LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');
const SINGLE_BOOK = args.find(a => a.startsWith('--book-id='))?.split('=')[1];
const OFFSET = parseInt(args.find(a => a.startsWith('--offset='))?.split('=')[1] || '0');
const MODEL = 'gemini-3-flash-preview';
const PROMPT_VERSION = 'v5.2026-02';

// Safety settings — disable all for historical texts
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// ── API Key Rotation ────────────────────────────────────────────────────
const API_KEYS = [
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 9 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`]),
  process.env.GEMINI_API_KEY_TIER3,
].filter(Boolean);

if (API_KEYS.length === 0) {
  console.error('No GEMINI_API_KEY found in environment');
  process.exit(1);
}

let keyIndex = 0;
const keyCooldowns = new Map();

function getClient() {
  const now = Date.now();
  let attempts = 0;
  while (attempts < API_KEYS.length) {
    const key = API_KEYS[keyIndex % API_KEYS.length];
    keyIndex++;
    const cooldownUntil = keyCooldowns.get(key) || 0;
    if (now >= cooldownUntil) {
      return new GoogleGenerativeAI(key);
    }
    attempts++;
  }
  console.warn('[WARN] All API keys in cooldown, using first available');
  const key = API_KEYS[keyIndex % API_KEYS.length];
  keyIndex++;
  return new GoogleGenerativeAI(key);
}

function cooldownKey(key, durationMs = 60000) {
  keyCooldowns.set(key, Date.now() + durationMs);
}

// ── OCR Prompt ──────────────────────────────────────────────────────────
// Hardcoded fallback — the DB prompt is preferred
const DEFAULT_OCR_PROMPT = `Transcribe this historical manuscript page to Markdown.

**Context:** This is a scholarly digitization project transcribing public domain manuscripts (16th-18th century) from institutional archives. All materials are out of copyright and provided by partner libraries for open access.

{language_instruction}

**Format:**
- # ## ### for headings (bigger text = bigger heading) — NEVER combine with centering syntax
- **bold**, *italic* for emphasis
- ->centered text<- for centered lines (NOT for headings)
- > blockquotes for quotes/prayers
- --- for dividers

**Tables:** Use markdown tables ONLY for actual tabular data with clear rows/columns:
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| data | data | data |

**DO NOT use tables for:**
- Circular diagrams
- Charts or graphs
- Any visual layout that isn't truly tabular

**Metadata tags (hidden from readers):**
- <language>X</language> — the detected language of this page (REQUIRED — always identify the language, e.g. Latin, German, French, English)
- <page-type>X</page-type> — classify this page (REQUIRED). One of: title-page, frontispiece, dedication, preface, toc, index, errata, colophon, appendix, blank, illustration, diagram, map, text
- <columns>N</columns> — number of text columns on this page (omit for single-column pages, include for 2+ columns)
- <page-num>N</page-num> — visible page/folio numbers (NOT in body text)
- <header>X</header> — running headers/chapter titles at top of page (NEVER duplicate as heading in body)
- <sig>X</sig> — printer's marks like A2, B1 (NOT in body text)
- <meta>X</meta> — hidden metadata (image quality, catchwords)
- <warning>X</warning> — quality issues (faded, damaged, blurry)
- <vocab>X</vocab> — key terms for indexing

**Inline annotations (visible to readers):**
- <margin>X</margin> — marginal notes, citations (place BEFORE the paragraph they annotate)
- <gloss>X</gloss> — interlinear annotations
- <insert>X</insert> — boxed text, later additions (inline only, not around tables)
- <unclear>X</unclear> — illegible readings
- <note>X</note> — interpretive notes for readers
- <term>X</term> — technical vocabulary

**Column layout:** If the page has two (or more) text columns, transcribe the left column first, then insert <column-break/> on its own line, then transcribe the right column. Do NOT use <column-break/> for single-column pages.

**Critical rules:**
1. Preserve original spelling, capitalization, punctuation
2. Page numbers/headers/signatures go in metadata tags ONLY — NEVER duplicate as ## headings or body text. Example: "DISCURSUS IV." at top of page → <header>DISCURSUS IV.</header> and nothing else
3. Decorative initials (drop caps): merge large ornamental first letters with the word they begin. A large "L" followed by "EX" → "Lex", not "L Ex"
4. IGNORE partial text at left/right edges (from facing page in spread)
5. Capture ALL text including margins and annotations
6. End with <vocab>key terms, names, concepts</vocab>

**If image has quality issues**, start with <warning>describe issue</warning>

**IMAGE DETECTION:** If the page contains ANY illustrations, diagrams, emblems, woodcuts, engravings, or decorative elements, add at the END:

<detected-images>
[{"description": "Brief description", "type": "emblem|woodcut|engraving|diagram|portrait|frontispiece|decorative|map", "bbox": {"x": 0.1, "y": 0.2, "width": 0.7, "height": 0.5}, "gallery_quality": 0.85, "museum_rationale": "Why museum-worthy or not"}]
</detected-images>

**Bounding box (0.0-1.0):** x=left edge, y=top edge. Measure PRECISELY to tightly enclose each illustration.

**Gallery quality:**
- 0.9-1.0: Museum-worthy — striking emblems, allegorical scenes, beautiful engravings
- 0.7-0.9: High — well-executed illustrations, interesting diagrams
- 0.4-0.7: Moderate — standard frontispieces, simple diagrams
- 0.0-0.4: Low — page ornaments, generic borders, printer's marks

If text-only page, omit the <detected-images> block.`;

const LANGUAGE_INSTRUCTION = `**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).`;

// ── Metadata extractors ─────────────────────────────────────────────────

const VALID_PAGE_TYPES = new Set([
  'title-page', 'frontispiece', 'dedication', 'preface', 'toc', 'index',
  'errata', 'colophon', 'appendix', 'blank', 'illustration', 'diagram', 'map', 'text',
]);

function extractPageType(ocrText) {
  const match = ocrText.match(/<page-type>([\s\S]*?)<\/page-type>/i);
  if (!match) return undefined;
  const type = match[1].trim().toLowerCase();
  return VALID_PAGE_TYPES.has(type) ? type : undefined;
}

function extractColumns(ocrText) {
  const match = ocrText.match(/<columns>(\d+)<\/columns>/i);
  if (!match) return undefined;
  const n = parseInt(match[1], 10);
  return n > 1 ? n : undefined;
}

function extractLanguage(ocrText) {
  const match = ocrText.match(/<language>([\s\S]*?)<\/language>/i);
  if (!match) return undefined;
  return match[1].trim();
}

const VALID_IMAGE_TYPES = new Set([
  'woodcut', 'diagram', 'chart', 'illustration', 'symbol', 'table', 'map',
  'decorative', 'emblem', 'engraving', 'portrait', 'frontispiece', 'musical_score', 'unknown',
]);

function parseDetectedImages(ocrText) {
  const match = ocrText.match(/<detected-images>([\s\S]*?)<\/detected-images>/i);
  if (!match) return [];
  try {
    const raw = JSON.parse(match[1].trim());
    if (!Array.isArray(raw)) return [];
    const now = new Date();
    return raw
      .filter(img => img && typeof img.description === 'string')
      .map(img => {
        const result = {
          description: img.description,
          detection_source: 'ocr_tag',
          detected_at: now,
        };
        if (typeof img.type === 'string' && VALID_IMAGE_TYPES.has(img.type)) result.type = img.type;
        if (img.bbox && typeof img.bbox === 'object') {
          const b = img.bbox;
          if (typeof b.x === 'number' && typeof b.y === 'number' &&
              typeof b.width === 'number' && typeof b.height === 'number') {
            result.bbox = { x: b.x, y: b.y, width: b.width, height: b.height };
          }
        }
        if (typeof img.gallery_quality === 'number') result.gallery_quality = Math.max(0, Math.min(1, img.gallery_quality));
        if (typeof img.museum_rationale === 'string') result.gallery_rationale = img.museum_rationale;
        if (typeof img.confidence === 'number') result.confidence = img.confidence;
        if (typeof img.museum_description === 'string') result.museum_description = img.museum_description;
        if (img.metadata && typeof img.metadata === 'object') {
          const m = img.metadata;
          result.metadata = {};
          if (Array.isArray(m.subjects)) result.metadata.subjects = m.subjects.filter(s => typeof s === 'string');
          if (Array.isArray(m.figures)) result.metadata.figures = m.figures.filter(s => typeof s === 'string');
          if (Array.isArray(m.symbols)) result.metadata.symbols = m.symbols.filter(s => typeof s === 'string');
          if (typeof m.style === 'string') result.metadata.style = m.style;
          if (typeof m.technique === 'string') result.metadata.technique = m.technique;
        }
        return result;
      });
  } catch {
    return [];
  }
}

// ── Pricing ─────────────────────────────────────────────────────────────
const PRICING = {
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  default: { input: 0.10, output: 0.40 },
};

function calcCost(inputTokens, outputTokens, model) {
  const p = PRICING[model] || PRICING.default;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

function generateId() {
  return `gu_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function revisionId() {
  return `rev_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

// ── Stats ───────────────────────────────────────────────────────────────
const stats = {
  booksProcessed: 0,
  pagesOcrd: 0,
  pagesSkipped: 0,
  pagesErrored: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCost: 0,
  startTime: Date.now(),
  errors: [],
};

function printProgress() {
  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
  const rate = stats.pagesOcrd > 0 ? (elapsed / stats.pagesOcrd).toFixed(1) : '?';
  console.log(
    `  [${elapsed}s] ${stats.pagesOcrd} OCR'd, ${stats.pagesSkipped} skipped, ` +
    `${stats.pagesErrored} errors, $${stats.totalCost.toFixed(4)} cost, ${rate}s/page`
  );
}

// ── Main ────────────────────────────────────────────────────────────────
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

console.log(`Realtime Re-OCR Script`);
console.log(`Model: ${MODEL}, Concurrency: ${CONCURRENCY}, API keys: ${API_KEYS.length}`);
console.log(`Dry run: ${DRY_RUN}`);
console.log('');

// Fetch OCR prompt from DB (or fall back to hardcoded)
let ocrPrompt = DEFAULT_OCR_PROMPT;
try {
  const promptDoc = await db.collection('prompts').findOne(
    { type: 'ocr', is_default: true },
    { sort: { version: -1 } }
  );
  if (promptDoc?.content) {
    ocrPrompt = promptDoc.content;
    console.log(`Using DB OCR prompt: "${promptDoc.name}" v${promptDoc.version}`);
  } else {
    console.log('No DB OCR prompt found, using hardcoded default');
  }
} catch (e) {
  console.log('Failed to fetch DB prompt, using hardcoded default');
}

// Apply language instruction
ocrPrompt = ocrPrompt
  .replace('{language_instruction}', LANGUAGE_INSTRUCTION)
  .replace('{language}', '');

// ── Find books with old-OCR pages ───────────────────────────────────────
// Old OCR = has ocr.data but no ocr.prompt_version (or prompt_version < v5)
console.log('Scanning for books with old-OCR pages (aggregation)...');

let booksToProcess;
if (SINGLE_BOOK) {
  const book = await db.collection('books').findOne(
    { id: SINGLE_BOOK },
    { projection: { id: 1, title: 1, slug: 1, language: 1, original_language: 1, read_count: 1, pages_count: 1 } }
  );
  if (!book) { console.error('Book not found'); process.exit(1); }
  const count = await db.collection('pages').countDocuments({
    book_id: SINGLE_BOOK,
    'ocr.data': { $exists: true, $ne: '' },
    $or: [
      { 'ocr.prompt_version': { $exists: false } },
      { 'ocr.prompt_version': null },
    ],
  });
  booksToProcess = count > 0 ? [{ ...book, oldOcrCount: count }] : [];
} else {
  const aggResult = await db.collection('pages').aggregate([
    {
      $match: {
        'ocr.data': { $exists: true, $ne: '' },
        $or: [
          { 'ocr.prompt_version': { $exists: false } },
          { 'ocr.prompt_version': null },
        ],
      },
    },
    { $group: { _id: '$book_id', oldOcrCount: { $sum: 1 } } },
  ], { allowDiskUse: true }).toArray();

  console.log(`Found ${aggResult.length} books with old-OCR pages`);

  const bookIds = aggResult.map(r => r._id);
  const bookDocs = await db.collection('books')
    .find({ id: { $in: bookIds } })
    .project({ id: 1, title: 1, slug: 1, language: 1, original_language: 1, read_count: 1, pages_count: 1 })
    .toArray();

  const bookMap = new Map(bookDocs.map(b => [b.id, b]));
  booksToProcess = aggResult
    .map(r => ({ ...bookMap.get(r._id), oldOcrCount: r.oldOcrCount }))
    .filter(b => b.id)
    .sort((a, b) => (b.read_count || 0) - (a.read_count || 0));

  if (OFFSET > 0) booksToProcess = booksToProcess.slice(OFFSET);
  if (BOOK_LIMIT > 0) booksToProcess = booksToProcess.slice(0, BOOK_LIMIT);
}

const totalPages = booksToProcess.reduce((s, b) => s + b.oldOcrCount, 0);
console.log(`\n${booksToProcess.length} books need re-OCR (${totalPages} total pages)`);

if (DRY_RUN) {
  console.log('\n=== DRY RUN — Top 30 books ===');
  for (const b of booksToProcess.slice(0, 30)) {
    const lang = b.language || b.original_language || 'Unknown';
    console.log(`  ${(b.title || '').substring(0, 50)} [${lang}] — ${b.oldOcrCount} pages (reads: ${b.read_count || 0})`);
  }
  if (booksToProcess.length > 30) console.log(`  ... and ${booksToProcess.length - 30} more`);
  const estCost = totalPages * 0.0023;
  console.log(`\nEstimated cost: $${estCost.toFixed(2)}`);
  await client.close();
  process.exit(0);
}

// ── Image fetching ──────────────────────────────────────────────────────

function getPageImageUrl(page) {
  // Fallback chain: cropped_photo → archived_photo → photo → photo_original
  if (page.cropped_photo && page.cropped_photo.startsWith('http')) return page.cropped_photo;
  if (page.archived_photo && page.archived_photo.startsWith('http') && !page.archived_photo.startsWith('failed:')) return page.archived_photo;
  if (page.photo && page.photo.startsWith('http')) return page.photo;
  if (page.photo_original && page.photo_original.startsWith('http')) return page.photo_original;
  return null;
}

async function fetchImage(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const mimeType = resp.headers.get('content-type') || 'image/jpeg';
    return { buffer, mimeType };
  } finally {
    clearTimeout(timer);
  }
}

// ── OCR function ────────────────────────────────────────────────────────

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function ocrPageClaude(imageBuffer, mimeType, previousOcr) {
  let prompt = ocrPrompt;
  if (previousOcr) {
    prompt += `\n\n**Previous page transcription for context:**\n${previousOcr.slice(0, 2000)}...`;
  }

  const base64Image = imageBuffer.toString('base64');
  const mediaType = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';

  const result = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
        { type: 'text', text: prompt },
      ],
    }],
  });

  const text = result.content[0]?.text || '';
  const inputTokens = result.usage?.input_tokens || 0;
  const outputTokens = result.usage?.output_tokens || 0;
  // Sonnet pricing: $3.00/1M input, $15.00/1M output
  const cost = (inputTokens * 3.00 / 1_000_000) + (outputTokens * 15.00 / 1_000_000);

  return { text, inputTokens, outputTokens, cost, model: CLAUDE_MODEL };
}

async function ocrPage(imageBuffer, mimeType, previousOcr, modelOverride) {
  let prompt = ocrPrompt;

  if (previousOcr) {
    prompt += `\n\n**Previous page transcription for context:**\n${previousOcr.slice(0, 2000)}...`;
  }

  const useModel = modelOverride || MODEL;
  const base64Image = imageBuffer.toString('base64');
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: useModel });

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: { mimeType, data: base64Image } },
      ],
    }],
    safetySettings: SAFETY_SETTINGS,
  });

  const usage = result.response.usageMetadata;
  const inputTokens = usage?.promptTokenCount || 0;
  const outputTokens = usage?.candidatesTokenCount || 0;

  return {
    text: result.response.text(),
    inputTokens,
    outputTokens,
    cost: calcCost(inputTokens, outputTokens, useModel),
    model: useModel,
  };
}

// ── Create revision ─────────────────────────────────────────────────────

async function createRevision(page) {
  if (!page.ocr?.data) return;
  try {
    await db.collection('page_revisions').insertOne({
      id: revisionId(),
      page_id: page.id,
      book_id: page.book_id,
      field: 'ocr',
      data: page.ocr.data,
      source: page.ocr.source || 'unknown',
      model: page.ocr.model || null,
      prompt_version: page.ocr.prompt_version || null,
      job_id: null,
      created_at: new Date(),
      reason: 'pre_reocr',
    });
  } catch (err) {
    console.error(`    [revision] Failed for ${page.id}: ${err.message?.substring(0, 60)}`);
  }
}

// ── Process a single book ───────────────────────────────────────────────

async function processBook(book) {
  const lang = book.language || book.original_language || 'Unknown';
  console.log(`\n📖 ${(book.title || '').substring(0, 55)} [${lang}] — ${book.oldOcrCount} pages`);

  // Get pages that need re-OCR, in order
  const pages = await db.collection('pages')
    .find({
      book_id: book.id,
      'ocr.data': { $exists: true, $ne: '' },
      $or: [
        { 'ocr.prompt_version': { $exists: false } },
        { 'ocr.prompt_version': null },
      ],
    })
    .sort({ page_number: 1 })
    .project({
      id: 1, page_number: 1, book_id: 1,
      photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1,
      'ocr.data': 1, 'ocr.source': 1, 'ocr.model': 1, 'ocr.prompt_version': 1,
    })
    .toArray();

  let previousOcr = null;
  let bookOcrd = 0;
  let bookSkipped = 0;
  let bookErrors = 0;

  for (const page of pages) {
    // Get image URL
    const imageUrl = getPageImageUrl(page);
    if (!imageUrl) {
      bookSkipped++;
      stats.pagesSkipped++;
      continue;
    }

    const startTime = Date.now();

    try {
      // Fetch image
      const { buffer, mimeType } = await fetchImage(imageUrl);

      // Hallucination guard: reject images that are too small
      if (buffer.length < 1000) {
        bookSkipped++;
        stats.pagesSkipped++;
        continue;
      }

      // OCR
      const result = await ocrPage(buffer, mimeType, previousOcr);

      // Hallucination guard: reject absurdly long OCR
      if (result.text.length > 25000) {
        console.log(`    p${page.page_number}: OCR too long (${result.text.length} chars), skipping`);
        bookSkipped++;
        stats.pagesSkipped++;
        continue;
      }

      // Valid result — save
      if (result.text && result.text.trim().length >= 5) {
        const now = new Date();
        const durationMs = Date.now() - startTime;

        // Create revision of old OCR
        await createRevision(page);

        // Extract metadata from new OCR
        const pageType = extractPageType(result.text);
        const columns = extractColumns(result.text);
        const detectedLang = extractLanguage(result.text);
        const detectedImages = parseDetectedImages(result.text);

        // Build update
        const setFields = {
          ocr: {
            data: result.text,
            model: MODEL,
            source: 'ai',
            language: detectedLang || lang,
            updated_at: now,
            prompt_version: PROMPT_VERSION,
          },
          updated_at: now,
        };
        if (pageType) setFields.page_type = pageType;
        if (columns) setFields.columns = columns;
        if (detectedImages.length > 0) setFields.detected_images = detectedImages;

        await db.collection('pages').updateOne(
          { id: page.id },
          { $set: setFields }
        );

        // Log to gemini_usage (non-blocking)
        db.collection('gemini_usage').insertOne({
          id: generateId(),
          timestamp: now,
          type: 'ocr',
          mode: 'realtime',
          model: MODEL,
          book_id: book.id,
          book_title: book.title,
          page_ids: [page.id],
          page_count: 1,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          cost_usd: result.cost,
          status: 'success',
          duration_ms: durationMs,
          prompt_version: PROMPT_VERSION,
          endpoint: 'hetzner/realtime-reocr',
        }).catch(() => {});

        previousOcr = result.text;
        bookOcrd++;
        stats.pagesOcrd++;
        stats.totalInputTokens += result.inputTokens;
        stats.totalOutputTokens += result.outputTokens;
        stats.totalCost += result.cost;

        if (bookOcrd % 10 === 0) {
          printProgress();
        }

      } else {
        bookSkipped++;
        stats.pagesSkipped++;
      }

    } catch (err) {
      const msg = err?.message || String(err);
      bookErrors++;
      stats.pagesErrored++;

      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('rate')) {
        console.log(`    p${page.page_number}: rate limited, waiting 30s...`);
        await new Promise(r => setTimeout(r, 30000));
        // Retry once
        try {
          const { buffer, mimeType } = await fetchImage(imageUrl);
          const result = await ocrPage(buffer, mimeType, previousOcr);

          if (result.text && result.text.trim().length >= 5 && result.text.length <= 25000) {
            const now = new Date();
            await createRevision(page);
            const pageType = extractPageType(result.text);
            const columns = extractColumns(result.text);
            const detectedLang = extractLanguage(result.text);
            const detectedImages = parseDetectedImages(result.text);

            const setFields = {
              ocr: {
                data: result.text,
                model: MODEL,
                source: 'ai',
                language: detectedLang || lang,
                updated_at: now,
                prompt_version: PROMPT_VERSION,
              },
              updated_at: now,
            };
            if (pageType) setFields.page_type = pageType;
            if (columns) setFields.columns = columns;
            if (detectedImages.length > 0) setFields.detected_images = detectedImages;

            await db.collection('pages').updateOne(
              { id: page.id },
              { $set: setFields }
            );

            previousOcr = result.text;
            bookOcrd++;
            stats.pagesOcrd++;
            stats.totalCost += result.cost;
            bookErrors--;
            stats.pagesErrored--;
            continue;
          }
        } catch {
          console.log(`    p${page.page_number}: retry also failed, skipping`);
        }
      } else if (msg.includes('SAFETY') || msg.includes('RECITATION') || msg.includes('PROHIBITED') || msg.includes('blocked')) {
        // Gemini refused — fall back to Claude
        try {
          console.log(`    p${page.page_number}: safety filter, retrying with Claude...`);
          const { buffer: retryBuf, mimeType: retryMime } = await fetchImage(imageUrl);
          const result = await ocrPageClaude(retryBuf, retryMime, previousOcr);
          if (result.text && result.text.trim().length >= 5 && result.text.length <= 25000) {
            const now = new Date();
            await createRevision(page);
            const pageType = extractPageType(result.text);
            const columns = extractColumns(result.text);
            const detectedLang = extractLanguage(result.text);
            const detectedImages = parseDetectedImages(result.text);

            const setFields = {
              ocr: {
                data: result.text,
                model: CLAUDE_MODEL,
                source: 'ai',
                language: detectedLang || lang,
                updated_at: now,
                prompt_version: PROMPT_VERSION,
              },
              updated_at: now,
            };
            if (pageType) setFields.page_type = pageType;
            if (columns) setFields.columns = columns;
            if (detectedImages.length > 0) setFields.detected_images = detectedImages;

            await db.collection('pages').updateOne(
              { id: page.id },
              { $set: setFields }
            );
            db.collection('gemini_usage').insertOne({
              id: generateId(),
              timestamp: now,
              type: 'ocr',
              mode: 'realtime',
              model: CLAUDE_MODEL,
              book_id: book.id,
              book_title: book.title,
              page_ids: [page.id],
              page_count: 1,
              input_tokens: result.inputTokens,
              output_tokens: result.outputTokens,
              cost_usd: result.cost,
              status: 'success',
              duration_ms: 0,
              prompt_version: PROMPT_VERSION,
              endpoint: 'hetzner/realtime-reocr',
              note: `claude_fallback from ${MODEL}`,
            }).catch(() => {});
            previousOcr = result.text;
            bookOcrd++;
            stats.pagesOcrd++;
            stats.totalCost += result.cost;
            bookErrors--;
            stats.pagesErrored--;
            console.log(`    p${page.page_number}: recovered with Claude`);
          } else {
            console.log(`    p${page.page_number}: Claude returned empty/invalid result`);
          }
        } catch (claudeErr) {
          console.log(`    p${page.page_number}: Claude fallback also failed — ${(claudeErr?.message || '').substring(0, 60)}`);
        }
      } else {
        console.log(`    p${page.page_number}: error — ${msg.substring(0, 80)}`);
        stats.errors.push(`${book.slug} p${page.page_number}: ${msg.substring(0, 100)}`);
      }
    }
  }

  // Clear stale translation if we re-OCR'd pages (translation is based on old OCR)
  if (bookOcrd > 0) {
    const reocrdPageIds = pages.slice(0, bookOcrd).map(p => p.id);
    // Don't clear translations — the translate script will handle those separately
    // Just update book-level OCR cache
    const ocrCount = await db.collection('pages').countDocuments({
      book_id: book.id,
      'ocr.data': { $exists: true, $ne: '' },
    });
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { pages_ocr: ocrCount } }
    );
  }

  stats.booksProcessed++;
  console.log(`  ✓ ${bookOcrd} re-OCR'd, ${bookSkipped} skipped, ${bookErrors} errors`);
}

// ── Process all books (with concurrency) ────────────────────────────────

// Process books sequentially (pages within each book are sequential for context)
// but use concurrency for the API calls within a book
for (const book of booksToProcess) {
  await processBook(book);
}

// ── Summary ─────────────────────────────────────────────────────────────
const elapsed = ((Date.now() - stats.startTime) / 1000 / 60).toFixed(1);
console.log(`\n${'='.repeat(60)}`);
console.log(`Re-OCR Complete`);
console.log(`  Books: ${stats.booksProcessed}`);
console.log(`  Pages OCR'd: ${stats.pagesOcrd}`);
console.log(`  Pages skipped: ${stats.pagesSkipped}`);
console.log(`  Errors: ${stats.pagesErrored}`);
console.log(`  Cost: $${stats.totalCost.toFixed(2)}`);
console.log(`  Duration: ${elapsed} minutes`);
if (stats.pagesOcrd > 0) {
  const rate = ((Date.now() - stats.startTime) / 1000 / stats.pagesOcrd).toFixed(1);
  console.log(`  Rate: ${rate}s/page`);
}
if (stats.errors.length > 0) {
  console.log(`\nLast 20 errors:`);
  for (const e of stats.errors.slice(-20)) console.log(`  ${e}`);
}

await client.close();
process.exit(0);
