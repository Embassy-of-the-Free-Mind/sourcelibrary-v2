#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-ocr.mjs `apply` — the CLI-read OCR writer (snapshot, write shape, guards, sweep row,
// recount, book event); it reads a read directory of meta/txt files, this reads the staging collection. And
// scripts/maintenance/withhold-paddle-table-pages-6388.mjs, the write this one reverses for a reviewed page.
//
// #6561 step 3: serve the Opus-corrected text of withheld Paddle table pages that the Gemini reviewer reviewed and did
// NOT call invented (verdict clean | minor | material). Reads `paddle_table_corrections_6561` (review written by
// review-step2.mjs) and writes `pages`. Dry run unless --apply.
//
// Per page: re-read live; skip if not still withheld for paddle_table_6388, human-edited, or its book is gone; skip if
// the image was replaced after Opus read it. SNAPSHOT FIRST: `saveRevisionBeforeOverwrite` is a no-op on these pages
// (the withhold removed `ocr.data`, keeping `withheld_chars`), so the withheld state is snapshotted here in the same
// row shape — field 'ocr', reason 'opus_correct_6561', `data` = the Paddle text (the withhold's own snapshot, pinned by
// content_hash), `meta` = the whole withheld `ocr` object. A failed snapshot aborts the page. Then the write, guarded on
// `ocr.unreadable_reason` still being paddle_table_6388 (a concurrent writer wins), one sweep_log row per page, and
// per book recountBook + a book_events row + sync-pages-content.mjs --book (the Supabase mirror).
//
// Lifts NOTHING else: no book hold is released, no translation is touched.
//
// UNDO (one page; --undo does it for every page this run wrote, by sweep_log):
//   rev = page_revisions.findOne({ page_id, field: 'ocr', reason: 'opus_correct_6561' }, sort created_at -1)
//   pages.updateOne({ id: page_id, 'ocr.engine.run.job_id': /^serve-opus-correct-6561/ }, { $set: { ocr: rev.meta } })
//   then recountBook + sync-pages-content.mjs --book.  `node serve.mjs --undo [--apply] [--pages-file=ids.json]`
//
// Usage (cwd = $JOB_SCRATCH): node --env-file=… serve.mjs --gate=gate-score.json [--apply] [--limit=20] [--pages-file=ids.json] [--undo]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { geminiEngine, imageInput, ocrProvenance, notRecorded, codeVersion, host, NOT_RECORDED } from '../../lib/write-provenance.mjs';
import { liftOcrTags, parseDetectedImages } from '../../lib/ocr-result-parse.mjs';
import { loopVerdict } from '../../lib/ocr-loop-guard.mjs';
import { ocrReadProblem } from '../../lib/cli-chatter.mjs';
import { recountBook } from '../../lib/page-counts.mjs';
import { recordSweepAction } from '../../lib/sweep-log.mjs';
import { fetchImage } from './sample.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const CALL_SITE = 'scripts/eval/paddle-review-6561/serve.mjs';
const REASON = 'paddle_table_6388';
const REV_REASON = 'opus_correct_6561';
const SWEEP = 'serve-opus-correct-6561';
const SERVE = new Set(['clean', 'minor', 'material']);
const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
// The gate (#6561 step 1) must have said GO before anything is written: --gate=<gate-score.json from score-gate.mjs>.
const GATE = arg('gate') ? JSON.parse(fs.readFileSync(arg('gate'), 'utf8')).summary?.gate : null;
if (APPLY && !UNDO && !String(GATE || '').startsWith('GO')) { console.error(`refusing --apply: the gate is ${GATE ?? 'not given (--gate=gate-score.json)'}`); process.exit(2); }
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity;
const ONLY = arg('pages-file') ? new Set(JSON.parse(fs.readFileSync(arg('pages-file'), 'utf8')).map((x) => (typeof x === 'string' ? x : x.page_id))) : null;
const sha16 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const runId = `${SWEEP}-${stamp}`;
const log = fs.createWriteStream(`serve-${UNDO ? 'undo-' : ''}${APPLY ? 'apply' : 'dry'}-${stamp}.jsonl`);
const rec = (o) => log.write(JSON.stringify({ ...o, at: new Date().toISOString() }) + '\n');

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const pagesC = db.collection('pages');
const tally = { written: 0, skipped: {} };
const skip = (d, why, extra = {}) => { tally.skipped[why] = (tally.skipped[why] || 0) + 1; rec({ page_id: d.page_id, book_id: d.book_id, page_number: d.page_number, status: 'skip', why, ...extra }); };
const books = new Map();
const syncBooks = (ids) => {
  for (const id of ids) {
    const r = spawnSync('node', ['--env-file=/root/sourcelibrary/.env.production.local', path.join(ROOT, 'scripts/workers/sync-pages-content.mjs'), `--book=${id}`], { encoding: 'utf8', cwd: ROOT, timeout: 600000 });
    rec({ book_id: id, status: 'mirror-sync', exit: r.status, tail: (r.stdout + r.stderr).trim().split('\n').slice(-2).join(' | ') });
    if (r.status !== 0) console.error(`  mirror sync FAILED for ${id}: ${(r.stderr || '').slice(-300)}`);
  }
};

