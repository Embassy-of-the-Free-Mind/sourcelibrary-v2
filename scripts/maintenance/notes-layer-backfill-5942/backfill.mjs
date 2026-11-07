#!/usr/bin/env node
/**
 * Backfill the notes layer (#5942 roadmap step 2): for stored translations, write
 * `translation.text` + `translation.text_from` beside `translation.data`, and the page's
 * annotations to `page_annotations` (anchor_kind "inferred": the parser inferred each anchor).
 * $0: no model call. `translation.data` is never rewritten.
 *
 * PRIOR ART: scripts/lib/translation-text.mjs builds what is written (the writers store the same
 * thing on every new translation); scripts/lib/annotation-layer.mjs is the parser.
 * scripts/maintenance/clear-bare-surname-claims.mjs is where the interlock call is copied from.
 * No existing backfill writes these fields (none existed before this PR).
 *
 * WHAT IT TOUCHES, and nothing else:
 *   pages.translation.text, pages.translation.text_from      ($set; never updated_at, never
 *     translation.updated_at, never pipeline_auto, never data)
 *   page_annotations                                         (INSERT per page + source + run_id; an existing
 *     doc is never overwritten or deleted — a re-run adds its own, the reader picks by data_hash)
 *   page_revisions   one row per written page: field 'translation.text', source
 *     'notes-layer-backfill-5942', the previous text/text_from (null on a first write) — what
 *     undo.mjs reads. field is NOT 'translation', so revision history, edition-reader and the
 *     double-OCR corpus (which select field: 'translation' / 'ocr') do not see it.
 *
 * COMPARE-AND-SET: each page is updated with a filter on the exact `translation.data` it was
 * parsed from. A page whose data changed between read and write (the correction lane, #7499
 * benchmarks) matches nothing and is skipped; its revision row is marked aborted: 'conflict'.
 *
 * INTERLOCK: scripts/audit/entities-sweep-active.mjs before the first batch that will write, then
 * again once --check-every pages have been written to. A stretch of pages already done reads and
 * skips without asking (or throttling). Only exit 0 with its "Quiet" line counts as clear; anything
 * else waits (60 s) and gives up after 30 min, exiting 75 (EX_TEMPFAIL). Exit 0 means the scan ended.
 *
 * RESUME (--full): the scan walks pages in `id` order and, after every batch, writes a checkpoint
 * file with the last id it fully processed. --resume reads it back (a missing file starts at the
 * beginning); --resume-from <page id> starts after that id. The id-ordered walk re-queries in pages
 * (`id > last`), so a long interlock wait cannot lose a cursor.
 *
 * USAGE (dry run unless --apply):
 *   node --env-file=.env.production.local scripts/maintenance/notes-layer-backfill-5942/backfill.mjs \
 *     --pilot 1000 [--seed 5942] [--apply] [--out $JOB_SCRATCH/pilot.jsonl]
 *   --ids-file <file>      these page ids (whitespace-separated), e.g. to re-apply after an undo test
 *   --full                 every translated page (pass --go-5942: Derek's go on #5942)
 *   --resume               --full: start after the id in the checkpoint file
 *   --resume-from <id>     --full: start after this page id
 *   --checkpoint <file>    default $JOB_SCRATCH/<run-id>.checkpoint.json (none without JOB_SCRATCH)
 *   --batch 50 --throttle-ms 300 --check-every 500 --interlock-tries 30 --interlock-wait-ms 60000
 *   --run-id <id>          default notes-layer-backfill-5942-<UTC timestamp>
 * Undo: undo.mjs --run-id <id> [--apply]
 */
import { MongoClient, BSON } from 'mongodb';
import { spawnSync } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { splitAnnotations, renderInline, renderMarkup } from '../../lib/annotation-layer.mjs';
import { translationLayers, translationTextIsCurrent, annotationsDoc, annotationsInsertOp, parserAnnotation, ANNOTATIONS_COLLECTION, PARSER_VERSION } from '../../lib/translation-text.mjs';

