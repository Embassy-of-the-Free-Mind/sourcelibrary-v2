#!/usr/bin/env node
/**
 * READ-ONLY audit for the bulk-JP2 off-by-one defect (#3368).
 *
 * scripts/workers/archive-bulk.mjs maps IA's IIIF leaf number (`/page/nN`) onto
 * the ordinal of the sorted *_jp2.zip contents. For items where those two
 * numberings differ, every page was archived its neighbour's scan — the reader
 * sees a scan one leaf behind the OCR beside it.
 *
 * This script writes nothing. For each candidate book it:
 *   1. loads pages and keeps books with >= MIN_BULK_PAGES `bulk_jp2` pages
 *   2. runs the shared dHash alignment check (same test as the #3359 guard)
 *   3. for shift+1 books, splits pages by whether OCR predates archival —
 *      only the pre-archival ones are reader-visible (see readerVisibleShift)
 *
 * Why not just count `bulk_jp2` pages first: a corpus-wide
 * countDocuments/distinct on that field exceeds Atlas's operation time limit.
 * We iterate books by _id (indexed) and look up pages per book instead.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/bulk-archive-alignment.mjs --limit 50
 *   node scripts/audit/bulk-archive-alignment.mjs --all --concurrency 4
 *   node scripts/audit/bulk-archive-alignment.mjs --book <bookId>
 *
 * Flags:
 *   --limit N        stop after N books carrying bulk_jp2 pages (default 50)
 *   --all            no limit
 *   --book ID        audit a single book (repeatable)
 *   --concurrency N  parallel books (default 3; be polite to IA)
 *   --out PATH       JSONL output (default scripts/output/bulk-archive-alignment.jsonl)
 *   --resume         skip book ids already present in the output file
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { checkAlignment, hashBuffer, readerVisibleShift } from '../lib/page-alignment.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
dotenv.config({ path: resolve(REPO_ROOT, '.env.production.local') });
dotenv.config({ path: resolve(REPO_ROOT, '.env.local') });

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const has = name => args.includes(`--${name}`);

const LIMIT = has('all') ? Infinity : parseInt(flag('limit', '50'), 10);
const CONCURRENCY = Math.max(1, parseInt(flag('concurrency', '3'), 10));
const OUT = resolve(REPO_ROOT, flag('out', 'scripts/output/bulk-archive-alignment.jsonl'));
const ONLY_BOOKS = args.reduce((acc, a, i) => (a === '--book' ? [...acc, args[i + 1]] : acc), []);
const MIN_BULK_PAGES = 10;
const SAMPLE = args.includes('--sample') ? parseInt(flag('sample', '50'), 10) : 0;
const BOOK_BATCH = 500; // books fetched per range query (see the pagination note in main)

// IA IIIF page URLs look like .../page/nN/full/pct:50/0/default.jpg — a small
// render is plenty for a perceptual hash and far kinder to archive.org.
const IA_LEAF_RE = /\/page\/n\d+/;
const thumbnail = url => String(url).replace(/\/full\/pct:\d+\//, '/full/pct:12/');

async function hashUrl(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return hashBuffer(Buffer.from(await r.arrayBuffer()));
}

async function auditBook(db, book) {
  const bid = String(book._id);

  // Cheap pre-check before pulling every page doc. Most IA books never went
  // through the bulk archiver, and loading a 600-page book's docs just to
  // discover that dominates the run.
  const probe = await db.collection('pages')
    .findOne({ book_id: bid, 'archive_metadata.source': 'bulk_jp2' }, { projection: { _id: 1 } });
  if (!probe) return null;

  const pages = await db.collection('pages')
    .find({ book_id: bid })
    .project({
      page_number: 1, photo: 1, photo_original: 1, archived_photo: 1,
      archive_metadata: 1, 'ocr.updated_at': 1, 'ocr.created_at': 1, 'ocr.source': 1,
    })
    .sort({ page_number: 1 })
    .toArray();

  const bulkPages = pages.filter(p => p.archive_metadata?.source === 'bulk_jp2');
  if (bulkPages.length < MIN_BULK_PAGES) return null; // not a bulk_jp2 book

  const align = await checkAlignment(pages, {
    hashUrl,
    sourceUrlFor: p => thumbnail(p.photo_original || p.photo),
    isUsableSource: p => IA_LEAF_RE.test(String(p.photo_original || p.photo)),
    // Sample only the bulk_jp2 pages — the ones this defect can touch. Books
    // are frequently archived by more than one path (e.g. 30 of 640 pages via
    // bulk_jp2, the rest via per-page IIIF); sampling the whole book tests
    // pages the bug never wrote and reports a false "aligned".
    candidates: bulkPages,
  });

  const row = {
    book_id: bid,
    title: (book.title || '').slice(0, 90),
    ia_identifier: book.ia_identifier || null,
    visible: book.visible === true,
    pages: pages.length,
    bulk_jp2_pages: bulkPages.length,
    verdict: align.verdict,
    detail: align.detail,
  };

  // Only a shifted archive can be reader-visible; classify its pages.
  //
  // Severity matters more than a boolean here. Nearly every book has a handful
  // of pre-archival pages — the import-time preview OCR pass runs before the
  // bulk archiver (the #3362 ordering hazard) — so "any pre-archival page" is
  // true almost everywhere and useless for triage. Measured: Pseudodoxia 80%
  // and The Federalist 73% of pages pre-archival (both reported by readers),
  // vs Historia de Yucatán at 3.7% (its interior reads correctly).
  if (align.verdict === 'shift+1') {
    const split = readerVisibleShift(bulkPages);
    const share = split.visible / bulkPages.length;
    row.reader_visible_pages = split.visible;
    row.self_consistent_pages = split.consistent;
    row.unknown_timing_pages = split.unknown;
    row.reader_visible_share = Number(share.toFixed(3));
    row.severity = share >= 0.5 ? 'high' : split.visible > 0 ? 'partial' : 'none';
  }
  return row;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  // Exit-code contract (the scheduled watch in corpus-integrity-watch.yml reads it):
  //   0 = ran, nothing shifted   1 = ran, FOUND misalignment   2 = could not run
  // Conflating 2 with 1 is how three Mondays of "misalignment found" issues were
  // filed by a job that never reached the database (#3572/#3862/#4009).
  if (!uri) { console.error('MONGODB_URI not set — source .env.production.local first'); process.exit(2); }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const done = new Set();
  if (has('resume') && fs.existsSync(OUT)) {
    for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { done.add(JSON.parse(line).book_id); } catch { /* ignore bad line */ }
    }
    console.log(`resume: skipping ${done.size} already-audited books`);
  }
  const out = fs.createWriteStream(OUT, { flags: has('resume') ? 'a' : 'w' });

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  const query = ONLY_BOOKS.length
    ? { $expr: { $in: [{ $toString: '$_id' }, ONLY_BOOKS] } }
    : { 'image_source.provider': 'internet_archive', pages_count: { $gt: MIN_BULK_PAGES } };

  const tally = {};
  let audited = 0, scanned = 0;
  const inFlight = new Set();

  const record = row => {
    audited++;
    tally[row.verdict] = (tally[row.verdict] || 0) + 1;
    if (row.severity) tally[`severity:${row.severity}`] = (tally[`severity:${row.severity}`] || 0) + 1;
    out.write(JSON.stringify(row) + '\n');
    const tag = row.verdict === 'shift+1'
      ? `shift+1 ${row.severity} ${row.reader_visible_pages}/${row.bulk_jp2_pages}`
      : row.verdict;
    console.log(`[${audited}] ${tag.padEnd(30)} ${row.book_id} ${row.title}`);
  };

  // --sample N: random books instead of an _id walk. Intended for a recurring
  // spot-check (a weekly run covers different books each time), which catches
  // drift from ANY writer — including the archive paths that still have no
  // write-time guard — rather than only the one this audit was built for.
  if (SAMPLE) {
    const picked = await db.collection('books').aggregate([
      { $match: query },
      { $sample: { size: SAMPLE } },
      { $project: { title: 1, ia_identifier: 1, visible: 1, pages_count: 1 } },
    ]).toArray();
    console.log(`sampling ${picked.length} random IA books`);
    for (const book of picked) {
      scanned++;
      const task = auditBook(db, book)
        .then(row => { if (row) record(row); })
        .catch(err => console.log(`  [ERR] ${book._id}: ${err.message?.slice(0, 80)}`))
        .finally(() => inFlight.delete(task));
      inFlight.add(task);
      if (inFlight.size >= CONCURRENCY) await Promise.race(inFlight);
    }
    await Promise.all(inFlight);
    out.end();
    const shifted = Object.entries(tally).filter(([k]) => k === 'shift+1').map(([, v]) => v)[0] || 0;
    console.log(`\nsampled ${scanned}, audited ${audited} with bulk_jp2 pages`);
    console.log('TALLY:', JSON.stringify(tally));
    await client.close();
    process.exit(shifted > 0 ? 1 : 0); // non-zero so a scheduled run can alert
  }

  // Paginate by _id rather than holding one cursor open. A single cursor sits
  // idle for minutes at a time while we fetch and hash images, and Atlas
  // reaps it — the first full-corpus run died at 701 books with CursorNotFound
  // (code 43). Range queries are also naturally resumable.
  let lastId = null;
  let exhausted = false;

  while (audited < LIMIT && !exhausted) {
    const batchQuery = lastId ? { $and: [query, { _id: { $gt: lastId } }] } : query;
    const batch = await db.collection('books')
      .find(batchQuery, { projection: { title: 1, ia_identifier: 1, visible: 1, pages_count: 1 } })
      .sort({ _id: 1 })
      .limit(BOOK_BATCH)
      .toArray();
    if (!batch.length) { exhausted = true; break; }
    lastId = batch[batch.length - 1]._id;

    for (const book of batch) {
      if (audited >= LIMIT) break;
      scanned++;
      if (scanned % 250 === 0) console.log(`  … scanned ${scanned} IA books, ${audited} with bulk_jp2 so far`);
      if (done.has(String(book._id))) continue;

      const task = auditBook(db, book)
        .then(row => { if (row) record(row); })
        .catch(err => console.log(`  [ERR] ${book._id}: ${err.message?.slice(0, 80)}`))
        .finally(() => inFlight.delete(task));
      inFlight.add(task);
      if (inFlight.size >= CONCURRENCY) await Promise.race(inFlight);
    }
  }
  await Promise.all(inFlight);

  out.end();
  console.log(`\nscanned ${scanned} IA books, audited ${audited} with >=${MIN_BULK_PAGES} bulk_jp2 pages`);
  console.log('TALLY:', JSON.stringify(tally));
  console.log(`rows: ${OUT}`);
  if (LIMIT !== Infinity && audited >= LIMIT) {
    console.log(`NOTE: stopped at --limit ${LIMIT}; coverage is partial. Re-run with --all --resume for full coverage.`);
  }
  await client.close();
}

main().catch(err => { console.error(err); process.exit(2); }); // 2 = infrastructure failure, never a finding
