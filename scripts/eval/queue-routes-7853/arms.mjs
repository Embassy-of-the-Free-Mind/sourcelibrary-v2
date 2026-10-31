#!/usr/bin/env node
// PRIOR ART: scripts/eval/fraktur-paired-7835/arms.mjs (t2-a the stored text, t2-b the #7558 lane's own correction with
// its dry apply, plainRead the read@4 with its dry apply, callsOf, the quota stop; restated over this study's OUT and
// keys), scripts/batch/cli-ocr-lane.mjs armcRun (arm c's read: `cli-ocr.mjs read --gpu-draft --image-dir --over-stored`
// on GPU_TEMPLATE, apply `--mark-stale=ARMC_LANE` with the E3 diff guard; #7835 T3 scored arm c with servedArmc instead,
// which a write-back cannot take) and armc-collect (the PERO / LightOnOCR outputs to one draft a page, armcDraftText).
// Nothing here writes a page: every apply is a dry run with --emit-written, so the served text is what the lane writes.
/**
 * The arms of #7853 (experiment file §Arms). Texts go to OUT/texts/<key>.<arm>.txt, outcomes to OUT/arms.jsonl.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/queue-routes-7853/arms.mjs lite
 *   ... arms.mjs corr | read4 | read1 [--concurrency=2]
 *   ... arms.mjs gpu-stage            the judged image bytes per engine -> OUT/gpu/img-{pero,lo}/<page_id>.jpg
 *   (the GPU task, gpu-task.sh, drafts them into OUT/gpu/pero.json and OUT/gpu/out/LO.jsonl)
 *   ... arms.mjs gpu-collect          one draft a page -> OUT/gpu/drafts/<page_id>.json
 *   ... arms.mjs gpu [--concurrency=2]
 *   ... arms.mjs retry-killed --arm=X  (a read the box killed, exit -9, is re-opened once; #7835 Amendment 1's rule)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { OUT, ROOT, J, jsonl, arg, ENV_FILE, AGY_MODEL, imageFor, gpuEngine } from './lib.mjs';
import { CORRECT_LANE, ARMC_LANE, GPU_TEMPLATE, armcDraftText } from '../../batch/cli-ocr-lane.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';

const CLI = path.join(ROOT, 'scripts/batch/cli-ocr.mjs');
const JOB = 'queue-routes-7853';
const TPL = path.join(OUT, 'fc-correct-prompt.txt');
const REASON = '#7853 eval arm (dry run, never applied)';
const T = (key, arm) => path.join(OUT, 'texts', `${key}.${arm}.txt`);
export const readT = (key, arm) => (fs.existsSync(T(key, arm)) ? fs.readFileSync(T(key, arm), 'utf8') : null);
const writeT = (key, arm, t) => { fs.mkdirSync(path.join(OUT, 'texts'), { recursive: true }); fs.writeFileSync(T(key, arm), t); };
const ARMS_LOG = path.join(OUT, 'arms.jsonl');
const sel = () => J('selected.json').selected;

function node(args, log) {
  return new Promise((resolve) => {
    const out = fs.openSync(log, 'a');
    const child = spawn(process.execPath, [`--env-file=${ENV_FILE}`, ...args], { stdio: ['ignore', out, out], env: { ...process.env, AGY_JOB: JOB } });
    child.on('close', (code) => { fs.closeSync(out); resolve(code); });
  });
}
function template() {
  if (!fs.existsSync(TPL)) { const r = spawnSync(process.execPath, [`--env-file=${ENV_FILE}`, path.join(ROOT, 'scripts/eval/flash-reread-5924/fc-prompt.mjs'), TPL], { stdio: 'inherit' }); if (r.status) throw new Error('fc-prompt.mjs refused'); }
  return TPL;
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
async function dryApply(dir, extra) {
  const emit = path.join(dir, 'emit.jsonl'); fs.rmSync(emit, { force: true });
  for (const f of fs.readdirSync(dir).filter((f) => /^apply-summary-dry/.test(f))) fs.rmSync(path.join(dir, f));
  const code = await node([CLI, 'apply', `--out=${dir}`, `--reason=${REASON}`, `--emit-written=${emit}`, ...extra], path.join(dir, 'apply.log'));
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

/** The stored text, once, from Mongo, before any arm (the reference every refused arm falls back to). */
async function lite() {
  const S = sel(), c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  let n = 0;
  for (const p of await c.db('bookstore').collection('pages').find({ id: { $in: S.map((s) => s.page_id) } }, { projection: { id: 1, 'ocr.data': 1, 'ocr.model': 1 } }).toArray()) {
    const s = S.find((x) => x.page_id === p.id); if (readT(s.key, 'lite') != null) continue;
    writeT(s.key, 'lite', p.ocr.data); n++;
    logRow({ key: s.key, arm: 'lite', model: p.ocr.model, written: false, why: 'stored text', calls: 0, pages: 0, hash: contentHash(p.ocr.data) });
  }
  await c.close();
  console.log(`lite: ${n} stored texts`);
}