export const SOURCE = 'notes-layer-backfill-5942';
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const PILOT = Number(arg('--pilot', 0));
const FULL = args.includes('--full');
const SEED = Number(arg('--seed', 5942));
const BATCH = Number(arg('--batch', 50));
const THROTTLE = Number(arg('--throttle-ms', 300));
const CHECK_EVERY = Number(arg('--check-every', 500));
const RUN_ID = arg('--run-id', `${SOURCE}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`);
const OUT = arg('--out', null);
const IDS_FILE = arg('--ids-file', null);
const INTERLOCK_TRIES = Number(arg('--interlock-tries', 30));
const INTERLOCK_WAIT_MS = Number(arg('--interlock-wait-ms', 60000));
const RESUME = args.includes('--resume');
const RESUME_FROM = arg('--resume-from', null);
const CHECKPOINT = arg('--checkpoint', process.env.JOB_SCRATCH ? join(process.env.JOB_SCRATCH, `${RUN_ID}.checkpoint.json`) : null);
export const EXIT_INTERLOCK = 75; // EX_TEMPFAIL: stopped, not finished — a wrapper should retry
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function interlockClear() {
  const script = fileURLToPath(new URL('../../audit/entities-sweep-active.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', env: process.env, timeout: 120000 });
  return r.status === 0 && /Quiet/.test(r.stdout || '');
}
async function waitForInterlock() {
  for (let i = 0; i < INTERLOCK_TRIES; i++) {
    if (interlockClear()) return true;
    console.log(`[interlock] entities writer active or unknown — waiting ${INTERLOCK_WAIT_MS / 1000}s (${i + 1}/${INTERLOCK_TRIES})`);
    if (i + 1 < INTERLOCK_TRIES) await sleep(INTERLOCK_WAIT_MS);
  }
  return false;
}

/** Per-page measures for the pilot report, from the same parse that is written. */
function measure(data, layers) {
  const split = splitAnnotations(data);
  const roundTrip = renderInline(split) === data;
  const stored = renderMarkup(layers.text, layers.annotations.map(parserAnnotation));
  const own = renderMarkup(split.text, split.annotations);
  const malformed = split.annotations.filter((a) => a.malformed);
  return {
    round_trip: roundTrip,
    term_lifted: split.termDefinitionsLifted,
    store_matches_parser: stored.markup === own.markup,
    orphans: stored.orphans.length,
    malformed_unclosed: malformed.filter((a) => a.malformed === 'unclosed').length,
    malformed_stray: malformed.filter((a) => a.malformed === 'stray-close').length,
    annotations: layers.annotations.length,
  };
}

async function drawPilot(db, n) {
  const books = await db.collection('books').find({ pages_translated: { $gt: 0 } }, { projection: { _id: 0, id: 1, pages_count: 1 } }).toArray();
  books.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rand = mulberry32(SEED);
  for (let i = books.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [books[i], books[j]] = [books[j], books[i]]; }
  const picked = [];
  const has = { 'translation.data': { $type: 'string', $gt: '' } };
  for (const b of books) {
    if (picked.length >= n) break;
    if (!b.id) continue;
    const r = 1 + Math.floor(rand() * Math.max(1, b.pages_count || 1));
    const proj = { projection: { _id: 0, id: 1 } };
    let p = await db.collection('pages').findOne({ book_id: b.id, page_number: { $gte: r }, ...has }, { ...proj, sort: { page_number: 1 } });
    if (!p) p = await db.collection('pages').findOne({ book_id: b.id, page_number: { $lt: r }, ...has }, { ...proj, sort: { page_number: -1 } });
    if (p) picked.push(p.id);
  }
  console.log(`[draw] ${books.length} books with translations; ${picked.length} pages drawn (seed ${SEED}, one per book)`);
  return picked;
}

/** Every translated page id after `from`, in `id` order, `batch` at a time. Each chunk is its own query. */
export async function* fullIds(db, { from = null, batch = BATCH, chunk = 2000 } = {}) {
  let last = from;
  for (;;) {
    const q = { 'translation.data': { $type: 'string', $gt: '' }, ...(last != null ? { id: { $gt: last } } : { id: { $type: 'string' } }) };
    const rows = await db.collection('pages').find(q, { projection: { _id: 0, id: 1 } }).sort({ id: 1 }).limit(chunk).toArray();
    for (let i = 0; i < rows.length; i += batch) yield rows.slice(i, i + batch).map((p) => p.id);
    if (rows.length < chunk) return;
    last = rows[rows.length - 1].id;
  }
}

