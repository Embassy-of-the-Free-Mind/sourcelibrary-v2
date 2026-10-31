#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-ocr-lane.mjs firstReadMain / correctMain (the live lanes: `cli-ocr.mjs read` then
// `cli-ocr.mjs apply`, run here the same way but apply always DRY, with --emit-written, so the served text is the lanes'
// own), scripts/batch/cli-ocr.mjs `--per-call` / `--draft-file` (#7701 arm C: the block correction of drafts on disk),
// scripts/eval/correction-pass-7818/armw.mjs gpu-correct (the arm-c request and servedArmc) and lib.mjs servedCorrection
// (the correct-mode apply rules for a read apply refuses because its draft came from a file; checked 320/320 against
// the lane's own reads in #7818). Nothing here writes a page: every apply is a dry run.
/**
 * The arms of #7835 (experiment file §Arms). Texts go to OUT/texts/<key>.<arm>.txt, outcomes to OUT/<set>/arms.jsonl.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/fraktur-paired-7835/arms.mjs t1-a | t1-b | t1-c
 *   ... arms.mjs t2-b | t2-c
 *   ... arms.mjs t3-a | t3-b | t3-pero | t3-c
 *   [--concurrency=4]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { OUT, ROOT, J, jsonl, arg, ENV_FILE, AGY_MODEL, imageFor, correctionRead, servedCorrection, servedArmc, sha } from './lib.mjs';
import { FIRST_READ_LANE, FIRST_READ_CORRECT_LANE, CORRECT_LANE, GPU_TEMPLATE } from '../../batch/cli-ocr-lane.mjs';
import { bookLanguages } from '../../lib/reread-lane-gate.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';

const CLI = path.join(ROOT, 'scripts/batch/cli-ocr.mjs');
const JOB = 'fraktur-7835';
const TPL = path.join(OUT, 'fc-correct-prompt.txt');
const REASON = '#7835 eval arm (dry run, never applied)';
const T = (key, arm) => path.join(OUT, 'texts', `${key}.${arm}.txt`);
const readT = (key, arm) => (fs.existsSync(T(key, arm)) ? fs.readFileSync(T(key, arm), 'utf8') : null);
const writeT = (key, arm, t) => { fs.mkdirSync(path.join(OUT, 'texts'), { recursive: true }); fs.writeFileSync(T(key, arm), t); };

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
/** Calls this dir's reads made: block calls from calls.jsonl, one-page reads from their metas. */
function callsOf(dir) {
  const blocks = jsonl(path.join(dir, 'calls.jsonl'));
  const inBlock = new Set(blocks.flatMap((c) => c.page_ids || []));
  const single = fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter((m) => !m.call_id || !inBlock.has(m.page_id));
  return { calls: blocks.reduce((a, c) => a + (c.calls || 1), 0) + single.reduce((a, m) => a + (m.reused_from ? 0 : m.calls || 1), 0), pages: new Set([...inBlock, ...single.map((m) => m.page_id)]).size };
}
async function dryApply(dir, extra) {
  const emit = path.join(dir, 'emit.jsonl'); fs.rmSync(emit, { force: true });
  for (const f of fs.readdirSync(dir).filter((f) => /^apply-summary-dry/.test(f))) fs.rmSync(path.join(dir, f));
  const code = await node([CLI, 'apply', `--out=${dir}`, `--reason=${REASON}`, `--emit-written=${emit}`, ...extra], path.join(dir, 'apply.log'));
  const sum = fs.existsSync(path.join(dir, 'apply-summary-dry.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'apply-summary-dry.json'), 'utf8')) : {};
  return { code, emitted: new Map(jsonl(emit).map((r) => [r.page_id, r.text])), skipped: sum.skipped_pages || {} };
}
async function pool(items, fn) {
  const conc = Math.max(1, Math.min(6, Number(arg('concurrency') || 4)));
  let i = 0, stop = null;
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < items.length) { const it = items[i++]; const r = await fn(it); if (r === 'quota') stop = 'quota'; } }));
  if (stop) console.log('STOPPED: agy quota; rerun resumes');
}
const logRow = (set, row) => fs.appendFileSync(path.join(OUT, set, 'arms.jsonl'), JSON.stringify({ ...row, at: new Date().toISOString() }) + '\n');
const done = (set, arm) => new Set(jsonl(path.join(OUT, set, 'arms.jsonl')).filter((r) => r.arm === arm && !r.quota).map((r) => r.key));
let booksDb = null;
async function books(ids) {
  if (!booksDb) { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); booksDb = { c, m: new Map() }; }
  const miss = ids.filter((id) => !booksDb.m.has(id));
  if (miss.length) for (const b of await booksDb.c.db('bookstore').collection('books').find({ id: { $in: miss } }, { projection: { id: 1, language: 1, original_language: 1, languages: 1 } }).toArray()) booksDb.m.set(b.id, b);
  return booksDb.m;
}

