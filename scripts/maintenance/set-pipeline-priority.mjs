#!/usr/bin/env node
// PRIOR ART: none that writes the field. scripts/workers/pipeline-orchestrator.mjs reads `pipeline_priority >= 1` as a
// manual boost in every paid phase's sort; scripts/maintenance/delete-orphan-book-fields.mjs retires the old
// `pipeline_priority_at` / `pipeline_priority_reason` siblings, so the reason lives in sweep_log, not on the book.
// Looked in scripts/maintenance/, scripts/batch/, src/app/api/ (git grep pipeline_priority).
/**
 * Move a named set of books to the front of the pipeline queue — or take them off it.
 *
 * WHO RUNS IT: a session that has been asked to get specific books processed first (a wave, a partner shelf).
 * It spends nothing: the boost only REORDERS work inside the existing daily dial (set-dial.mjs). Every paid phase
 * still asks the spend guard, so a boosted book waits like any other when the day's budget is spent.
 *
 *   node --env-file=.env.production.local scripts/maintenance/set-pipeline-priority.mjs \
 *     --ids-file=F --reason="Spanish wave #6559" [--clear] [--commit]
 *
 * F holds book ids (the `id` string), one per line or whitespace-separated. Dry run unless --commit.
 * Books that are held (`pipeline_auto.status: 'held'`) are reported and skipped: a hold is a decision, and
 * a boost must not read as one being overridden. One sweep_log row per changed book carries the reason.
 */
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const FILE = arg('ids-file');
const REASON = arg('reason');
const CLEAR = process.argv.includes('--clear');
const COMMIT = process.argv.includes('--commit');
if (!FILE || !REASON) {
  console.error('usage: set-pipeline-priority.mjs --ids-file=F --reason="..." [--clear] [--commit]');
  process.exit(2);
}

const ids = [...new Set(readFileSync(FILE, 'utf8').split(/\s+/).filter(Boolean))];
const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await client.connect();
const db = client.db('bookstore');

const books = await db.collection('books')
  .find({ id: { $in: ids } }, { projection: { id: 1, title: 1, pages_count: 1, pipeline_priority: 1, 'pipeline_auto.status': 1 } })
  .toArray();
const found = new Set(books.map((b) => b.id));
const missing = ids.filter((id) => !found.has(id));

const held = books.filter((b) => b.pipeline_auto?.status === 'held');
const target = books.filter((b) => b.pipeline_auto?.status !== 'held'
  && (CLEAR ? (b.pipeline_priority ?? 0) >= 1 : (b.pipeline_priority ?? 0) < 1));
const pages = target.reduce((s, b) => s + (b.pages_count || 0), 0);

console.log(`${COMMIT ? 'COMMIT' : 'DRY-RUN'} ${CLEAR ? 'clear' : 'boost'}: ${target.length} books, ${pages} pages`
  + ` (asked ${ids.length}; missing ${missing.length}; held ${held.length}; already ${books.length - held.length - target.length})`);
for (const b of held) console.log(`  HELD, skipped: ${b.id} ${String(b.title).slice(0, 60)}`);
for (const id of missing) console.log(`  NOT FOUND: ${id}`);

if (COMMIT && target.length) {
  const update = CLEAR ? { $unset: { pipeline_priority: '' } } : { $set: { pipeline_priority: 1 } };
  const res = await db.collection('books').updateMany({ id: { $in: target.map((b) => b.id) } }, update);
  const logged = await recordSweepActions(db, target.map((b) => ({
    sweep: 'set-pipeline-priority',
    book_id: b.id,
    action: CLEAR ? 'priority_cleared' : 'priority_boosted',
    detail: { reason: REASON, pages: b.pages_count || 0, status: b.pipeline_auto?.status || null },
  })));
  console.log(`modified ${res.modifiedCount}, sweep_log rows ${logged}`);
}
await client.close();
