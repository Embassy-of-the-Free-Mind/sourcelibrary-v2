#!/usr/bin/env node
/**
 * Pages whose text was stranded by the #3368 bulk-JP2 IMAGE repair (#5309).
 *
 * PRIOR ART: scripts/audit/ia-model-ocr-off-leaf.mjs (#5398) — finds the same
 * pages from the text side by matching against IA's djvu leaves; it needs ~29 h
 * of IA fetches for the corpus and abstains on books IA cannot read (mostly
 * Chinese). This audit is the exact list for the one cause that detector
 * traced, read from Mongo in minutes. scripts/audit/bulk-archive-alignment.mjs
 * checks images, not text.
 *
 * THE CAUSE. repair-bulk-jp2-offset.mjs re-archived the shifted images of every
 * book where it could prove the archive was wrong (2026-07-28/29). Pages OCR'd
 * after the shifted archive was written had read the shifted image; the repair
 * corrected the image beside them and flagged them `needs_reocr`. Nothing reads
 * that flag, so their text (and translation) still shows the neighbouring leaf.
 * Classifier: strandedByImageRepair() in scripts/lib/page-alignment.mjs.
 *
 * Read-only. Exits 1 while any stranded page remains, so a scheduled run is a
 * check that terminates when the repair lands.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/stranded-image-repair-text.mjs \
 *     [--out scripts/output/stranded-image-repair-text.jsonl] [--book ID]
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';
import { strandedByImageRepair } from '../lib/page-alignment.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const OUT = flag('out', 'scripts/output/stranded-image-repair-text.jsonl');
const ONE = flag('book', null);

/** Collapse sorted page numbers into "a-b" ranges. */
export function ranges(nums) {
  const out = [];
  for (const n of nums) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n; else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`));
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const bookQuery = ONE ? { id: ONE } : { 'archive_metadata.jp2_offset_repaired_at': { $exists: true } };
const books = await db.collection('books').find(bookQuery, {
  projection: { id: 1, title: 1, visible: 1, pages_count: 1, language: 1, archive_metadata: 1 },
}).toArray();

fs.mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
const w = fs.createWriteStream(OUT);
const tot = { books: 0, books_stranded: 0, live_books_stranded: 0, stranded: 0, stranded_translated: 0,
  live_stranded: 0, live_stranded_translated: 0, flagged_not_stranded: 0, stranded_not_flagged: 0 };
const cls = {};

for (const b of books) {
  tot.books++;
  const repairedAt = b.archive_metadata?.jp2_offset_repaired_at;
  const pages = await db.collection('pages').find({ book_id: b.id }, {
    projection: { page_number: 1, hidden: 1, needs_reocr: 1, needs_reocr_reason: 1, archive_metadata: 1,
      'ocr.data': 1, 'ocr.updated_at': 1, 'ocr.created_at': 1, 'ocr.model': 1, 'ocr.source': 1, 'translation.data': 1 },
  }).sort({ page_number: 1 }).toArray();

  const stranded = [];
  const counts = {};
  for (const p of pages) {
    const c = strandedByImageRepair(p, repairedAt);
    counts[c] = (counts[c] || 0) + 1;
    cls[c] = (cls[c] || 0) + 1;
    const flagged = p.needs_reocr === true && p.needs_reocr_reason === 'jp2-offset-repair-#3368';
    if (c === 'stranded') { stranded.push(p); if (!flagged) tot.stranded_not_flagged++; }
    else if (flagged && c !== 'unknown') tot.flagged_not_stranded++;
  }
  const live = b.visible === true && (b.pages_count || 0) > 0;
  const translated = stranded.filter(p => String(p.translation?.data || '').trim()).length;
  if (stranded.length) {
    tot.books_stranded++; tot.stranded += stranded.length; tot.stranded_translated += translated;
    if (live) { tot.live_books_stranded++; tot.live_stranded += stranded.length; tot.live_stranded_translated += translated; }
  }
  const ocrRuns = {};
  for (const p of stranded) { const k = `${p.ocr?.source}|${p.ocr?.model}`; ocrRuns[k] = (ocrRuns[k] || 0) + 1; }
  w.write(JSON.stringify({
    book_id: b.id, title: b.title?.slice(0, 120), language: b.language, live,
    repaired: b.archive_metadata?.jp2_offset_repaired === true, repaired_at: repairedAt,
    pages: pages.length, classes: counts,
    stranded: stranded.length, stranded_translated: translated,
    stranded_ranges: ranges(stranded.map(p => p.page_number)),
    stranded_page_ids: stranded.map(p => String(p._id)),
    ocr_runs: ocrRuns,
  }) + '\n');
}
w.end();
await client.close();

console.log(`books with an image repair: ${tot.books}`);
console.log(`page classes: ${JSON.stringify(cls)}`);
console.log(`STRANDED: ${tot.stranded} pages in ${tot.books_stranded} books (${tot.stranded_translated} translated)`);
console.log(`  live books: ${tot.live_stranded} pages in ${tot.live_books_stranded} books (${tot.live_stranded_translated} translated)`);
console.log(`flag vs timestamps: ${tot.stranded_not_flagged} stranded but unflagged, ${tot.flagged_not_stranded} flagged but not stranded`);
console.log(`wrote ${OUT}`);
process.exit(tot.stranded > 0 ? 1 : 0);
