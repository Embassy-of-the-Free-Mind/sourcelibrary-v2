#!/usr/bin/env node
/**
 * Backfill `content_type: 'book'` on paged records that carry no content_type
 * and no resource_type (#5292 part c, design: .claude/docs/translation-state.md).
 *
 * WHY: the translation-state ladder puts `content_type: 'artwork'` records in
 * `no_pages`. On 2026-10-01, 29,656 live records with pages (57,042 across all
 * visibility) had content_type missing, so that exclusion held only because
 * artwork records happen to have pages_count 0. Every artwork record carries a
 * `resource_type` (measured: 0 null-content_type records with pages have one),
 * and isArtworkRecord() (src/lib/artwork-record.ts) already reads "no
 * content_type, no resource_type" as a text. This sweep writes down what every
 * reader already concludes; it changes no routing and no rung.
 *
 * The predicate is exactly that reading rule plus "has pages":
 *   content_type null/missing  AND  resource_type null/missing  AND  pages_count > 0
 * Spot-checked by title: 16-page dissertations and pamphlets, BPH manuscripts,
 * Balinese lontar from Commons — texts, not pictures.
 *
 * Shape: ids are collected to a checkpoint file FIRST (never stream a cursor
 * across writes), then written in batches of 1000. Each batch logs its rows to
 * `sweep_log` BEFORE writing (scripts/lib/sweep-log.mjs), re-asserts the
 * predicate in the update filter, and then asserts the stage ran: no id in the
 * batch may still match. Re-running resumes from the checkpoint.
 *
 * Deliberately does NOT bump `updated_at`: that would push 57K rows through
 * sync-books-catalog.mjs to Supabase at once. Supabase's copy catches up on each
 * book's next ordinary sync, and its artwork filter already treats null as a
 * text (ARTWORK_EXCLUSION_OR in src/lib/artwork-record.ts).
 *
 * PRIOR ART: scripts/maintenance/recount-page-stats.mjs — per-book page walk for counters, not a field stamp; scripts/maintenance/backfill-content-hashes.mjs — page hashes, different collection
 *
 * Usage (from the main checkout, which has the env file):
 *   node --env-file=.env.production.local scripts/maintenance/backfill-content-type.mjs            # dry run
 *   node --env-file=.env.production.local scripts/maintenance/backfill-content-type.mjs --apply
 *   ... --live-only      restrict to visible: true (default: every paged record)
 *   ... --checkpoint <path>   default: scripts/output/backfill-content-type.checkpoint.json
 */
import { MongoClient } from 'mongodb';
import { EJSON } from 'bson';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const SWEEP = 'content-type-backfill-2026-10';
const BATCH = 1000;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LIVE_ONLY = args.includes('--live-only');
const cpIdx = args.indexOf('--checkpoint');
const CHECKPOINT = cpIdx >= 0 ? args[cpIdx + 1] : 'scripts/output/backfill-content-type.checkpoint.json';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

/** The reading rule of isArtworkRecord(), inverted, plus "has pages". */
const UNTYPED_TEXT_FILTER = Object.freeze({
  content_type: null, // matches missing too, which is the point here
  resource_type: null,
  pages_count: { $gt: 0 },
});

async function main() {
  const client = await MongoClient.connect(MONGODB_URI, { socketTimeoutMS: 120000, serverSelectionTimeoutMS: 30000 });
  const db = client.db('bookstore');
  const books = db.collection('books');
  const filter = LIVE_ONLY ? { ...UNTYPED_TEXT_FILTER, visible: true } : { ...UNTYPED_TEXT_FILTER };

  const before = {
    live: await books.countDocuments({ ...UNTYPED_TEXT_FILTER, visible: true }),
    all: await books.countDocuments(UNTYPED_TEXT_FILTER),
  };
  console.log(`Before: ${before.live} live / ${before.all} all paged records with no content_type and no resource_type`);

  if (!APPLY) {
    console.log('Dry run. Pass --apply to write content_type: "book".');
    await client.close();
    return;
  }

  let cp;
  if (existsSync(CHECKPOINT)) {
    cp = EJSON.parse(readFileSync(CHECKPOINT, 'utf8'));
    console.log(`Resuming checkpoint ${CHECKPOINT}: ${cp.done}/${cp.ids.length} done`);
  } else {
    const ids = (await books.find(filter, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
    cp = { sweep: SWEEP, live_only: LIVE_ONLY, collected_at: new Date(), ids, done: 0, written: 0 };
    mkdirSync(dirname(CHECKPOINT), { recursive: true });
    writeFileSync(CHECKPOINT, EJSON.stringify(cp));
    console.log(`Collected ${ids.length} ids → ${CHECKPOINT}`);
  }

  while (cp.done < cp.ids.length) {
    const batchIds = cp.ids.slice(cp.done, cp.done + BATCH);
    // Only the ids that still match get a row and a write.
    const still = await books
      .find({ _id: { $in: batchIds }, ...filter }, { projection: { _id: 1, id: 1, visible: 1, pages_count: 1 } })
      .toArray();
    if (still.length > 0) {
      await recordSweepActions(db, still.map((d) => ({
        sweep: SWEEP,
        book_id: String(d.id ?? d._id),
        action: 'set-content-type-book',
        detail: { from: null, visible: d.visible === true, pages_count: d.pages_count },
      })));
      const res = await books.updateMany(
        { _id: { $in: still.map((d) => d._id) }, ...filter },
        { $set: { content_type: 'book' } },
      );
      cp.written += res.modifiedCount;
    }
    // Stage assertion: nothing in this batch may still read as untyped.
    const left = await books.countDocuments({ _id: { $in: batchIds }, ...filter });
    if (left !== 0) throw new Error(`batch at ${cp.done}: ${left} records still untyped after the write`);
    cp.done += batchIds.length;
    writeFileSync(CHECKPOINT, EJSON.stringify(cp));
    console.log(`  ${cp.done}/${cp.ids.length}  written ${cp.written}`);
  }

  const after = {
    live: await books.countDocuments({ ...UNTYPED_TEXT_FILTER, visible: true }),
    all: await books.countDocuments(UNTYPED_TEXT_FILTER),
  };
  console.log(`After:  ${after.live} live / ${after.all} all (wrote ${cp.written})`);
  await client.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