if (UNDO) {
  const rows = await db.collection('sweep_log').find({ sweep: SWEEP, action: 'ocr-served-opus-correct' }).toArray();
  for (const s of rows) {
    const pid = s.detail?.page_id; if (!pid || (ONLY && !ONLY.has(pid))) continue;
    const rev = await db.collection('page_revisions').findOne({ page_id: pid, field: 'ocr', reason: REV_REASON }, { sort: { created_at: -1 } });
    if (!rev?.meta?.unreadable) { skip({ page_id: pid, book_id: s.book_id }, 'no withheld-state snapshot'); continue; }
    if (!APPLY) { tally.written++; rec({ page_id: pid, status: 'would-undo' }); continue; }
    const r = await pagesC.updateOne({ id: pid, 'ocr.engine.run.job_id': { $regex: `^${SWEEP}` } }, { $set: { ocr: rev.meta, updated_at: new Date() } });
    if (r.modifiedCount !== 1) { skip({ page_id: pid, book_id: s.book_id }, 'page rewritten since the serve'); continue; }
    await recordSweepAction(db, { sweep: SWEEP, book_id: s.book_id, action: 'ocr-serve-undone', detail: { page_id: pid, revision: rev.id } });
    (books.get(s.book_id) || books.set(s.book_id, []).get(s.book_id)).push(s.detail.page_number); tally.written++;
  }
  if (APPLY) { for (const b of books.keys()) await recountBook(db, b, { reason: `${SWEEP}-undo` }); syncBooks(books.keys()); }
  console.log(`${APPLY ? 'undone' : 'would undo'}: ${tally.written}  skipped: ${JSON.stringify(tally.skipped)}`);
  await c.close(); log.end(); process.exit(0);
}

const CODE_VERSION = await codeVersion();
const staged = await db.collection('paddle_table_corrections_6561').find({ 'review.verdict': { $in: [...SERVE] } }).toArray();
const cand = staged.filter((d) => !ONLY || ONLY.has(d.page_id)).sort((a, b) => (a.book_id + String(a.page_number).padStart(6, '0') < b.book_id + String(b.page_number).padStart(6, '0') ? -1 : 1));
console.log(`${staged.length} staged pages reviewed and not called invented; ${cand.length} selected; ${APPLY ? 'APPLY' : 'dry run'}`);
const bookAlive = new Map();
fs.mkdirSync('img', { recursive: true });

