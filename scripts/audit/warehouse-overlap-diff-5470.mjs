#!/usr/bin/env node
// PRIOR ART: scripts/audit/books-delete-ledger-gap.mjs (resolves references across books /
// books_warehouse / deleted_books, but compares no content); scripts/eval/enrich-verify-warehouse.mjs
// (reads warehouse metadata for enrichment, not page content). Nothing compared a warehouse copy's
// PAGES against the live copy's, which is the question retiring the warehouse turns on (#5470).
//
// warehouse-overlap-diff-5470 — for every book present in BOTH `books` and `books_warehouse`, does
// the warehouse copy hold anything the live copy lacks? Read-only.
//
// Per book: page-doc counts, scoped `archived_photo` coverage, OCR and translation pages, on both
// sides. A book is FLAGGED when the warehouse side is ahead on any of them; flagged books then get a
// page-level diff. Pages are paired by `id`, falling back to page_number — and a pairing only counts
// when the SOURCE image matches (photo_original || photo): a renumbered or re-split live copy must
// never receive a warehouse page's image or text by position alone (paired-artifacts.md).
//
// An archived URL that is not book-scoped (#3362 `archived/undefined/N.jpg`) is never a gain.
//
//   node --env-file=.env.production.local scripts/audit/warehouse-overlap-diff-5470.mjs [--out=<dir>]
// Writes <out>/overlap-books.jsonl (flagged books, with counts) and <out>/overlap-gains.jsonl
// (page-level gains: { book_id, page_id, live_page_id, page_number, kind, value }).

import fs from 'fs';
import { MongoClient } from 'mongodb';
import { isBookScopedUrl } from '../lib/r2-key.mjs';

const OUT = (process.argv.find((a) => a.startsWith('--out=')) || '--out=scripts/output/retire-warehouse').slice(6);
const CHUNK = 500;

const nonEmpty = (f) => ({ $cond: [{ $gt: [{ $strLenCP: { $ifNull: [f, ''] } }, 0] }, 1, 0] });
const httpUrl = { $cond: [{ $regexMatch: { input: { $ifNull: ['$archived_photo', ''] }, regex: '^https?://' } }, 1, 0] };
const poisoned = { $cond: [{ $regexMatch: { input: { $ifNull: ['$archived_photo', ''] }, regex: '/(undefined|null|NaN)/' } }, 1, 0] };

async function stats(coll, ids) {
  const rows = await coll.aggregate([
    { $match: { book_id: { $in: ids } } },
    { $group: { _id: '$book_id', n: { $sum: 1 }, arch: { $sum: httpUrl }, poison: { $sum: poisoned }, ocr: { $sum: nonEmpty('$ocr.data') }, tr: { $sum: nonEmpty('$translation.data') } } },
  ], { allowDiskUse: true }).toArray();
  return new Map(rows.map((r) => [r._id, r]));
}

const src = (p) => p.photo_original || p.photo || null;

const goodArchive = (p) => typeof p.archived_photo === 'string' && /^https?:\/\//.test(p.archived_photo) && isBookScopedUrl(p.archived_photo, p.book_id);

