#!/usr/bin/env node
/**
 * Remediate AI "recitation-loop" translation pages — the destructive half that
 * detect-translation-loops.mjs deliberately left for "a future --fix pass".
 *
 * BACKGROUND. A page sends the translation model into a token-repetition loop
 * ("They see the Dharma." × 6,522 → 52k words from a 1,600-word original). The
 * culprit is the retired `gemini-3.1-flash-lite-preview` running on non-Latin
 * scripts (Tibetan, Hebrew, Ge'ez, Syriac, CJK, Javanese). The current pipeline
 * already routes those scripts to `flash` (see getModelForBook in
 * translate-worker.mjs), which does not loop — so clearing the garbage and
 * letting the orchestrator re-queue the page produces a correct translation.
 *
 * WHAT IT DOES (per flagged page):
 *   - $unset translation.data / translation_summary / translation_keywords
 *     (the loop garbage — it pollutes search, embeddings, quotes, and corpus
 *     stats; it is never real source text).
 *   - decrements books.pages_translated by the number cleared.
 *   - resets the book's pipeline_auto.status to 'ocr_complete' and clears any
 *     stale job, so orchestrator Phase 4 re-queues the now-untranslated pages
 *     (which then route to flash and translate cleanly).
 *
 * TWO-GATE SAFETY. Length alone is a coarse flag (a dense folio can be long).
 * Before clearing ANY page, this script fetches the translation and confirms it
 * is genuinely repetitive: the most-frequent line/sentence must account for
 * >= REPEAT_FRAC of the text (default 0.5). Long-but-varied pages are skipped
 * and logged. This is the precision gate that makes a mass clear safe.
 *
 * DRY-RUN BY DEFAULT — writes nothing without --fix. Always run dry first,
 * review the per-language/per-book report and the cost estimate, then re-run
 * with --fix (optionally --book=<id> to remediate a single book as a test).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/fix-translation-loops.mjs                 # dry run, full corpus
 *   node scripts/maintenance/fix-translation-loops.mjs --book=<id>     # scope to one book
 *   node scripts/maintenance/fix-translation-loops.mjs --book=<id> --fix
 *   node scripts/maintenance/fix-translation-loops.mjs --fix           # FULL remediation (after review)
 */

import { MongoClient, ObjectId } from 'mongodb';

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
};
const ABS_CHARS = parseInt(arg('abs', '20000'), 10);      // length flag (~3k words)
const RATIO = parseFloat(arg('ratio', '3'));              // translation/ocr length flag
const RATIO_FLOOR = parseInt(arg('floor', '4000'), 10);   // min length for the ratio rule
const REPEAT_FRAC = parseFloat(arg('repeat', '0.5'));     // precision gate: dominant-line fraction
const ONE_BOOK = arg('book', null);
const FIX = process.argv.includes('--fix');
const LIMIT = parseInt(arg('limit', '0'), 10);            // optional cap (testing)

const toOid = (id) => { try { return new ObjectId(String(id)); } catch { return null; } };

// Repetition ratio: fraction of the text occupied by its single most-common
// non-trivial line. A clean page is ~0; a recitation loop is ~1.
function loopFraction(text) {
  if (!text || text.length < 200) return 0;
  const counts = new Map();
  let total = 0;
  for (let raw of text.split(/[\n.;:!?]+/)) {
    const line = raw.trim();
    if (line.length < 8) continue; // ignore tiny fragments
    counts.set(line, (counts.get(line) || 0) + line.length);
    total += line.length;
  }
  if (!total) return 0;
  let top = 0;
  for (const v of counts.values()) if (v > top) top = v;
  return top / total;
}

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) { console.error('Missing MONGODB_URI'); process.exit(1); }
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const pages = db.collection('pages');
const books = db.collection('books');

console.log(`Recitation-loop remediation — ${FIX ? '\x1b[31mFIX (writing)\x1b[0m' : 'DRY RUN (no writes)'}`);
console.log(`  length flag: > ${ABS_CHARS.toLocaleString()} chars OR > ${RATIO}× ocr (min ${RATIO_FLOOR.toLocaleString()})`);
console.log(`  precision gate: dominant line >= ${(REPEAT_FRAC * 100).toFixed(0)}% of text`);
if (ONE_BOOK) console.log(`  scope: book ${ONE_BOOK}`);

// 1) Length-flag candidate pages server-side (returns only candidates).
const match = { 'translation.data': { $type: 'string' } };
if (ONE_BOOK) match.book_id = String(ONE_BOOK);
const t0 = Date.now();
const candidates = await pages.aggregate([
  { $match: match },
  { $project: { book_id: 1, page_number: 1, tl: { $strLenCP: '$translation.data' }, ol: { $strLenCP: { $ifNull: ['$ocr.data', ''] } } } },
  { $match: { $expr: { $or: [
    { $gt: ['$tl', ABS_CHARS] },
    { $and: [{ $gt: ['$tl', RATIO_FLOOR] }, { $gt: ['$tl', { $multiply: [RATIO, '$ol'] }] }] },
  ] } } },
], { allowDiskUse: true }).toArray();
console.log(`\nLength-flagged ${candidates.length.toLocaleString()} pages in ${((Date.now() - t0) / 1000).toFixed(0)}s.`);

// 2) Precision gate. Fetching every candidate's full text (each up to ~275KB)
// would move tens of GB, so in DRY RUN we verify only a SAMPLE to estimate the
// confirmed-loop fraction; in --fix we verify each page individually right
// before clearing it (bounded, and necessary for a destructive write).
async function verifyFrac(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const docs = await pages.find({ _id: { $in: ids.slice(i, i + 200) } },
      { projection: { 'translation.data': 1 } }).toArray();
    for (const d of docs) out.set(String(d._id), loopFraction(d.translation?.data || ''));
  }
  return out;
}

