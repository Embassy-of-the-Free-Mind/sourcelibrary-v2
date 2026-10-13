#!/usr/bin/env node
/**
 * apply-reread.mjs — fold the #6523 re-reads into the #6293 CLI arms and re-score the Latin-script strata.
 *
 * PRIOR ART: ocr-pareto-6293/import-cli-arm.py lays ONE whole CLI arm into a bench and rewrites its outputs/meter
 * files from a single raw file; here three arms are re-read on 191 of their pages only, so their committed rows are
 * kept and those pages replaced. benchmark-score.mjs is the scorer, unchanged.
 *
 *   node scripts/eval/cli-ocr-fix-6523/apply-reread.mjs --raw gemini-3.8-flash-low=A.jsonl,B.jsonl --raw … [--write]
 *
 * 1. For each arm, the committed results/ocr-pareto-6293/outputs-<engine>.jsonl and meter-<engine>.jsonl rows of the
 *    re-read pages are replaced: the text as returned (cut at Gemini's block message, import-cli-arm.py's rule), and a
 *    meter row naming the route config (`cli_config`), attempts and the tool calls the gate saw.
 * 2. A bench is built under $JOB_SCRATCH/bench-apply: the #6293 bench's images and stored engines for the four
 *    Latin-script strata, plus every CLI arm's text from the (updated) outputs files.
 * 3. benchmark-score.mjs scores it. CONTROL: every engine cell that was not re-read must equal the committed scored
 *    file exactly, or nothing is written.
 * With --write: the outputs/meter files and scored/<stratum>-<date>.json replace the committed ones.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(__dirname, '..', 'results', 'ocr-pareto-6293');
const SRC = '/mnt/HC_Volume_105839809/jobs/ocr-pareto-6293/bench';
const J = process.env.JOB_SCRATCH || '/tmp';
const STRATA = ['ref-ws', 'ref-pinned', 'latin-period-5126', 'eebo-tcp-5488'];
const BLOCK = "This request was blocked by Gemini's filters";
const CONFIG = 'sentinels+tool-gate (#6523): reply asked for between <<<BEGIN>>>/<<<END>>>; PreToolUse hook allows view_file in the page workspace, denies other tools with a reason; plan mode; ≤2 attempts on an empty reply';
const ENGINE = { 'gemini-3.8-flash-low': 'gemini-3.8-flash+antigravity-cli', 'gemini-3.8-flash-high': 'gemini-3.8-flash-high+antigravity-cli', 'gemini-3.7-flash-low': 'gemini-3.7-flash+antigravity-cli' };
const args = process.argv.slice(2);
const jl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const cut = (t) => (t.includes(BLOCK) ? t.slice(0, t.indexOf(BLOCK)).trimEnd().replace(/<[^>\n]*$/, '').trimEnd() : t);

const reread = new Map(); // engine → Map(uid → raw row)
for (let i = 0; i < args.length; i++) if (args[i] === '--raw') {
  const [model, files] = args[++i].split('=');
  const m = reread.get(ENGINE[model]) || new Map();
  for (const f of files.split(',')) for (const r of jl(f)) m.set(r.uid, r);
  reread.set(ENGINE[model], m);
}

// 1. updated outputs / meter rows
const updated = {};
for (const [engine, rows] of reread) {
  const outs = jl(path.join(RES, `outputs-${engine}.jsonl`)), meters = jl(path.join(RES, `meter-${engine}.jsonl`));
  let n = 0;
  const outs2 = outs.map((o) => { const r = rows.get(`${o.stratum}|${o.slug}`); if (!r) return o; n++; return { ...o, text: cut(r.text || '') }; });
  const meters2 = meters.map((m) => {
    const r = rows.get(`${m.stratum}|${m.slug}`); if (!r) return m;
    const raw = r.text || '';
    return { stratum: m.stratum, slug: m.slug, engine, finishReason: raw.includes(BLOCK) ? 'SAFETY' : raw.trim() ? 'STOP' : 'CLI_EMPTY', chars: cut(raw).length, route: 'cli', model: r.model,
      cli_mode: r.cli_mode, cli_config: CONFIG, tool_calls: r.gate_calls ?? null, nudged: !!r.nudged, attempts: r.attempts, secs: r.secs, at: r.date, error: r.error ? r.error.slice(-200) : null };
  });
  if (n !== rows.size) throw new Error(`${engine}: ${rows.size} re-read pages but ${n} matched committed rows`);
  updated[engine] = { outs: outs2, meters: meters2, n };
  console.log(`${engine}: ${n} pages replaced`);
}

// 2. bench
const cliEngines = fs.readdirSync(RES).filter((f) => /^outputs-.*\+antigravity-cli\.jsonl$/.test(f)).map((f) => f.slice(8, -6));
const bench = path.join(J, 'bench-apply');
fs.rmSync(bench, { recursive: true, force: true });
// the engines each stratum's committed scored file holds: the source bench also carries arms that were never charted
const committedFile = (st) => fs.readdirSync(path.join(RES, 'scored')).find((f) => f.startsWith(`${st}-2026`));
const enginesOf = (st) => new Set(JSON.parse(fs.readFileSync(path.join(RES, 'scored', committedFile(st)), 'utf8')).pages.flatMap((p) => Object.keys(p.engines)));
for (const st of STRATA) {
  const d = path.join(bench, st);
  fs.mkdirSync(path.join(d, 'out'), { recursive: true });
  for (const f of fs.readdirSync(path.join(SRC, st))) if (f.endsWith('.jpg') || f === 'manifest.json') fs.symlinkSync(path.join(SRC, st, f), path.join(d, f));
  const keep = enginesOf(st);
  for (const e of fs.readdirSync(path.join(SRC, st, 'out'))) if (keep.has(e) && !cliEngines.includes(e)) fs.cpSync(path.join(SRC, st, 'out', e), path.join(d, 'out', e), { recursive: true });
}
for (const e of cliEngines) {
  const outs = updated[e]?.outs || jl(path.join(RES, `outputs-${e}.jsonl`));
  const meters = updated[e]?.meters || jl(path.join(RES, `meter-${e}.jsonl`));
  const byDir = {};
  for (const o of outs) if (STRATA.includes(o.stratum)) { const d = path.join(bench, o.stratum, 'out', e); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `${o.slug}.txt`), o.text); }
  for (const m of meters) if (STRATA.includes(m.stratum)) (byDir[path.join(bench, m.stratum, 'out', e)] ||= []).push(m);
  for (const [d, ms] of Object.entries(byDir)) fs.writeFileSync(path.join(d, '_meter.jsonl'), ms.map((m) => JSON.stringify(m)).join('\n') + '\n');
}

// 3. score + control
const out = path.join(J, 'scored-apply');
fs.rmSync(out, { recursive: true, force: true });
execFileSync('node', [path.join(__dirname, '..', 'benchmark-score.mjs'), `--root=${bench}`, `--stratum=${STRATA.join(',')}`, `--out=${out}`], { stdio: ['ignore', 'ignore', 'inherit'], maxBuffer: 1 << 26 });
const committed = Object.fromEntries(fs.readdirSync(path.join(RES, 'scored')).filter((f) => STRATA.some((s) => f.startsWith(`${s}-2026`))).map((f) => [f.replace(/-\d{4}-\d{2}-\d{2}\.json$/, ''), f]));
const fresh = Object.fromEntries(fs.readdirSync(out).filter((f) => STRATA.some((s) => f.startsWith(`${s}-2026`))).map((f) => [f.replace(/-\d{4}-\d{2}-\d{2}\.json$/, ''), f]));
let checked = 0, same = 0;
const diffs = [];
const strip = (c) => JSON.stringify(c);
for (const st of STRATA) {
  const a = new Map(JSON.parse(fs.readFileSync(path.join(RES, 'scored', committed[st]), 'utf8')).pages.map((p) => [p.slug, p]));
  for (const p of JSON.parse(fs.readFileSync(path.join(out, fresh[st]), 'utf8')).pages) {
    const old = a.get(p.slug);
    for (const [e, c] of Object.entries(p.engines)) {
      if (reread.get(e)?.has(`${st}|${p.slug}`)) continue;
      // invention / unsupported-token rates read every engine's text on the page, so a re-read moves them for the
      // others; the control holds each engine's own reading: CER, alignment, refusal.
      const pick = (x) => x && strip({ cer: x.cer, aligned: x.aligned, refused: x.refused, missing: x.missing });
      checked++;
      if (pick(c) === pick(old?.engines?.[e])) same++; else diffs.push(`${st}|${p.slug}|${e}: ${pick(old?.engines?.[e])} → ${pick(c)}`);
    }
  }
}
console.log(`control: ${same}/${checked} engine cells not re-read reproduce the committed score`);
for (const d of diffs.slice(0, 15)) console.log('  ' + d);
if (same !== checked) { console.error('control failed; nothing written'); process.exit(1); }
if (!args.includes('--write')) { console.log('dry run (add --write)'); process.exit(0); }
for (const [e, u] of Object.entries(updated)) {
  fs.writeFileSync(path.join(RES, `outputs-${e}.jsonl`), u.outs.map((x) => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(RES, `meter-${e}.jsonl`), u.meters.map((x) => JSON.stringify(x)).join('\n') + '\n');
}
for (const st of STRATA) {
  fs.rmSync(path.join(RES, 'scored', committed[st]));
  fs.copyFileSync(path.join(out, fresh[st]), path.join(RES, 'scored', fresh[st]));
}
console.log(`wrote outputs/meter for ${Object.keys(updated).length} arms and scored/ for ${STRATA.join(', ')}; bench at ${bench}`);
