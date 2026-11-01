#!/usr/bin/env node
// PRIOR ART: scripts/eval/queue-routes-7853/arms.mjs (the node/dryApply/callsOf/pool/logRow/done machinery, the GPU
// stage/collect over the judged image bytes with armcDraftText, the template hash check, retry-killed; restated over this
// study's OUT, arms and keys) and scripts/batch/cli-ocr-lane.mjs armcRun --frame=first-read (the live route's read: the
// unread GPU-draft path, no --over-stored, one page a call, apply --diff-guard=gpu-draft --print-only) and
// scripts/eval/route-judge-6740/cheap-routes-7701/run.mjs (la-armc: the same read 4 a call; the read@4 route's apply
// --first-read-only --print-only). Nothing here writes a page: every apply is a dry run with --emit-written.
/**
 * The arms of the Latin first-read paired test (experiment file §Arms). Texts go to OUT/texts/<key>.<arm>.txt (only a
 * text the arm's apply would WRITE; a page not written stays scans-only), outcomes to OUT/arms.jsonl.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/latin-paired-6740/arms.mjs gpu-stage
 *   (the GPU task, gpu-task.sh, drafts OUT/gpu/img into OUT/gpu/pero.json)
 *   ... arms.mjs gpu-collect           one draft a page -> OUT/gpu/drafts/<page_id>.json
 *   ... arms.mjs live | pero4 | read4 [--concurrency=2]
 *   ... arms.mjs retry-killed --arm=X  (a read the box killed, exit -9, is re-opened once; #7835 Amendment 1's rule)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { OUT, ROOT, J, jsonl, arg, ENV_FILE, AGY_MODEL, imageFor, LANES } from './lib.mjs';
import { GPU_TEMPLATE, armcDraftText } from '../../batch/cli-ocr-lane.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';

const CLI = path.join(ROOT, 'scripts/batch/cli-ocr.mjs');
const JOB = 'latin-paired-6740';
const REASON = '#6740 Latin first-read paired test arm (dry run, never applied)';
const T = (key, arm) => path.join(OUT, 'texts', `${key}.${arm}.txt`);
export const readT = (key, arm) => (fs.existsSync(T(key, arm)) ? fs.readFileSync(T(key, arm), 'utf8') : null);
const writeT = (key, arm, t) => { fs.mkdirSync(path.join(OUT, 'texts'), { recursive: true }); fs.writeFileSync(T(key, arm), t); };
const ARMS_LOG = path.join(OUT, 'arms.jsonl');
const sel = () => J('selected.json').selected;
const GPU = path.join(OUT, 'gpu');
// A dry apply skips a page the live lane read after this test read it (cheap-routes-7701 LATER_READ): reported, never written back.
const LATER_READ = /the page has OCR now/;

function node(args, log) {
  return new Promise((resolve) => {
    const out = fs.openSync(log, 'a');
    const child = spawn(process.execPath, [`--env-file=${ENV_FILE}`, ...args], { stdio: ['ignore', out, out], env: { ...process.env, AGY_JOB: JOB } });
    child.on('close', (code) => { fs.closeSync(out); resolve(code); });
  });
}
const meta = (dir, id) => { const f = path.join(dir, `${id}.meta.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
const readText = (dir, id) => { const f = path.join(dir, `${id}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };
/** Calls this dir's reads made (#7835 callsOf): block calls from calls.jsonl, one-page reads from their metas; a reused kept read costs 0. */
function callsOf(dir) {
  const blocks = jsonl(path.join(dir, 'calls.jsonl'));
  const inBlock = new Set(blocks.flatMap((c) => c.page_ids || []));
  const single = fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter((m) => !m.call_id || !inBlock.has(m.page_id));
  return { calls: blocks.reduce((a, c) => a + (c.calls || 1), 0) + single.reduce((a, m) => a + (m.reused_from ? 0 : m.calls || 1), 0), pages: new Set([...inBlock, ...single.map((m) => m.page_id)]).size, reused: single.filter((m) => m.reused_from).length };
}
async function dryApply(dir, only, extra) {
  const emit = path.join(dir, 'emit.jsonl'); fs.rmSync(emit, { force: true });
  for (const f of fs.readdirSync(dir).filter((f) => /^apply-summary-dry/.test(f))) fs.rmSync(path.join(dir, f));
  const of = path.join(dir, 'only-drawn.json'); fs.writeFileSync(of, JSON.stringify(only));
  const code = await node([CLI, 'apply', `--out=${dir}`, `--only=${of}`, `--reason=${REASON}`, `--emit-written=${emit}`, ...extra], path.join(dir, 'apply.log'));
  const sum = fs.existsSync(path.join(dir, 'apply-summary-dry.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'apply-summary-dry.json'), 'utf8')) : {};
  return { code, emitted: new Map(jsonl(emit).map((r) => [r.page_id, r.text])), skipped: sum.skipped_pages || {}, diff_guard: sum.diff_guard ?? null, change_shares: sum.change_shares ?? null };
}
async function pool(items, fn) {
  // agy 2 at a time in all (#7835 Amendment 1: at 4 the box's OOM killer took agy processes)
  const conc = Math.max(1, Math.min(2, Number(arg('concurrency') || 2)));
  let i = 0, stop = null;
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < items.length) { const it = items[i++]; const r = await fn(it); if (r === 'quota') stop = 'quota'; } }));
  if (stop) console.log('STOPPED: agy quota; rerun resumes');
  return stop;
}
const logRow = (row) => fs.appendFileSync(ARMS_LOG, JSON.stringify({ ...row, at: new Date().toISOString() }) + '\n');
// The last row a key got for an arm decides: a `superseded` row (a read the box killed) re-opens the key.
const done = (arm) => { const last = new Map(); for (const r of jsonl(ARMS_LOG).filter((x) => x.arm === arm && !x.quota)) last.set(r.key, r); return new Set([...last].filter(([, r]) => !r.superseded).map(([k]) => k)); };
/** The outcome of the drawn page: written (the text the lane writes), or why not (the page then stays scans-only). */
function outcome(s, arm, dir, ap) {
  const served = ap.emitted.get(s.page_id) ?? null, raw = readText(dir, s.page_id), why = ap.skipped[s.page_id];
  if (raw) writeT(s.key, `${arm}-read`, raw);
  fs.rmSync(T(s.key, arm), { force: true });
  if (served != null) { writeT(s.key, arm, served); return { written: true, why: 'written' }; }
  // read before the live lane took the page: the read stands as the arm's text (judged), never written back
  if (why && LATER_READ.test(why) && raw && arm === 'read4') { writeT(s.key, arm, raw); return { written: true, later_read: why, why: 'written (the page was read by a lane since)' }; }
  return { written: false, why: why ?? (meta(dir, s.page_id) ? 'not in dry-run output' : 'not read') };
}