let confirmFrac = 1;
if (!FIX) {
  const sampleN = Math.min(600, candidates.length);
  const step = Math.max(1, Math.floor(candidates.length / sampleN));
  const sampleIds = candidates.filter((_, i) => i % step === 0).slice(0, sampleN).map((c) => c._id);
  const fracs = await verifyFrac(sampleIds);
  const isLoop = [...fracs.values()].filter((f) => f >= REPEAT_FRAC).length;
  confirmFrac = fracs.size ? isLoop / fracs.size : 0;
  console.log(`Precision check on ${fracs.size} sampled candidates: ${(confirmFrac * 100).toFixed(1)}% are genuine loops ` +
    `(dominant line >= ${(REPEAT_FRAC * 100).toFixed(0)}%). Length-flagged but varied pages are spared at --fix time.`);
}

// In dry run, "work" is the length-flagged set scaled by the confirmed fraction
// for reporting. In --fix, every candidate is re-verified per-page before clearing.
const work = candidates.map((c) => ({ _id: c._id, book_id: String(c.book_id), page_number: c.page_number }));

// 3) Report by language + book.
const bookIds = [...new Set(work.map((c) => c.book_id))];
const bookDocs = await books.find({ _id: { $in: bookIds.map(toOid).filter(Boolean) } },
  { projection: { language: 1, title: 1, display_title: 1, slug: 1, pages_translated: 1, 'pipeline_auto.status': 1 } }).toArray();
const bookMap = new Map(bookDocs.map((b) => [String(b._id), b]));
const byLang = new Map();
const perBook = new Map();
for (const c of work) {
  const lang = bookMap.get(c.book_id)?.language || 'unknown';
  byLang.set(lang, (byLang.get(lang) || 0) + 1);
  perBook.set(c.book_id, (perBook.get(c.book_id) || 0) + 1);
}
const estConfirmed = Math.round(work.length * confirmFrac);
console.log(`\nLength-flagged: ${work.length.toLocaleString()} pages across ${bookIds.length.toLocaleString()} books`);
if (!FIX) console.log(`Estimated genuine loops (flagged × ${(confirmFrac * 100).toFixed(0)}%): ~${estConfirmed.toLocaleString()} pages`);
console.log('\n=== LENGTH-FLAGGED BY LANGUAGE ===');
for (const [lang, n] of [...byLang.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(lang).padEnd(22)} ${n.toLocaleString().padStart(8)} pages`);
}
console.log('\nWorst 15 books by flagged-page count:');
for (const [bid, n] of [...perBook.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  const b = bookMap.get(bid) || {};
  console.log(`  ${String(b.language || '?').padEnd(10)} ${String(n).padStart(4)} pages  ${(b.display_title || b.title || '').slice(0, 48)}`);
  if (b.slug) console.log(`      https://sourcelibrary.org/book/${b.slug}`);
}
console.log(`\nRe-translation cost estimate: ~${Math.ceil(estConfirmed / 8).toLocaleString()} flash batches (cleared pages re-queue automatically).`);

if (!FIX) {
  console.log('\nDRY RUN — no writes. Re-run with --fix (optionally --book=<id> first) to remediate.');
  await client.close();
  process.exit(0);
}

// 4) Remediate per book: re-verify EACH flagged page (fetch its text, confirm
// it loops) before clearing, so a long-but-varied page is never destroyed.
console.log('\nWriting…');
let cleared = 0, sparedAtFix = 0, booksReset = 0, bookN = 0;
for (const [bid, flagged] of perBook.entries()) {
  bookN++;
  const pageIds = work.filter((c) => c.book_id === bid).map((c) => c._id);
  const docs = await pages.find({ _id: { $in: pageIds } }, { projection: { 'translation.data': 1 } }).toArray();
  const loopIds = [];
  for (const d of docs) {
    if (loopFraction(d.translation?.data || '') >= REPEAT_FRAC) loopIds.push(d._id);
    else sparedAtFix++;
  }
  if (!loopIds.length) continue;
  const res = await pages.updateMany(
    { _id: { $in: loopIds } },
    { $unset: { 'translation.data': '', translation_summary: '', translation_keywords: '' },
      $set: { 'translation.loop_quarantined_at': new Date(), 'translation.loop_quarantine_reason': 'recitation-loop (legacy flash-lite-preview)' } },
  );
  cleared += res.modifiedCount;
  // Decrement translated count and reset status so orchestrator Phase 4 re-queues.
  const b = bookMap.get(bid);
  const newTranslated = Math.max(0, (b?.pages_translated || 0) - res.modifiedCount);
  const status = b?.pipeline_auto?.status;
  const reset = ['translate_complete', 'complete', 'images_complete', 'images_submitted', 'summarizing', 'chapters'].includes(status);
  await books.updateOne({ _id: toOid(bid) }, {
    $set: { pages_translated: newTranslated, updated_at: new Date(),
      ...(reset ? { 'pipeline_auto.status': 'ocr_complete' } : {}) },
    ...(reset ? { $unset: { job: '' } } : {}),
  });
  if (reset) booksReset++;
  if (bookN % 100 === 0) console.log(`  …${bookN}/${perBook.size} books, ${cleared.toLocaleString()} pages cleared`);
}
console.log(`\nDone. Cleared ${cleared.toLocaleString()} loop pages; spared ${sparedAtFix.toLocaleString()} long-but-varied; reset ${booksReset.toLocaleString()} books to ocr_complete for re-translation.`);
console.log('The orchestrator will re-queue the cleared pages (non-Latin -> flash, which does not loop).');
await client.close();
process.exit(0);