/** Arm 1: the #7558 lane's own correction of the STORED lite draft, one page a call, apply dry with its real guards. */
async function corr() {
  const have = done('corr'), tpl = template();
  await pool(sel().filter((s) => !have.has(s.key)), async (s) => {
    const dir = path.join(OUT, 'corr', s.book_id); fs.mkdirSync(dir, { recursive: true });
    const ids = path.join(dir, 'page-ids.json'); fs.writeFileSync(ids, JSON.stringify([s.page_id]));
    const code = await node([CLI, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${AGY_MODEL}`, `--correct-prompt=${tpl}`, `--lane=${CORRECT_LANE}`, `--job=${JOB}`, '--stop-on-quota'], path.join(dir, 'read.log'));
    if (code === 3) { logRow({ key: s.key, arm: 'corr', quota: true }); return 'quota'; }
    const ap = await dryApply(dir, [`--mark-stale=${CORRECT_LANE}`]);
    const served = ap.emitted.get(s.page_id), m = meta(dir, s.page_id);
    writeT(s.key, 'corr-read', readText(dir, s.page_id));
    writeT(s.key, 'corr', served ?? readT(s.key, 'lite'));
    logRow({ key: s.key, arm: 'corr', read_exit: code, meta_exit: m?.exit ?? null, written: served != null, why: served != null ? 'written' : ap.skipped[s.page_id] ?? 'not read', ...callsOf(dir) });
    console.log(`  corr ${s.key}: ${served != null ? 'written' : ap.skipped[s.page_id] ?? 'not read'}`);
  });
}

/** Arms 3 and 4: a fresh read (the live first-read prompt) of the block 4 a call, or of the page alone; plain apply dry. */
async function plainRead(arm, perCall) {
  const have = done(arm);
  await pool(sel().filter((s) => !have.has(s.key)), async (s) => {
    const dir = path.join(OUT, arm, s.book_id); fs.mkdirSync(dir, { recursive: true });
    const pages = perCall > 1 ? s.block : [s.page_id];
    const ids = path.join(dir, 'page-ids.json'); fs.writeFileSync(ids, JSON.stringify(pages));
    const code = await node([CLI, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${AGY_MODEL}`, `--job=${JOB}`, '--stop-on-quota', ...(perCall > 1 ? [`--per-call=${perCall}`] : [])], path.join(dir, 'read.log'));
    if (code === 3) { logRow({ key: s.key, arm, quota: true }); return 'quota'; }
    const ap = await dryApply(dir, []);
    const m = meta(dir, s.page_id), raw = readText(dir, s.page_id);
    const served = ap.emitted.get(s.page_id) ?? null;
    if (raw) writeT(s.key, `${arm}-read`, raw);
    // a refused re-read leaves the stored lite text
    writeT(s.key, arm, served ?? readT(s.key, 'lite'));
    logRow({ key: s.key, arm, read_exit: code, meta_exit: m?.exit ?? null, wrapper: m?.wrapper ?? null, call_pages: m?.call_pages ?? 1, written: served != null, why: served != null ? 'written' : ap.skipped[s.page_id] ?? (m ? 'not in dry-run output' : 'not read'), image_sha256: m?.image_sha256 ?? null, ...callsOf(dir) });
    console.log(`  ${arm} ${s.key}: ${served != null ? 'written' : ap.skipped[s.page_id] ?? 'not read'}`);
  });
}