/** A plain read of the page's block, 4 a call (the live first read), then the lane's apply, dry. */
async function plainRead(set, arm, applyExtra) {
  const S = J(`${set}/selected.json`).selected, have = done(set, arm);
  await pool(S.filter((s) => !have.has(s.key)), async (s) => {
    const dir = path.join(OUT, set, arm, s.book_id); fs.mkdirSync(dir, { recursive: true });
    const ids = path.join(dir, 'page-ids.json'); fs.writeFileSync(ids, JSON.stringify(s.block));
    const code = await node([CLI, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${AGY_MODEL}`, `--job=${JOB}`, '--stop-on-quota', '--per-call=4'], path.join(dir, 'read.log'));
    if (code === 3) { logRow(set, { key: s.key, arm, quota: true }); return 'quota'; }
    const ap = await dryApply(dir, applyExtra);
    const m = meta(dir, s.page_id), raw = readText(dir, s.page_id);
    let served = ap.emitted.get(s.page_id) ?? null, note = null;
    const why0 = ap.skipped[s.page_id];
    // T1: the live first-read lane may read the page between our read and the dry apply. The apply then refuses on the
    // page's state, not on the read: the read stands (flagged). T2: a refused re-read leaves the stored lite text.
    if (served == null && set === 't1' && /has OCR now|rewritten after this read/.test(why0 || '') && m?.exit === 0 && !m?.wrapper && raw.trim()) { served = raw.trim(); note = `read served as made: ${why0}`; }
    if (served == null && set === 't2') { served = readT(s.key, 'a'); note = `re-read refused (${why0 ?? 'not read'}): the stored lite text stands`; }
    if (raw) writeT(s.key, `${arm}-read`, raw);
    if (served != null) writeT(s.key, arm, served);
    // a plain read apply refuses leaves the page as it was: unread (T1) or the stored lite text (T2)
    const blockServed = Object.fromEntries(s.block.map((id) => [id, ap.emitted.get(id) ?? null]));
    fs.writeFileSync(path.join(dir, 'block-served.json'), JSON.stringify(blockServed));
    const written = ap.emitted.has(s.page_id);
    logRow(set, { key: s.key, arm, read_exit: code, meta_exit: m?.exit ?? null, wrapper: m?.wrapper ?? null, call_pages: m?.call_pages ?? 1, written, why: written ? 'written' : why0 ?? (m ? 'not in dry-run output' : 'not read'), note, image_sha256: m?.image_sha256 ?? null, ...callsOf(dir) });
    console.log(`  ${set}/${arm} ${s.key}: ${written ? 'written' : why0 ?? 'not read'}${note ? ` [${note}]` : ''}`);
  });
}

/** A correction (#7558 template, agy Flash-low with the image) of drafts on disk, `perCall` a call; served by servedCorrection. */
async function correctDrafts(set, arm, fromArm, perCall) {
  const S = J(`${set}/selected.json`).selected, have = done(set, arm), tpl = template();
  const bk = await books([...new Set(S.map((s) => s.book_id))]);
  await pool(S.filter((s) => !have.has(s.key)), async (s) => {
    const draft = readT(s.key, fromArm);
    if (draft == null) { logRow(set, { key: s.key, arm, written: false, why: `no ${fromArm} text to correct`, calls: 0, pages: 0 }); return; }
    const dir = path.join(OUT, set, arm, s.book_id); fs.mkdirSync(dir, { recursive: true });
    let pages = [s.page_id], drafts = { [s.page_id]: draft };
    if (perCall > 1) {
      const bs = JSON.parse(fs.readFileSync(path.join(OUT, set, fromArm, s.book_id, 'block-served.json'), 'utf8'));
      pages = s.block.filter((id) => bs[id] != null); drafts = Object.fromEntries(pages.map((id) => [id, bs[id]]));
    }
    const ids = path.join(dir, 'page-ids.json'), df = path.join(dir, 'drafts.json');
    fs.writeFileSync(ids, JSON.stringify(pages)); fs.writeFileSync(df, JSON.stringify(drafts));
    const lane = set === 't2' ? CORRECT_LANE : FIRST_READ_CORRECT_LANE;
    const code = await node([CLI, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${AGY_MODEL}`, `--correct-prompt=${tpl}`, `--lane=${lane}`, `--draft-file=${df}`, `--job=${JOB}`, '--stop-on-quota', ...(perCall > 1 ? [`--per-call=${perCall}`] : [])], path.join(dir, 'read.log'));
    if (code === 3) { logRow(set, { key: s.key, arm, quota: true }); return 'quota'; }
    const m = meta(dir, s.page_id);
    const read = { exit: m ? m.exit : 1, wrapper: m?.wrapper ?? null, text: readText(dir, s.page_id) };
    const sv = servedCorrection(read, draft, { languages: bookLanguages(bk.get(s.book_id)) });
    writeT(s.key, `${arm}-read`, read.text); writeT(s.key, arm, sv.served);
    logRow(set, { key: s.key, arm, read_exit: code, meta_exit: m?.exit ?? null, call_pages: m?.call_pages ?? 1, outcome: sv.outcome, why: sv.why, written: sv.outcome === 'written', ...callsOf(dir) });
    console.log(`  ${set}/${arm} ${s.key}: ${sv.outcome} (${sv.why})`);
  });
}

