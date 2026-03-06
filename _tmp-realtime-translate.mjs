#!/usr/bin/env node
/**
 * Realtime translation script for Hetzner.
 * Translates pages with OCR but no translation, using Gemini realtime API.
 *
 * Processes books by popularity (read_count desc), pages in order within each book.
 * Passes previous page's translation for context continuity.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node _tmp-realtime-translate.mjs
 *   node _tmp-realtime-translate.mjs --dry-run
 *   node _tmp-realtime-translate.mjs --concurrency=10 --limit=50
 *   node _tmp-realtime-translate.mjs --book-id=abc123
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';

// ── Config ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CONCURRENCY = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '5');
const BOOK_LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0'); // 0 = unlimited
const SINGLE_BOOK = args.find(a => a.startsWith('--book-id='))?.split('=')[1];
const OFFSET = parseInt(args.find(a => a.startsWith('--offset='))?.split('=')[1] || '0');
const MODEL = 'gemini-3-flash-preview';

// Only skip truly blank pages — illustrations/maps/etc. often have captions, labels, margin notes
const SKIP_PAGE_TYPES = new Set(['blank']);

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
const keyCooldowns = new Map(); // key -> cooldown until timestamp

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
  // All keys in cooldown — use the one with oldest cooldown
  console.warn('[WARN] All API keys in cooldown, using first available');
  const key = API_KEYS[keyIndex % API_KEYS.length];
  keyIndex++;
  return new GoogleGenerativeAI(key);
}

function cooldownKey(key, durationMs = 60000) {
  keyCooldowns.set(key, Date.now() + durationMs);
}

// ── Prompts ─────────────────────────────────────────────────────────────

const ENGLISH_MODERNIZATION_PROMPT = `You are modernizing Early Modern English text into clear, accessible Modern English.

**Context:** This is a historical text (1500s-1700s) written in Early Modern English. The OCR transcription preserves the original spelling, vocabulary, and syntax. Your job is to make it readable for a modern audience while preserving the author's meaning and the document's formatting.

**Input:** The OCR transcription with markdown formatting and XML tags, plus (if available) the previous page's modernization for continuity.

**Output:** Modern English text that preserves the markdown formatting and XML tags from the OCR.

**Preserve from OCR:**
- Heading levels (# ## ###) — keep the same hierarchy
- **Bold** and *italic* formatting
- Tables — recreate them with modern spelling
- Centered text (->text<-)
- <column-break/> markers — preserve exactly as-is
- Line breaks and paragraph structure

**XML tags to preserve:**
- <note>X</note> — update the language inside to modern English
- <margin>X</margin> — modernize marginal notes
- <gloss>X</gloss> — modernize glosses
- <insert>X</insert> — modernize insertions
- <unclear>X</unclear> — keep as-is
- <term>X</term> — keep technical terms, modernize explanation if given
- <meta>X</meta> — for your translator notes (hidden from readers)

**Do NOT use:**
- Code blocks or backticks — this is prose
- Square brackets for editorial notes — use <note> tags instead

**Instructions:**
1. Start with <meta>...</meta> if noting continuity with previous page.
2. Modernize spelling: "ye" → "the", "hath" → "has", "doth" → "does", "wherefore" → "why", etc.
3. Modernize grammar: "it pleaseth me" → "it pleases me", regularize verb forms.
4. Keep meaning and tone — preserve the author's voice, just update the language.
5. Keep proper nouns, place names, and technical terms (with <note> if unclear).
6. Preserve ALL content — this is NOT a summary. Every sentence must be represented.
7. END with <summary>...</summary> and <keywords>...</keywords>.

**Final output format:**
[modernized text]

<summary>1-2 sentence summary of this page's main content</summary>
<keywords>key concepts, names, themes — for indexing</keywords>`;

// Default translation prompt (fallback — will try DB first)
const DEFAULT_TRANSLATION_PROMPT = `You are translating a manuscript transcription into accessible English.

**Input:** The OCR transcription and (if available) the previous page's translation for continuity.

**Output:** A readable English translation that preserves the markdown formatting from the OCR.

**Preserve from OCR:**
- Heading levels (# ## ###) - keep the same hierarchy
- **Bold** and *italic* formatting
- Tables - recreate them in the translation
- Centered text (->text<-)
- <column-break/> markers — preserve exactly as-is between translated columns
- Line breaks and paragraph structure

**Inline annotations (visible to readers):**
- <note>X</note> — interpretive notes for readers
- <margin>X</margin> — translate and keep marginal notes
- <gloss>X</gloss> — translate interlinear annotations
- <insert>X</insert> — translate later additions (inline only)
- <unclear>X</unclear> — illegible readings
- <term>X</term> — technical vocabulary with explanation

**Metadata tags (hidden from readers):**
- <meta>X</meta> for translator notes that should be hidden (e.g., continuity with previous page)

**Do NOT use:**
- Code blocks or backticks - this is prose

**IMPORTANT - Translate ALL languages to English:**
The source text may contain phrases in multiple languages (Latin, Greek, Hebrew, etc.). You MUST translate EVERYTHING to English:
- Latin quotes embedded in German → translate to English
- Greek phrases → translate to English
- Hebrew or Aramaic terms → translate to English
- ANY non-English text → translate to English
Use <note>original: "..."</note> to preserve important original phrases for scholars, but the main text must be fully readable in English without knowing other languages.

**Instructions:**
1. Start with <meta>...</meta> if noting continuity with previous page (hidden from readers).
2. Mirror the source layout - headings, paragraphs, tables, centered text.
3. Translate ALL text including <margin>, <insert>, <gloss> - keep the XML tags.
4. Translate embedded Latin/Greek/Hebrew phrases to English, noting originals when significant.
5. Add <note>...</note> inline to explain historical references or difficult phrases.
6. Style: warm museum label - explain rather than assume knowledge.
7. Preserve the voice and spirit of the original.
8. END with <summary>...</summary> and <keywords>...</keywords> for indexing.

**Source language:** {source_language}
**Target language:** {target_language}

**Final output format:**
[translated text]

<summary>1-2 sentence summary of this page's main content and significance</summary>
<keywords>key concepts, names, themes in English — for indexing</keywords>`;

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

// ── Stats ───────────────────────────────────────────────────────────────
const stats = {
  booksProcessed: 0,
  pagesTranslated: 0,
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
  const rate = stats.pagesTranslated > 0 ? (elapsed / stats.pagesTranslated).toFixed(1) : '?';
  console.log(
    `  [${elapsed}s] ${stats.pagesTranslated} translated, ${stats.pagesSkipped} skipped, ` +
    `${stats.pagesErrored} errors, $${stats.totalCost.toFixed(4)} cost, ${rate}s/page`
  );
}

// ── Main ────────────────────────────────────────────────────────────────
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

console.log(`Realtime Translation Script`);
console.log(`Model: ${MODEL}, Concurrency: ${CONCURRENCY}, API keys: ${API_KEYS.length}`);
console.log(`Dry run: ${DRY_RUN}`);
console.log('');

// Fetch translation prompt from DB (or fall back to hardcoded)
let dbTranslationPrompt = DEFAULT_TRANSLATION_PROMPT;
try {
  const promptDoc = await db.collection('prompts').findOne(
    { type: 'translation', is_default: true },
    { sort: { version: -1 } }
  );
  if (promptDoc?.content) {
    dbTranslationPrompt = promptDoc.content;
    console.log(`Using DB translation prompt: "${promptDoc.name}" v${promptDoc.version}`);
  } else {
    console.log('No DB translation prompt found, using hardcoded default');
  }
} catch (e) {
  console.log('Failed to fetch DB prompt, using hardcoded default');
}

// ── Find books with untranslated pages ──────────────────────────────────
// Use aggregation to find all books with untranslated pages in ONE query
console.log('Scanning for books with untranslated pages (aggregation)...');

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
      { 'translation.data': { $exists: false } },
      { 'translation.data': null },
      { 'translation.data': '' },
    ],
  });
  booksToProcess = count > 0 ? [{ ...book, untranslatedCount: count }] : [];
} else {
  // Single aggregation on pages collection — group by book_id
  const aggResult = await db.collection('pages').aggregate([
    {
      $match: {
        'ocr.data': { $exists: true, $ne: '' },
        $or: [
          { 'translation.data': { $exists: false } },
          { 'translation.data': null },
          { 'translation.data': '' },
        ],
      },
    },
    { $group: { _id: '$book_id', untranslatedCount: { $sum: 1 } } },
  ], { allowDiskUse: true }).toArray();

  console.log(`Found ${aggResult.length} books with untranslated pages`);

  // Fetch book metadata for all these books
  const bookIds = aggResult.map(r => r._id);
  const bookDocs = await db.collection('books')
    .find({ id: { $in: bookIds } })
    .project({ id: 1, title: 1, slug: 1, language: 1, original_language: 1, read_count: 1, pages_count: 1 })
    .toArray();

  const bookMap = new Map(bookDocs.map(b => [b.id, b]));
  booksToProcess = aggResult
    .map(r => ({ ...bookMap.get(r._id), untranslatedCount: r.untranslatedCount }))
    .filter(b => b.id) // skip if book not found
    .sort((a, b) => (b.read_count || 0) - (a.read_count || 0));

  if (OFFSET > 0) booksToProcess = booksToProcess.slice(OFFSET);
  if (BOOK_LIMIT > 0) booksToProcess = booksToProcess.slice(0, BOOK_LIMIT);
}

const totalPages = booksToProcess.reduce((s, b) => s + b.untranslatedCount, 0);
console.log(`\n${booksToProcess.length} books need translation (${totalPages} total pages)`);

if (DRY_RUN) {
  console.log('\n=== DRY RUN — Top 30 books ===');
  for (const b of booksToProcess.slice(0, 30)) {
    const lang = b.language || b.original_language || 'Unknown';
    console.log(`  ${(b.title || '').substring(0, 50)} [${lang}] — ${b.untranslatedCount} pages (reads: ${b.read_count || 0})`);
  }
  if (booksToProcess.length > 30) console.log(`  ... and ${booksToProcess.length - 30} more`);

  const estCost = totalPages * 0.0022; // ~$0.0022/page for translation
  console.log(`\nEstimated cost: $${estCost.toFixed(2)}`);
  await client.close();
  process.exit(0);
}

// ── Process books ───────────────────────────────────────────────────────

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function translatePageClaude(ocrText, sourceLanguage, previousTranslation) {
  const isEnglish = sourceLanguage.toLowerCase() === 'english';
  const basePrompt = isEnglish ? ENGLISH_MODERNIZATION_PROMPT : dbTranslationPrompt;

  let prompt = basePrompt
    .replace('{source_language}', sourceLanguage)
    .replace('{target_language}', 'English')
    .replace('{sourceLanguage}', sourceLanguage)
    .replace('{targetLanguage}', 'English')
    .replace('{language}', sourceLanguage);

  prompt += isEnglish
    ? `\n\n**Text to modernize:**\n${ocrText}`
    : `\n\n**Text to translate:**\n${ocrText}`;

  if (previousTranslation) {
    prompt += isEnglish
      ? `\n\n**Previous page (modernized) for continuity:**\n${previousTranslation.slice(0, 2000)}...`
      : `\n\n**Previous page translation for continuity:**\n${previousTranslation.slice(0, 2000)}...`;
  }

  const result = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = result.content[0]?.text || '';
  const inputTokens = result.usage?.input_tokens || 0;
  const outputTokens = result.usage?.output_tokens || 0;
  // Sonnet pricing: $3.00/1M input, $15.00/1M output
  const cost = (inputTokens * 3.00 / 1_000_000) + (outputTokens * 15.00 / 1_000_000);

  return { text, inputTokens, outputTokens, cost, model: CLAUDE_MODEL };
}

async function translatePage(ocrText, sourceLanguage, previousTranslation, modelOverride) {
  const isEnglish = sourceLanguage.toLowerCase() === 'english';
  const basePrompt = isEnglish ? ENGLISH_MODERNIZATION_PROMPT : dbTranslationPrompt;

  let prompt = basePrompt
    .replace('{source_language}', sourceLanguage)
    .replace('{target_language}', 'English')
    .replace('{sourceLanguage}', sourceLanguage)
    .replace('{targetLanguage}', 'English')
    .replace('{language}', sourceLanguage);

  prompt += isEnglish
    ? `\n\n**Text to modernize:**\n${ocrText}`
    : `\n\n**Text to translate:**\n${ocrText}`;

  if (previousTranslation) {
    prompt += isEnglish
      ? `\n\n**Previous page (modernized) for continuity:**\n${previousTranslation.slice(0, 2000)}...`
      : `\n\n**Previous page translation for continuity:**\n${previousTranslation.slice(0, 2000)}...`;
  }

  const useModel = modelOverride || MODEL;
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: useModel });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
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

async function processBook(book) {
  const lang = book.language || book.original_language || 'Unknown';
  const isEnglish = lang.toLowerCase() === 'english';
  console.log(`\n📖 ${(book.title || '').substring(0, 55)} [${lang}] — ${book.untranslatedCount} pages`);

  // Get ALL pages for this book in order (need previous translations for context)
  const allPages = await db.collection('pages')
    .find({ book_id: book.id })
    .sort({ page_number: 1 })
    .project({
      id: 1, page_number: 1, page_type: 1,
      'ocr.data': 1, 'translation.data': 1, 'translation.updated_at': 1,
      'translation.source': 1, 'translation.model': 1,
    })
    .toArray();

  let previousTranslation = null;
  let bookTranslated = 0;
  let bookSkipped = 0;
  let bookErrors = 0;

  for (const page of allPages) {
    // If page already has translation, use it as context and skip
    if (page.translation?.data) {
      previousTranslation = page.translation.data;
      continue;
    }

    // If page has no OCR, skip
    if (!page.ocr?.data) {
      continue;
    }

    // Skip non-translatable page types
    if (page.page_type && SKIP_PAGE_TYPES.has(page.page_type)) {
      bookSkipped++;
      stats.pagesSkipped++;
      continue;
    }

    // Skip very short OCR that's likely not real content
    if (page.ocr.data.trim().length < 10) {
      bookSkipped++;
      stats.pagesSkipped++;
      continue;
    }

    try {
      const startMs = Date.now();
      const result = await translatePage(page.ocr.data, lang, previousTranslation);
      const durationMs = Date.now() - startMs;

      // Validate result — reject garbage
      if (!result.text || result.text.trim().length < 5) {
        console.log(`    p${page.page_number}: empty result, skipping`);
        bookErrors++;
        stats.pagesErrored++;
        continue;
      }

      // Hallucination guard — reject absurdly long output
      if (result.text.length > 25000) {
        console.log(`    p${page.page_number}: output too long (${result.text.length} chars), skipping`);
        bookErrors++;
        stats.pagesErrored++;
        continue;
      }

      // Create revision if page already has translation (shouldn't happen in 129k backlog)
      if (page.translation?.data) {
        await db.collection('page_revisions').insertOne({
          id: `rev_${crypto.randomBytes(6).toString('hex')}`,
          page_id: page.id,
          book_id: book.id,
          field: 'translation',
          data: page.translation.data,
          source: page.translation.source || 'unknown',
          model: page.translation.model,
          original_date: page.translation.updated_at,
          created_at: new Date(),
        });
      }

      // Save translation — use full object replacement to handle corrupt `translation` fields
      // (some pages have `translation` as a string instead of an object)
      const now = new Date();
      await db.collection('pages').updateOne(
        { id: page.id },
        {
          $set: {
            translation: {
              data: result.text,
              model: MODEL,
              source: 'ai',
              language: isEnglish ? 'English (modernized)' : lang,
              updated_at: now,
              prompt_version: 'v5.2026-02',
            },
            updated_at: now,
          },
        }
      );

      // Log to gemini_usage (non-blocking)
      db.collection('gemini_usage').insertOne({
        id: generateId(),
        timestamp: now,
        type: 'translate',
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
        prompt_version: 'v5.2026-02',
        endpoint: 'hetzner/realtime-translate',
      }).catch(() => {});

      previousTranslation = result.text;
      bookTranslated++;
      stats.pagesTranslated++;
      stats.totalInputTokens += result.inputTokens;
      stats.totalOutputTokens += result.outputTokens;
      stats.totalCost += result.cost;

      // Progress every 10 pages
      if (bookTranslated % 10 === 0) {
        printProgress();
      }

    } catch (err) {
      const msg = err?.message || String(err);
      bookErrors++;
      stats.pagesErrored++;

      // Handle rate limits
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('rate')) {
        console.log(`    p${page.page_number}: rate limited, waiting 30s...`);
        await new Promise(r => setTimeout(r, 30000));
        // Retry once
        try {
          const result = await translatePage(page.ocr.data, lang, previousTranslation);
          if (result.text && result.text.trim().length >= 5) {
            const now = new Date();
            await db.collection('pages').updateOne(
              { id: page.id },
              {
                $set: {
                  translation: {
                    data: result.text,
                    model: MODEL,
                    source: 'ai',
                    language: isEnglish ? 'English (modernized)' : lang,
                    updated_at: now,
                    prompt_version: 'v5.2026-02',
                  },
                  updated_at: now,
                },
              }
            );
            previousTranslation = result.text;
            bookTranslated++;
            stats.pagesTranslated++;
            stats.totalCost += result.cost;
            bookErrors--; // Undo the error count
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
          const result = await translatePageClaude(page.ocr.data, lang, previousTranslation);
          if (result.text && result.text.trim().length >= 5 && result.text.length <= 25000) {
            const now = new Date();
            await db.collection('pages').updateOne(
              { id: page.id },
              {
                $set: {
                  translation: {
                    data: result.text,
                    model: CLAUDE_MODEL,
                    source: 'ai',
                    language: isEnglish ? 'English (modernized)' : lang,
                    updated_at: now,
                    prompt_version: 'v5.2026-02',
                  },
                  updated_at: now,
                },
              }
            );
            db.collection('gemini_usage').insertOne({
              id: generateId(),
              timestamp: now,
              type: 'translate',
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
              prompt_version: 'v5.2026-02',
              endpoint: 'hetzner/realtime-translate',
              note: `claude_fallback from ${MODEL}`,
            }).catch(() => {});
            previousTranslation = result.text;
            bookTranslated++;
            stats.pagesTranslated++;
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

  // Update book-level cache
  if (bookTranslated > 0) {
    const translatedCount = await db.collection('pages').countDocuments({
      book_id: book.id,
      'translation.data': { $exists: true, $ne: '' },
    });
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { pages_translated: translatedCount } }
    );
  }

  stats.booksProcessed++;
  console.log(`  ✓ ${bookTranslated} translated, ${bookSkipped} skipped, ${bookErrors} errors`);
}

// Process books with concurrency limit (but sequential pages within each book)
async function processBatch(books) {
  const queue = [...books];
  const active = new Set();

  async function runNext() {
    if (queue.length === 0) return;
    const book = queue.shift();
    active.add(book.id);
    try {
      await processBook(book);
    } catch (err) {
      console.error(`  FATAL error on book ${book.slug}: ${err.message}`);
      stats.errors.push(`FATAL ${book.slug}: ${err.message}`);
    }
    active.delete(book.id);
    await runNext(); // process next when done
  }

  // Start CONCURRENCY workers
  const workers = [];
  for (let i = 0; i < Math.min(CONCURRENCY, books.length); i++) {
    workers.push(runNext());
  }
  await Promise.all(workers);
}

try {
  await processBatch(booksToProcess);
} finally {
  const elapsed = ((Date.now() - stats.startTime) / 1000 / 60).toFixed(1);
  console.log('\n════════════════════════════════════════');
  console.log(`Done in ${elapsed} minutes`);
  console.log(`Books: ${stats.booksProcessed}`);
  console.log(`Pages translated: ${stats.pagesTranslated}`);
  console.log(`Pages skipped: ${stats.pagesSkipped}`);
  console.log(`Pages errored: ${stats.pagesErrored}`);
  console.log(`Tokens: ${stats.totalInputTokens.toLocaleString()} in, ${stats.totalOutputTokens.toLocaleString()} out`);
  console.log(`Cost: $${stats.totalCost.toFixed(4)}`);
  if (stats.errors.length > 0) {
    console.log(`\nErrors (${stats.errors.length}):`);
    for (const e of stats.errors.slice(0, 20)) console.log(`  ${e}`);
    if (stats.errors.length > 20) console.log(`  ... and ${stats.errors.length - 20} more`);
  }

  await client.close();
}
