#!/usr/bin/env node
/**
 * Standalone Greek transliteration — runs outside the pipeline lock.
 * Processes translated Greek books that lack transliteration.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/transliterate-greek.mjs
 *   node scripts/workers/transliterate-greek.mjs --dry-run
 *   node scripts/workers/transliterate-greek.mjs --limit 10
 *   node scripts/workers/transliterate-greek.mjs --concurrency 5
 */

import { MongoClient } from 'mongodb';
import crypto from 'crypto';
import { logUsage, outputTokensFrom } from './lib/supabase-usage-logger.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find((_, i) => args[i - 1] === '--limit') || '0') || Infinity;
const CONCURRENCY = parseInt(args.find((_, i) => args[i - 1] === '--concurrency') || '3');

const MODEL = 'gemini-3.1-flash-lite';
const PROMPT = `You are a scholarly transliterator. Convert the following text to Latin characters using standard academic Romanization conventions.

Rules:
1. Preserve line breaks, paragraphs, and whitespace exactly.
2. Maintain all XML-like tags (<language>, <page-type>, <meta>, etc.) unchanged.
3. Content within <insert> tags should also be transliterated.
4. Use standard academic Romanization (e.g., ALA-LC or ISO 843 for Greek).
5. Preserve numbers, punctuation, and special characters as-is.
6. Do not translate — only transliterate.

The source script is: **Greek**

**Text to transliterate:**
`;

// Rotate through available API keys
const API_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_TIER3,
].filter(Boolean);

let keyIndex = 0;
function getKey() {
  const key = API_KEYS[keyIndex % API_KEYS.length];
  keyIndex++;
  return key;
}

async function transliteratePage(db, page, bookId) {
  const ocrText = page.ocr?.data;
  if (!ocrText || typeof ocrText !== 'string' || ocrText.length < 10) return false;

  const ocrHash = crypto.createHash('md5').update(ocrText).digest('hex');

  // Skip if already transliterated with same OCR
  if (page.transliteration?.source_ocr_hash === ocrHash) return false;

  const apiKey = getKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT + ocrText }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  // Record the spend. An unattended worker that writes no usage row is money
  // the dial cannot see and no report can attribute (#4599).
  await logUsage({
    type: 'transliterate',
    mode: 'realtime',
    model: MODEL,
    book_id: bookId,
    page_ids: [String(page._id)],
    input_tokens: data.usageMetadata?.promptTokenCount || 0,
    output_tokens: outputTokensFrom(data.usageMetadata),
    status: 'success',
    endpoint: 'worker/transliterate-greek',
  }, db);

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');

  await db.collection('pages').updateOne(
    { _id: page._id },
    {
      $set: {
        'transliteration.data': text,
        'transliteration.model': MODEL,
        'transliteration.updated_at': new Date(),
        'transliteration.source_ocr_hash': ocrHash,
        'transliteration.script': 'Greek',
      },
    }
  );

  return true;
}

// Main
const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Find translated Greek books without full transliteration
const books = await db.collection('books').find({
  language: { $regex: /greek/i },
  pages_translated: { $gt: 0 },
  visible: true,
}, { projection: { id: 1, title: 1, pages_ocr: 1 } })
.sort({ pages_ocr: 1 }) // shortest first
.toArray();

console.log(`Found ${books.length} translated Greek books`);
if (DRY_RUN) console.log('DRY RUN — no changes');

let booksProcessed = 0;
let booksSkipped = 0;
let totalPages = 0;
let totalErrors = 0;
const start = Date.now();

for (const book of books) {
  if (booksProcessed >= LIMIT) break;

  // Find pages needing transliteration
  const pages = await db.collection('pages').find({
    book_id: book.id,
    'ocr.data': { $exists: true, $nin: [null, ''] },
    page_type: { $nin: ['blank'] },
    $or: [
      { 'transliteration.data': { $exists: false } },
      { 'transliteration.data': null },
      { 'transliteration.data': '' },
    ],
  })
  .sort({ page_number: 1 })
  .project({ _id: 1, id: 1, ocr: 1, transliteration: 1 })
  .toArray();

  if (pages.length === 0) { booksSkipped++; continue; }

  if (DRY_RUN) {
    console.log(`  [dry] ${book.title?.substring(0, 55)} — ${pages.length} pages`);
    booksProcessed++;
    totalPages += pages.length;
    continue;
  }

  const label = (book.title || '').substring(0, 50);
  console.log(`  ${label} — ${pages.length} pages...`);

  let done = 0;
  let errors = 0;

  // Process in chunks for concurrency
  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const chunk = pages.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(page => transliteratePage(db, page, book.id))
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) done++;
      else if (r.status === 'rejected') {
        errors++;
        if (errors <= 3) console.log(`    Error: ${r.reason?.message?.substring(0, 100)}`);
      }
    }
  }

  console.log(`    Done: ${done} ok, ${errors} errors`);
  booksProcessed++;
  totalPages += done;
  totalErrors += errors;
}

const elapsed = ((Date.now() - start) / 1000).toFixed(0);
console.log(`\n${DRY_RUN ? 'DRY RUN ' : ''}Complete: ${booksProcessed} books, ${totalPages} pages, ${totalErrors} errors, ${booksSkipped} skipped (${elapsed}s)`);

await client.close();