/** T2 (b): the #7558 lane's own correction of the STORED lite draft, one page a call, apply dry (its real guards). */
async function t2b() {
  const S = J('t2/selected.json').selected, have = done('t2', 'b'), tpl = template();
  await pool(S.filter((s) => !have.has(s.key)), async (s) => {
    const dir = path.join(OUT, 't2', 'b', s.book_id); fs.mkdirSync(dir, { recursive: true });
    const ids = path.join(dir, 'page-ids.json'); fs.writeFileSync(ids, JSON.stringify([s.page_id]));
    const code = await node([CLI, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${AGY_MODEL}`, `--correct-prompt=${tpl}`, `--lane=${CORRECT_LANE}`, `--job=${JOB}`, '--stop-on-quota'], path.join(dir, 'read.log'));
    if (code === 3) { logRow('t2', { key: s.key, arm: 'b', quota: true }); return 'quota'; }
    const ap = await dryApply(dir, [`--mark-stale=${CORRECT_LANE}`]);
    const served = ap.emitted.get(s.page_id);
    writeT(s.key, 'b-read', readText(dir, s.page_id));
    writeT(s.key, 'b', served ?? readT(s.key, 'a'));
    logRow('t2', { key: s.key, arm: 'b', read_exit: code, written: served != null, why: served != null ? 'written' : ap.skipped[s.page_id] ?? 'not read', ...callsOf(dir) });
    console.log(`  t2/b ${s.key}: ${served != null ? 'written' : ap.skipped[s.page_id] ?? 'not read'}`);
  });
}

/** T2 (a) is the stored text; written once from Mongo before any arm runs. T3's lite is written by frame.mjs t3-draw. */
async function t2a() {
  const S = J('t2/selected.json').selected;
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  for (const p of await c.db('bookstore').collection('pages').find({ id: { $in: S.map((s) => s.page_id) } }, { projection: { id: 1, 'ocr.data': 1, 'ocr.model': 1 } }).toArray()) writeT(`T2-${p.id}`, 'a', p.ocr.data);
  await c.close();
  console.log(`t2-a: ${S.length} stored texts`);
}

/** T3, PERO: the images the judge sees go to gex45; pero-draft.py (the model's GPU config if the card is free, else CPU). */
async function t3Pero() {
  const S = J('t3/selected.json').selected, dir = path.join(OUT, 't3', 'pero'), img = path.join(dir, 'img');
  fs.mkdirSync(img, { recursive: true });
  for (const s of S) fs.writeFileSync(path.join(img, `${s.page_id}.jpg`), await imageFor(s.key, s.image));
  const R = '/root/jobs/fraktur-7835/t3';
  const sh = (cmd) => spawnSync('ssh', ['-o', 'ConnectTimeout=20', 'root@65.108.136.89', cmd], { encoding: 'utf8', maxBuffer: 1 << 26 });
  sh(`mkdir -p ${R}/img`);
  spawnSync('scp', ['-q', '-r', `${img}/.`, `root@65.108.136.89:${R}/img/`]);
  const util = sh("nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits").stdout.trim();
  const [u, mem] = util.split(',').map(Number);
  const device = u < 10 && mem < 2000 ? 'gpu' : 'cpu';
  console.log(`gex45 card: ${util} -> --device=${device}`);
  const r = sh(`cd /root/sourcelibrary && python3 scripts/batch/pero-draft.py ${R}/img ${R}/pero-drafts.json --device=${device} > ${R}/pero.log 2>&1; echo exit $?; tail -3 ${R}/pero.log`);
  console.log(r.stdout, r.stderr);
  spawnSync('scp', ['-q', `root@65.108.136.89:${R}/pero-drafts.json`, path.join(dir, 'pero-drafts.json')]);
  const d = JSON.parse(fs.readFileSync(path.join(dir, 'pero-drafts.json'), 'utf8'));
  let n = 0, short = 0, mism = 0;
  for (const s of S) {
    const x = d[s.page_id]; if (!x) continue;
    if (x.image_sha256 !== sha(fs.readFileSync(path.join(img, `${s.page_id}.jpg`)))) { mism++; continue; }
    if (String(x.text || '').replace(/\W/g, '').length < 30) { short++; continue; }
    writeT(s.key, 'pero', x.text); n++;
  }
  fs.writeFileSync(path.join(dir, 'collect.json'), JSON.stringify({ device, engine: d._engine, drafts: n, under_30_word_chars: short, image_mismatch: mism }, null, 1));
  console.log(`t3-pero: ${n} drafts (${short} short, ${mism} image mismatches) on ${device}`);
}

/** T3 (c): arm c — the PERO draft corrected by agy Flash-low on the lane's GPU template, served by servedArmc over the stored lite. */
async function t3c() {
  const template = fs.readFileSync(path.join(ROOT, GPU_TEMPLATE.file), 'utf8');
  if (contentHash(template) !== GPU_TEMPLATE.hash) throw new Error('GPU template hash moved');
  const S = J('t3/selected.json').selected, have = done('t3', 'c');
  const bk = await books([...new Set(S.map((s) => s.book_id))]);
  await pool(S.filter((s) => !have.has(s.key)), async (s) => {
    const pero = readT(s.key, 'pero'), lite = readT(s.key, 'lite');
    if (pero == null) { logRow('t3', { key: s.key, arm: 'c', written: false, why: 'no PERO draft', calls: 0, pages: 0 }); return; }
    const ws = path.join(OUT, 't3', 'c', 'ws', s.page_id); fs.rmSync(ws, { recursive: true, force: true });
    const r = await correctionRead({ template, draft: pero, imageBuf: await imageFor(s.key, s.image), ws, key: s.page_id, model: AGY_MODEL });
    if (r.quota) { logRow('t3', { key: s.key, arm: 'c', quota: true }); return 'quota'; }
    const b = bk.get(s.book_id);
    const sv = servedArmc(r, lite, { languages: bookLanguages(b), language: b?.language });
    writeT(s.key, 'c-read', r.text); writeT(s.key, 'c', sv.served);
    fs.rmSync(ws, { recursive: true, force: true });
    logRow('t3', { key: s.key, arm: 'c', outcome: sv.outcome, why: sv.why, written: sv.outcome === 'written', put_back: sv.put_back ?? null, calls: r.calls, pages: 1, template_hash: GPU_TEMPLATE.hash });
    console.log(`  t3/c ${s.key}: ${sv.outcome} (${sv.why})`);
  });
}

const stages = {
  't1-a': () => plainRead('t1', 'a', [`--lane=${FIRST_READ_LANE}`, '--first-read-only', '--print-only']),   // FIRST_READ_LANE: the stamp the write-back uses
  't1-b': () => correctDrafts('t1', 'b', 'a', 4),
  't1-c': () => correctDrafts('t1', 'c', 'a', 1),
  't2-a': t2a, 't2-b': t2b,
  't2-c': () => plainRead('t2', 'c', []),
  't3-a': () => plainRead('t3', 'a', ['--print-only']),
  't3-b': () => correctDrafts('t3', 'b', 'a', 4),
  't3-pero': t3Pero, 't3-c': t3c,
};
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();
if (booksDb) await booksDb.c.close();
