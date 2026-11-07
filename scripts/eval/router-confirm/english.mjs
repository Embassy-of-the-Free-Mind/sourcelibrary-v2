#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-corpus-audit/ — JUDGE-PROMPT.md + IMAGE-ADDENDUM.md (the judge, verbatim), draw.mjs
// (the swap / drop / repeat controls, restated: its controls come from a corpus draw's extras and it cannot take this
// harness's pages) and score.mjs's GATE (copied: a run whose controls fail is not reported). The #7968 run
// (draw-from-7866.mjs, analyze-7866-join.mjs) is the same judge over STORED English only; it translates nothing.
// scripts/batch/claude-translate.mjs `read --cli=agy --per-call=4` — the Latin translation lane's own reader
// (translation-routing-table.json row latin-cli-agy4, cli-translate-lane.mjs), run with its eval-only --ocr-file.
// confirm.mjs (this folder) — the drawn pages and the transcription arms this stage translates.
/**
 * V4 English stage (#7263, Derek's inbox note 2026-11-03): on the SAME pages as confirm.mjs's transcription arms, what
 * English does each option give a reader?
 *
 *   E1  the stored English, as served
 *   E2  the served Flash-Lite transcription re-translated            (translate-only: isolates the translator)
 *   E3  English from arm B's served transcription                     (correct + translate)
 *   E4  English from arm C's served transcription                     (re-read + translate)
 *
 *   node --env-file=... scripts/eval/router-confirm/english.mjs translate --cell=latin-lite/print [--concurrency=2]
 *   ... english.mjs judge --cell=... [--concurrency=4] [--size=10]
 *   ... english.mjs analyze --cell=...
 *
 * TRANSLATOR: the Latin lane's route today, latin-cli-agy4 (gemini-3.8-flash-low through agy, the block reader, 4 pages a
 * call, the live translation prompt, seeded with the stored English of the page before the block). Each page is
 * translated as one block with its 3 neighbours (confirm.mjs's block): E3 overrides the page's text with B's, E4 every
 * block page's text with C's dry-apply output. `--fresh` (no kept read reused), CANDIDATE_READS=off (no read kept in R2),
 * and the readonly-mongo preload: nothing is written anywhere but this run's folder. A page whose B or C text is the
 * stored text (a refused correction or re-read) gets E2's English: the same source, so no second call.
 * A failed read (no English between the markers, a CLI failure) serves the stored English, as a lane that wrote nothing
 * would; counted.
 *
 * JUDGE: Opus (`claude -p --model opus`, subscription), JUDGE-PROMPT.md + IMAGE-ADDENDUM.md verbatim, packets of
 * --size items, each with its page image, blind (opaque ids, items of all arms and controls shuffled together). Each
 * verdict: fidelity against ITS OWN transcription, and ocr_misread / ocr_wrong_leaf against the image. Identical
 * (transcription, English) pairs on a page are judged once. Controls as draw.mjs plants them, 15 of each (score.mjs's
 * gate needs 10): swap (another drawn page's E2 English), drop (the middle ~35% of an E2 English removed), repeat (a
 * main item under a new id, never in its original's packet). The gate (score.mjs GATE) decides whether the run reports.
 *
 * END TO END: a page is wrong for a reader when its English has a major defect OR the judge saw a misread or wrong leaf.
 */