// ── GPU drafts (PERO-OCR on the bytes every arm and the judge see) ──
/** The block pages' image bytes (the drawn page's are the judge's), one folder for the GPU task. */
async function gpuStage() {
  const d = path.join(GPU, 'img'); fs.mkdirSync(d, { recursive: true });
  let n = 0, failed = 0;
  for (const s of sel()) for (const id of s.block) {
    try { fs.writeFileSync(path.join(d, `${id}.jpg`), await imageFor(`L-${id}`, s.block_images[id])); n++; } catch (e) { failed++; console.log(`  ${id}: ${e.message}`); }
  }
  console.log(`gpu-stage: ${n} images, ${failed} not fetched`);
}
/** armc-collect's rule: one draft a page (armcDraftText), with the hash of the image it was made from. */
function gpuCollect() {
  const D = path.join(GPU, 'drafts'); fs.mkdirSync(D, { recursive: true });
  const j = JSON.parse(fs.readFileSync(path.join(GPU, 'pero.json'), 'utf8'));
  if (j._engine?.exit !== 0) throw new Error(`PERO exited ${j._engine?.exit}`);
  let n = 0, empty = 0;
  for (const [id, r] of Object.entries(j).filter(([k]) => k !== '_engine')) { fs.writeFileSync(path.join(D, `${id}.json`), JSON.stringify({ text: armcDraftText(r.text), image_sha256: r.image_sha256, engine: j._engine })); n++; }
  for (const s of sel()) for (const id of s.block) if (!fs.existsSync(path.join(D, `${id}.json`))) { fs.writeFileSync(path.join(D, `${id}.json`), JSON.stringify({ text: '', error: 'pero wrote no draft' })); empty++; }
  console.log(`gpu-collect: ${n} drafts, ${empty} pages with none`);
}
const draftOf = (id) => JSON.parse(fs.readFileSync(path.join(GPU, 'drafts', `${id}.json`), 'utf8'));
// armcRun's refusal before the read: no draft, or a draft under 30 word characters
const usableDraft = (d) => d.text && d.text.replace(/\W/g, '').length >= 30;

