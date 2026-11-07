#!/usr/bin/env node
// PRIOR ART: scripts/eval/queue-routes-7853/arms.mjs (corr, plainRead, gpu, callsOf, dryApply; its OUT, keys and one-page
// gpu arm are fixed at module level) and scripts/batch/cli-ocr-lane.mjs rereadReadArgs/rereadApplyArgs + armcRun (the argv
// restated with this panel's lane name: those builders hard-code their own lane). New here: PERO blocks of 4, translation
// arms, and failed reads kept as failed instead of falling back to the stored text.
/**
 * The panel's reads, in batches, so the stop rule can end an arm. Nothing here writes a page: every apply is dry.
 *   node --env-file=... arms.mjs pero-stage --cell=latin      images of every block -> OUT/latin/gpu/img
 *   node --env-file=... arms.mjs pero-collect --cell=latin    one draft a page -> OUT/latin/gpu/drafts/<id>.json
 *   node --env-file=... arms.mjs run --cell=C --arm=A --upto=N [--conc=3] [--rep]
 * Outcomes append to OUT/<cell>/arms.jsonl: {key, arm, rep, written, cat, why, call_pages, call_position, calls, tokens, ...}.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, ENV_FILE, AGY_MODEL, PANEL_LANE, OCR_CHECKED, arg, flag, cellOf, selected, jsonl, pool, readText, writeText, costOf, category } from './lib.mjs';
import { GPU_TEMPLATE, armcDraftText } from '../../batch/cli-ocr-lane.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';

const CLI = path.join(ROOT, 'scripts/batch/cli-ocr.mjs');
const CLI_TR = path.join(ROOT, 'scripts/batch/cli-translate.mjs');
const CLAUDE_TR = path.join(ROOT, 'scripts/batch/claude-translate.mjs');
const JOB = 'route-panel-1-7263';
const REASON = '#7263 panel arm (dry run)';
const cell = cellOf(arg('cell'));
const LOG = path.join(cell.dir, 'arms.jsonl');
const logRow = (r) => { fs.mkdirSync(cell.dir, { recursive: true }); fs.appendFileSync(LOG, JSON.stringify({ ...r, at: new Date().toISOString() }) + '\n'); };
const GPU = path.join(cell.dir, 'gpu');

function node(args, log, env = {}) {
  return new Promise((resolve) => {
    const out = fs.openSync(log, 'a');
    const child = spawn(process.execPath, [`--env-file=${ENV_FILE}`, ...args], { stdio: ['ignore', out, out], env: { ...process.env, AGY_JOB: JOB, CLI_JOB_NAME: JOB, AGY_HOME: cell.agy_home, ...env } });
    child.on('close', (code) => { fs.closeSync(out); resolve(code); });
  });
}
const fcTemplate = () => {
  const f = path.join(cell.dir, 'fc-correct-prompt.txt');
  if (!fs.existsSync(f)) { const r = spawnSync(process.execPath, [`--env-file=${ENV_FILE}`, path.join(ROOT, 'scripts/eval/flash-reread-5924/fc-prompt.mjs'), f], { stdio: 'inherit' }); if (r.status) throw new Error('fc-prompt.mjs refused'); }
  return f;
};
const meta = (dir, id) => { const f = path.join(dir, `${id}.meta.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
const rawRead = (dir, id) => { const f = path.join(dir, `${id}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };
async function ocrArm(armId, A, s, rep) {
  const dir = path.join(cell.dir, rep ? `${armId}-rep` : armId, s.book_id); fs.mkdirSync(dir, { recursive: true });
  const stored = readText(cell, s.key, 'stored');
  let pages = A.per_call > 1 ? s.block : [s.page_id];
  const common = [`--out=${dir}`, `--model=${AGY_MODEL}`, `--job=${JOB}`, '--stop-on-quota', ...(rep ? ['--fresh'] : [])];
  let extra = [], applyExtra = [];
  if (A.kind === 'read') {
    extra = [`--lane=${PANEL_LANE}`, `--per-call=${A.per_call}`];
    applyExtra = [`--lane=${PANEL_LANE}`, '--print-only', `--mark-stale=${PANEL_LANE}`];
  } else if (A.kind === 'correct') {
    extra = [`--correct-prompt=${fcTemplate()}`, `--lane=${PANEL_LANE}`];
    applyExtra = [`--mark-stale=${PANEL_LANE}`];
  } else if (A.kind === 'gpu') {
    const tplText = fs.readFileSync(path.join(ROOT, GPU_TEMPLATE.file), 'utf8');
    if (contentHash(tplText) !== GPU_TEMPLATE.hash) throw new Error('GPU template hash moved');
    const tpl = path.join(dir, `gpu-correct-prompt-${GPU_TEMPLATE.hash}.txt`); fs.writeFileSync(tpl, tplText);
    const imgDir = path.join(dir, 'img'); fs.mkdirSync(imgDir, { recursive: true });
    const drafts = { };
    for (const id of s.block) {
      const f = path.join(GPU, 'drafts', `${id}.json`);
      const d = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { text: '' };
      if (!d.text || d.text.replace(/\W/g, '').length < 30) continue;   // armcRun's refusal: a draft under 30 word characters
      drafts[id] = { text: d.text, image_sha256: d.image_sha256 }; drafts._engine = d.engine;
      fs.copyFileSync(path.join(GPU, 'img', `${id}.jpg`), path.join(imgDir, `${id}.jpg`));
    }
    if (!drafts[s.page_id]) { logRow({ key: s.key, arm: armId, rep, written: false, cat: 'failed', why: 'no GPU draft', calls: 0, tokens: 0 }); return null; }
    writeText(cell, s.key, `${armId}-draft`, drafts[s.page_id].text);
    pages = s.block.filter((id) => drafts[id]);
    const df = path.join(dir, 'drafts.json'); fs.writeFileSync(df, JSON.stringify(drafts));
    extra = [`--correct-prompt=${tpl}`, `--lane=${PANEL_LANE}`, `--gpu-draft=${df}`, `--image-dir=${imgDir}`, '--over-stored', `--per-call=${A.per_call}`];
    applyExtra = [`--mark-stale=${PANEL_LANE}`];
  }
  const ids = path.join(dir, 'page-ids.json'); fs.writeFileSync(ids, JSON.stringify(pages));
  const t0 = Date.now();
  const code = await node([CLI, 'read', `--page-ids-file=${ids}`, ...common, ...extra], path.join(dir, 'read.log'));
  if (code === 3) { logRow({ key: s.key, arm: armId, rep, quota: true }); return 'stop'; }
  const only = path.join(dir, 'only.json'); fs.writeFileSync(only, JSON.stringify([s.page_id]));
  const emit = path.join(dir, 'emit.jsonl'); fs.rmSync(emit, { force: true });
  for (const f of fs.readdirSync(dir).filter((f) => /^apply-summary-dry/.test(f))) fs.rmSync(path.join(dir, f));
  const ap = await node([CLI, 'apply', `--out=${dir}`, `--only=${only}`, `--reason=${REASON}`, `--emit-written=${emit}`, ...applyExtra], path.join(dir, 'apply.log'));
  const sum = fs.existsSync(path.join(dir, 'apply-summary-dry.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'apply-summary-dry.json'), 'utf8')) : {};
  const served = jsonl(emit).find((r) => r.page_id === s.page_id)?.text ?? null;
  const m = meta(dir, s.page_id), raw = rawRead(dir, s.page_id);
  const why = served != null ? 'written' : sum.skipped_pages?.[s.page_id] ?? (/^\s*UNCHANGED/i.test(raw) ? 'UNCHANGED' : m ? 'not in dry-run output' : 'not read');
  const label = rep ? `${armId}#rep` : armId;
  if (raw) writeText(cell, s.key, `${label}-read`, raw);
  let cat = 'ok';
  if (served != null) writeText(cell, s.key, label, served);
  else { cat = category(`${why} ${/^\s*CONTAIN/i.test(raw) ? 'CONTAIN' : ''}`); if (cat === 'unchanged') writeText(cell, s.key, label, stored); }
  logRow({ key: s.key, arm: armId, rep, read_exit: code, apply_exit: ap, meta_exit: m?.exit ?? null, wrapper: m?.wrapper ?? null, call_pages: m?.call_pages ?? 1, call_position: m?.call_position ?? null, block_pos: s.block_pos, written: served != null, cat, why: String(why).slice(0, 200), secs: Math.round((Date.now() - t0) / 1000), image_sha256: m?.image_sha256 ?? null, ...costOf(dir) });
  console.log(`  ${cell.name}/${label} ${s.key}: ${cat} ${served != null ? '' : String(why).slice(0, 80)}`);
  return null;
}

/** A dry apply of one page: a directory holding only that page's files, because cli-translate's apply has no --only. */
async function trDryApply(dir, id) {
  const ad = path.join(dir, 'apply-one'); fs.rmSync(ad, { recursive: true, force: true }); fs.mkdirSync(ad, { recursive: true });
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`${id}.`))) fs.copyFileSync(path.join(dir, f), path.join(ad, f));
  const pr = path.join(dir, 'prompts'); if (fs.existsSync(pr)) fs.cpSync(pr, path.join(ad, 'prompts'), { recursive: true });
  const m = meta(ad, id);
  if (m?.prompt_sent_file && fs.existsSync(path.join(dir, m.prompt_sent_file))) { fs.mkdirSync(path.dirname(path.join(ad, m.prompt_sent_file)), { recursive: true }); fs.copyFileSync(path.join(dir, m.prompt_sent_file), path.join(ad, m.prompt_sent_file)); }
  const log = path.join(ad, 'apply.log');
  await node([CLI_TR, 'apply', `--out=${ad}`, `--reason=${REASON}`], log);
  const t = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  return { ok: /would write p\./.test(t), why: /skip p\.\S*: (.*)/.exec(t)?.[1] ?? (m ? 'no apply verdict' : 'not read') };
}
async function trArm(armId, A, s, rep) {
  const dir = path.join(cell.dir, rep ? `${armId}-rep` : armId, s.book_id); fs.mkdirSync(dir, { recursive: true });
  const pages = A.per_call > 1 ? s.block : [s.page_id];
  const ids = path.join(dir, 'page-ids.json'); fs.writeFileSync(ids, JSON.stringify(pages));
  const argv = A.kind === 'tr1'
    ? [CLI_TR, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${AGY_MODEL}`, `--ocr-checked=${OCR_CHECKED}`, ...(rep ? ['--fresh'] : [])]
    : [CLAUDE_TR, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, '--cli=agy', '--per-call=4', `--model=${AGY_MODEL}`, `--job=${JOB}`, `--ocr-checked=${OCR_CHECKED}`, ...(rep ? ['--fresh'] : [])];
  const t0 = Date.now();
  const code = await node(argv, path.join(dir, 'read.log'));
  if (code === 3) { logRow({ key: s.key, arm: armId, rep, quota: true }); return 'stop'; }
  const ap = await trDryApply(dir, s.page_id);
  const m = meta(dir, s.page_id), raw = rawRead(dir, s.page_id);
  const label = rep ? `${armId}#rep` : armId;
  if (ap.ok) writeText(cell, s.key, label, raw);
  const cat = ap.ok ? 'ok' : category(ap.why);
  logRow({ key: s.key, arm: armId, rep, read_exit: code, meta_exit: m?.exit ?? null, call_pages: m?.call_pages ?? (pages.length === 1 ? 1 : null), call_position: m?.call_position ?? null, block_pos: s.block_pos, written: ap.ok, cat, why: ap.ok ? 'written' : String(ap.why).slice(0, 200), secs: Math.round((Date.now() - t0) / 1000), ...costOf(dir) });
  console.log(`  ${cell.name}/${label} ${s.key}: ${cat} ${ap.ok ? '' : String(ap.why).slice(0, 80)}`);
  return null;
}

async function run() {
  const armId = arg('arm'), A = cell.arms[armId], rep = flag('rep'), upto = Number(arg('upto'));
  if (!A || !upto) throw new Error('--arm and --upto are required');
  const last = new Map(); for (const r of jsonl(LOG).filter((x) => x.arm === armId && !!x.rep === rep && !x.quota)) last.set(r.key, r);
  const todo = selected(cell).slice(0, upto).filter((s) => !last.has(s.key) || last.get(s.key).superseded);
  console.log(`${cell.name}/${armId}${rep ? '#rep' : ''}: ${todo.length} pages to read, up to page ${upto}`);
  const fn = A.kind.startsWith('tr') ? trArm : ocrArm;
  const stopped = await pool(todo, Math.max(1, Math.min(4, Number(arg('conc') || 3))), (s) => fn(armId, A, s, rep));
  if (stopped) { console.log('STOPPED: agy quota; rerun resumes'); process.exitCode = 3; }
}

async function peroStage() {
  const d = path.join(GPU, 'img'); fs.mkdirSync(d, { recursive: true });
  const bad = [];
  const jobs = selected(cell).flatMap((s) => s.block.map((id, k) => ({ id, url: s.block_images[k], key: s.key })));
  await pool(jobs, 6, async (j) => {
    const f = path.join(d, `${j.id}.jpg`); if (fs.existsSync(f)) return;
    for (let a = 0; a < 3; a++) {
      try { const r = await fetch(j.url, { headers: { 'User-Agent': 'SourceLibrary-eval/7263 (https://sourcelibrary.org)' } }); if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length >= 2000) { fs.writeFileSync(f, b); return; } } } catch { /* retry */ }
      await new Promise((w) => setTimeout(w, 2000 * (a + 1)));
    }
    bad.push(j);
  });
  fs.writeFileSync(path.join(GPU, 'stage-bad.json'), JSON.stringify(bad));
  console.log(`pero-stage: ${jobs.length} block pages, ${fs.readdirSync(d).length} on disk, ${bad.length} not fetched`);
}
function peroCollect() {
  const D = path.join(GPU, 'drafts'); fs.mkdirSync(D, { recursive: true });
  const j = JSON.parse(fs.readFileSync(path.join(GPU, 'pero.json'), 'utf8'));
  if (j._engine?.exit !== 0) throw new Error(`PERO exited ${j._engine?.exit}`);
  let n = 0; for (const [id, r] of Object.entries(j).filter(([k]) => k !== '_engine')) { fs.writeFileSync(path.join(D, `${id}.json`), JSON.stringify({ text: armcDraftText(r.text), image_sha256: r.image_sha256, engine: j._engine })); n++; }
  console.log(`pero-collect: ${n} drafts`);
}
/** Amendment 1: a read the box killed (exit -9) is no route outcome. Its files move aside and the key is re-opened, once. */
function retryKilled() {
  const rows = jsonl(LOG); let n = 0;
  const last = new Map(); for (const r of rows.filter((x) => !x.quota)) last.set(`${r.arm}:${!!r.rep}:${r.key}`, r);
  for (const r of last.values()) {
    if (r.superseded || !/exit -9/.test(r.why || '') ) continue;
    if (rows.some((x) => x.superseded && x.arm === r.arm && !!x.rep === !!r.rep && x.key === r.key)) continue;   // once
    const s = selected(cell).find((x) => x.key === r.key);
    const dir = path.join(cell.dir, r.rep ? `${r.arm}-rep` : r.arm, s.book_id), aside = path.join(dir, 'killed'); fs.mkdirSync(aside, { recursive: true });
    const killed = fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')).filter((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).exit === -9).map((f) => f.replace(/\.meta\.json$/, ''));
    for (const id of killed) for (const ext of ['meta.json', 'txt', 'raw.txt', 'prompt.txt']) { const f = path.join(dir, `${id}.${ext}`); if (fs.existsSync(f)) fs.renameSync(f, path.join(aside, `${id}.${ext}`)); }
    logRow({ key: r.key, arm: r.arm, rep: !!r.rep, superseded: true, killed_pages: killed.length }); n++;
  }
  console.log(`${cell.name} retry-killed: ${n} keys re-opened`);
}
const stages = { run, 'retry-killed': retryKilled, 'pero-stage': peroStage, 'pero-collect': peroCollect };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();
