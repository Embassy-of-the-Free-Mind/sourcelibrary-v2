#!/usr/bin/env node
/**
 * Detect AI "recitation-loop" pages in the translation/OCR corpus.
 *
 * Some pages — overwhelmingly non-Latin scripts (Tibetan, Hebrew, Ge'ez,
 * Syriac, Javanese, CJK), especially repetitive liturgical content — send the
 * model into a token-repetition loop, producing a single page with tens or
 * hundreds of thousands of words of repeated garbage. These pages are normal
 * in count but dominate the corpus by volume (measured 2026-05-30: ~3% of
 * translated pages held ~69% of all translation characters). They wreck mean
 * statistics and show readers a wall of repeated text.
 *
 * They are trivially detectable by length. A page is flagged as a loop when:
 *   - translation length > ABS_CHARS (default 20,000 chars, ~3k words), OR
 *   - translation length > RATIO × ocr length  (translation should never be
 *     several times longer than its own source page), with a floor so short
 *     pages with empty/missing OCR don't false-positive.
 *
 * DRY-RUN ONLY by default — it writes nothing. It reports counts per language
 * and per book and (optionally) dumps the affected page list to
 * scripts/output/ for review. A future --fix pass could hide + re-queue these
 * pages; this script deliberately does not, so it is safe to run anytime.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/detect-translation-loops.mjs                 # full corpus, report only
 *   node scripts/maintenance/detect-translation-loops.mjs --language=Tibetan
 *   node scripts/maintenance/detect-translation-loops.mjs --abs=20000 --ratio=3
 *   node scripts/maintenance/detect-translation-loops.mjs --dump          # write affected pages to scripts/output/
 */

import { MongoClient, ObjectId } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';

// pages.book_id is stored as a STRING; books._id is an ObjectId. Convert for joins.
const toOid = (id) => { try { return new ObjectId(String(id)); } catch { return null; } };

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
};
const ABS_CHARS = parseInt(arg('abs', '20000'), 10);     // absolute translation-length flag
const RATIO = parseFloat(arg('ratio', '3'));             // translation/ocr length ratio flag
const RATIO_FLOOR = parseInt(arg('floor', '4000'), 10);  // min translation length for the ratio rule
const LANGUAGE = arg('language', null);                  // restrict to one language
const DUMP = process.argv.includes('--dump');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) { console.error('Missing MONGODB_URI'); process.exit(1); }

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const pages = db.collection('pages');
const books = db.collection('books');

console.log(`Loop detector (DRY RUN — no writes)`);
console.log(`  rule: translation > ${ABS_CHARS.toLocaleString()} chars  OR  translation > ${RATIO}× ocr (min ${RATIO_FLOOR.toLocaleString()} chars)`);
if (LANGUAGE) console.log(`  language filter: ${LANGUAGE}`);

// Optionally scope to one language's books (keeps the scan small for spot checks).
let bookFilter = null;
if (LANGUAGE) {
  const ids = await books.distinct('_id', { language: LANGUAGE });
  bookFilter = ids.map((id) => String(id)); // pages.book_id is a string
  console.log(`  ${ids.length.toLocaleString()} ${LANGUAGE} books`);
}

// Server-side: compute lengths, match the loop condition, return only offending pages.
// Output is small (the offenders), even though the scan itself touches every translated page.
const match = { 'translation.data': { $type: 'string' } };
if (bookFilter) match.book_id = { $in: bookFilter };

const t0 = Date.now();
const offenders = await pages.aggregate([
  { $match: match },
  { $project: {
      book_id: 1, page_number: 1,
      tl: { $strLenCP: '$translation.data' },
      ol: { $strLenCP: { $ifNull: ['$ocr.data', ''] } },
  } },
  { $match: { $expr: { $or: [
      { $gt: ['$tl', ABS_CHARS] },
      { $and: [ { $gt: ['$tl', RATIO_FLOOR] }, { $gt: ['$tl', { $multiply: [RATIO, '$ol'] }] } ] },
  ] } } },
], { allowDiskUse: true }).toArray();
console.log(`\nScan complete in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${offenders.length.toLocaleString()} flagged pages.\n`);

// Join book metadata (language/title/slug) for the affected books.
const bookIds = [...new Set(offenders.map((o) => String(o.book_id)))];
const bookDocs = await books.find(
  { _id: { $in: bookIds.map(toOid).filter(Boolean) } },
  { projection: { language: 1, title: 1, display_title: 1, slug: 1, pages_translated: 1 } },
).toArray();
const bookMap = new Map(bookDocs.map((b) => [String(b._id), b]));

// Aggregate by language and by book.
const byLang = new Map();
const byBook = new Map();
for (const o of offenders) {
  const b = bookMap.get(String(o.book_id));
  const lang = b?.language || 'unknown';
  byLang.set(lang, (byLang.get(lang) || 0) + 1);
  const bk = byBook.get(String(o.book_id)) || { n: 0, maxTl: 0, b };
  bk.n++; bk.maxTl = Math.max(bk.maxTl, o.tl);
  byBook.set(String(o.book_id), bk);
}

console.log('=== FLAGGED PAGES BY LANGUAGE ===');
for (const [lang, n] of [...byLang.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(lang).padEnd(22)} ${n.toLocaleString().padStart(8)} pages`);
}

console.log(`\n=== AFFECTED BOOKS: ${bookIds.length.toLocaleString()} ===`);
console.log('Worst 20 by flagged-page count:');
const worst = [...byBook.values()].sort((a, b) => b.n - a.n).slice(0, 20);
for (const bk of worst) {
  const b = bk.b || {};
  const tr = b.pages_translated || 0;
  const pct = tr ? ((100 * bk.n) / tr).toFixed(0) : '?';
  console.log(`  ${String(b.language || '?').padEnd(10)} ${String(bk.n).padStart(4)} pages (${pct}% of book, max ${bk.maxTl.toLocaleString()} ch)  ${(b.display_title || b.title || '').slice(0, 50)}`);
  if (b.slug) console.log(`      https://sourcelibrary.org/book/${b.slug}`);
}

if (DUMP) {
  const outDir = path.join(process.cwd(), 'scripts', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `translation-loops-${LANGUAGE || 'all'}.json`);
  const payload = offenders.map((o) => ({
    book_id: String(o.book_id), page_number: o.page_number,
    translation_chars: o.tl, ocr_chars: o.ol,
    slug: bookMap.get(String(o.book_id))?.slug,
    language: bookMap.get(String(o.book_id))?.language,
  }));
  fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${payload.length.toLocaleString()} flagged pages → ${out}`);
}

console.log('\nNo writes performed (dry run).');
await client.close();