import './readonly-mongo.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { makeRng, resetSeed, bootstrapCI, binomTwoSided } from '../lib/paired-stats.mjs';
import { paceCheck } from '../correction-pass-7818/lib.mjs';
import { planArms, DEFAULT_SEED } from './confirm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const TCA = path.join(ROOT, 'scripts/eval/translation-corpus-audit');
const PRELOAD = path.join(HERE, 'readonly-mongo.mjs');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const CELL = arg('cell');
const SLUG = String(CELL || '').replace(/[^a-z0-9]+/gi, '-');
const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'router-confirm', SLUG));
const EN = path.join(OUT, 'english');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const shuffle = (xs, rnd) => { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const readT = (key, arm) => { const f = path.join(OUT, 'texts', `${key}.${arm}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
export const TR_MODEL = 'gemini-3.8-flash-low';   // CLI_TRANSLATE_LANES['gemini-3.8-flash+agy-cli'].model
export const TR_PER_CALL = 4;                       // translation-routing-table.json latin-cli-agy4 per_call
export const GATE = Object.freeze({ swap_caught: 14 / 15, drop_flagged: 13 / 15, repeat_within1: 14 / 15, min_n: 10 });   // score.mjs
export const N_CONTROLS = 15;
const E_ARMS = ['E1', 'E2', 'E3', 'E4'];
const LOG = () => path.join(EN, 'translate.jsonl');

// ── translate ──
function node(args, log, env) {
  return new Promise((resolve) => {
    const out = fs.openSync(log, 'a');
    const child = spawn(process.execPath, [`--import=${PRELOAD}`, ...args], { stdio: ['ignore', out, out], env: { ...process.env, CANDIDATE_READS: 'off', AGY_JOB: `router-confirm-en-${SLUG}`, ...env } });
    child.on('close', (code) => { fs.closeSync(out); resolve(code); });
  });
}
const emitted = (arm, bookId) => new Map(jsonl(path.join(OUT, arm, bookId, 'emit.jsonl')).map((r) => [r.page_id, r.text]));

/** One block through the lane's reader, with `override` ({page_id: text}) in place of the stored OCR. → target's English or null. */
async function translateBlock(earm, s, override) {
  const dir = path.join(EN, earm, s.book_id); fs.mkdirSync(dir, { recursive: true });
  const ids = path.join(dir, 'page-ids.json'); fs.writeFileSync(ids, JSON.stringify(s.block));
  const extra = [];
  if (Object.keys(override).length) { const f = path.join(dir, 'ocr-override.json'); fs.writeFileSync(f, JSON.stringify(override)); extra.push(`--ocr-file=${f}`); }
  const code = await node([path.join(ROOT, 'scripts/batch/claude-translate.mjs'), 'read', '--cli=agy', `--per-call=${TR_PER_CALL}`, `--page-ids-file=${ids}`, `--out=${dir}`,
    `--model=${TR_MODEL}`, `--job=router-confirm-en-${SLUG}`, '--fresh', ...extra,
    '--ocr-checked=#7263 V4 eval: the stored Flash-Lite text is itself an arm under test, judged against the page image by Opus in this run; nothing is written'], path.join(dir, 'read.log'));
  if (code === 3) return { quota: true };
  const txt = path.join(dir, `${s.page_id}.txt`), meta = path.join(dir, `${s.page_id}.meta.json`);
  let m = null; try { m = JSON.parse(fs.readFileSync(meta, 'utf8')); } catch { /* not read */ }
  const t = fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8').trim() : '';
  const calls = new Set(fs.existsSync(path.join(dir, 'raw')) ? fs.readdirSync(path.join(dir, 'raw')) : []).size;
  return { code, text: m?.exit === 0 && t.length > 5 ? t : null, why: m ? (m.exit === 0 ? (t.length > 5 ? 'read' : 'empty read') : `exit ${m.exit}`) : 'not read', calls };
}

async function translate() {
  const P = J('plan.json');
  const arms = planArms(P).map((a) => a.arm);
  if (!arms.includes('B') || !arms.includes('C')) throw new Error('english.mjs needs a --routes plan with arms B and C');
  fs.mkdirSync(EN, { recursive: true });
  const stored = await (async () => { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); try {
    return new Map((await c.db('bookstore').collection('pages').find({ id: { $in: P.selected.map((s) => s.page_id) } }, { projection: { id: 1, 'translation.data': 1, 'translation.model': 1 } }).toArray()).map((p) => [p.id, p.translation || null]));
  } finally { await c.close(); } })();
  const done = new Set(jsonl(LOG()).filter((r) => !r.quota).map((r) => `${r.key}:${r.earm}`));
  const log = (r) => fs.appendFileSync(LOG(), JSON.stringify({ ...r, at: new Date().toISOString() }) + '\n');
  const conc = Math.max(1, Math.min(2, Number(arg('concurrency') || 2)));
  let i = 0, stop = null;
  const work = async (s) => {
    const lite = readT(s.key, 'lite'), tr = stored.get(s.page_id);
    const put = (earm, text, row) => { if (text != null) fs.writeFileSync(path.join(EN, `${s.key}.${earm}.txt`), text); log({ key: s.key, earm, has_text: text != null, ...row }); };
    if (!done.has(`${s.key}:E1`)) put('E1', tr?.data?.trim() || null, { source_arm: 'lite', model: tr?.model ?? null, why: tr?.data ? 'stored' : 'no stored English', calls: 0 });
    let e2 = fs.existsSync(path.join(EN, `${s.key}.E2.txt`)) ? fs.readFileSync(path.join(EN, `${s.key}.E2.txt`), 'utf8') : null;
    if (!done.has(`${s.key}:E2`)) {
      const r = await translateBlock('E2', s, {});
      if (r.quota) return 'quota';
      e2 = r.text; put('E2', r.text ?? (tr?.data?.trim() || null), { source_arm: 'lite', why: r.text ? 'read' : `${r.why}: stored English served`, translated: !!r.text, calls: r.calls });
    }
    for (const [earm, arm] of [['E3', 'B'], ['E4', 'C']]) {
      if (done.has(`${s.key}:${earm}`)) continue;
      const src = readT(s.key, arm);
      if (src == null || src === lite) { put(earm, e2 ?? (tr?.data?.trim() || null), { source_arm: 'lite', why: `${arm} served the stored text: E2's English`, translated: false, calls: 0 }); continue; }
      const ov = arm === 'C' ? Object.fromEntries([...emitted('C', s.book_id)].filter(([id]) => s.block.includes(id))) : {};
      ov[s.page_id] = src;
      const r = await translateBlock(earm, s, ov);
      if (r.quota) return 'quota';
      put(earm, r.text ?? (tr?.data?.trim() || null), { source_arm: arm, why: r.text ? 'read' : `${r.why}: stored English served`, translated: !!r.text, calls: r.calls, override_pages: Object.keys(ov).length });
    }
    console.log(`  ${s.key} done`);
    return null;
  };
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < P.selected.length) { const s = P.selected[i++]; if (await work(s) === 'quota') stop = 'agy quota'; } }));
  console.log(`translate: ${stop ? `STOPPED (${stop}); rerun resumes` : 'done'}`);
}

