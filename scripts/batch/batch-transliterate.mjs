#!/usr/bin/env node
/**
 * Batch Transliteration Script
 *
 * Processes non-Latin script pages that have OCR but no transliteration.
 * Calls Gemini directly (text-only, no images needed).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/batch/batch-transliterate.mjs
 *   node scripts/batch/batch-transliterate.mjs --dry-run
 *   node scripts/batch/batch-transliterate.mjs --limit 500
 *   node scripts/batch/batch-transliterate.mjs --book-id BOOK_ID
 *   node scripts/batch/batch-transliterate.mjs --language greek
 *   node scripts/batch/batch-transliterate.mjs --concurrency 20
 *
 * Cost: ~$0.0001/page using gemini-3.1-flash-lite-preview (text-only).
 * ~$19 total for all 190k non-Latin OCR'd pages.
 */

import { MongoClient } from 'mongodb';

// ── Config ──

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const GEMINI_API_KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) { console.error('No GEMINI_API_KEY found'); process.exit(1); }

const MODEL = 'gemini-3.1-flash-lite-preview';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Model pricing per 1M tokens (USD) — default for unknown models
const PRICING = { input: 0.10, output: 0.40 };

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : null;
}

const LIMIT = parseInt(getArg('limit') || '10000', 10);
const CONCURRENCY = parseInt(getArg('concurrency') || '10', 10);
const BOOK_ID = getArg('book-id');
const LANGUAGE_FILTER = getArg('language');

// Non-Latin script languages
const NON_LATIN_LANGUAGES = [
  'greek', 'hebrew', 'arabic', 'persian', 'ottoman turkish',
  'syriac', 'chinese', 'japanese', 'korean', 'sanskrit',
  'armenian', 'georgian', 'ethiopic', 'coptic', 'tibetan',
  'russian', 'church slavonic',
];

// Page types to skip
const SKIP_PAGE_TYPES = ['blank'];

function languageToScript(language) {
  if (!language) return 'Unknown';
  const map = {
    'greek': 'Greek',
    'hebrew': 'Hebrew',
    'arabic': 'Arabic',
    'persian': 'Arabic (Persian)',
    'ottoman turkish': 'Arabic (Ottoman Turkish)',
    'syriac': 'Syriac',
    'chinese': 'Chinese',
    'japanese': 'Japanese',
    'korean': 'Korean',
    'sanskrit': 'Sanskrit/Devanagari',
    'armenian': 'Armenian',
    'georgian': 'Georgian',
    'ethiopic': 'Ethiopic',
    'coptic': 'Coptic',
    'tibetan': 'Tibetan',
    'russian': 'Cyrillic',
    'church slavonic': 'Cyrillic',
  };
  return map[language.toLowerCase()] || language;
}

// Simple hash function (matches the one in the API route)
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

const TRANSLITERATION_PROMPT = `You are a scholarly transliterator. Convert the following text to Latin characters using standard academic Romanization conventions.

CRITICAL RULES:
1. Preserve the line-by-line structure EXACTLY. Each line of output must correspond to the same line of input. Do not merge or split lines.
2. Preserve paragraph breaks and blank lines exactly as they appear.
3. PRESERVE the <column-break/> tag exactly where it appears — this marks column boundaries for rendering.
4. Remove all OTHER XML/markup tags (<note>, <term>, <margin>, <page-type>, <columns>, <language>, <detected-images>, etc.) from the output.
5. Include standard scholarly diacritics (macrons for long vowels, dots for emphatics, etc.).
6. Do not translate — only transliterate. The output should be a phonetic representation in Latin script, not a translation.
7. If the text contains passages in Latin script already (e.g. Latin in a Greek manuscript), preserve them as-is.

Romanization conventions by script:
- **Greek:** Standard scholarly transliteration. α→a, β→b, γ→g, δ→d, ε→e, ζ→z, η→ē, θ→th, ι→i, κ→k, λ→l, μ→m, ν→n, ξ→x, ο→o, π→p, ρ→r, σ/ς→s, τ→t, υ→y/u, φ→ph, χ→ch, ψ→ps, ω→ō. Rough breathing→h, accents preserved where standard.
- **Hebrew:** SBL academic style. א→ʾ, ב→b/v, ג→g, ד→d, ה→h, ו→w, ז→z, ח→ḥ, ט→ṭ, י→y, כ→k/kh, ל→l, מ→m, נ→n, ס→s, ע→ʿ, פ→p/f, צ→ṣ, ק→q, ר→r, שׁ→sh, שׂ→ś, ת→t/th. Vowels: qamets→ā, patach→a, tsere→ē, segol→e, hiriq→i, holem→ō, qibbuts→u, shureq→ū, shva→ə.
- **Arabic:** DIN 31635 / Library of Congress. Include hamza (ʾ), ayn (ʿ), emphatics (ṭ, ḍ, ṣ, ẓ), long vowels (ā, ī, ū), tāʾ marbūṭa (a/at).
- **Syriac:** Based on standard Semiticist conventions, similar to Hebrew/Arabic.
- **Armenian:** Library of Congress romanization.
- **Georgian:** National system or ISO 9984.
- **Coptic/Ethiopic:** Standard scholarly conventions.
- **Chinese:** Pinyin with tone marks.
- **Japanese:** Modified Hepburn.
- **Korean:** Revised Romanization.
- **Sanskrit/Devanagari:** IAST (International Alphabet of Sanskrit Transliteration).`;

