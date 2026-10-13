#!/usr/bin/env node
/**
 * adopt-enrich-batch.mjs — record an enrich Batch job that exists at Gemini but that the lane
 * cannot collect, WITHOUT touching any book the job does not contain (#6145).
 *
 * PRIOR ART: scripts/workers/lib/enrich-batch-lane.mjs is the lane: it submits, collects and
 * advances, and since #6371 writes the job row BEFORE the job exists, so a killed submit leaves a
 * row at `submitting` and its books parked at `<stage>_pending`. Nothing in the repo moves that row
 * on. The first adoption (2026-10-10, `enrich-index-muy4a57p-qf1e`, 108 Tengyur volumes) was a
 * script kept on the main box (`/root/tengyur-enrich-6145/adopt-orphan.mjs`), outside the repo. It
 * recorded the job and DELETED the state rows of the 67 admitted books the job did not hold, "so
 * the lane could re-admit them". scripts/lib/gemini-batch-ledger.mjs finds such jobs and reports
 * them; it adopts nothing.
 *
 * WHY A PARKED ROW IS NOT GARBAGE. A state row at `<stage>_pending` is what keeps the hourly lane
 * from admitting that book again. Deleting one is a submission: the lane re-admitted those 67
 * within the hour and ran their index round, $2.94 nobody had decided, under the global dial and
 * no envelope. A parked row is released by a person who has decided to pay for the book, never as
 * a side effect of adopting a different job.
 *
 * So this script has no delete, and a book outside the job is never written. tests/unit/
 * adopt-enrich-batch.test.ts holds both.
 *
 * WHAT READS WHAT IT WRITES: the lane's collect step reads `enrich_batch_jobs` rows at status
 * `submitted` on its next run (every 15 minutes) and applies the results; `advance` then submits
 * the next round for the collected books, which is new spend behind the dial. Adopt only a job
 * whose next round has been decided.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/adopt-enrich-batch.mjs \
 *     --job <enrich-…id> --gemini-name batches/<name> [--stage index --books-file ids.json] [--apply]
 *   --job           the job id (the Gemini display name). Its row, if one exists, gives stage and books.
 *   --gemini-name   the Gemini resource name. Required unless the row already carries one.
 *   --stage, --books-file   only when no row exists (a job from before #6371): the stage and a
 *                   JSON array of the book ids whose requests the job holds.
 *   Dry run unless --apply.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { BOOKS_COLL, JOBS_COLL } from '../workers/lib/enrich-batch-lane.mjs';

const ADOPTABLE_JOB_STATUS = new Set(['submitting', 'submit_failed']);

/**
 * What adopting one job writes. Pure.
 *
 * @param {{ jobId: string, geminiName: string|null, stage?: string|null, bookIds?: string[]|null,
 *           jobRow: object|null, stateRows: object[], now?: Date }} input
 *   stateRows: every row of enrich_batch_books the caller wants accounted for (the job's books,
 *   and any other parked row it wants listed).
 * @returns {{ refuse: string|null, job: {filter: object, update: object, upsert: boolean}|null,
 *            states: {filter: object, update: object}[], adopted: string[],
 *            notParked: {book_id: string, stage: string|null}[], leftParked: string[] }}
 */
