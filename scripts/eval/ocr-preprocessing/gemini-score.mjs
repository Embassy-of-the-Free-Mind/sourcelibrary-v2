#!/usr/bin/env node
// PRIOR ART: scripts/eval/benchmark-score.mjs scoreRefTier() — the same kernel (lib/metrics.mjs scoreAgainstReference,
// windowed CER) over the same references; this pairs it per page across the #5250 arms and applies the A/A rule
// (lib/paired-stats.mjs is the JS twin of ocr-preprocessing/paired.py).
//
// node scripts/eval/ocr-preprocessing/gemini-score.mjs <dir>   (dir: pages.jsonl, out/<arm>/<slug>.txt, calls.jsonl)
// Metric: windowed CER (lower is better). A page ABSTAINS when its `none` read does not pass the alignment guard
// (the reference window is not this leaf, or the engine refused), so a bad reference cannot score an arm. On a page
// that does not abstain, an arm whose read is not `text` or fails the guard scores 1.0 (a failed read, eval-design §5.1).
// Writes <dir>/gemini-<stratum>.json per stratum (tables + rows + store rows) for build-results.py.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { scoreAgainstReference } from '../lib/metrics.mjs';

const dir = process.argv[2];
const ARMS = ['none', 'none-repeat', 'otsu', 'sauvola', 'clahe', 'deskew', 'upscale2x'];
const pages = readFileSync(`${dir}/pages.jsonl`, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const calls = {};
for (const l of readFileSync(`${dir}/calls.jsonl`, 'utf8').split('\n').filter(Boolean)) {
  const c = JSON.parse(l); calls[`${c.arm}/${c.slug}`] = c;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
function signP(k, n) { if (!n) return null; k = Math.min(k, n - k); let p = 0, c = 1; for (let i = 0; i <= n; i++) { if (i <= k) p += c; c = c * (n - i) / (i + 1); } return Math.min(1, 2 * p / 2 ** n); }
function boot(d, iters = 4000) { let s = 5250; const r = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; const m = []; for (let i = 0; i < iters; i++) m.push(median(d.map(() => d[Math.floor(r() * d.length)]))); m.sort((x, y) => x - y); return [m[Math.floor(0.025 * iters)], m[Math.floor(0.975 * iters)]].map((x) => +x.toFixed(4)); }
function paired(base, arm) { // lower is better; delta reported as GAIN (base - arm)
  const keys = Object.keys(base).filter((k) => arm[k] != null && base[k] != null);
  const d = keys.map((k) => base[k] - arm[k]);
  const w = d.filter((x) => x > 1e-9).length, l = d.filter((x) => x < -1e-9).length;
  return { n: keys.length, wins: w, losses: l, ties: keys.length - w - l, median_gain: d.length ? +median(d).toFixed(4) : null, ci95: d.length ? boot(d) : null, sign_p: signP(w, w + l) === null ? null : +signP(w, w + l).toFixed(4) };
}
function floor(a, b) { const keys = Object.keys(a).filter((k) => b[k] != null); const d = keys.map((k) => Math.abs(a[k] - b[k])).sort((x, y) => x - y); return d.length ? { n: d.length, median_abs: +median(d).toFixed(4), p90_abs: +d[Math.min(d.length - 1, Math.floor(0.9 * d.length))].toFixed(4), max_abs: +d[d.length - 1].toFixed(4), identical: d.filter((x) => x === 0).length } : null; }

for (const stratum of [...new Set(pages.map((p) => p.stratum))]) {
  const rows = [], val = {}, abstain = [];
  for (const p of pages.filter((q) => q.stratum === stratum)) {
    const script = p.script === 'cjk' ? 'cjk' : p.script;
    const sc = {};
    for (const arm of ARMS) {
      const f = `${dir}/out/${arm}/${p.slug}.txt`;
      if (!existsSync(f)) continue;
      const c = calls[`${arm}/${p.slug}`] || {};
      const text = readFileSync(f, 'utf8');
      const s = c.outcome === 'text' ? scoreAgainstReference(p.ref, text, script) : null;
      sc[arm] = { outcome: c.outcome, aligned: s?.aligned ?? false, wcer: s?.windowedCer ?? null, cer: s?.cer ?? null, guard: s?.guard?.value ?? null, chars: text.length };
    }
    if (!sc.none) continue;
    const ab = !(sc.none.aligned && sc.none.wcer != null);
    if (ab) abstain.push({ slug: p.slug, script: p.script, reason: sc.none.outcome !== 'text' ? `none-${sc.none.outcome}` : 'none-unaligned' });
    for (const [arm, s] of Object.entries(sc)) {
      const v = ab ? null : (s.aligned && s.wcer != null ? Math.min(1, s.wcer) : 1.0);
      (val[arm] ||= {})[p.slug] = v;
      rows.push({ slug: p.slug, script: p.script, origin: p.origin, arm, ...s, score: v, abstain: ab });
    }
  }
  const fl = floor(val.none || {}, val['none-repeat'] || {});
  const tables = {};
  const bySc = (sc) => Object.fromEntries(Object.entries(val).map(([a, m]) => [a, Object.fromEntries(Object.entries(m).filter(([k]) => !sc || rows.find((r) => r.slug === k)?.script === sc))]));
  for (const sub of [null, ...new Set(rows.map((r) => r.script))]) {
    const v = bySc(sub), t = {};
    for (const arm of ARMS.slice(2)) if (v[arm]) { const c = paired(v.none, v[arm]); c.counts = c.median_gain != null && fl && Math.abs(c.median_gain) > fl.p90_abs && c.sign_p != null && c.sign_p < 0.05; c.arm_median = +median(Object.values(v[arm]).filter((x) => x != null)).toFixed(4); t[arm] = c; }
    tables[sub || 'all'] = { baseline_median: +median(Object.values(v.none || {}).filter((x) => x != null)).toFixed(4), paired: t };
  }
  const outcomes = {};
  for (const r of rows) { const k = `${r.arm}:${r.outcome}`; outcomes[k] = (outcomes[k] || 0) + 1; }
  const cost = Object.values(calls).filter((c) => c.stratum === stratum).reduce((s, c) => s + (c.cost_usd || 0), 0);
  const runId = `5250-${stratum}-flash-lite-2026-09-29`;
  const out = { stratum, run_id: runId, engine: 'gemini-3.1-flash-lite', measure: 'accuracy', metric: 'windowed CER (lower is better); failed or unaligned arm read = 1.0',
    grade: stratum === 'cjk-woodblock' ? 'decision-grade (canonical-dependent, refs not leaf-checked)' : 'directional (greek canonical-dependent; latin external)',
    noise_floor: fl, tables, abstained: abstain, outcomes, cost_usd: +cost.toFixed(4), rows,
    store_outputs: Object.values(calls).filter((c) => c.stratum === stratum).map((c) => ({ run_id: runId, slug: c.slug, arm: c.arm, engine: 'gemini-lite-realtime', model: c.model, engine_version: c.model,
      prompt_id: c.prompt_id, prompt_hash: c.prompt_hash, params: { thinking: 'budget-0', temperature: 0, max_tokens: 8000, batch: false, context_given: null }, at: c.at, by: 'ocr-preproc-5250', issue: 5250,
      finish_reason: c.finish_reason, cost_usd: c.cost_usd, latency_ms: c.latency_ms, chars: c.chars, outcome: c.outcome, text_path: `scripts/eval/results/ocr-preprocessing-2026-09-29/gemini-texts.jsonl.gz#${c.arm}/${c.slug}`, text_hash: c.text_hash })),
    store_scores: rows.map((r) => ({ slug: r.slug, arm: r.arm, measure: 'accuracy', against: { reference_id: `ref:${r.slug}` }, scorer: 'ocr-preproc-5250@1', scorer_version: 1, normaliser_version: 'metrics.mjs normalizeForScript/normalizeCJK', at: '2026-09-29', engine: 'gemini-lite-realtime', run_id: runId, outcome: r.outcome, metric: { wcer: r.wcer, cer: r.cer, guard: r.guard, aligned: r.aligned, score: r.score }, abstain: r.abstain, abstain_reason: r.abstain ? 'none-read-unaligned-or-failed' : null })) };
  writeFileSync(`${dir}/gemini-${stratum}.json`, JSON.stringify(out));
  console.log(`== ${stratum}  cost $${out.cost_usd}  abstained ${abstain.length}  floor ${JSON.stringify(fl)}`);
  for (const [sub, t] of Object.entries(tables)) {
    console.log(`  [${sub}] baseline median ${t.baseline_median}`);
    for (const [arm, c] of Object.entries(t.paired)) console.log(`    ${arm.padEnd(10)} n=${c.n} W-L-T ${c.wins}-${c.losses}-${c.ties} gain=${c.median_gain} CI=${JSON.stringify(c.ci95)} p=${c.sign_p} arm_med=${c.arm_median} counts=${c.counts}`);
  }
}
