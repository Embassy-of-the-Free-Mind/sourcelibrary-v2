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
 * INTERLOCK: scripts/audit/entities-sweep-active.mjs before the run and every --check-every pages.
 * Only exit 0 with its "Quiet" line counts as clear; anything else waits (60 s) and gives up after
 * 30 min.
 *
 * USAGE (dry run unless --apply):
 *   node --env-file=.env.production.local scripts/maintenance/notes-layer-backfill-5942/backfill.mjs \
 *     --pilot 1000 [--seed 5942] [--apply] [--out $JOB_SCRATCH/pilot.jsonl]
 *   --ids-file <file>      these page ids (whitespace-separated), e.g. to re-apply after an undo test
 *   --full                 every translated page (waits for Derek's go on #5942; not run yet)
 *   --batch 50 --throttle-ms 300 --check-every 500
 *   --run-id <id>          default notes-layer-backfill-5942-<UTC timestamp>
 * Undo: undo.mjs --run-id <id> [--apply]
 */
import { MongoClient, BSON } from 'mongodb';
import { spawnSync } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
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
  for (let i = 0; i < 30; i++) {
    if (interlockClear()) return true;
    console.log(`[interlock] entities writer active or unknown — waiting 60s (${i + 1}/30)`);
    await sleep(60000);
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

async function* fullIds(db) {
  const cur = db.collection('pages').find({ 'translation.data': { $type: 'string', $gt: '' } }, { projection: { _id: 0, id: 1 }, batchSize: 2000 });
  let ids = [];
  for await (const p of cur) { ids.push(p.id); if (ids.length >= BATCH) { yield ids; ids = []; } }
  if (ids.length) yield ids;
}

export function newTotals() {
  return { seen: 0, written: 0, conflict: 0, already: 0, no_data: 0, round_trip: 0, store_matches_parser: 0, term_lifted_pages: 0, orphans: 0, malformed_unclosed: 0, malformed_stray: 0, malformed_pages: 0, text_bytes: 0, ann_bytes: 0, ann_docs: 0 };
}

/** One batch of page ids. `opts.beforeWrite(page)` is a test seam: it runs between the read and the write. */
export async function processBatch(db, ids, totals, out, { apply = APPLY, runId = RUN_ID, beforeWrite } = {}) {
  const pages = await db.collection('pages').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, book_id: 1, 'translation.data': 1, 'translation.text': 1, 'translation.text_from': 1, 'translation.prompt_version': 1 } }).toArray();
  for (const page of pages) {
    const t = page.translation;
    if (!t || typeof t.data !== 'string' || !t.data) { totals.no_data++; continue; }
    if (translationTextIsCurrent(t) && t.text_from?.parser_version === PARSER_VERSION) { totals.already++; continue; }
    const layers = translationLayers(t.data, { promptVersion: t.prompt_version });
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

async function main() {
  if (!PILOT && !FULL && !IDS_FILE) { console.error('Pass --pilot <n>, --ids-file <file> or --full.'); process.exit(2); }
  if (FULL && !args.includes('--go-5942')) { console.error('--full waits for Derek\'s go on #5942: pass --go-5942 once it is given.'); process.exit(2); }
  const client = new MongoClient(process.env.MONGODB_URI, { appName: SOURCE, maxPoolSize: 4 });
  await client.connect();
  const db = client.db('bookstore');
  console.log(`[${SOURCE}] run ${RUN_ID} · ${APPLY ? 'APPLY' : 'dry run'} · ${PILOT ? `pilot ${PILOT}` : 'full'} · batch ${BATCH} · throttle ${THROTTLE}ms`);
  if (APPLY) {
    if (!(await waitForInterlock())) { console.error('entities interlock never cleared — stopping.'); process.exit(3); }
    await db.collection(ANNOTATIONS_COLLECTION).createIndex({ page_id: 1, source: 1, run_id: 1, data_hash: 1 }, { name: 'page_annotations_key_uniq', unique: true });
    await db.collection(ANNOTATIONS_COLLECTION).createIndex({ book_id: 1 }, { name: 'page_annotations_book_idx' });
  }
  const out = OUT ? createWriteStream(OUT) : null;
  const totals = newTotals();
  const started = Date.now();
  let done = 0, sinceCheck = 0;
  const chunks = function* (ids) { for (let i = 0; i < ids.length; i += BATCH) yield ids.slice(i, i + BATCH); };
  const batches = IDS_FILE ? chunks(readFileSync(IDS_FILE, 'utf8').split(/\s+/).filter(Boolean)) : PILOT ? chunks(await drawPilot(db, PILOT)) : fullIds(db);
  for await (const ids of batches) {
    if (APPLY && sinceCheck >= CHECK_EVERY) {
      sinceCheck = 0;
      if (!(await waitForInterlock())) { console.error('entities interlock never cleared — stopping mid-run; re-run resumes (written pages are skipped).'); break; }
    }
    await processBatch(db, ids, totals, out);
    done += ids.length; sinceCheck += ids.length;
    if (done % 500 < BATCH) console.log(`  ${done} pages · ${totals.written} written · ${totals.conflict} conflicts · ${((Date.now() - started) / 1000).toFixed(0)}s`);
    if (THROTTLE) await sleep(THROTTLE);
  }
  out?.end();
  const secs = (Date.now() - started) / 1000;
  console.log(JSON.stringify({ run_id: RUN_ID, apply: APPLY, seconds: Math.round(secs), ...totals }, null, 1));
  await client.close();
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