async function callGemini(ocrText, sourceScript) {
  const prompt = `${TRANSLITERATION_PROMPT}\n\nThe source script is: **${sourceScript}**\n\n**Text to transliterate:**\n${ocrText}`;

  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
      generationConfig: {
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data.usageMetadata || {};
  const inputTokens = usage.promptTokenCount || 0;
  const outputTokens = usage.candidatesTokenCount || 0;

  return { text, inputTokens, outputTokens };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function processPage(db, page, bookLanguage) {
  const sourceScript = languageToScript(bookLanguage);
  const ocrText = page.ocr.data;
  const ocrHash = hashString(ocrText);

  // Check if already transliterated with current OCR
  if (page.transliteration?.data && page.transliteration.source_ocr_hash === ocrHash) {
    return { status: 'cached', pageId: page.id };
  }

  const startTime = Date.now();
  const result = await callGemini(ocrText, sourceScript);
  const duration = Date.now() - startTime;

  if (!result.text) {
    return { status: 'empty', pageId: page.id };
  }

  // Save to database
  await db.collection('pages').updateOne(
    { id: page.id },
    {
      $set: {
        'transliteration.data': result.text,
        'transliteration.model': MODEL,
        'transliteration.updated_at': new Date(),
        'transliteration.source_ocr_hash': ocrHash,
        'transliteration.script': sourceScript,
        updated_at: new Date(),
      },
    }
  );

  // Log to gemini_usage
  const costUsd = (result.inputTokens / 1_000_000) * PRICING.input +
                  (result.outputTokens / 1_000_000) * PRICING.output;

  await db.collection('gemini_usage').insertOne({
    type: 'transliterate',
    mode: 'realtime',
    model: MODEL,
    book_id: page.book_id,
    page_ids: [page.id],
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    cost_usd: costUsd,
    status: 'success',
    duration_ms: duration,
    endpoint: 'batch-transliterate',
    timestamp: new Date(),
  });

  return {
    status: 'success',
    pageId: page.id,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd,
    duration,
  };
}

async function run() {
  const startTime = Date.now();
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  console.log(`[batch-transliterate] Model: ${MODEL} | Limit: ${LIMIT} | Concurrency: ${CONCURRENCY} | Dry run: ${DRY_RUN}`);

  // Find non-Latin books
  const bookQuery = {
    language: {
      $regex: new RegExp(`^(${(LANGUAGE_FILTER ? [LANGUAGE_FILTER] : NON_LATIN_LANGUAGES).join('|')})$`, 'i'),
    },
  };
  if (BOOK_ID) bookQuery.id = BOOK_ID;

  const books = await db.collection('books')
    .find(bookQuery)
    .project({ id: 1, title: 1, language: 1, pages_count: 1 })
    .toArray();

  console.log(`Found ${books.length} non-Latin books${LANGUAGE_FILTER ? ` (${LANGUAGE_FILTER})` : ''}`);

  // Find pages with OCR but no transliteration (or stale transliteration)
  const bookIds = books.map(b => b.id);
  const bookMap = Object.fromEntries(books.map(b => [b.id, b]));

  // Build page query
  const pageQuery = {
    book_id: { $in: bookIds },
    'ocr.data': { $exists: true, $nin: [null, ''] },
    page_type: { $nin: SKIP_PAGE_TYPES },
    $or: [
      { 'transliteration.data': { $exists: false } },
      { 'transliteration.data': null },
      { 'transliteration.data': '' },
    ],
  };

  const totalPages = await db.collection('pages').countDocuments(pageQuery);
  console.log(`Pages needing transliteration: ${totalPages}`);

  if (DRY_RUN) {
    // Show per-language breakdown
    const pipeline = [
      { $match: pageQuery },
      {
        $lookup: {
          from: 'books',
          localField: 'book_id',
          foreignField: 'id',
          as: 'book',
        },
      },
      { $unwind: '$book' },
      {
        $group: {
          _id: { $toLower: '$book.language' },
          count: { $sum: 1 },
          books: { $addToSet: '$book_id' },
        },
      },
      { $sort: { count: -1 } },
    ];
    const breakdown = await db.collection('pages').aggregate(pipeline).toArray();
    console.log('\nPer-language breakdown:');
    for (const row of breakdown) {
      console.log(`  ${row._id}: ${row.count} pages (${row.books.length} books)`);
    }
    const estCost = totalPages * 0.0001;
    console.log(`\nEstimated cost: $${estCost.toFixed(2)}`);
    await client.close();
    return;
  }

  // Process in chunks by book (so we can log per-book progress)
  let totalProcessed = 0;
  let totalCached = 0;
  let totalErrors = 0;
  let totalCost = 0;

  for (const book of books) {
    if (totalProcessed >= LIMIT) break;

    const remaining = LIMIT - totalProcessed;
    const pages = await db.collection('pages')
      .find({
        book_id: book.id,
        'ocr.data': { $exists: true, $nin: [null, ''] },
        page_type: { $nin: SKIP_PAGE_TYPES },
        $or: [
          { 'transliteration.data': { $exists: false } },
          { 'transliteration.data': null },
          { 'transliteration.data': '' },
        ],
      })
      .sort({ page_number: 1 })
      .project({ id: 1, book_id: 1, page_number: 1, ocr: 1, transliteration: 1 })
      .limit(remaining)
      .toArray();

    if (pages.length === 0) continue;

    const label = (book.title || '').substring(0, 50);
    console.log(`\n${label} (${book.language}) — ${pages.length} pages`);

    // Process pages with concurrency
    let bookProcessed = 0;
    let bookCached = 0;
    let bookErrors = 0;
    let bookCost = 0;

    for (let i = 0; i < pages.length; i += CONCURRENCY) {
      const chunk = pages.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(page => processPage(db, page, book.language))
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value.status === 'success') {
            bookProcessed++;
            bookCost += r.value.costUsd || 0;
          } else if (r.value.status === 'cached') {
            bookCached++;
          } else {
            bookErrors++;
          }
        } else {
          bookErrors++;
          const errMsg = r.reason?.message || String(r.reason);
          console.error(`  Error: ${errMsg.substring(0, 100)}`);

          // Back off on rate limits
          if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')) {
            console.log('  Rate limited — waiting 30s...');
            await sleep(30000);
          }
        }
      }

      // Progress update every 50 pages
      const done = Math.min(i + CONCURRENCY, pages.length);
      if (done % 50 === 0 || done === pages.length) {
        console.log(`  ${done}/${pages.length} (${bookProcessed} ok, ${bookCached} cached, ${bookErrors} err, $${bookCost.toFixed(4)})`);
      }
    }

    totalProcessed += bookProcessed;
    totalCached += bookCached;
    totalErrors += bookErrors;
    totalCost += bookCost;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n── Summary ──`);
  console.log(`  Processed: ${totalProcessed}`);
  console.log(`  Cached: ${totalCached}`);
  console.log(`  Errors: ${totalErrors}`);
  console.log(`  Cost: $${totalCost.toFixed(4)}`);
  console.log(`  Duration: ${duration}s`);

  await client.close();
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
