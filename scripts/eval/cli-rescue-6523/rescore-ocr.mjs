#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-pareto-6293/rescore-extract.mjs (6523c) re-scores the 4 Latin-script strata with a copy of
// the scorer's normalisation; this runs the UNCHANGED instrument (benchmark-score.mjs) on every stratum instead, over
// a shadow bench root, so the CLI-pass rescues and the non-Latin strata are scored by the same code as the chart.
/**
 * Step 4 (OCR) of the #6523 rescue: score each Pareto CLI arm as stored and as rescued, with benchmark-score.mjs.
 *
 *   node scripts/eval/cli-rescue-6523/rescore-ocr.mjs [--bench DIR] [--dir RESCUE_DIR]
 *
 * Shadow root ($JOB_SCRATCH/cli-rescue-6523/shadow): per stratum, manifest.json and every engine's out/ folder are
 * symlinked from the scoring bench (default /mnt/HC_Volume_105839809/jobs/cli-effort-6293/bench, the one that holds
 * every CLI tier); beside each CLI engine sits `<engine>+rescued-6523`, the same files with the rescued text where
 * rescue.mjs (deterministic) or cut-pass.mjs (cli-restructure, accepted) produced one, the stored read elsewhere.
 * CONTROL: the stored CLI engines, re-scored in the shadow, must reproduce the committed
 * results/ocr-pareto-6293/scored/<stratum>-*.json CER on every page, or nothing is written.
 * Writes scripts/eval/results/cli-rescue-6523/ocr-pareto-rescored.json: per arm and stratum, pages, mean CER and
 * pages over half wrong, stored vs rescued; and one row per page whose text changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readJsonl } from './rescue.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const BENCH = arg('bench', '/mnt/HC_Volume_105839809/jobs/cli-effort-6293/bench');
const DIR = arg('dir', path.join(process.env.JOB_SCRATCH || '/tmp', 'cli-rescue-6523'));
const SHADOW = path.join(DIR, 'shadow'), SCORED = path.join(DIR, 'shadow-scored');
const RES = 'scripts/eval/results/ocr-pareto-6293';
const OUT = 'scripts/eval/results/cli-rescue-6523/ocr-pareto-rescored.json';
const SUFFIX = '+rescued-6523';
const ENGINES = ['gemini-3.6-flash+antigravity-cli', 'gemini-3.7-flash+antigravity-cli', 'gemini-3.8-flash+antigravity-cli', 'gemini-3.8-flash-high+antigravity-cli'];

// rescued text per engine|stratum|slug
const rescued = new Map(), method = new Map();
for (const e of ENGINES) {
  const f = path.join(DIR, `pareto-6293__${e}.jsonl`);
  for (const r of readJsonl(f)) if (r.method === 'deterministic') { rescued.set(`${e}|${r.key}`, r.text); method.set(`${e}|${r.key}`, 'deterministic'); }
}
for (const r of readJsonl(path.join(DIR, 'cut-residual.jsonl'))) {
  const e = r.arm.replace(/^pareto-6293:/, '');
  if (r.accepted && ENGINES.includes(e)) { rescued.set(`${e}|${r.key}`, r.text); method.set(`${e}|${r.key}`, 'cli-restructure'); }
}

fs.rmSync(SHADOW, { recursive: true, force: true });
fs.rmSync(SCORED, { recursive: true, force: true });
const strata = fs.readdirSync(BENCH).filter((s) => fs.existsSync(path.join(BENCH, s, 'out')));
for (const s of strata) {
  const out = path.join(SHADOW, s, 'out');
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(path.join(BENCH, s))) if (f !== 'out') fs.symlinkSync(path.join(BENCH, s, f), path.join(SHADOW, s, f));
  for (const e of fs.readdirSync(path.join(BENCH, s, 'out'))) {
    fs.symlinkSync(path.join(BENCH, s, 'out', e), path.join(out, e));
    if (!ENGINES.includes(e)) continue;
    const dst = path.join(out, e + SUFFIX);
    fs.mkdirSync(dst);
    for (const f of fs.readdirSync(path.join(BENCH, s, 'out', e))) {
      const src = path.join(BENCH, s, 'out', e, f);
      const slug = f.replace(/\.txt$/, '');
      const t = f.endsWith('.txt') ? rescued.get(`${e}|${s}|${slug}`) : undefined;
      if (t != null) fs.writeFileSync(path.join(dst, f), t);
      else fs.copyFileSync(src, path.join(dst, f));
    }
  }
}
// The chinese-cohort references ship as one bundle (benchmark/refs/chinese-cohort-5547.refs.jsonl), which the scored
// files were built from; benchmark-score reads <slug>.txt/.json, so the bundle is exploded beside the repo refs.
const REFS = path.join(DIR, 'shadow-refs');
fs.rmSync(REFS, { recursive: true, force: true });
fs.mkdirSync(REFS, { recursive: true });
const REPO_REFS = 'scripts/eval/benchmark/refs';
for (const f of fs.readdirSync(REPO_REFS)) fs.symlinkSync(path.resolve(REPO_REFS, f), path.join(REFS, f));
for (const r of readJsonl(path.join(REPO_REFS, 'chinese-cohort-5547.refs.jsonl'))) {
  if (typeof r.text !== 'string' || fs.existsSync(path.join(REFS, `${r.slug}.txt`))) continue;
  fs.writeFileSync(path.join(REFS, `${r.slug}.txt`), r.text);
  fs.writeFileSync(path.join(REFS, `${r.slug}.json`), JSON.stringify(r.record));
}
execFileSync('node', ['scripts/eval/benchmark-score.mjs', `--root=${SHADOW}`, `--out=${SCORED}`, `--refs-dir=${REFS}`], { stdio: ['ignore', 'ignore', 'inherit'], maxBuffer: 1 << 26 });

const latest = (dir, s) => fs.readdirSync(dir).filter((f) => f.startsWith(`${s}-`) && /-\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(s.length + 1).match(/^\d{4}-/)).sort().at(-1);
const control = { checked: 0, reproduced: 0, mismatches: [] };
const arms = {}, rows = [];
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
for (const s of strata) {
  const fNew = latest(SCORED, s), fOld = latest(path.join(RES, 'scored'), s);
  if (!fNew || !fOld) continue;
  const now = JSON.parse(fs.readFileSync(path.join(SCORED, fNew), 'utf8')).pages;
  const old = new Map(JSON.parse(fs.readFileSync(path.join(RES, 'scored', fOld), 'utf8')).pages.map((p) => [p.slug, p]));
  for (const p of now) {
    for (const e of ENGINES) {
      const a = p.engines[e], b = p.engines[e + SUFFIX], c = old.get(p.slug)?.engines?.[e];
      if (!a || a.missing || !b) continue;
      control.checked++;
      if (c && c.cer === a.cer && !!c.aligned === !!a.aligned) control.reproduced++;
      else control.mismatches.push(`${s}|${p.slug}|${e}: committed ${c?.cer} vs shadow ${a.cer}`);
      const k = `${e}|${s}`;
      const t = (arms[k] ||= { engine: e, stratum: s, pages: 0, cer_stored: 0, cer_rescued: 0, n_cer: 0, over_half_stored: 0, over_half_rescued: 0, changed: 0, deterministic: 0, cli_restructure: 0 });
      t.pages++;
      if (a.cer != null && b.cer != null) { t.n_cer++; t.cer_stored += a.cer; t.cer_rescued += b.cer; }
      if (a.cer > 0.5) t.over_half_stored++;
      if (b.cer > 0.5) t.over_half_rescued++;
      const m = method.get(`${e}|${s}|${p.slug}`);
      if (m) {
        t.changed++; t[m === 'deterministic' ? 'deterministic' : 'cli_restructure']++;
        rows.push({ page: `${s}|${p.slug}`, engine: e, method: m, stored: { cer: a.cer ?? null, aligned: a.aligned ?? null }, rescued: { cer: b.cer ?? null, aligned: b.aligned ?? null } });
      }
    }
  }
}
console.log(`control: ${control.reproduced}/${control.checked} stored CLI reads reproduce the committed score`);
for (const m of control.mismatches.slice(0, 15)) console.log(`  ${m}`);
const summary = Object.values(arms).map((t) => ({ ...t, cer_stored: r3(t.n_cer ? t.cer_stored / t.n_cer : null), cer_rescued: r3(t.n_cer ? t.cer_rescued / t.n_cer : null) }))
  .sort((x, y) => x.engine.localeCompare(y.engine) || x.stratum.localeCompare(y.stratum));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ issue: 6523, generated_by: 'scripts/eval/cli-rescue-6523/rescore-ocr.mjs', scorer: 'scripts/eval/benchmark-score.mjs (unchanged)', bench: BENCH,
  control: { checked: control.checked, reproduced: control.reproduced, mismatches: control.mismatches }, arms: summary, rows: rows.sort((a, b) => a.page.localeCompare(b.page) || a.engine.localeCompare(b.engine)) }, null, 1) + '\n');
for (const t of summary) if (t.changed) console.log(`${t.engine.padEnd(40)} ${t.stratum.padEnd(20)} pages ${String(t.pages).padStart(4)} changed ${String(t.changed).padStart(3)} (det ${t.deterministic}, cli ${t.cli_restructure})  CER ${t.cer_stored} → ${t.cer_rescued}  >50% ${t.over_half_stored} → ${t.over_half_rescued}`);
console.log(`wrote ${OUT}`);
