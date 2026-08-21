#!/usr/bin/env node
/**
 * Repoint `pages.image_thumb` from a provider's server to the R2 thumbnail we
 * already hold.
 *
 * WHY (#4163)
 * -----------
 * `image_thumb` is the FIRST candidate the thumb tier of `getPageImageUrl`
 * considers, so a provider URL there wins over an R2 variant sitting in
 * `thumbnail_blob` — even though we archived the page and hold the bytes.
 * That is precisely how 2,506 Florentine Codex pages rendered nothing: Getty
 * was missing from `CSP_IMG_HOSTS`, every browser refused the URL, and the
 * working R2 thumbnail one field away was never reached.
 *
 * Serving our own bytes removes the whole class:
 *   - no dependency on a provider's uptime, rate limits or URL scheme
 *   - no allowlist entry to maintain in TWO places (CSP + the image proxy),
 *     where a miss is silent and total
 *   - R2 egress is free; we are already paying to store these objects
 *
 * SHAPE — why this is two phases with a checkpoint
 * ------------------------------------------------
 * The first version issued ONE query: every page of every live book, with a
 * 22,073-element `$in` and a `$expr` regex, over 18.9M documents. It ran ~10
 * minutes and then died on `MongoNetworkError: read ECONNRESET` before printing
 * a line — so a 5,490-row write depended on a ten-minute unindexed scan not
 * being interrupted. (Nothing was written; verified via `sweep_log` and probe
 * pages.) That is the corpus-walk rule: a walk needs a checkpoint FIRST.
 *
 * Phase A discovers the candidate BOOK ids once and caches them to disk. It
 * drops the giant `$in` (intersecting with the live set afterwards in memory is
 * free) and uses a plain `$not` operator rather than `$expr`. Phase B then works
 * book by book — each query indexed on `book_id`, each book checkpointed — so an
 * interruption costs one book, not the run.
 *
 * SAFETY
 * ------
 * - Only touches pages whose `thumbnail_blob` is already an R2 URL. Never
 *   invents a key, never derives one — see the #3362 rule that a page key must
 *   contain its own book_id; this copies an existing verified value and asserts
 *   book scope before writing.
 * - HEAD-checks the R2 targets before any write, so we cannot repoint at a 404.
 * - Preserves the old value in `field_provenance.image_thumb.previous`.
 * - Records one `sweep_log` ROW per book, not a new column (field-sprawl rule).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repoint-provider-thumbs-to-r2.mjs
 *   node --env-file=.env.production.local scripts/maintenance/repoint-provider-thumbs-to-r2.mjs --apply
 *   … --refresh-books   discard the cached book list and re-discover
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const REFRESH = process.argv.includes('--refresh-books');
const R2_HOST = 'images.sourcelibrary.org';
const R2_PREFIX = `https://${R2_HOST}/`;
const OUT_DIR = 'scripts/output';
const BOOKS_CACHE = path.join(OUT_DIR, 'repoint-thumb-books.json');
const CHECKPOINT = path.join(OUT_DIR, 'repoint-thumb-books.checkpoint');

fs.mkdirSync(OUT_DIR, { recursive: true });

const client = new MongoClient(process.env.MONGODB_URI, {
  socketTimeoutMS: 0,          // the discovery scan legitimately runs for minutes
  serverSelectionTimeoutMS: 30000,
  retryReads: true,
  retryWrites: true,
});
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

// ---- Phase A: which books have a provider-hosted thumb? -------------------
let bookIds;
if (!REFRESH && fs.existsSync(BOOKS_CACHE)) {
  bookIds = JSON.parse(fs.readFileSync(BOOKS_CACHE, 'utf8'));
  console.log(`phase A: ${bookIds.length} candidate books (cached — --refresh-books to redo)`);
} else {
  console.log('phase A: scanning for pages whose image_thumb is not on R2 (minutes, once)…');
  const rows = await pages.aggregate([
    // Plain operators, no $expr and no 22K-element $in — both were why the
    // single-query version could not finish reliably.
    { $match: { image_thumb: { $type: 'string', $ne: '', $not: new RegExp(R2_HOST.replace(/\./g, '\\.')) } } },
    { $group: { _id: '$book_id' } },
  ], { allowDiskUse: true, maxTimeMS: 3600000 }).toArray();

  const liveIds = new Set((await books
    .find({ visible: true, pages_count: { $gt: 0 } }, { projection: { _id: 1 }, maxTimeMS: 300000 })
    .toArray()).map(b => b._id.toString()));

  bookIds = rows.map(r => r._id).filter(id => id && liveIds.has(id));
  fs.writeFileSync(BOOKS_CACHE, JSON.stringify(bookIds, null, 1));
  console.log(`phase A: ${rows.length} books with a provider thumb, ${bookIds.length} of them live -> ${BOOKS_CACHE}`);
}
if (!bookIds.length) { console.log('nothing to do.'); await client.close(); process.exit(0); }

const done = new Set(fs.existsSync(CHECKPOINT)
  ? fs.readFileSync(CHECKPOINT, 'utf8').split('\n').filter(Boolean)
  : []);
if (done.size) console.log(`resuming: ${done.size} book(s) already processed`);

// ---- Phase B: per book — indexed, verified, checkpointed ------------------
let totalCandidates = 0, totalWritten = 0, totalSkipped = 0;
const hostTotals = {};

for (const bookId of bookIds) {
  if (done.has(bookId)) continue;

  const candidates = await pages.find(
    {
      book_id: bookId,                       // indexed
      page_number: { $gte: 0 },
      image_thumb: { $type: 'string', $ne: '', $not: new RegExp(R2_HOST.replace(/\./g, '\\.')) },
      thumbnail_blob: { $regex: `^${R2_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` },
    },
    { projection: { book_id: 1, page_number: 1, image_thumb: 1, thumbnail_blob: 1 }, maxTimeMS: 120000 },
  ).toArray();

  if (!candidates.length) {
    fs.appendFileSync(CHECKPOINT, `${bookId}\n`);
    continue;
  }
  totalCandidates += candidates.length;

  // A page key must contain its own book_id (#3362). The value was written by
  // the archiver, but assert rather than trust.
  const misscoped = candidates.filter(p => !p.thumbnail_blob.includes(p.book_id));
  if (misscoped.length) {
    console.error(`REFUSING (${bookId}): ${misscoped.length} thumbnail_blob values not scoped to their own book_id`);
    console.error(misscoped.slice(0, 3).map(p => `  ${p.thumbnail_blob}`).join('\n'));
    process.exit(1);
  }

  for (const p of candidates) {
    const h = (() => { try { return new URL(p.image_thumb).hostname; } catch { return '(malformed)'; } })();
    hostTotals[h] = (hostTotals[h] || 0) + 1;
  }

  // Verify the R2 targets for THIS book before touching it. 16-way concurrent:
  // serially and silently this looked like a hang and got the first run killed.
  let bad = 0;
  const queue = [...candidates];
  await Promise.all(Array.from({ length: Math.min(16, queue.length) }, async () => {
    while (queue.length) {
      const p = queue.pop();
      const res = await fetch(p.thumbnail_blob, { method: 'HEAD' }).catch(() => null);
      if (!res || !res.ok) { bad++; console.error(`  MISSING ${res?.status ?? 'ERR'} ${p.thumbnail_blob}`); }
    }
  }));
  if (bad) {
    // Repointing at a 404 would turn a blocked image into a missing one.
    console.error(`SKIPPING ${bookId}: ${bad}/${candidates.length} R2 targets did not return 200`);
    totalSkipped += candidates.length;
    continue; // deliberately NOT checkpointed — this book needs a look
  }

  if (!APPLY) {
    console.log(`  [dry] ${bookId}  ${candidates.length} pages ready`);
    fs.appendFileSync(CHECKPOINT, `${bookId}\n`);
    continue;
  }

  const res = await pages.bulkWrite(candidates.map(p => ({
    updateOne: {
      filter: { _id: p._id },
      update: {
        $set: {
          image_thumb: p.thumbnail_blob,
          'field_provenance.image_thumb': {
            source: 'repoint-provider-thumbs-to-r2',
            method: 'copy-verified-thumbnail_blob',
            previous: p.image_thumb,
            date: new Date().toISOString(),
          },
        },
      },
    },
  })), { ordered: false });

  totalWritten += res.modifiedCount;
  await recordSweepAction(db, {
    sweep: 'repoint-provider-thumbs-to-r2',
    book_id: bookId,
    action: 'repointed-thumbs',
    detail: { pages: res.modifiedCount, to: R2_HOST },
  });
  fs.appendFileSync(CHECKPOINT, `${bookId}\n`);
  console.log(`  ${bookId}  modified ${res.modifiedCount}/${candidates.length}  (running total ${totalWritten})`);
}

console.log(`\ncandidates seen: ${totalCandidates}`);
for (const [h, n] of Object.entries(hostTotals).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${h.padEnd(26)} ${String(n).padStart(6)} pages`);
}
if (totalSkipped) console.log(`skipped (R2 target missing): ${totalSkipped}`);
console.log(APPLY
  ? `\nmodified ${totalWritten} pages. Old values kept in field_provenance.image_thumb.previous.`
  : '\nDRY RUN — pass --apply to write. Nothing changed.');
console.log(`checkpoint: ${CHECKPOINT} (delete to re-run from the start)`);
await client.close();
