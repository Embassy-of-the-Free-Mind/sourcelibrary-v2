#!/usr/bin/env node
// PRIOR ART: scripts/audit/bulk-archive-alignment.mjs — the weekly sample of 40 Internet Archive books (#441); it asks
//   "is this archive shifted", bulk_jp2 only, and not "did a lane just read from a shifted set".
// scripts/audit/provenance-coverage.mjs — walks the pages written in a window by the indexed `ocr.updated_at`; it checks
//   the provenance block, never the image. This borrows its window walk.
// scripts/audit/leaf-alignment-screen.mjs (#7866) — judge-free signals over stored text; by its own account it misses
//   e-rara books whose text was read from the shifted images.
/**
 * image-set-reads — the read side of the image-set gate (scripts/lib/image-set-gate.mjs, v3#466). READ-ONLY.
 *
 * The gate sits in cli-ocr.mjs, which the agy and Claude lanes write through. Other readers (the GPU and Paddle lanes,
 * anything new) do not pass it, and a guard on one writer is not a guarantee. This lists the books that had a page
 * transcribed in the window and whose stored images sit off their page rows, whichever lane wrote them, so a reader
 * that bypasses the gate shows up the next day instead of at the next accident.
 *
 *   node --env-file=.env.production.local scripts/audit/image-set-reads.mjs [--days=2] [--limit=400] [--json]
 *
 * Exit 0: no book read in the window sits on a shifted or mixed image set. Exit 3: at least one does (listed, with the
 * lanes that wrote it). Exit 2: the control failed — no page was found in the window at all, which on this library
 * means the walk is broken, not that nothing was read.
 * Cost: one indexed walk of the window, then up to 15 small image fetches a book that a shift-prone writer archived.
 */
import { MongoClient } from 'mongodb';
import { bookImageSet, imageSetReadRefusal, SHIFT_PRONE_WRITERS } from '../lib/image-set-gate.mjs';

const PRONE = Object.keys(SHIFT_PRONE_WRITERS);

const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const DAYS = Number(arg('days', '2'));
const LIMIT = Number(arg('limit', '400'));
const JSON_OUT = process.argv.includes('--json');

const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await client.connect();
const db = client.db('bookstore');
const since = new Date(Date.now() - DAYS * 86400_000);

// Books with a page transcribed in the window, with the lanes that wrote them (indexed on ocr.updated_at).
const books = await db.collection('pages').aggregate([
  { $match: { 'ocr.updated_at': { $gte: since } } },
  { $group: { _id: '$book_id', pages: { $sum: 1 }, prone: { $sum: { $cond: [{ $in: ['$archive_metadata.source', PRONE] }, 1, 0] } }, lanes: { $addToSet: { $ifNull: ['$ocr.lane', { $ifNull: ['$ocr.source', 'unknown'] }] } }, gated: { $sum: { $cond: [{ $ifNull: ['$ocr.engine.input.image_set', false] }, 1, 0] } } } },
  { $sort: { pages: -1 } },
], { allowDiskUse: true, maxTimeMS: 600_000 }).toArray();

if (!books.length) { console.error(`CONTROL FAILED: no page transcribed in the last ${DAYS} day(s)`); await client.close(); process.exit(2); }

// Only a book a shift-prone writer archived can fail, so only those are fetched (the pages read in the window say which).
const prone = books.filter((b) => b.prone > 0);
const tally = { books_read: books.length, no_shift_prone_page_read: books.length - prone.length, checked: 0, not_applicable: 0, aligned: 0, unknown: 0, shifted: 0, mixed: 0, not_checked_over_limit: Math.max(0, prone.length - LIMIT) };
const bad = [];
for (const b of prone.slice(0, LIMIT)) {
  const v = await bookImageSet(db, b._id);
  tally.checked++; tally[v.verdict]++;
  if (imageSetReadRefusal(v)) bad.push({ book_id: b._id, verdict: v.verdict, pages_read_in_window: b.pages, of_which_passed_the_gate: b.gated, lanes: b.lanes, writers: v.writers });
}
await client.close();

if (JSON_OUT) console.log(JSON.stringify({ since, tally, bad }, null, 1));
else {
  console.log(`Books with a page transcribed since ${since.toISOString().slice(0, 10)}: ${tally.books_read}; image sets checked: ${tally.checked}`);
  console.log(`  no page from a shift-prone archive ${tally.no_shift_prone_page_read}; of the rest: aligned ${tally.aligned}, already verified by the archiver ${tally.not_applicable}, could not be decided ${tally.unknown}, SHIFTED ${tally.shifted}, MIXED ${tally.mixed}${tally.not_checked_over_limit ? `, not checked (over --limit) ${tally.not_checked_over_limit}` : ''}`);
  for (const r of bad) console.log(`  ${r.verdict.toUpperCase()} ${r.book_id}: ${r.pages_read_in_window} page(s) read in the window by ${r.lanes.join(', ')} (${r.of_which_passed_the_gate} carry a gate record) ${JSON.stringify(r.writers)}`);
}
process.exit(bad.length ? 3 : 0);
