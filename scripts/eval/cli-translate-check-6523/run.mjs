#!/usr/bin/env node
// PRIOR ART: scripts/eval/pareto-6182/RUNBOOK-cli38-xl.md and build-xl-packet.py — the #6182 C38 arm (3.8 Flash low
// through `agy -p`) on the 365 xl pages, judged blind by Opus with the #5695 prompt; this re-reads 10 of those pages
// through the shared CLI translation call (scripts/lib/agy-cli.mjs gatedTextCall, the one scripts/batch/cli-translate.mjs
// uses) and judges the new read beside the stored one. scripts/eval/cli-ocr-fix-6523/score-round.mjs is the OCR twin.
/**
 * Check the CLI translation runner's #6523 config (markers + tool gate) on 10 pages of the #6182 xl panel ($0: CLI and
 * Opus on the subscriptions; no database).
 *
 *   node scripts/eval/cli-translate-check-6523/run.mjs read  --scratch=DIR    # 10 CLI reads, 2 in flight
 *   node scripts/eval/cli-translate-check-6523/run.mjs judge --scratch=DIR    # one blind Opus pass (claude -p)
 *   node scripts/eval/cli-translate-check-6523/run.mjs score --scratch=DIR    # writes results/cli-translate-check-6523/
 *
 * The pages: 10 ARMS items of results/cli-arm-6182/xljudge/key.json, two per language stratum, drawn with a fixed seed.
 * Each read sends the page's frozen #6182 prompt (/root/pareto-6182/units.jsonl) + TRANSLATE_SUFFIX. The judge item is
 * the stored xl item (source, reference) with three candidates in shuffled labels: the new read, the stored C38 read,
 * and the stored G38 read (the API anchor). Checks: markers used, 0 text outside them, 0 empties; new − stored C38
 * fidelity, paired in the same judging call; and the stored C38 re-judged against its stored J1 score (the judge's own
 * test-retest spread, the noise the difference is read against). The judge packet holds the references: scratch only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gatedTextCall, TRANSLATE_SUFFIX } from '../../lib/agy-cli.mjs';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dirname, '..');
const RES = path.join(EVAL, 'results', 'cli-translate-check-6523');
const KEY = path.join(EVAL, 'results', 'cli-arm-6182', 'xljudge', 'key.json');
const UNITS = '/root/pareto-6182/units.jsonl';
const C38 = '/root/cli38-6182/C38-full.jsonl';
const XL = '/root/cli38-6182/xljudge';
const MODEL = 'gemini-3.8-flash-low';
const stage = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const SCRATCH = arg('scratch');
if (!['read', 'judge', 'score'].includes(stage) || !SCRATCH) { console.error('usage: run.mjs read|judge|score --scratch=DIR'); process.exit(2); }
fs.mkdirSync(SCRATCH, { recursive: true });
const jsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// mulberry32: the draw is reproducible
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const key = JSON.parse(fs.readFileSync(KEY, 'utf8')).items;
function draw() {
  const rand = rng(6523), byStratum = new Map();
  for (const [id, it] of Object.entries(key).sort()) {
    if (it.kind !== 'ARMS') continue;
    const s = `${it.lang}|${it.track}`;
    if (!byStratum.has(s)) byStratum.set(s, []);
    byStratum.get(s).push({ id, ...it });
  }
  const strata = [...byStratum.keys()].sort();
  const out = [];
  for (let round = 0; out.length < 10; round++) for (const s of strata) {
    const pool = byStratum.get(s).filter((x) => !out.includes(x));
    if (pool.length && out.length < 10) out.push(pool[Math.floor(rand() * pool.length)]);
  }
  return out;
}
const PICK = draw();
const READS = path.join(SCRATCH, 'reads.jsonl');

if (stage === 'read') {
  const units = new Map(jsonl(UNITS).map((u) => [u.uid, u]));
  const done = new Set(fs.existsSync(READS) ? jsonl(READS).map((r) => r.id) : []);
  const queue = PICK.filter((p) => !done.has(p.id));
  console.log(`${PICK.length} pages (${queue.length} to read): ${PICK.map((p) => `${p.id} ${p.lang}/${p.track}`).join(', ')}`);
  await Promise.all([0, 1].map(async () => {
    while (queue.length) {
      const p = queue.shift();
      const u = units.get(p.page_id);
      if (!u) throw new Error(`${p.id}: page ${p.page_id} not in units.jsonl`);
      const sent = u.prompt + TRANSLATE_SUFFIX;
      const r = await gatedTextCall(sent, { model: MODEL, task: 'translate', tmp: SCRATCH });
      const row = { id: p.id, page_id: p.page_id, lang: p.lang, track: p.track, model: `${MODEL} (agy -p)`, cls: r.cls, calls: r.calls,
        secs: Math.round(r.secs), tool_calls: r.tool_calls, markers: /<<<\s*BEGIN\s*>>>/.test(r.text), problem: r.problem,
        chatter: r.answer ? cliChatterReason(r.answer) : 'empty', raw: r.text, text: r.answer };
      fs.appendFileSync(READS, JSON.stringify(row) + '\n');
      console.log(`  ${p.id} ${r.cls || r.problem || 'ok'} ${r.answer.length} chars ${row.secs}s calls ${r.calls} tools ${r.tool_calls.join(',') || '-'}`);
    }
  }));
  process.exit(0);
}

const PACKET = path.join(SCRATCH, 'judge-in.jsonl'), JOUT = path.join(SCRATCH, 'judge-out.jsonl'), JKEY = path.join(SCRATCH, 'judge-key.json');
if (stage === 'judge') {
  const reads = new Map(jsonl(READS).map((r) => [r.id, r]));
  const stored = new Map();
  for (const f of fs.readdirSync(XL).filter((f) => /^in-J1-\d+\.jsonl$/.test(f))) for (const it of jsonl(path.join(XL, f))) stored.set(it.id, it);
  const rand = rng(65231), items = [], jkey = {};
  for (const p of PICK) {
    const it = stored.get(p.id), r = reads.get(p.id);
    if (!it || !r) throw new Error(`${p.id}: missing stored item or read`);
    const tr = it.translations, lab = key[p.id].labels;
    const byArm = Object.fromEntries(Object.entries(lab).map(([t, arm]) => [arm, tr[t]]));
    const cands = [['NEW', r.text], ['C38', byArm.C38], ['G38', byArm.G38]];
    for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
    const translations = Object.fromEntries(cands.map(([, t], i) => [`T${i + 1}`, t]));
    jkey[p.id] = Object.fromEntries(cands.map(([arm], i) => [`T${i + 1}`, arm]));
    items.push({ ...it, n: 3, translations });
  }
  fs.writeFileSync(PACKET, items.map((x) => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(JKEY, JSON.stringify(jkey, null, 1));
  fs.copyFileSync(path.join(XL, 'PROMPT.md'), path.join(SCRATCH, 'PROMPT.md'));
  const ask = `Read ${SCRATCH}/PROMPT.md and follow it exactly, with INPUT_FILE = ${PACKET} and OUTPUT_FILE = ${JOUT}. Judge every item in INPUT_FILE (count its lines first). Do not read any other file.`;
  fs.rmSync(JOUT, { force: true });
  const r = spawnSync('claude', ['-p', '--model', 'opus', '--allowedTools', 'Bash', 'Read', 'Write'], { input: ask, encoding: 'utf8', cwd: SCRATCH, timeout: 3_000_000 });
  console.log((r.stdout || '').slice(-300), (r.stderr || '').slice(-300));
  process.exit(fs.existsSync(JOUT) && jsonl(JOUT).length === items.length ? 0 : 1);
}

// ── score ──
const reads = jsonl(READS), jkey = JSON.parse(fs.readFileSync(JKEY, 'utf8'));
const out = new Map(jsonl(JOUT).map((o) => [o.id, o]));
const storedJ1 = new Map();
for (const f of fs.readdirSync(XL).filter((f) => /^out-J1-\d+\.jsonl$/.test(f))) for (const o of jsonl(path.join(XL, f))) storedJ1.set(o.id, o);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const rows = PICK.map((p) => {
  const o = out.get(p.id), k = jkey[p.id], lab = Object.fromEntries(Object.entries(k).map(([t, arm]) => [arm, t]));
  const fid = (arm) => o?.scores?.[lab[arm]]?.fidelity ?? null;
  const st = storedJ1.get(p.id), stLab = Object.entries(key[p.id].labels).find(([, a]) => a === 'C38')[0];
  const rd = reads.find((r) => r.id === p.id);
  return { id: p.id, lang: p.lang, track: p.track, new: fid('NEW'), c38_rejudged: fid('C38'), g38: fid('G38'), c38_stored_j1: st?.scores?.[stLab]?.fidelity ?? null,
    new_reversal: !!o?.scores?.[lab.NEW]?.reversal, markers: rd.markers, outside_markers: rd.problem === 'text outside the markers', empty: !rd.text, problem: rd.problem, cls: rd.cls, calls: rd.calls, secs: rd.secs, tool_calls: rd.tool_calls };
});
const both = rows.filter((r) => r.new != null && r.c38_rejudged != null);
const retest = rows.filter((r) => r.c38_rejudged != null && r.c38_stored_j1 != null);
// paired bootstrap (pages) of the mean new − stored C38, same judging call
const boot = (ds) => { const rand = rng(1), m = []; for (let b = 0; b < 4000; b++) { const s = ds.map(() => ds[Math.floor(rand() * ds.length)]); m.push(mean(s)); } m.sort((a, b) => a - b); return [r2(m[100]), r2(m[3899])]; };
const d = both.map((r) => r.new - r.c38_rejudged), dr = retest.map((r) => r.c38_rejudged - r.c38_stored_j1);
const summary = {
  pages: rows.length, markers_used: rows.filter((r) => r.markers).length, text_outside_markers: rows.filter((r) => r.outside_markers).length,
  empties: rows.filter((r) => r.empty).length, retried: rows.filter((r) => r.calls > 1).length, tool_requests_denied: rows.reduce((n, r) => n + r.tool_calls.filter((t) => t.endsWith(':deny')).length, 0),
  fidelity: { new: r2(mean(both.map((r) => r.new))), c38_stored_rejudged: r2(mean(both.map((r) => r.c38_rejudged))), g38: r2(mean(rows.filter((r) => r.g38 != null).map((r) => r.g38))) },
  new_minus_c38: { mean: r2(mean(d)), ci95: boot(d), n: d.length, pages_differing: d.filter((x) => x !== 0).length },
  judge_retest_c38: { mean: r2(mean(dr)), mean_abs: r2(mean(dr.map(Math.abs))), n: dr.length, pages_differing: dr.filter((x) => x !== 0).length },
  new_reversals: rows.filter((r) => r.new_reversal).length,
};
fs.mkdirSync(RES, { recursive: true });
fs.writeFileSync(path.join(RES, 'summary.json'), JSON.stringify({ issue: 6523, generated_by: 'scripts/eval/cli-translate-check-6523/run.mjs', model: MODEL, judge: 'claude opus (subscription), #5695 xl prompt, one pass', summary, rows }, null, 1) + '\n');
fs.writeFileSync(path.join(RES, 'reads.jsonl'), reads.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify(summary, null, 1));
