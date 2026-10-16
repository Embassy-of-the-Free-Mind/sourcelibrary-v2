#!/usr/bin/env node
/**
 * Write one-line reasons for model-estimated work dates (#6721, Derek 2026-10-15) to `books`:
 * `source_work_dates_meta.work.why` (+ `why_model`, `why_prompt_version`; `why_year` where the reasons pass would date the
 * work more than 50 years away, which also adds `why_disagrees` to `source_work_dates_meta.checks`). The date itself is
 * NEVER changed. No new top-level field.
 *
 * Inputs: <works.jsonl> (export-why.mjs: each work's member books and the stored date the reason was written against)
 * and <why.jsonl> (date-books.mjs --lean why). A member is written only if, LIVE, its work date is still that stored
 * date with basis model_knowledge and no human has dated it: another job may have re-dated it since the export (the
 * author-lifespan upgrade on #6721), and a reason written against the old date would be wrong. The same test is in the
 * update's filter, so a change between the read and the write is not clobbered either.
 *
 * Every write is logged first: recordSweepActions(sweep 'library-dating-why', action 'why', detail.previous_why).
 * Batches of 500; resumable (a book whose stored reason is already this one is skipped). `--dry-run` writes nothing.
 *
 * PRIOR ART: write-dates.mjs in this directory writes whole date rows from a plan (it would re-derive and rewrite the
 * dates); this writes one nested field under the same rules (sweep_log first, edited_by re-read live, batches of 500).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/library-dating/write-why.mjs \
 *     <works.jsonl> <why.jsonl> [--dry-run] [--max-batches N]
 */
import fs from 'node:fs';
import { MongoClient, ObjectId } from 'mongodb';
import { recordSweepActions } from '../../lib/sweep-log.mjs';
import { WHY_PROMPT_VERSION } from '../../lib/date-works.mjs';

const [WORKS, WHY] = process.argv.slice(2, 4);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (!WORKS || !WHY) { console.error('usage: write-why.mjs <works.jsonl> <why.jsonl> [--dry-run] [--max-batches N]'); process.exit(2); }
const DRY = process.argv.includes('--dry-run'); const MAX_BATCHES = +arg('--max-batches', 0); const BATCH = 500;

const readRows = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const why = new Map(readRows(WHY).map((r) => [r.book_id, r]));
const todo = [];
for (const w of readRows(WORKS)) {
  const r = why.get(w.book_id);
  if (!r) continue;
  for (const id of w.members) todo.push({ book_id: id, work: w.work, why: r.why, year: r.year ?? null, model: r.model, prompt_version: r.prompt_version || WHY_PROMPT_VERSION });
}
console.log(`${todo.length} books with a reason ready (${why.size} works)${DRY ? ' — DRY RUN' : ''}`);

const idOr = (id) => (/^[0-9a-f]{24}$/i.test(id) ? [{ id }, { _id: new ObjectId(id) }, { _id: id }] : [{ id }, { _id: id }]);
const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const stats = { written: 0, already: 0, redated: 0, human: 0, missing: 0, why_disagrees: 0 };
for (let i = 0, nb = 0; i < todo.length && (!MAX_BATCHES || nb < MAX_BATCHES); i += BATCH, nb++) {
  const batch = todo.slice(i, i + BATCH);
  const live = await db.collection('books').find({ $or: batch.flatMap((t) => idOr(t.book_id)) }, { projection: { id: 1, source_work_dates_meta: 1 } }).toArray();
  const byId = new Map(); for (const d of live) { byId.set(String(d._id), d); if (d.id) byId.set(String(d.id), d); }
  const go = [];
  for (const t of batch) {
    const d = byId.get(t.book_id); const m = d?.source_work_dates_meta; const w = m?.work;
    if (!d) { stats.missing++; continue; }
    if (m?.edited_by) { stats.human++; continue; }
    if (w?.basis !== 'model_knowledge' || w.year !== t.work.year || w.from !== t.work.from || w.to !== t.work.to) { stats.redated++; continue; }
    if (w.why === t.why && w.why_prompt_version === t.prompt_version) { stats.already++; continue; }
    go.push({ t, d });
  }
  stats.why_disagrees += go.filter(({ t }) => t.year != null).length;
  if (DRY) { stats.written += go.length; if (nb === 0) console.log(JSON.stringify(go.slice(0, 3).map(({ t, d }) => ({ book_id: t.book_id, work: d.source_work_dates_meta.work, why: t.why, why_year: t.year })), null, 1)); continue; }
  if (!go.length) continue;
  // log BEFORE the write; a crash between the two leaves a logged, unwritten book that the next run writes
  await recordSweepActions(db, go.map(({ t, d }) => ({ sweep: 'library-dating-why', book_id: t.book_id, action: 'why',
    detail: { prompt_version: t.prompt_version, why_year: t.year, previous_why: d.source_work_dates_meta.work.why ?? null } })));
  const res = await db.collection('books').bulkWrite(go.map(({ t, d }) => ({ updateOne: {
    filter: { _id: d._id, 'source_work_dates_meta.edited_by': { $exists: false }, 'source_work_dates_meta.work.basis': 'model_knowledge',
      'source_work_dates_meta.work.year': t.work.year, 'source_work_dates_meta.work.from': t.work.from, 'source_work_dates_meta.work.to': t.work.to },
    update: {
      $set: { 'source_work_dates_meta.work.why': t.why, 'source_work_dates_meta.work.why_model': t.model, 'source_work_dates_meta.work.why_prompt_version': t.prompt_version,
        ...(t.year != null ? { 'source_work_dates_meta.work.why_year': t.year } : {}) },
      ...(t.year != null ? { $addToSet: { 'source_work_dates_meta.checks': 'why_disagrees' } } : { $unset: { 'source_work_dates_meta.work.why_year': '' }, $pull: { 'source_work_dates_meta.checks': 'why_disagrees' } }),
    } } })), { ordered: false });
  stats.written += res.modifiedCount;
  if (nb % 10 === 0) console.log(`  batch ${nb + 1}: ${res.modifiedCount}/${go.length} written; totals ${JSON.stringify(stats)}`);
}
await client.close();
console.log(`done ${JSON.stringify(stats)}`);
