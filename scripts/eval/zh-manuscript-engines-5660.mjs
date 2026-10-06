#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/paddle-zh-5600-optimize.mjs (branch job-nolayout-5600e — the same sealed pool and
 * scorer, but it compares serving CONFIGURATIONS of Paddle against a non-inferiority gate) and
 * scripts/eval/benchmark-score.mjs (the scorer, used unchanged as a subprocess). This compares ENGINES against
 * Paddle under a superiority rule, per PREREGISTRATION-zh-manuscript-engines-5660.md.
 *
 *   sample  draw the 50 pages → results/zh-manuscript-engines-5660/sample.json; stage <dir>/score-root/
 *           chinese-cohort-5547/<slug>.jpg + manifest.json (for benchmark-run-api.mjs), <dir>/acc.tsv for a box,
 *           and <dir>/tput.tsv (400 never-read cohort pages, 40 books × 10, from the lane plan) for throughput.
 *   score   score every arm in <dir>/score-root/chinese-cohort-5547/out/<arm>/ (+ the #5547 anchors) and write
 *           results/zh-manuscript-engines-5660/score.json + a table. Arm cost meta: <dir>/arms/<arm>.json
 *           { eur_per_page, how } (GPU arms) — Gemini arms are costed from their _meter.jsonl.
 *
 *   node scripts/eval/zh-manuscript-engines-5660.mjs sample --dir=/root/gpu-backlog-5660/engines
 *   node scripts/eval/zh-manuscript-engines-5660.mjs score  --dir=/root/gpu-backlog-5660/engines --owed=<pages>
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { makeRng } from './lib/paired-stats.mjs';
import { loopVerdict } from '../lib/ocr-loop-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const CMD = process.argv[2];
const DIR = argOf('dir', '/root/gpu-backlog-5660/engines');
const PLAN = argOf('plan', '/root/gpu-backlog-5660/zh/plan');
const BENCH = '/root/ocr-bench/images/chinese-cohort-5547';
const RES = path.join(__dirname, 'results', 'zh-manuscript-engines-5660');
const REG = JSON.parse(fs.readFileSync(path.join(__dirname, 'benchmark', 'chinese-cohort-5547.json'), 'utf8'));
const REFS_BUNDLE = path.join(__dirname, 'benchmark', 'refs', 'chinese-cohort-5547.refs.jsonl');
const CLASS = path.join(__dirname, 'benchmark', 'script-class', 'chinese-cohort-5547.jsonl');
const USED = argOf('used', '/root/gpu-backlog-5660/engines/used-5600.json');   // the 200 slugs of #5600's sample.json + sample-fresh.json
const ANCHORS = ['gemini-3.1-flash-lite', 'gemini-3-flash-preview'];
const N = 50, SEED = 5660, BASE = 'paddle';
const RULE = { delta: -0.02, catastrophic_slack: 1 };
const ST = 'chinese-cohort-5547';
const jsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const median = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r4 = x => x == null ? null : +x.toFixed(4);

function sample() {
  const refs = new Map(jsonl(REFS_BUNDLE).filter(r => r.text && r.text.trim()).map(r => [r.slug, r]));
  const cls = new Map(jsonl(CLASS).map(r => [r.slug, r.script_class]));
  const used = new Set(JSON.parse(fs.readFileSync(USED, 'utf8')));
  const all = REG.pages.filter(p => !p.retired && p.cohort === 'held' && cls.get(p.slug) === 'manuscript-regular' && refs.has(p.slug));
  const pool = all.filter(p => !used.has(p.slug)).map(p => p.slug).sort();
  if (new Set(all.map(p => p.book_id)).size !== all.length) throw new Error('pool is not one page per book');
  const rng = makeRng(SEED), bag = [...pool], slugs = [];
  while (slugs.length < N && bag.length) slugs.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
  slugs.sort();
  fs.mkdirSync(RES, { recursive: true });
  fs.writeFileSync(path.join(RES, 'sample.json'), JSON.stringify({ issue: 5660, seed: SEED, drawn_at: new Date().toISOString(), rule: 'sealed chinese-cohort-5547 pages: cohort=held, eye manuscript-regular, with a reference; minus the 200 pages of #5600 sample.json + sample-fresh.json; slug-sorted, makeRng(5660) without replacement', pool_before_exclusion: all.length, pool: pool.length, slugs }, null, 1));
  const st = path.join(DIR, 'score-root', ST);
  fs.mkdirSync(st, { recursive: true });
  for (const s of slugs) { const d = path.join(st, `${s}.jpg`); if (!fs.existsSync(d)) fs.copyFileSync(path.join(BENCH, `${s}.jpg`), d); }
  fs.writeFileSync(path.join(st, 'manifest.json'), JSON.stringify({ stratum: ST, issue: 5660, slugs }, null, 1));
  fs.mkdirSync(path.join(DIR, 'img', '_bench'), { recursive: true });
  const acc = slugs.map(s => { fs.copyFileSync(path.join(BENCH, `${s}.jpg`), path.join(DIR, 'img', '_bench', `${s}.jpg`)); return `_bench\t${s}\timg/_bench/${s}.jpg`; });
  fs.writeFileSync(path.join(DIR, 'acc.tsv'), acc.join('\n') + '\n');
  // throughput set: 40 plan books (seeded), their first 10 never-read pages — read by both GPU arms, never written
  const plans = fs.readdirSync(PLAN).filter(f => f.endsWith('.json')).sort();
  const pick = [], r2 = makeRng(SEED + 1), pb = [...plans];
  while (pick.length < 40 && pb.length) pick.push(pb.splice(Math.floor(r2() * pb.length), 1)[0]);
  const tput = [];
  for (const f of pick) { const p = JSON.parse(fs.readFileSync(path.join(PLAN, f), 'utf8')); for (const r of p.pages.filter(r => r.first_write).slice(0, 10)) tput.push(`${p.bid}\t${r.pn}\t${r.src}`); }
  fs.writeFileSync(path.join(DIR, 'tput.tsv'), tput.join('\n') + '\n');
  console.log(`pool ${all.length} → ${pool.length} after excluding #5600's 200; drew ${slugs.length}; tput ${tput.length} rows`);
}

function bootMedian(xs, rng, iters = 10000) {
  const ms = [];
  for (let i = 0; i < iters; i++) { const s = []; for (let j = 0; j < xs.length; j++) s.push(xs[Math.floor(rng() * xs.length)]); ms.push(median(s)); }
  ms.sort((a, b) => a - b);
  return [ms[Math.floor(iters * 0.025)], ms[Math.floor(iters * 0.975)]];
}

function score() {
  const { slugs } = JSON.parse(fs.readFileSync(path.join(RES, 'sample.json'), 'utf8'));
  const root = path.join(DIR, 'score-root'), st = path.join(root, ST);
  const arms = fs.readdirSync(path.join(st, 'out')).filter(a => !a.startsWith('anchor-') && fs.statSync(path.join(st, 'out', a)).isDirectory()).sort();
  if (!arms.includes(BASE)) throw new Error(`no ${BASE} arm`);
  for (const a of ANCHORS) {
    const d = path.join(st, 'out', `anchor-${a}`); fs.mkdirSync(d, { recursive: true });
    for (const s of slugs) { const f = path.join(BENCH, 'out', a, `${s}.txt`); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(d, `${s}.txt`)); }
  }
  const refsDir = path.join(__dirname, 'benchmark', 'refs'); const made = [];
  for (const r of jsonl(REFS_BUNDLE).filter(r => slugs.includes(r.slug))) {
    for (const [ext, body] of [['json', JSON.stringify(r.record, null, 2)], ['txt', r.text]]) { const f = path.join(refsDir, `${r.slug}.${ext}`); if (body != null && !fs.existsSync(f)) { fs.writeFileSync(f, body); made.push(f); } }
  }
  const out = path.join(DIR, 'scored');
  fs.rmSync(out, { recursive: true, force: true });
  try { execFileSync('node', [path.join(__dirname, 'benchmark-score.mjs'), `--root=${root}`, `--stratum=${ST}`, `--ref=${BASE}`, `--out=${out}`], { stdio: ['ignore', 'ignore', 'inherit'] }); }
  finally { for (const f of made) fs.rmSync(f, { force: true }); }
  const scored = JSON.parse(fs.readFileSync(path.join(out, fs.readdirSync(out).find(f => f.startsWith(`${ST}-`))), 'utf8'));
  const byPage = new Map(scored.pages.map(p => [p.slug, p]));
  const refd = slugs.filter(s => byPage.get(s)?.has_ref);
  // no output (missing, empty, refused) = CER 1.0 — an unread page
  const cerOf = (s, arm) => { const e = byPage.get(s)?.engines?.[arm]; if (!e || e.missing) return 1; return e.cer != null ? Math.min(e.cer, 1) : 1; };
  const rng = makeRng(SEED);
  const baseCat = refd.filter(s => cerOf(s, BASE) > 0.5).length;
  const rows = [];
  for (const arm of arms) {
    const cers = refd.map(s => cerOf(s, arm));
    const deltas = refd.map(s => cerOf(s, arm) - cerOf(s, BASE));
    const cat = cers.filter(c => c > 0.5).length;
    const texts = slugs.map(s => { const f = path.join(st, 'out', arm, `${s}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; });
    const loops = texts.filter(t => t && loopVerdict(t).loop).length;
    const inv = median(refd.map(s => byPage.get(s)?.engines?.[arm]?.invention_ref ?? null));
    const w = deltas.filter(d => d < -1e-9).length, l = deltas.filter(d => d > 1e-9).length;
    const d = median(deltas), ci = arm === BASE ? null : bootMedian(deltas, rng);
    let eur = null, how = null;
    const meter = path.join(st, 'out', arm, '_meter.jsonl');
    if (fs.existsSync(meter)) {
      const m = jsonl(meter); const last = new Map(); for (const r of m) last.set(r.slug, r);
      const usd = m.reduce((s, r) => s + (r.costUsd ?? r.cost ?? 0), 0);
      eur = usd * 0.86 / Math.max(1, last.size); how = `metered: $${usd.toFixed(4)} over ${m.length} calls / ${last.size} pages, ×0.86 €/$`;
    } else if (fs.existsSync(path.join(DIR, 'arms', `${arm}.json`))) { const a = JSON.parse(fs.readFileSync(path.join(DIR, 'arms', `${arm}.json`), 'utf8')); eur = a.eur_per_page; how = a.how; }
    const wins = arm === BASE || /^lite/.test(arm) ? null : (d < RULE.delta && ci[1] < 0 && cat <= baseCat + RULE.catastrophic_slack);
    rows.push({ arm, n: refd.length, median_cer: r4(median(cers)), delta_vs_paddle: arm === BASE ? 0 : r4(d), ci95: ci && ci.map(r4), wlt: arm === BASE ? null : [w, l, deltas.length - w - l], catastrophic: cat, loops, invention_ref_median: r4(inv), eur_per_page: eur == null ? null : +eur.toFixed(7), cost_how: how, wins });
  }
  // noise floor: lite vs lite-b, paired
  let noise = null;
  if (arms.includes('lite') && arms.includes('lite-b')) {
    const dd = refd.map(s => cerOf(s, 'lite-b') - cerOf(s, 'lite'));
    noise = { measure: 'stability', median_delta: r4(median(dd)), ci95: bootMedian(dd, rng).map(r4), median_abs_delta: r4(median(dd.map(Math.abs))), identical_pages: dd.filter(x => Math.abs(x) < 1e-9).length, n: dd.length };
  }
  const owed = +argOf('owed', 0);
  for (const r of rows) r.eur_for_all = owed && r.eur_per_page != null ? Math.round(owed * r.eur_per_page) : null;
  const excluded = { textless: scored.summary?.textless?.filter(s => slugs.includes(s)) || [], ref_mismatch: scored.summary?.ref_mismatch?.filter(s => slugs.includes(s)) || [] };
  const res = { issue: 5660, measure: 'accuracy', scored_at: new Date().toISOString(), drawn: slugs.length, n_scored: refd.length, excluded, base_catastrophic: baseCat, rule: RULE, owed_pages: owed || null, arms: rows, noise_floor: noise };
  fs.writeFileSync(path.join(RES, 'score.json'), JSON.stringify(res, null, 1));
  console.log(`${slugs.length} drawn; ${refd.length} scored; excluded ${JSON.stringify(excluded)}`);
  console.log('| arm | median CER | Δ vs Paddle [95% CI] | W/L/T | catastrophic | loops | invention | €/page | € for all | wins |');
  for (const r of rows) console.log(`| ${r.arm} | ${r.median_cer} | ${r.delta_vs_paddle} ${r.ci95 ? `[${r.ci95.join(', ')}]` : ''} | ${r.wlt ? r.wlt.join('/') : ''} | ${r.catastrophic} | ${r.loops} | ${r.invention_ref_median} | ${r.eur_per_page ?? ''} | ${r.eur_for_all ?? ''} | ${r.wins ?? ''} |`);
  if (noise) console.log('noise floor (lite vs lite-b):', JSON.stringify(noise));
}

if (CMD === 'sample') sample();
else if (CMD === 'score') score();
else { console.error('sample | score'); process.exit(2); }
