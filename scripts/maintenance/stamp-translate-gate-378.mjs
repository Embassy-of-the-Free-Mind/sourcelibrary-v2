#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/reread-loop-pages.mjs — re-reads looped OCR (the repair this lists as an item), it does
// not record a refusal. scripts/lib/pre-translation-gate.mjs — stamps its own rules at translate time, not a backfill.
// scripts/batch/cli-translate-lane.mjs finish — stamps the same refusals going forward (translate-gate-stamp.mjs), but
// only on pages it reaches, and a page already in its ledger is never reached again; this backfills those once.
/**
 * stamp-translate-gate-378 — record the translator's pre-flight refusals on the finish books' owed pages, once (#378).
 *
 *   node --env-file=.env.production.local scripts/maintenance/stamp-translate-gate-378.mjs [--book=ID[,ID]] [--out=FILE.jsonl] [--apply]
 *   node --env-file=.env.production.local scripts/maintenance/stamp-translate-gate-378.mjs --undo=RUN_ID [--apply]
 *
 * FRAME: the books `cli-translate-lane.mjs finish` serves first (FINISH_BOOKS, >= 80% translated, an agy row), or --book.
 * PAGES: visible, no English, OCR present, no health_blocked reason yet; judged by translate-core isTranslatablePage with
 * the production settings. A page it turns away for no-body / blank-ocr (nothing owed) or ocr-loop / ocr-unreadable /
 * illegible-source (a repair item) is stamped (translate-gate-stamp.mjs; the rule is page-counts.mjs isHealthBlocked),
 * and each touched book is recounted (recountBook), so a book whose only owed pages were these crosses to `complete`.
 *
 * ACTUATION: the recount restamps `translation_state`; a book that crosses shows "Complete" on its page and in the
 * collection grids, and is counted in the homepage / progress stats at their next read. Nothing else reads it.
 * RECORDED: one sweep_log row per touched book (sweep `translate-gate-378`, the run id, the pages and reasons); the
 * repair items, one JSON line each, to --out. REVERSIBLE: --undo=RUN_ID unsets that run's stamps and recounts.
 * Without --apply nothing is written; the counts are what it would do.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { VISIBLE_PAGE_MATCH, recountBook } from '../lib/page-counts.mjs';
import { translateLaneForBook } from '../lib/translate-core.mjs';
import { stampGateRefusals, GATE_PROJECTION, GATE_UNSET, TRANSLATE_GATE_BLOCK } from '../lib/translate-gate-stamp.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';
import { FINISH_BOOKS, FINISH_ENGINE } from '../batch/cli-translate-lane.mjs';
import { isFinishBook, finishedTally } from '../batch/cli-ocr-lane.mjs';

const SWEEP = 'translate-gate-378';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const db = client.db('bookstore');
const rungOf = async (id) => (await db.collection('books').findOne({ id }, { projection: { _id: 0, 'translation_state.rung': 1 } }))?.translation_state?.rung ?? null;

if (arg('undo')) {
  const RUN = arg('undo');
  const q = { 'translation.health_blocked': TRANSLATE_GATE_BLOCK, 'translation.refusal.run': RUN };
  const rows = await db.collection('sweep_log').find({ sweep: SWEEP, 'detail.run': RUN }, { projection: { book_id: 1 } }).toArray();
  const ids = [...new Set(rows.map((r) => r.book_id))];
  const n = ids.length ? await db.collection('pages').countDocuments({ book_id: { $in: ids }, ...q }) : 0;
  console.log(`undo ${RUN}: ${n} stamp(s) in ${ids.length} book(s)${APPLY ? '' : ', DRY RUN'}`);
  if (APPLY && n) {
    await db.collection('pages').updateMany({ book_id: { $in: ids }, ...q }, { $unset: GATE_UNSET, $set: { updated_at: new Date() } });
    for (const id of ids) await recountBook(db, id, { reason: `${SWEEP} undo ${RUN}` });
    await recordSweepActions(db, ids.map((book_id) => ({ sweep: SWEEP, book_id, action: 'undo-translate-gate-stamps', detail: { run: RUN } })));
  }
  await client.close();
  process.exit(0);
}

const RUN = `${SWEEP}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
const ONLY = arg('book') ? new Set(arg('book').split(',')) : null;
const OUT = arg('out') ?? null;
const books = (await db.collection('books').find(ONLY ? { id: { $in: [...ONLY] } } : FINISH_BOOKS,
  { projection: { id: 1, title: 1, publisher: 1, language: 1, image_source: 1, translation_state: 1 } }).toArray())
  .filter((b) => ONLY || (isFinishBook(b) && (() => { const l = translateLaneForBook(b); return l.channel === 'cli' && l.engine === FINISH_ENGINE; })()));
console.log(`${SWEEP}: run ${RUN}; ${books.length} book(s)${APPLY ? '' : ', DRY RUN'}`);

const before = new Map(), after = new Map(), byReason = {}, sweepRows = [];
let stampedTotal = 0;
const out = OUT ? fs.openSync(OUT, 'a') : null;
const B = 50;
for (let i = 0; i < books.length; i += B) {
  const ids = books.slice(i, i + B).map((b) => b.id);
  const pages = await db.collection('pages').find({
    book_id: { $in: ids }, ...VISIBLE_PAGE_MATCH, 'ocr.data': { $type: 'string', $ne: '' }, 'translation.health_blocked': { $exists: false },
    $or: [{ 'translation.data': { $exists: false } }, { 'translation.data': { $in: [null, ''] } }],
  }, { projection: GATE_PROJECTION }).toArray();
  const g = await stampGateRefusals(db, pages, { apply: APPLY, lane: SWEEP, run: RUN });
  const perBook = new Map();
  for (const x of g.stamped) {
    byReason[x.reason] = (byReason[x.reason] || 0) + 1;
    if (!perBook.has(x.book_id)) perBook.set(x.book_id, []);
    perBook.get(x.book_id).push(x);
    if (out && x.kind === 'repair') fs.writeSync(out, JSON.stringify({ ...x, run: RUN }) + '\n');
  }
  stampedTotal += g.stamped.length;
  for (const [id, xs] of perBook) {
    before.set(id, await rungOf(id));
    if (APPLY) {
      const r = await recountBook(db, id, { reason: `${SWEEP} ${RUN}` });
      after.set(id, r.rung ?? null);
    } else after.set(id, before.get(id));
    sweepRows.push({ sweep: SWEEP, book_id: id, action: 'translate-gate-stamps', detail: { run: RUN, pages: xs.map((x) => ({ id: x.id, n: x.page_number, reason: x.reason })), rung_before: before.get(id), rung_after: after.get(id) } });
  }
  if (APPLY && sweepRows.length >= 500) { await recordSweepActions(db, sweepRows.splice(0)); }
  if ((i / B) % 20 === 0) console.log(`  ${Math.min(i + B, books.length)}/${books.length} books read; ${stampedTotal} page(s) stamped so far`);
}
if (APPLY && sweepRows.length) await recordSweepActions(db, sweepRows);
if (out) fs.closeSync(out);
const t = finishedTally(before, after);
console.log(`\n${SWEEP} ${RUN}: ${stampedTotal} page(s) ${APPLY ? 'stamped' : 'would be stamped'} in ${before.size} book(s): ${JSON.stringify(byReason)}`);
console.log(`books finished this run (${SWEEP}): ${t.finished} (readable ${t.readable}, complete ${t.complete}) of ${t.touched} book(s) touched${APPLY ? '' : ' (DRY RUN: no recount, so 0)'}`);
await client.close();