for (const d of cand) {
  if (tally.written >= LIMIT) break;
  const text = d.corrected_text;
  if (typeof text !== 'string' || sha16(text) !== d.corrected_sha) { skip(d, 'staging text does not match its hash'); continue; }
  const page = await pagesC.findOne({ id: d.page_id }, { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1 } });
  if (!page) { skip(d, 'page gone'); continue; }
  if (!bookAlive.has(d.book_id)) bookAlive.set(d.book_id, !!(await db.collection('books').findOne({ $or: [{ id: d.book_id }, { _id: d.book_id }] }, { projection: { _id: 1 } })));
  if (!bookAlive.get(d.book_id)) { skip(d, 'book gone'); continue; }
  if (!(page.ocr?.unreadable === true && page.ocr?.unreadable_reason === REASON)) { skip(d, 'no longer withheld for paddle_table_6388', { reason_now: page.ocr?.unreadable_reason ?? null }); continue; }
  if (page.ocr?.edited_by || page.ocr?.source === 'manual') { skip(d, 'human-edited page'); continue; }
  if (typeof page.ocr?.data === 'string') { skip(d, 'withheld page unexpectedly carries ocr.data'); continue; }
  // the guards cli-ocr apply runs on a CLI read
  const chatter = ocrReadProblem(text);
  if (chatter) { skip(d, `chatter guard: ${chatter}`); continue; }
  if (loopVerdict(text).refuse) { skip(d, 'repetition loop guard'); continue; }
  if ((text.match(/<page-type>/g) || []).length !== 1) { skip(d, 'not exactly one <page-type> tag'); continue; }
  let im;
  try { im = await fetchImage(d.image_url, 'img'); } catch (e) { skip(d, `image fetch failed: ${e.message}`); continue; }
  // The image must not have been replaced after Opus read it (bytes cannot tell: Cloudflare Polish serves either variant).
  const readAt = d.provenance?.read_at;
  if (!im.last_modified || !readAt || im.last_modified > new Date(readAt)) { skip(d, 'image replaced after the Opus read (or no last-modified)', { last_modified: im.last_modified, read_at: readAt }); continue; }
  // The Paddle draft Opus corrected = the withhold's snapshot of it (pinned by its content_hash).
  const paddleRev = await db.collection('page_revisions').findOne({ page_id: d.page_id, field: 'ocr', reason: 'withhold_paddle_table_6388' }, { sort: { created_at: -1 } });
  if (!paddleRev || sha16(paddleRev.data || '') !== d.paddle_sha) { skip(d, 'withhold snapshot of the Paddle draft not found or hash differs'); continue; }

  const P = d.provenance || {};
  const engine = geminiEngine({
    name: 'anthropic', call_site: CALL_SITE, api: 'cli', cli: { name: P.cli || 'claude -p', version: P.cli_version || NOT_RECORDED }, model: P.model,
    prompt: { id: null, name: P.prompt?.name, version: P.prompt?.version, hash: P.prompt?.head_sha, sent_hash: NOT_RECORDED },
    generationConfig: notRecorded('claude -p exposes no temperature, output cap or thinking setting; the model id names the tier'),
    run: {
      job_id: runId, code_version: CODE_VERSION, host: host(), at: new Date(), reason: 'issue 6561: Opus-correct of a withheld Paddle table page, served after a Gemini review that did not call it invented',
      method: 'opus-correct', correction_run: d.run, read_at: P.read_at, read_host: P.host, read_account: P.account,
      prompt_hashes: { head_sha: P.prompt?.head_sha ?? null, redo_opus_sha: P.prompt?.redo_opus_sha ?? null, note: P.prompt?.note ?? null, per_page_sent_hash: 'not recorded by the read; the prompt embeds the page\'s Paddle draft' },
      draft: { engine: 'paddle', model: paddleRev.model, content_hash: d.paddle_sha, revision: paddleRev.id, run: paddleRev.engine?.run ?? null },
      reviewer: { model: d.review.model, cli: 'agy -p', verdict: d.review.verdict, at: d.review.at, prompt: 'scripts/eval/paddle-table-pilot-6388/review-prompt-pilot.txt' },
      staging: { collection: 'paddle_table_corrections_6561', corrected_sha: d.corrected_sha },
    },
    input: { ...imageInput({ url: d.image_url, mime: 'image/jpeg', bytes: im.orig_bytes }), image_sha256: im.polished ? null : im.sha256, ...(im.polished && { served_variant: { cf_polished: true, bytes: im.bytes, sha256: im.sha256 } }) },
  });
  const tags = liftOcrTags(text);
  const detectedImages = parseDetectedImages(text);
  const prov = ocrProvenance(text, engine); // throws on an incomplete engine block, in the dry run too
  if (!APPLY) { tally.written++; rec({ page_id: d.page_id, book_id: d.book_id, page_number: d.page_number, status: 'would-write', verdict: d.review.verdict, chars: text.length }); continue; }

  // SNAPSHOT FIRST: the withheld state, whole.
  const revId = crypto.randomBytes(6).toString('hex');
  try {
    await db.collection('page_revisions').insertOne({
      id: revId, page_id: page.id, book_id: page.book_id, field: 'ocr', data: paddleRev.data, source: page.ocr.source, model: page.ocr.model, language: page.ocr.language,
      prompt_version: page.ocr.prompt_version, edited_by: page.ocr.edited_by, job_id: runId, reason: REV_REASON, original_date: page.ocr.updated_at, created_at: new Date(),
      ...(page.ocr.content_hash ? { content_hash: page.ocr.content_hash } : {}), ...(page.ocr.engine ? { engine: page.ocr.engine } : {}),
      meta: page.ocr, note: 'withheld state (ocr.data removed by the 6388 withhold; data here is its Paddle snapshot). Undo: $set ocr = meta.',
    });
  } catch (e) { skip(d, `snapshot failed: ${e.message}`); continue; }
  const r = await pagesC.updateOne(
    { id: page.id, 'ocr.unreadable_reason': REASON, 'ocr.data': { $exists: false } },
    { $set: {
      ocr: { data: text, language: page.ocr.language || 'Chinese', model: P.model, updated_at: new Date(), source: 'ai', prompt_version: P.prompt?.version ?? null, prompt_id: null, prompt_name: P.prompt?.name ?? null, ...prov },
      ...tags,
      ...(detectedImages.length > 0 && { detected_images: detectedImages }),
      updated_at: new Date(),
    } },
  );
  if (r.modifiedCount !== 1) { skip(d, 'page changed before the write (a concurrent writer won)'); await db.collection('page_revisions').deleteOne({ id: revId }); continue; }
  await recordSweepAction(db, { sweep: SWEEP, book_id: page.book_id, action: 'ocr-served-opus-correct', detail: { page_id: page.id, page_number: page.page_number, from: `withheld paddle (${page.ocr.model})`, to_model: P.model, verdict: d.review.verdict, reviewer: d.review.model, revision: revId, run: runId, issue: 6561 } });
  await db.collection('paddle_table_corrections_6561').updateOne({ page_id: page.id }, { $set: { served: { at: new Date(), run: runId, revision: revId } } });
  (books.get(page.book_id) || books.set(page.book_id, []).get(page.book_id)).push(page.page_number);
  tally.written++;
  rec({ page_id: page.id, book_id: page.book_id, page_number: page.page_number, status: 'written', verdict: d.review.verdict, revision: revId });
}

if (APPLY) {
  for (const [bookId, nums] of books) {
    await recountBook(db, bookId, { reason: SWEEP });
    await db.collection('book_events').insertOne({ book_id: bookId, type: 'ocr_served', at: new Date(), source: CALL_SITE, details: { run: runId, issue: 6561, method: 'opus-correct, Gemini-reviewed', pages: nums.length, page_numbers: nums.sort((a, b) => a - b), note: 'withheld Paddle table pages (6388) replaced by the reviewed Opus correction; book hold and withheld translations unchanged' } });
  }
  syncBooks(books.keys());
}
console.log(`${APPLY ? 'written' : 'would write'}: ${tally.written} pages in ${APPLY ? books.size : '?'} books   skipped: ${JSON.stringify(tally.skipped)}   run ${runId}`);
await c.close(); log.end();