/** Arms 1 and 2: the PERO draft corrected by agy with the image (template GPU_TEMPLATE), one page a call or the block 4 a call. */
async function peroArm(arm, perCall) {
  const tplText = fs.readFileSync(path.join(ROOT, GPU_TEMPLATE.file), 'utf8');
  if (contentHash(tplText) !== GPU_TEMPLATE.hash) throw new Error('GPU template hash moved');
  const have = done(arm);
  await pool(sel().filter((s) => !have.has(s.key)), async (s) => {
    const dir = path.join(OUT, arm, s.book_id), imgDir = path.join(dir, 'img'); fs.mkdirSync(imgDir, { recursive: true });
    const tpl = path.join(dir, `gpu-correct-prompt-${GPU_TEMPLATE.hash}.txt`); fs.writeFileSync(tpl, tplText);
    const want = perCall > 1 ? s.block : [s.page_id];
    const drafts = { _engine: null }, send = [];
    for (const id of want) {
      const d = draftOf(id); if (!usableDraft(d)) continue;
      drafts._engine ??= d.engine; drafts[id] = { text: d.text, image_sha256: d.image_sha256 }; send.push(id);
      fs.copyFileSync(path.join(GPU, 'img', `${id}.jpg`), path.join(imgDir, `${id}.jpg`));
    }
    if (!drafts[s.page_id]) { logRow({ key: s.key, arm, written: false, why: `no draft: ${draftOf(s.page_id).error || 'GPU draft under 30 word characters'}`, calls: 0, pages: 0 }); fs.rmSync(T(s.key, arm), { force: true }); return; }
    writeT(s.key, `${arm}-draft`, drafts[s.page_id].text);
    const df = path.join(dir, 'drafts.json'), ids = path.join(dir, 'page-ids.json');
    fs.writeFileSync(df, JSON.stringify(drafts)); fs.writeFileSync(ids, JSON.stringify(send));
    const code = await node([CLI, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${AGY_MODEL}`, `--correct-prompt=${tpl}`, `--lane=${LANES[arm]}`, `--gpu-draft=${df}`, `--image-dir=${imgDir}`, `--job=${JOB}`, '--stop-on-quota', ...(perCall > 1 ? [`--per-call=${perCall}`] : [])], path.join(dir, 'read.log'));
    if (code === 3) { logRow({ key: s.key, arm, quota: true }); return 'quota'; }
    const ap = await dryApply(dir, [s.page_id], ['--diff-guard=gpu-draft', '--print-only']);
    const o = outcome(s, arm, dir, ap), m = meta(dir, s.page_id);
    logRow({ key: s.key, arm, read_exit: code, meta_exit: m?.exit ?? null, call_pages: m?.call_pages ?? 1, block_sent: send.length, ...o, diff_guard: ap.diff_guard, change_share: ap.change_shares?.[s.page_id] ?? null, template_hash: GPU_TEMPLATE.hash, image_sha256: m?.image_sha256 ?? null, ...callsOf(dir) });
    console.log(`  ${arm} ${s.key}: ${o.why}`);
  });
}

/** Arm 3: a fresh agy read of the block, 4 a call, on the live first-read prompt; apply --first-read-only --print-only. */
async function read4() {
  const arm = 'read4', have = done(arm);
  await pool(sel().filter((s) => !have.has(s.key)), async (s) => {
    const dir = path.join(OUT, arm, s.book_id); fs.mkdirSync(dir, { recursive: true });
    const ids = path.join(dir, 'page-ids.json'); fs.writeFileSync(ids, JSON.stringify(s.block));
    const code = await node([CLI, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${AGY_MODEL}`, `--job=${JOB}`, '--stop-on-quota', '--per-call=4'], path.join(dir, 'read.log'));
    if (code === 3) { logRow({ key: s.key, arm, quota: true }); return 'quota'; }
    const ap = await dryApply(dir, [s.page_id], ['--first-read-only', '--print-only', `--lane=${LANES.read4}`]);
    const o = outcome(s, arm, dir, ap), m = meta(dir, s.page_id);
    logRow({ key: s.key, arm, read_exit: code, meta_exit: m?.exit ?? null, wrapper: m?.wrapper ?? null, call_pages: m?.call_pages ?? 1, ...o, image_sha256: m?.image_sha256 ?? null, ...callsOf(dir) });
    console.log(`  ${arm} ${s.key}: ${o.why}`);
  });
}