// ── Arm 2: GPU draft (PERO for Fraktur and mixed, LightOnOCR-3-1B for Antiqua) > agy correction, the arm-c lane's path ──
const GPU = path.join(OUT, 'gpu');
const ENG_DIR = { pero: 'img-pero', lightonocr: 'img-lo' };
/** The judged image bytes, one folder an engine (the drafts must be made from the bytes the corrector and judge see). */
async function gpuStage() {
  const t = {};
  for (const s of sel()) {
    const eng = gpuEngine(s.face), d = path.join(GPU, ENG_DIR[eng]); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${s.page_id}.jpg`), await imageFor(s.key, s.image));
    t[eng] = (t[eng] ?? 0) + 1;
  }
  console.log(`gpu-stage: ${JSON.stringify(t)}`);
}
/** armc-collect's rule: one draft a page (armcDraftText), with the hash of the image it was made from. */
function gpuCollect() {
  const D = path.join(GPU, 'drafts'); fs.mkdirSync(D, { recursive: true });
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  let n = 0, empty = 0;
  const pf = path.join(GPU, 'pero.json');
  if (fs.existsSync(pf)) {
    const j = JSON.parse(fs.readFileSync(pf, 'utf8'));
    if (j._engine?.exit !== 0) throw new Error(`PERO exited ${j._engine?.exit}`);
    for (const [id, r] of Object.entries(j).filter(([k]) => k !== '_engine')) { fs.writeFileSync(path.join(D, `${id}.json`), JSON.stringify({ text: armcDraftText(r.text), image_sha256: r.image_sha256, engine: j._engine })); n++; }
  }
  const lf = path.join(GPU, 'out', 'LO.jsonl');
  if (fs.existsSync(lf)) {
    const engine = { name: 'lightonocr', model: 'lightonai/LightOnOCR-3-1B', ...(fs.existsSync(`${lf}.engine.json`) && JSON.parse(fs.readFileSync(`${lf}.engine.json`, 'utf8'))), ...(fs.existsSync(`${lf}.run.json`) && { run: JSON.parse(fs.readFileSync(`${lf}.run.json`, 'utf8')) }) };
    for (const r of jsonl(lf).filter((x) => !x.error)) { fs.writeFileSync(path.join(D, `${r.page_id}.json`), JSON.stringify({ text: armcDraftText(r.text), image_sha256: sha(path.join(GPU, 'img-lo', `${r.page_id}.jpg`)), engine, finish: r.finish })); n++; }
  }
  for (const s of sel()) if (!fs.existsSync(path.join(D, `${s.page_id}.json`))) { fs.writeFileSync(path.join(D, `${s.page_id}.json`), JSON.stringify({ text: '', error: `${gpuEngine(s.face)} wrote no draft` })); empty++; }
  console.log(`gpu-collect: ${n} drafts, ${empty} pages with none`);
}
async function gpu() {
  const tplText = fs.readFileSync(path.join(ROOT, GPU_TEMPLATE.file), 'utf8');
  if (contentHash(tplText) !== GPU_TEMPLATE.hash) throw new Error('GPU template hash moved');
  const have = done('gpu');
  await pool(sel().filter((s) => !have.has(s.key)), async (s) => {
    const dir = path.join(OUT, 'gpu-arm', s.book_id), imgDir = path.join(dir, 'img'); fs.mkdirSync(imgDir, { recursive: true });
    const tpl = path.join(dir, `gpu-correct-prompt-${GPU_TEMPLATE.hash}.txt`); fs.writeFileSync(tpl, tplText);
    const d = JSON.parse(fs.readFileSync(path.join(GPU, 'drafts', `${s.page_id}.json`), 'utf8'));
    const lite = readT(s.key, 'lite');
    // armcRun's own refusals before the read: no draft, a draft under 30 word characters
    if (!d.text || d.text.replace(/\W/g, '').length < 30) { writeT(s.key, 'gpu', lite); logRow({ key: s.key, arm: 'gpu', engine: gpuEngine(s.face), written: false, why: `no draft: ${d.error || 'GPU draft under 30 word characters'}`, calls: 0, pages: 1 }); return; }
    writeT(s.key, 'gpu-draft', d.text);
    const engDir = path.join(GPU, ENG_DIR[gpuEngine(s.face)]);
    fs.copyFileSync(path.join(engDir, `${s.page_id}.jpg`), path.join(imgDir, `${s.page_id}.jpg`));
    const drafts = path.join(dir, 'drafts.json'), ids = path.join(dir, 'page-ids.json');
    fs.writeFileSync(drafts, JSON.stringify({ _engine: d.engine, [s.page_id]: { text: d.text, image_sha256: d.image_sha256 } }));
    fs.writeFileSync(ids, JSON.stringify([s.page_id]));
    const code = await node([CLI, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${AGY_MODEL}`, `--correct-prompt=${tpl}`, `--lane=${ARMC_LANE}`, `--gpu-draft=${drafts}`, `--image-dir=${imgDir}`, '--over-stored', `--job=${JOB}`, '--stop-on-quota'], path.join(dir, 'read.log'));
    if (code === 3) { logRow({ key: s.key, arm: 'gpu', quota: true }); return 'quota'; }
    const ap = await dryApply(dir, [`--only=${ids}`, `--mark-stale=${ARMC_LANE}`]);
    const served = ap.emitted.get(s.page_id), m = meta(dir, s.page_id);
    writeT(s.key, 'gpu-read', readText(dir, s.page_id));
    writeT(s.key, 'gpu', served ?? lite);
    logRow({ key: s.key, arm: 'gpu', engine: gpuEngine(s.face), read_exit: code, meta_exit: m?.exit ?? null, written: served != null, why: served != null ? 'written' : ap.skipped[s.page_id] ?? 'not read', diff_guard: ap.diff_guard, change_share: ap.change_shares?.[s.page_id] ?? null, template_hash: GPU_TEMPLATE.hash, ...callsOf(dir) });
    console.log(`  gpu ${s.key}: ${served != null ? 'written' : ap.skipped[s.page_id] ?? 'not read'}`);
  });
}