export function readCheckpoint(file) {
  if (!file || !existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function writeCheckpoint(file, cp) {
  if (!file) return;
  writeFileSync(`${file}.tmp`, JSON.stringify(cp) + '\n');
  renameSync(`${file}.tmp`, file);
}

export function newTotals() {
  return { seen: 0, written: 0, conflict: 0, already: 0, no_data: 0, round_trip: 0, store_matches_parser: 0, term_lifted_pages: 0, orphans: 0, malformed_unclosed: 0, malformed_stray: 0, malformed_pages: 0, text_bytes: 0, ann_bytes: 0, ann_docs: 0 };
}

export function loadPages(db, ids) {
  return db.collection('pages').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, book_id: 1, 'translation.data': 1, 'translation.text': 1, 'translation.text_from': 1, 'translation.prompt_version': 1, 'ocr.data': 1 } }).toArray();
}
const hasData = (t) => !!t && typeof t.data === 'string' && !!t.data;
const isDone = (t) => translationTextIsCurrent(t) && t.text_from?.parser_version === PARSER_VERSION;
/** Would processBatch write this page? (data present and not already current) */
export const needsWrite = (page) => hasData(page.translation) && !isDone(page.translation);

/** One batch of page ids. `opts.pages` reuses an earlier read; `opts.beforeWrite(page)` is a test seam: it runs between the read and the write. */
export async function processBatch(db, ids, totals, out, { apply = APPLY, runId = RUN_ID, beforeWrite, pages } = {}) {
  pages ??= await loadPages(db, ids);
  for (const page of pages) {
    const t = page.translation;
    if (!hasData(t)) { totals.no_data++; continue; }
    if (isDone(t)) { totals.already++; continue; }
    const layers = translationLayers(t.data, { promptVersion: t.prompt_version, ocr: page.ocr?.data ?? null });
    const m = measure(t.data, layers);
    const textBytes = BSON.calculateObjectSize({ text: layers.text, text_from: layers.text_from });
    const doc = annotationsDoc({ page_id: page.id, book_id: page.book_id, layers, run_id: runId });
    const annBytes = doc ? BSON.calculateObjectSize(doc) : 0;
    const rec = { page_id: page.id, book_id: page.book_id, data_chars: t.data.length, text_chars: layers.text.length, text_bytes: textBytes, ann_bytes: annBytes, ...m };
    totals.seen++;
    for (const k of ['round_trip', 'store_matches_parser']) if (m[k]) totals[k]++;
    totals.term_lifted_pages += m.term_lifted ? 1 : 0;
    totals.orphans += m.orphans;
    totals.malformed_unclosed += m.malformed_unclosed;
    totals.malformed_stray += m.malformed_stray;
    totals.malformed_pages += m.malformed_unclosed + m.malformed_stray ? 1 : 0;
    totals.text_bytes += textBytes;
    totals.ann_bytes += annBytes;
    totals.ann_docs += doc ? 1 : 0;
    if (!apply) { rec.written = 'dry-run'; out?.write(JSON.stringify(rec) + '\n'); continue; }
    if (beforeWrite) await beforeWrite(page);

    const revId = randomBytes(6).toString('hex');
    await db.collection('page_revisions').insertOne({
      id: revId, page_id: page.id, book_id: page.book_id, field: 'translation.text', source: SOURCE, reason: 'notes-layer-backfill',
      run_id: runId, data: t.text ?? null, prev_text_from: t.text_from ?? null,
      data_hash: layers.data_hash, parser_version: PARSER_VERSION, annotations_source: layers.source, created_at: new Date(),
    });
    const r = await db.collection('pages').updateOne(
      { id: page.id, 'translation.data': { $eq: t.data } }, // compare-and-set on the data parsed
      { $set: { 'translation.text': layers.text, 'translation.text_from': layers.text_from } },
    );
    if (!r.matchedCount) {
      totals.conflict++;
      await db.collection('page_revisions').updateOne({ id: revId }, { $set: { aborted: 'conflict', aborted_at: new Date() } });
      rec.written = 'conflict';
    } else {
      if (doc) await db.collection(ANNOTATIONS_COLLECTION).bulkWrite([annotationsInsertOp(doc)]);
      totals.written++;
      rec.written = true;
    }
    out?.write(JSON.stringify(rec) + '\n');
  }
}

/**
 * Walk `batches`. Before a batch with a page to write, ask `interlock()` — the first time, then again
 * after `checkEvery` pages to write; a batch with nothing to write neither asks nor throttles.
 * `onBatch(lastId, done)` runs after every batch that finished (the checkpoint hook).
 * Returns { stopped: 'interlock' | null, done, lastId }.
 */