// ── judge ──
const VO = () => path.join(EN, 'verdicts.jsonl');
const strip = (t) => t.replace(/<!--[\s\S]*?-->\s*/g, '').trim();
const enText = (key, earm) => { const f = path.join(EN, `${key}.${earm}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
/** The transcription each English arm was made from (E1: the stored text the stored English sits on). */
function sourceOf(key, earm, rows) {
  const r = rows.get(`${key}:${earm}`);
  return readT(key, r?.source_arm && r.source_arm !== 'lite' ? r.source_arm : 'lite');
}
/** Every judge item: main items (one per distinct (source, English) on a page) + planted controls, shuffled. Deterministic. */
export function englishItems(P, textOf, srcOf, seed = DEFAULT_SEED) {
  const main = [];
  for (const s of P.selected) {
    const by = new Map();
    for (const e of E_ARMS) {
      const t = textOf(s.key, e), src = srcOf(s.key, e); if (t == null || src == null) continue;
      const h = sha(src + '\u0000' + t);
      if (!by.has(h)) by.set(h, { kind: 'main', key: s.key, page_id: s.page_id, book_id: s.book_id, arms: [], h, source: src, translation: t });
      by.get(h).arms.push(e);
    }
    main.push(...by.values());
  }
  const rnd = makeRng(seed + 11);
  const e2 = shuffle(P.selected.filter((s) => textOf(s.key, 'E2') != null), rnd);
  const controls = [];
  for (let j = 0; controls.filter((c) => c.kind === 'swap').length < N_CONTROLS && e2.length > 1; j++) {
    const a = e2[j % e2.length], b = e2[(j + 1 + Math.floor(j / e2.length)) % e2.length]; if (a.key === b.key) continue;
    controls.push({ kind: 'swap', key: a.key, page_id: a.page_id, swap_from: b.key, source: srcOf(a.key, 'E2'), translation: textOf(b.key, 'E2') });
  }
  const units = (s) => { let u = s.split(/(?<=[.!?])\s+/).filter((x) => x.trim()); if (u.length < 6) u = s.split(/\n+/).filter((x) => x.trim()); return u; };
  for (const s of shuffle(e2, rnd)) {
    if (controls.filter((c) => c.kind === 'drop').length >= N_CONTROLS) break;
    const t = textOf(s.key, 'E2'), u = units(t); if (u.length < 4) continue;
    const k = Math.max(1, Math.round(u.length * 0.35)), st = Math.floor((u.length - k) / 2);
    controls.push({ kind: 'drop', key: s.key, page_id: s.page_id, source: srcOf(s.key, 'E2'), translation: [...u.slice(0, st), ...u.slice(st + k)].join(u.length >= 6 && /[.!?]\s/.test(t) ? ' ' : '\n'), dropped_units: k, total_units: u.length });
  }
  for (const m of shuffle(main, rnd).slice(0, N_CONTROLS)) controls.push({ kind: 'repeat', key: m.key, page_id: m.page_id, repeat_of: m.h, source: m.source, translation: m.translation });
  const all = [...main, ...controls];
  const ids = shuffle(all.map((_, i) => i), makeRng(seed + 12));
  all.forEach((it, i) => { it.id = `t${String(ids[i]).padStart(3, '0')}`; });
  for (const c of controls.filter((x) => x.kind === 'repeat')) c.repeat_of_id = main.find((m) => m.key === c.key && m.h === c.repeat_of).id;
  return { main, controls, all: shuffle(all, makeRng(seed + 13)) };
}
/** Packets of `size`, a repeat never with its original. */
export function packets(all, size) {
  const ps = [];
  for (const it of all) {
    let p = ps.find((q) => q.length < size && !q.some((x) => x.id === it.repeat_of_id || x.repeat_of_id === it.id));
    if (!p) { p = []; ps.push(p); }
    p.push(it);
  }
  return ps;
}
function opus(prompt, cwd) {
  return new Promise((resolve) => {
    const env = { ...process.env }; for (const k of Object.keys(env)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete env[k];
    const child = spawn('claude', ['-p', '--model', 'opus', '--tools', 'Read,Write', '--allowedTools', 'Read,Write', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env });
    let out = '', err = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 1500e3);
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    child.on('close', (code) => { clearTimeout(timer); let j = {}; try { j = JSON.parse(out); } catch { /* */ } resolve({ code, text: String(j.result ?? ''), usage: j.usage ?? null, err: err.slice(0, 300), is_error: !!j.is_error }); });
  });
}
async function smallImage(src, dst) {
  if (fs.existsSync(dst)) return dst;
  const sharp = (await import('sharp')).default;
  await sharp(src).resize(1800, 1800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(dst);
  return dst;
}

async function judge() {
  const P = J('plan.json');
  const rows = new Map(jsonl(LOG()).filter((r) => !r.quota).map((r) => [`${r.key}:${r.earm}`, r]));
  const { all, main, controls } = englishItems(P, enText, (k, e) => sourceOf(k, e, rows));
  const size = Number(arg('size') || 10);
  const ps = packets(all, size);
  const pdir = path.join(EN, 'packets'); fs.mkdirSync(pdir, { recursive: true });
  const idir = path.join(EN, 'img'); fs.mkdirSync(idir, { recursive: true });
  const bySel = new Map(P.selected.map((s) => [s.key, s]));
  fs.writeFileSync(path.join(EN, 'manifest.json'), JSON.stringify(all.map(({ source, translation, ...m }) => ({ ...m, source_sha: sha(source), translation_sha: sha(translation), words: (translation.match(/\p{L}+/gu) || []).length })), null, 1));
  const prompt0 = `${strip(fs.readFileSync(path.join(TCA, 'JUDGE-PROMPT.md'), 'utf8'))}\n\n${strip(fs.readFileSync(path.join(TCA, 'IMAGE-ADDENDUM.md'), 'utf8'))}`;
  const have = new Set(jsonl(VO()).map((v) => v.id));
  const limits = await import('../../lib/model-limits.mjs');
  const state = {};
  const todo = ps.map((p, i) => ({ p, name: `packet-${String(i + 1).padStart(2, '0')}` })).filter(({ p }) => p.some((x) => !have.has(x.id)));
  console.log(`english judge: ${main.length} main + ${controls.length} controls = ${all.length} items, ${ps.length} packets of <= ${size}; ${todo.length} to do`);
  let i = 0, stop = null;
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 4)));
  await Promise.all(Array.from({ length: conc }, async () => {
    while (!stop && i < todo.length) {
      const why = await paceCheck(limits, state); if (why) { stop = `pace: ${why}`; break; }
      const { p, name } = todo[i++];
      const ws = path.join(pdir, name); fs.mkdirSync(ws, { recursive: true });
      const lines = [];
      for (const it of p) {
        const s = bySel.get(it.key);
        const img = await smallImage(path.join(OUT, 'img', `${it.key}.jpg`), path.join(ws, `${it.id}.jpg`));
        lines.push(JSON.stringify({ id: it.id, language: 'Latin', source: it.source, translation: it.translation, image: img }));
        void s;
      }
      const pf = path.join(ws, 'packet.jsonl'), of = path.join(ws, 'output.jsonl');
      fs.writeFileSync(pf, lines.join('\n') + '\n'); fs.rmSync(of, { force: true });
      const r = await opus(`${prompt0}\n\nPACKET_FILE: ${pf}\nOUTPUT_FILE: ${of}\n`, ws);
      if (/usage limit|limit reached|hit your (?:usage )?limit|rate.?limit|out of extra usage/i.test(r.text + r.err) && (r.is_error || r.code)) { limits.noteLimitHit('claude', { reason: r.text.slice(0, 200) }); stop = 'quota'; break; }
      const got = jsonl(of).filter((v) => p.some((x) => x.id === v.id));
      for (const v of got) fs.appendFileSync(VO(), JSON.stringify({ ...v, packet: name, at: new Date().toISOString() }) + '\n');
      console.log(`  ${name}: ${got.length}/${p.length} verdicts${r.code ? ` (exit ${r.code})` : ''}`);
    }
  }));
  console.log(`english judge: ${stop ? `STOPPED (${stop})` : 'queue done'}`);
}

// ── analyze ──
const MAJOR = (v) => (v.defects || []).some((d) => d.severity === 'major');
const MISREAD = (v) => !!(v.ocr_misread || v.ocr_wrong_leaf);
async function analyze() {
  const P = J('plan.json');
  const rows = new Map(jsonl(LOG()).filter((r) => !r.quota).map((r) => [`${r.key}:${r.earm}`, r]));
  const { main, controls } = englishItems(P, enText, (k, e) => sourceOf(k, e, rows));
  const V = new Map(); for (const v of jsonl(VO())) V.set(v.id, v);
  // controls and the gate first (score.mjs)
  const sw = controls.filter((c) => c.kind === 'swap' && V.get(c.id)), dr = controls.filter((c) => c.kind === 'drop' && V.get(c.id)), rp = controls.filter((c) => c.kind === 'repeat' && V.get(c.id) && V.get(c.repeat_of_id));
  const checks = {
    swap: { n: sw.length, k: sw.filter((c) => V.get(c.id).fidelity <= 2).length, need: GATE.swap_caught },
    drop: { n: dr.length, k: dr.filter((c) => V.get(c.id).flags?.omission).length, need: GATE.drop_flagged },
    repeat: { n: rp.length, k: rp.filter((c) => Math.abs(V.get(c.id).fidelity - V.get(c.repeat_of_id).fidelity) <= 1).length, need: GATE.repeat_within1 },
  };
  for (const c of Object.values(checks)) { c.rate = c.n ? +(c.k / c.n).toFixed(3) : 0; c.pass = c.n >= GATE.min_n && c.k / c.n >= c.need - 1e-9; }
  const gate = { pass: Object.values(checks).every((c) => c.pass), checks };
  const words = (t) => (String(t || '').replace(/<[^>]+>/g, ' ').match(/\p{L}[\p{L}\p{M}'’-]*/gu) || []).length;
  const vOf = (key, e) => { const m = main.find((x) => x.key === key && x.arms.includes(e)); const v = m && V.get(m.id); return v ? { fid: v.fidelity, major: MAJOR(v), majors: (v.defects || []).filter((d) => d.severity === 'major').length, misread: MISREAD(v), bad: MAJOR(v) || MISREAD(v), words: words(m.translation) } : null; };
  const per = {};
  const boot = (xs) => { resetSeed(DEFAULT_SEED); return xs.length > 1 ? bootstrapCI(xs).map((x) => +x.toFixed(3)) : null; };
  const ratioCI = (rs) => { const rnd = makeRng(DEFAULT_SEED + 21); const out = []; for (let b = 0; b < 10000; b++) { let m = 0, w = 0; for (let j = 0; j < rs.length; j++) { const r = rs[Math.floor(rnd() * rs.length)]; m += r.majors; w += r.words; } out.push(w ? (1000 * m) / w : 0); } out.sort((a, b) => a - b); return [out[250], out[9750]].map((x) => +x.toFixed(2)); };
  const sel = P.selected;
  for (const e of E_ARMS) {
    const vs = sel.map((s) => vOf(s.key, e)).filter(Boolean);
    const W = vs.reduce((a, v) => a + v.words, 0), M = vs.reduce((a, v) => a + v.majors, 0);
    const tr = sel.map((s) => rows.get(`${s.key}:${e}`)).filter(Boolean);
    per[e] = { pages: vs.length, wrong_end_to_end: vs.filter((v) => v.bad).length, wrong_e2e_rate: vs.length ? +(vs.filter((v) => v.bad).length / vs.length).toFixed(3) : null, wrong_e2e_ci95: boot(vs.map((v) => Number(v.bad))),
      major_pages: vs.filter((v) => v.major).length, misread_pages: vs.filter((v) => v.misread).length, fidelity_ge4: vs.filter((v) => v.fid >= 4).length, fidelity_ge4_share: vs.length ? +(vs.filter((v) => v.fid >= 4).length / vs.length).toFixed(3) : null,
      fidelity_mean: vs.length ? +(vs.reduce((a, v) => a + v.fid, 0) / vs.length).toFixed(2) : null, english_words: W, majors: M, major_per_1k: W ? +((1000 * M) / W).toFixed(2) : null, major_per_1k_ci95: vs.length > 1 ? ratioCI(vs) : null,
      translated_fresh: tr.filter((r) => r.translated).length, reused_e2: tr.filter((r) => /E2's English/.test(r.why || '')).length, failed_stored_served: tr.filter((r) => /stored English served/.test(r.why || '')).length, agy_calls: tr.reduce((a, r) => a + (r.calls || 0), 0) };
  }
  const paired = (a, b) => {
    const ps = sel.map((s) => [vOf(s.key, a), vOf(s.key, b)]).filter(([x, y]) => x && y);
    const d = ps.map(([x, y]) => Number(y.bad) - Number(x.bad));   // + = a is better (fewer wrong pages) than b
    const better = ps.filter(([x, y]) => !x.bad && y.bad).length, worse = ps.filter(([x, y]) => x.bad && !y.bad).length;
    return { arm: a, vs: b, n: ps.length, wrong_arm: ps.filter(([x]) => x.bad).length, wrong_vs: ps.filter(([, y]) => y.bad).length, d_wrong_rate_reduction: ps.length ? +(d.reduce((p, q) => p + q, 0) / ps.length).toFixed(3) : null, ci95: boot(d), fixed: better, broke: worse, sign_test_p: +binomTwoSided(better, better + worse).toFixed(4),
      fid_ge4_arm: ps.filter(([x]) => x.fid >= 4).length, fid_ge4_vs: ps.filter(([, y]) => y.fid >= 4).length };
  };
  const vsE1 = ['E2', 'E3', 'E4'].map((e) => paired(e, 'E1'));
  const between = [paired('E3', 'E2'), paired('E4', 'E2'), paired('E4', 'E3')];
  const res = { at: new Date().toISOString(), cell: P.cell, translator: { model: TR_MODEL, per_call: TR_PER_CALL, row: 'latin-cli-agy4', reader: 'claude-translate.mjs read --cli=agy --per-call=4 --fresh (CANDIDATE_READS=off)' },
    judge: 'claude -p --model opus, JUDGE-PROMPT.md + IMAGE-ADDENDUM.md', gate, reported: gate.pass, items: { main: main.length, controls: controls.length, verdicts: V.size }, arms: per, vs_E1: vsE1, between,
    per_page: sel.map((s) => ({ book_id: s.book_id, page_id: s.page_id, ...Object.fromEntries(E_ARMS.map((e) => { const v = vOf(s.key, e); return [e, v ? { fid: v.fid, major: v.major, misread: v.misread, bad: v.bad } : null]; })) })) };
  const dir = path.join(ROOT, 'scripts/eval/results/router-v4-latin-lite'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `english-${res.at.slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify(res, null, 1) + '\n');
  const { per_page, ...head } = res;
  console.log(JSON.stringify(head, null, 1));
  console.log(`-> ${path.relative(ROOT, file)}`);
}

const stages = { translate, judge, analyze };
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await stages[process.argv[2]]();
}
