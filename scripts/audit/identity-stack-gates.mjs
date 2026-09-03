#!/usr/bin/env node
/**
 * identity-stack-gates — one command that prints the August plan's Done table.
 *
 * #3730's gates, measured live, with dates. Issue bodies drift (the repo has
 * been burned by this repeatedly — #3102's "4,916 to backfill" was already
 * done, #2567's checklist was 3-for-5 stale); this script is the version of
 * the table that cannot drift, because it re-derives every number on demand.
 * Any future session verifies the month with this instead of trusting prose.
 *
 * Read-only. No flags but --json.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/identity-stack-gates.mjs [--json]
 */
import { MongoClient } from 'mongodb';

const JSON_OUT = process.argv.includes('--json');

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const client = new MongoClient(uri, { maxPoolSize: 2 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');

const nonArtwork = { content_type: { $ne: 'artwork' } };
const live = { visible: true, pages_count: { $gt: 0 }, ...nonArtwork };

// ── Gate 1: Phase 0 health — identity fields exist and keep existing ────────
const missingFields = await books.countDocuments({
  ...nonArtwork,
  $or: [{ edition_key: { $exists: false } }, { normalized_title: { $exists: false } }],
});
const lastWorkerRun = await db.collection('cron_runs')
  .find({ cron: 'identity-worker' }).sort({ timestamp: -1 }).limit(1).next();
const workerAgeH = lastWorkerRun ? ((Date.now() - new Date(lastWorkerRun.timestamp).getTime()) / 3600e3).toFixed(1) : null;

// ── Gate 2: work_id conflicts (one edition, two works) ──────────────────────
const conflicts = await books.aggregate([
  { $match: { ...nonArtwork, edition_key: { $nin: [null, ''] }, work_id: { $nin: [null, ''] } } },
  { $group: { _id: '$edition_key', works: { $addToSet: '$work_id' }, quality: { $first: '$edition_key_quality' } } },
  { $match: { 'works.1': { $exists: true } } },
  { $group: { _id: null, total: { $sum: 1 }, full: { $sum: { $cond: [{ $eq: ['$quality', 'full'] }, 1, 0] } } } },
]).toArray();
const conflictTotal = conflicts[0]?.total ?? 0;
const conflictFull = conflicts[0]?.full ?? 0;

// ── Gate 3: collocation — who could see a sibling, who does ─────────────────
const multiLang = await books.aggregate([
  { $match: { ...live, work_id: { $nin: [null, ''] } } },
  { $group: { _id: '$work_id', langs: { $addToSet: '$language' }, n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 }, 'langs.1': { $exists: true } } },
  { $group: { _id: null, clusters: { $sum: 1 }, books: { $sum: '$n' } } },
]).toArray();
const editionSiblings = await books.aggregate([
  { $match: { ...live, edition_key: { $nin: [null, ''] }, edition_key_quality: 'full' } },
  { $group: { _id: '$edition_key', n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } },
  { $group: { _id: null, clusters: { $sum: 1 }, books: { $sum: '$n' } } },
]).toArray();

// ── Gate 4: the duplicate queues ─────────────────────────────────────────────
const darkPointers = await books.aggregate([
  { $match: { duplicate_of: { $nin: [null, ''] } } },
  { $lookup: { from: 'books', localField: 'duplicate_of', foreignField: 'id', as: 'keeper' } },
  { $unwind: { path: '$keeper', preserveNullAndEmptyArrays: true } },
  { $match: { $or: [{ keeper: null }, { 'keeper.visible': { $ne: true } }] } },
  { $count: 'n' },
]).toArray();
const bothVisible = await books.aggregate([
  { $match: { ...live, edition_key: { $nin: [null, ''] } } },
  { $group: { _id: '$edition_key', n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } },
  { $count: 'n' },
]).toArray();

// ── Gate 5: the REVIEW queues — is the human lane draining? (#4271) ─────────
// Detection finished weeks before the drain did; a queue that stops moving is
// the failure mode, and it is invisible unless the table counts it. Segment
// the merge queue by the LLM screen's verdict: `same`/`different` are the
// batchable slices, `unsure`/unstamped are the manual remainder.
const mergeQueue = await db.collection('work_merge_queue').aggregate([
  { $group: { _id: { status: '$status', verdict: { $ifNull: ['$llm.verdict', 'unscreened'] } }, n: { $sum: 1 } } },
]).toArray();
const mergePending = {};
let mergeAdjudicated = 0;
for (const r of mergeQueue) {
  if (r._id.status === 'pending') mergePending[r._id.verdict] = (mergePending[r._id.verdict] ?? 0) + r.n;
  else mergeAdjudicated += r.n;
}
const mergePendingTotal = Object.values(mergePending).reduce((a, b) => a + b, 0);

const keeperQueue = await db.collection('edition_keeper_queue').aggregate([
  { $group: { _id: { status: '$status', bucket: '$bucket', ft: { $eq: ['$ft_flag', true] } }, n: { $sum: 1 } } },
]).toArray();
const keeperPending = {};
let keeperAdjudicated = 0;
let keeperBatchable = 0; // MECHANICAL_KEEP with no FT badge at stake — the batch lane's slice
for (const r of keeperQueue) {
  if (r._id.status === 'pending') {
    keeperPending[r._id.bucket] = (keeperPending[r._id.bucket] ?? 0) + r.n;
    if (r._id.bucket === 'MECHANICAL_KEEP' && !r._id.ft) keeperBatchable += r.n;
  } else keeperAdjudicated += r.n;
}
const keeperPendingTotal = Object.values(keeperPending).reduce((a, b) => a + b, 0);

const gates = {
  measured_at: new Date().toISOString(),
  phase0: {
    books_missing_identity_fields: missingFields,
    target: 0,
    last_worker_run_hours_ago: workerAgeH,
    last_worker_stale_missing: lastWorkerRun?.actions?.stale_missing ?? null,
  },
  work_id_conflicts: { total: conflictTotal, full_quality: conflictFull, target: '<10' },
  collocation: {
    multilanguage_work_clusters: multiLang[0]?.clusters ?? 0,
    books_addressable: multiLang[0]?.books ?? 0,
    full_quality_edition_sibling_books: editionSiblings[0]?.books ?? 0,
    note: 'rail target: every addressable book shows its siblings',
  },
  queues: {
    dark_cluster_pointers: darkPointers[0]?.n ?? 0,
    both_visible_edition_clusters: bothVisible[0]?.n ?? 0,
  },
  review_queues: {
    work_merge_queue: {
      pending: mergePendingTotal,
      adjudicated: mergeAdjudicated,
      pending_by_verdict: mergePending,
      batchable: (mergePending.same ?? 0) + (mergePending.different ?? 0),
      manual_remainder: (mergePending.unsure ?? 0) + (mergePending.unscreened ?? 0),
    },
    edition_keeper_queue: {
      pending: keeperPendingTotal,
      adjudicated: keeperAdjudicated,
      pending_by_bucket: keeperPending,
      batchable_mechanical_non_ft: keeperBatchable,
    },
    note: 'batch lanes: /curation/identity-review (#4271). A pending count that stops falling means the drain stalled again.',
  },
};

if (JSON_OUT) {
  console.log(JSON.stringify(gates, null, 2));
} else {
  console.log(`identity stack gates — ${gates.measured_at}`);
  console.log(`  Phase 0:  ${missingFields} books missing identity fields (target 0)`);
  console.log(`            worker last ran ${workerAgeH ?? 'NEVER'}h ago, stale_missing=${gates.phase0.last_worker_stale_missing ?? '?'}`);
  console.log(`  Works:    ${conflictTotal} edition/work conflicts (${conflictFull} full-quality; target <10)`);
  console.log(`  Reader:   ${gates.collocation.books_addressable} live books in multi-language work clusters (${gates.collocation.multilanguage_work_clusters} clusters)`);
  console.log(`            ${gates.collocation.full_quality_edition_sibling_books} live books with a full-quality edition sibling`);
  console.log(`  Queues:   ${gates.queues.dark_cluster_pointers} dark pointers, ${gates.queues.both_visible_edition_clusters} both-visible edition clusters`);
  const rq = gates.review_queues;
  const byVerdict = Object.entries(rq.work_merge_queue.pending_by_verdict).map(([k, v]) => `${v} ${k}`).join(', ') || 'none';
  const byBucket = Object.entries(rq.edition_keeper_queue.pending_by_bucket).map(([k, v]) => `${v} ${k}`).join(', ') || 'none';
  console.log(`  Review:   work_merge_queue ${rq.work_merge_queue.pending} pending (${byVerdict}), ${rq.work_merge_queue.adjudicated} adjudicated`);
  console.log(`            → ${rq.work_merge_queue.batchable} batchable, ${rq.work_merge_queue.manual_remainder} need a human one at a time`);
  console.log(`            edition_keeper_queue ${rq.edition_keeper_queue.pending} pending (${byBucket}), ${rq.edition_keeper_queue.adjudicated} adjudicated`);
  console.log(`            → ${rq.edition_keeper_queue.batchable_mechanical_non_ft} batchable (MECHANICAL_KEEP, no FT badge at stake)`);
  console.log(`            drain: /curation/identity-review (batch lanes, #4271)`);
}

await client.close();