export function planAdoption({ jobId, geminiName, stage = null, bookIds = null, jobRow, stateRows, now = new Date() }) {
  const out = { refuse: null, job: null, states: [], adopted: [], notParked: [], leftParked: [] };
  const refuse = (why) => ({ ...out, refuse: why });
  if (!jobId) return refuse('no job id');
  if (jobRow && !ADOPTABLE_JOB_STATUS.has(jobRow.status)) return refuse(`job row is at status '${jobRow.status}': only 'submitting' or 'submit_failed' is adopted`);
  const theStage = jobRow?.stage || stage;
  const ids = jobRow?.book_ids || bookIds;
  const name = geminiName || jobRow?.gemini_name || null;
  if (!theStage) return refuse('no stage: the job has no row, so pass --stage');
  if (!Array.isArray(ids) || !ids.length) return refuse('no book ids: the job has no row, so pass --books-file');
  if (!name) return refuse('no Gemini resource name: pass --gemini-name');

  const inJob = new Set(ids);
  const byId = new Map(stateRows.map((r) => [r._id, r]));
  const set = { gemini_name: name, status: 'submitted', submitted_at: now, adopted_at: now, adopted_by: 'adopt-enrich-batch.mjs' };
  out.job = jobRow
    ? { filter: { _id: jobId, status: jobRow.status }, update: { $set: set }, upsert: false }
    : { filter: { _id: jobId }, update: { $setOnInsert: { _id: jobId, stage: theStage, book_ids: ids, created_at: now }, $set: set }, upsert: true };

  for (const id of ids) {
    const row = byId.get(id);
    // Only a row parked for THIS round moves. A book that has gone on (collected, failed, dropped)
    // or has no row is reported and left as it is: the lane's collect skips it.
    if (row?.stage !== `${theStage}_pending`) { out.notParked.push({ book_id: id, stage: row?.stage ?? null }); continue; }
    out.states.push({
      filter: { _id: id, stage: `${theStage}_pending` },
      update: { $set: { stage: `${theStage}_submitted`, [`${theStage}_job`]: jobId, updated_at: now } },
    });
    out.adopted.push(id);
  }
  // Parked rows of books the job does not hold: listed, never written, never deleted.
  out.leftParked = stateRows.filter((r) => !inJob.has(r._id) && /_pending$/.test(r.stage || '')).map((r) => r._id);
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
  const APPLY = args.includes('--apply');
  const jobId = arg('job');
  if (!jobId) { console.error('usage: adopt-enrich-batch.mjs --job <id> --gemini-name batches/<name> [--stage S --books-file F] [--apply]'); process.exit(2); }
  const bookIds = arg('books-file') ? JSON.parse(fs.readFileSync(arg('books-file'), 'utf8')) : null;

  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const db = client.db('bookstore');
  try {
    const jobRow = await db.collection(JOBS_COLL).findOne({ _id: jobId });
    const ids = jobRow?.book_ids || bookIds || [];
    const stage = jobRow?.stage || arg('stage');
    const stateRows = await db.collection(BOOKS_COLL).find(
      { $or: [{ _id: { $in: ids } }, ...(stage ? [{ stage: `${stage}_pending` }] : [])] },
      { projection: { _id: 1, stage: 1, run_tag: 1 } },
    ).toArray();
    const plan = planAdoption({ jobId, geminiName: arg('gemini-name'), stage, bookIds, jobRow, stateRows });
    if (plan.refuse) { console.error(`[REFUSE] ${plan.refuse}`); process.exit(2); }

    console.log(`job ${jobId}: ${jobRow ? `row at '${jobRow.status}'` : 'no row (will be written)'} → 'submitted' as ${plan.job.update.$set.gemini_name}`);
    console.log(`books in the job: ${ids.length}; parked for this round and adopted: ${plan.adopted.length}; not parked, left as they are: ${plan.notParked.length}`);
    for (const n of plan.notParked.slice(0, 20)) console.log(`  not parked: ${n.book_id} (${n.stage ?? 'no state row'})`);
    console.log(`parked rows of books NOT in this job: ${plan.leftParked.length}. Left parked. The lane will not admit them until someone releases them.`);
    if (!APPLY) { console.log('DRY RUN: nothing was written.'); return; }

    const j = await db.collection(JOBS_COLL).updateOne(plan.job.filter, plan.job.update, { upsert: plan.job.upsert });
    if (!j.modifiedCount && !j.upsertedCount) { console.error('[REFUSE] the job row changed underneath; nothing else was written'); process.exit(2); }
    let moved = 0;
    for (const s of plan.states) moved += (await db.collection(BOOKS_COLL).updateOne(s.filter, s.update)).modifiedCount;
    console.log(`written: job row ${j.upsertedCount ? 'inserted' : 'updated'}; ${moved} of ${plan.states.length} state rows moved to '${stage}_submitted'.`);
    console.log('The lane collects this job on its next run and then submits the next round for its books (new spend, behind the dial).');
  } finally { await client.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