/** A read the box killed (meta exit -9) is not a route outcome: moved aside under killed/, the key re-opened once. */
function retryKilled() {
  const arm = arg('arm'), rows = jsonl(ARMS_LOG);
  const base = arm === 'gpu' ? 'gpu-arm' : arm;
  let n = 0;
  for (const s of sel()) {
    if (rows.some((r) => r.key === s.key && r.arm === arm && r.superseded)) continue;   // once
    const dir = path.join(OUT, base, s.book_id); if (!fs.existsSync(dir)) continue;
    const killed = fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')).filter((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).exit === -9).map((f) => f.replace(/\.meta\.json$/, ''));
    if (!killed.length) continue;
    const aside = path.join(dir, 'killed'); fs.mkdirSync(aside, { recursive: true });
    for (const id of killed) for (const ext of ['meta.json', 'txt', 'raw.txt', 'prompt.txt']) { const f = path.join(dir, `${id}.${ext}`); if (fs.existsSync(f)) fs.renameSync(f, path.join(aside, `${id}.${ext}`)); }
    logRow({ key: s.key, arm, superseded: true, retry: 1, killed_pages: killed, judged_page_killed: killed.includes(s.page_id) });
    n++;
  }
  console.log(`retry-killed ${arm}: ${n} keys re-opened`);
}

const stages = { lite, corr, read4: () => plainRead('read4', 4), read1: () => plainRead('read1', 1), 'gpu-stage': gpuStage, 'gpu-collect': gpuCollect, gpu, 'retry-killed': retryKilled };
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await stages[process.argv[2]]();
}