async function pageDiff(db, bookId) {
  // Text lengths only — never pull the text itself over the wire for 20K books.
  const pipe = [{ $match: { book_id: bookId } }, { $project: { _id: 1, id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, archive_metadata: 1, book_id: 1,
    ocr_len: { $strLenCP: { $trim: { input: { $ifNull: ['$ocr.data', ''] } } } }, tr_len: { $strLenCP: { $trim: { input: { $ifNull: ['$translation.data', ''] } } } } } }];
  const wh = await db.collection('pages_warehouse').aggregate(pipe).toArray();
  const live = await db.collection('pages').aggregate(pipe).toArray();
  const byId = new Map(live.map((p) => [p.id || String(p._id), p]));
  const byNum = new Map();
  for (const p of live) { if (!byNum.has(p.page_number)) byNum.set(p.page_number, []); byNum.get(p.page_number).push(p); }
  const gains = [];
  const tally = { missing_in_live: 0, unpaired_source_mismatch: 0, archive: 0, ocr: 0, translation: 0 };
  for (const w of wh) {
    let l = byId.get(w.id || String(w._id));
    if (!l) { const c = byNum.get(w.page_number) || []; l = c.length === 1 ? c[0] : null; }
    if (!l) { tally.missing_in_live++; gains.push({ book_id: bookId, page_id: String(w._id), page_number: w.page_number, kind: 'missing_in_live', has_archive: goodArchive(w), has_ocr: w.ocr_len > 0, has_translation: w.tr_len > 0 }); continue; }
    if (src(w) && src(l) && src(w) !== src(l)) { tally.unpaired_source_mismatch++; continue; }
    const base = { book_id: bookId, page_id: String(w._id), live_page_id: String(l._id), page_number: w.page_number };
    if (goodArchive(w) && !goodArchive(l)) { tally.archive++; gains.push({ ...base, kind: 'archive', value: w.archived_photo, live_value: l.archived_photo ?? null, archive_metadata: w.archive_metadata ?? null }); }
    if (w.ocr_len > 0 && !(l.ocr_len > 0)) { tally.ocr++; gains.push({ ...base, kind: 'ocr', chars: w.ocr_len }); }
    if (w.tr_len > 0 && !(l.tr_len > 0)) { tally.translation++; gains.push({ ...base, kind: 'translation', chars: w.tr_len }); }
  }
  return { tally, gains, wh: wh.length, live: live.length };
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  fs.mkdirSync(OUT, { recursive: true });
  const booksOut = fs.createWriteStream(`${OUT}/overlap-books.jsonl`);
  const gainsOut = fs.createWriteStream(`${OUT}/overlap-gains.jsonl`);

  // Overlap = warehouse rows whose id is in books, minus books this migration itself promoted.
  const overlap = await db.collection('books_warehouse').aggregate([
    { $lookup: { from: 'books', localField: 'id', foreignField: 'id', as: 'live', pipeline: [{ $project: { pages_count: 1, 'pipeline_auto.hold.reason': 1 } }] } },
    { $match: { 'live.0': { $exists: true } } },
    { $project: { id: 1, title: 1, pages_count: 1, promoted_to: 1, promoted_at: 1, live_pages_count: { $arrayElemAt: ['$live.pages_count', 0] }, hold: { $arrayElemAt: ['$live.pipeline_auto.hold.reason', 0] } } },
  ], { allowDiskUse: true }).toArray();
  const pop = overlap.filter((b) => b.hold !== 'warehouse-promotion-5470');
  console.log(`[overlap] ${overlap.length} in both; ${pop.length} excluding this migration's own promotions`);

  const sum = { books: pop.length, flagged: 0, wh_pages: 0, live_pages: 0, wh_poisoned_pages: 0, gains: { missing_in_live: 0, archive: 0, ocr: 0, translation: 0, unpaired_source_mismatch: 0 }, promoted_to_live: pop.filter((b) => b.promoted_to === 'live').length };
  for (let i = 0; i < pop.length; i += CHUNK) {
    const chunk = pop.slice(i, i + CHUNK);
    const ids = chunk.map((b) => b.id);
    const [ws, ls] = await Promise.all([stats(db.collection('pages_warehouse'), ids), stats(db.collection('pages'), ids)]);
    for (const b of chunk) {
      const w = ws.get(b.id) || { n: 0, arch: 0, poison: 0, ocr: 0, tr: 0 };
      const l = ls.get(b.id) || { n: 0, arch: 0, poison: 0, ocr: 0, tr: 0 };
      sum.wh_pages += w.n; sum.live_pages += l.n; sum.wh_poisoned_pages += w.poison;
      const whArch = w.arch - w.poison;
      const ahead = w.n > l.n || whArch > l.arch - l.poison || w.ocr > l.ocr || w.tr > l.tr;
      // A warehouse page can carry a gain even when the live totals are higher (different pages),
      // so totals only decide which books get the page-level pass; they are not the verdict.
      const maybe = ahead || (w.n > 0 && (whArch > 0 || w.ocr > 0 || w.tr > 0));
      if (!maybe) continue;
      const d = await pageDiff(db, b.id);
      const any = d.tally.missing_in_live + d.tally.archive + d.tally.ocr + d.tally.translation;
      for (const k of Object.keys(sum.gains)) sum.gains[k] += d.tally[k];
      if (any === 0 && d.tally.unpaired_source_mismatch === 0) continue;
      sum.flagged++;
      booksOut.write(JSON.stringify({ book_id: b.id, title: String(b.title || '').slice(0, 100), promoted_to: b.promoted_to ?? null, wh_pages_count: b.pages_count, live_pages_count: b.live_pages_count, wh: w, live: l, tally: d.tally }) + '\n');
      for (const g of d.gains) gainsOut.write(JSON.stringify(g) + '\n');
    }
    console.log(`  ${Math.min(i + CHUNK, pop.length)}/${pop.length} ${JSON.stringify(sum.gains)} flagged=${sum.flagged}`);
  }
  console.log(`[overlap] ${JSON.stringify(sum)}`);
  fs.writeFileSync(`${OUT}/overlap-summary.json`, JSON.stringify(sum, null, 2));
  await new Promise((r) => booksOut.end(r));
  await new Promise((r) => gainsOut.end(r));
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
