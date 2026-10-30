#!/usr/bin/env node
/**
 * Bring the pages a backfill run already wrote up to the current parser (#5942 legacy syntaxes): the paused full run
 * wrote ~9,000 pages under annotation-layer/2, which left [[vocabulary:]], [[image:]], bracketed image paragraphs and
 * the other legacy syntaxes in `translation.text` as book words. $0, no model call. Dry run unless --apply.
 *
 * PRIOR ART: backfill.mjs (this folder) `processBatch` is the writer for a page with no current text. This script
 * differs only in what it does with a page whose /3 split is the SAME as the one stored: it does not insert a second,
 * identical page_annotations doc for the same text (keep-the-reads keeps each READ, and nothing new was read); it
 * re-stamps text_from.parser_version so the resumed backfill skips the page. undo.mjs reads the revision rows of both.
 *
 * For each page in the given runs' page_revisions rows (field 'translation.text', not aborted, not undone):
 *   current parser already        → skipped;
 *   text_from not current for data → skipped (a writer moved the page on; the resumed backfill re-parses it);
 *   /3 text or annotations differ  → REWRITE: revision row, text + text_from replaced (compare-and-set on the data
 *                                    and the stored text_from), a NEW page_annotations doc under this run id;
 *   /3 split identical             → RESTAMP: revision row, text_from.parser_version set to the current one (same CAS).
 * The stored annotations compared against are the page's newest doc for its data_hash.
 *
 * USAGE
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/notes-layer-backfill-5942/rewrite-stale.mjs \
 *     --runs notes-layer-backfill-5942-full-20261029,notes-layer-backfill-5942-pilot-2 [--apply] [--recheck] [--run-id <id>] [--out $JOB_SCRATCH/rewrite.jsonl]
 * Undo: undo.mjs --run-id <this run id> --apply (then, if wanted, undo of the original run).
 */
import { MongoClient } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { translationLayers, translationTextIsCurrent, annotationsDoc, annotationsInsertOp, ANNOTATIONS_COLLECTION, PARSER_VERSION } from '../../lib/translation-text.mjs';
import { SOURCE } from './backfill.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const RUNS = String(arg('--runs', '')).split(',').filter(Boolean);
const RUN_ID = arg('--run-id', `notes-legacy-5942-rewrite-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`);
const OUT = arg('--out', null);
// --recheck: also re-parse pages already stamped with the current version, and rewrite any whose split differs (a
// parser change made before its version was released; use a NEW --run-id, since the annotations key includes it).
const RECHECK = args.includes('--recheck');
const BATCH = 100;

const stable = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

function interlockClear() {
  const script = fileURLToPath(new URL('../../audit/entities-sweep-active.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', env: process.env, timeout: 120000 });
  return r.status === 0 && /Quiet/.test(r.stdout || '');
}

/** One page: what to do, and (with apply) do it. Exported for the test. */
export async function rewritePage(db, page, { apply = APPLY, runId = RUN_ID, recheck = RECHECK } = {}) {
  const t = page.translation;
  if (!t || typeof t.data !== 'string' || !t.data || typeof t.text !== 'string') return 'no_text';
  if (t.text_from?.parser_version === PARSER_VERSION && !recheck) return 'current';
  if (!translationTextIsCurrent(t)) return 'moved_on';
  const layers = translationLayers(t.data, { promptVersion: t.prompt_version, ocr: page.ocr?.data ?? null });
  const doc = await db.collection(ANNOTATIONS_COLLECTION).find({ page_id: page.id, data_hash: layers.data_hash }).sort({ created_at: -1 }).limit(1).next();
  const same = layers.text === t.text && stable(layers.annotations) === stable(doc?.annotations ?? []);
  if (same && t.text_from?.parser_version === PARSER_VERSION) return 'current';
  const action = same ? 'restamp' : 'rewrite';
  if (!apply) return action;
  const revId = randomBytes(6).toString('hex');
  await db.collection('page_revisions').insertOne({
    id: revId, page_id: page.id, book_id: page.book_id, field: 'translation.text', source: SOURCE, reason: `notes-legacy-5942-${action}`,
    run_id: runId, data: t.text, prev_text_from: t.text_from, data_hash: layers.data_hash, parser_version: PARSER_VERSION,
    annotations_source: layers.source, created_at: new Date(),
  });
  const filter = { id: page.id, 'translation.data': { $eq: t.data }, 'translation.text_from.parser_version': t.text_from?.parser_version, 'translation.text_from.data_hash': t.text_from?.data_hash };
  const update = same
    ? { $set: { 'translation.text_from.parser_version': PARSER_VERSION } }
    : { $set: { 'translation.text': layers.text, 'translation.text_from': layers.text_from } };
  const r = await db.collection('pages').updateOne(filter, update);
  if (!r.matchedCount) {
    await db.collection('page_revisions').updateOne({ id: revId }, { $set: { aborted: 'conflict', aborted_at: new Date() } });
    return 'conflict';
  }
  if (!same) {
    const d = annotationsDoc({ page_id: page.id, book_id: page.book_id, layers, run_id: runId });
    if (d) await db.collection(ANNOTATIONS_COLLECTION).bulkWrite([annotationsInsertOp(d)]);
  }
  return action;
}

async function main() {
  if (!RUNS.length) { console.error('--runs <run id>[,<run id>…] is required'); process.exit(2); }
  const client = new MongoClient(process.env.MONGODB_URI, { appName: 'notes-legacy-5942-rewrite', maxPoolSize: 4 });
  await client.connect();
  const db = client.db('bookstore');
  if (APPLY && !interlockClear()) { console.error('entities interlock not clear — stopping.'); process.exit(3); }
  const ids = [...new Set((await db.collection('page_revisions').find({ run_id: { $in: RUNS }, source: SOURCE, field: 'translation.text', aborted: { $exists: false }, undone_at: { $exists: false } }).project({ _id: 0, page_id: 1 }).toArray()).map((r) => r.page_id))];
  console.log(`[rewrite-stale] ${RUN_ID} · ${APPLY ? 'APPLY' : 'dry run'} · ${ids.length} pages from ${RUNS.join(', ')} · parser ${PARSER_VERSION}`);
  const out = OUT ? createWriteStream(OUT) : null;
  const totals = {};
  for (let i = 0; i < ids.length; i += BATCH) {
    const pages = await db.collection('pages').find({ id: { $in: ids.slice(i, i + BATCH) } }).project({ _id: 0, id: 1, book_id: 1, 'translation.data': 1, 'translation.text': 1, 'translation.text_from': 1, 'translation.prompt_version': 1, 'ocr.data': 1 }).toArray();
    for (const p of pages) {
      const a = await rewritePage(db, p);
      totals[a] = (totals[a] || 0) + 1;
      out?.write(JSON.stringify({ page_id: p.id, action: a }) + '\n');
    }
    if (APPLY) await new Promise((r) => setTimeout(r, 200));
  }
  out?.end();
  console.log(JSON.stringify({ run_id: RUN_ID, apply: APPLY, ...totals }, null, 1));
  await client.close();
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