export async function runScan(db, batches, totals, out, { apply = APPLY, runId = RUN_ID, checkEvery = CHECK_EVERY, throttleMs = THROTTLE, interlock = waitForInterlock, onBatch, onFirstWrite, log = () => {} } = {}) {
  let done = 0, pending = Infinity, lastId = null, checked = false;
  for await (const ids of batches) {
    const pages = await loadPages(db, ids);
    const toWrite = pages.filter(needsWrite).length;
    if (apply && toWrite && pending >= checkEvery) {
      if (!(await interlock())) return { stopped: 'interlock', done, lastId };
      pending = 0;
      if (!checked) { checked = true; await onFirstWrite?.(); }
    }
    await processBatch(db, ids, totals, out, { apply, runId, pages });
    done += ids.length; pending += toWrite;
    lastId = ids[ids.length - 1];
    await onBatch?.(lastId, done);
    if (done % 500 < ids.length) log(done);
    if (toWrite && throttleMs) await sleep(throttleMs);
  }
  return { stopped: null, done, lastId };
}

async function main() {
  if (!PILOT && !FULL && !IDS_FILE) { console.error('Pass --pilot <n>, --ids-file <file> or --full.'); process.exit(2); }
  if (FULL && !args.includes('--go-5942')) { console.error('--full waits for Derek\'s go on #5942: pass --go-5942 once it is given.'); process.exit(2); }
  if ((RESUME || RESUME_FROM) && !FULL) { console.error('--resume / --resume-from apply to --full only.'); process.exit(2); }
  if (RESUME && !CHECKPOINT) { console.error('--resume needs a checkpoint file: --checkpoint <file>, or set JOB_SCRATCH.'); process.exit(2); }
  let from = RESUME_FROM;
  if (RESUME && !from) {
    const cp = readCheckpoint(CHECKPOINT);
    from = cp?.last_id ?? null;
    console.log(cp ? `[resume] ${CHECKPOINT}: after ${from} (${cp.done} pages in its attempt, ${cp.at})` : `[resume] no checkpoint at ${CHECKPOINT} — starting at the beginning`);
  }
  const client = new MongoClient(process.env.MONGODB_URI, { appName: SOURCE, maxPoolSize: 4 });
  await client.connect();
  const db = client.db('bookstore');
  console.log(`[${SOURCE}] run ${RUN_ID} · ${APPLY ? 'APPLY' : 'dry run'} · ${PILOT ? `pilot ${PILOT}` : 'full'} · batch ${BATCH} · throttle ${THROTTLE}ms${FULL ? ` · from ${from ?? 'start'} · checkpoint ${CHECKPOINT ?? 'none'}` : ''}`);
  const out = OUT ? createWriteStream(OUT, { flags: RESUME || RESUME_FROM ? 'a' : 'w' }) : null;
  const totals = newTotals();
  const started = Date.now();
  const chunks = function* (ids) { for (let i = 0; i < ids.length; i += BATCH) yield ids.slice(i, i + BATCH); };
  const batches = IDS_FILE ? chunks(readFileSync(IDS_FILE, 'utf8').split(/\s+/).filter(Boolean)) : PILOT ? chunks(await drawPilot(db, PILOT)) : fullIds(db, { from });
  const r = await runScan(db, batches, totals, out, {
    onFirstWrite: async () => {
      await db.collection(ANNOTATIONS_COLLECTION).createIndex({ page_id: 1, source: 1, run_id: 1, data_hash: 1 }, { name: 'page_annotations_key_uniq', unique: true });
      await db.collection(ANNOTATIONS_COLLECTION).createIndex({ book_id: 1 }, { name: 'page_annotations_book_idx' });
    },
    onBatch: FULL ? (lastId, done) => writeCheckpoint(CHECKPOINT, { run_id: RUN_ID, last_id: lastId, done, at: new Date().toISOString() }) : undefined,
    log: (done) => console.log(`  ${done} pages · ${totals.written} written · ${totals.already} already · ${totals.conflict} conflicts · ${((Date.now() - started) / 1000).toFixed(0)}s`),
  });
  await new Promise((res) => (out ? out.end(res) : res()));
  const secs = (Date.now() - started) / 1000;
  console.log(JSON.stringify({ run_id: RUN_ID, apply: APPLY, seconds: Math.round(secs), last_id: r.lastId, stopped: r.stopped, ...totals }, null, 1));
  await client.close();
  if (r.stopped) {
    console.error(`entities interlock never cleared — stopped after ${r.lastId ?? '(nothing)'}; exit ${EXIT_INTERLOCK}. Re-run with --resume${CHECKPOINT ? ` (checkpoint ${CHECKPOINT})` : ''}.`);
    process.exit(EXIT_INTERLOCK);
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