/** A read the box killed (meta exit -9) is not a route outcome: moved aside under killed/, the key re-opened once. */
function retryKilled() {
  const arm = arg('arm'), rows = jsonl(ARMS_LOG);
  let n = 0;
  for (const s of sel()) {
    if (rows.some((r) => r.key === s.key && r.arm === arm && r.superseded)) continue;   // once
    const dir = path.join(OUT, arm, s.book_id); if (!fs.existsSync(dir)) continue;
    const killed = fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')).filter((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).exit === -9).map((f) => f.replace(/\.meta\.json$/, ''));
    if (!killed.length) continue;
    const aside = path.join(dir, 'killed'); fs.mkdirSync(aside, { recursive: true });
    for (const id of killed) for (const ext of ['meta.json', 'txt', 'raw.txt', 'prompt.txt']) { const f = path.join(dir, `${id}.${ext}`); if (fs.existsSync(f)) fs.renameSync(f, path.join(aside, `${id}.${ext}`)); }
    fs.rmSync(path.join(dir, 'calls.jsonl'), { force: true });
    logRow({ key: s.key, arm, superseded: true, retry: 1, killed_pages: killed, judged_page_killed: killed.includes(s.page_id) });
    n++;
  }
  console.log(`retry-killed ${arm}: ${n} keys re-opened`);
}

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
/** The judged bytes and the GPU bytes must be one file: checked before any arm reads. */
function checkBytes() {
  let bad = 0;
  for (const s of sel()) { const a = path.join(OUT, 'img', `${s.key}.jpg`), b = path.join(GPU, 'img', `${s.page_id}.jpg`); if (!fs.existsSync(b) || sha256(a) !== sha256(b)) bad++; }
  if (bad) throw new Error(`${bad} pages: the GPU image is not the judged image`);
}

const stages = { 'gpu-stage': gpuStage, 'gpu-collect': gpuCollect, live: () => (checkBytes(), peroArm('live', 1)), pero4: () => (checkBytes(), peroArm('pero4', 4)), read4, 'retry-killed': retryKilled };
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await stages[process.argv[2]]();
}
