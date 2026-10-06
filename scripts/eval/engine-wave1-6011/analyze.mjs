#!/usr/bin/env node
// PRIOR ART: scripts/eval/benchmark-cost-lane.mjs (paired rule output over ONE result file, against the
// engines in that file) and scripts/eval/build-ocr-pareto.mjs on PR #6003 (shared pages across files, but
// medians per engine, no paired Δ). Neither pairs a new run against the COMMITTED per-page CER of the
// chart's engines, which is what the #6011 preregistration fixes (the EEBO flash text is not on this box).
/**
 * analyze.mjs — wave-1 result table for #6011 (PREREGISTRATION-engine-wave1-6011.md).
 *
 *   node scripts/eval/engine-wave1-6011/analyze.mjs [--bench=/root/engine-wave1-6011/bench] [--gpu-usd=<billed lease $>]
 *
 * Reads results/engine-wave1-6011/scored/*.json (benchmark-score.mjs over the bench root), the committed
 * results/benchmark/<stratum>-<date>.json (latest) as the comparators, results/engine-wave1-6011/tibetan-scores.jsonl
 * (kanjur_align), the run meters, and the GPU box record. Writes results/engine-wave1-6011/summary.json and
 * prints the markdown table. $0, no network.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { binomTwoSided } from '../lib/paired-stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dirname, '..');
const RES = path.join(EVAL, 'results', 'engine-wave1-6011');
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const BENCH = argOf('bench', '/root/engine-wave1-6011/bench');
const GPU_USD = argOf('gpu-usd') ? parseFloat(argOf('gpu-usd')) : null;

const NEW = ['deepseek-ocr', 'qwen3-vl-8b', 'chandra-ocr-2', 'mistral-ocr-4-1', 'claude-opus-5-5', 'claude-sonnet-5-5'];
const GPU_ARMS = ['deepseek-ocr', 'qwen3-vl-8b', 'chandra-ocr-2'];
const COMPARATORS = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite'];
const SCRIPTS = [
  { id: 'latin', title: 'Latin print', strata: ['latin-period-5126'] },
  { id: 'english', title: 'Early English print', strata: ['eebo-tcp-5488'] },
  { id: 'greek', title: 'Greek', strata: ['greek', 'greek-ext'] },
  { id: 'chinese-woodblock', title: 'Chinese woodblock / canon', strata: ['chinese', 'chinese-ext'] },
  { id: 'chinese-manuscript', title: 'Chinese manuscript', strata: ['chinese-cohort-5547'] },
  { id: 'sanskrit', title: 'Sanskrit (A5, corrected-OCR ref)', strata: ['a5-nonlatin-5700'], lang: 'Sanskrit' },
  { id: 'persian', title: 'Persian (A5, corrected-OCR ref)', strata: ['a5-nonlatin-5700'], lang: 'Persian' },
  { id: 'arabic', title: 'Arabic (A5, corrected-OCR ref)', strata: ['a5-nonlatin-5700'], lang: 'Arabic' },
  { id: 'hebrew', title: 'Hebrew (A5 corrected-OCR ref + 4 pinned)', strata: ['a5-nonlatin-5700', 'ref-pinned'], lang: 'Hebrew' },
];

// ── stats ──
const r3 = x => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const median = xs => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function bootCI(xs, B = 2000) {
  if (xs.length < 5) return null;
  const rand = mulberry32(6011), meds = [];
  for (let b = 0; b < B; b++) { const s = []; for (let i = 0; i < xs.length; i++) s.push(xs[Math.floor(rand() * xs.length)]); meds.push(median(s)); }
  meds.sort((a, b) => a - b);
  return [r3(meds[Math.floor(0.025 * B)]), r3(meds[Math.floor(0.975 * B) - 1])];
}
function paired(deltas) {   // Δ = comparator − arm (positive = arm better)
  const wins = deltas.filter(d => d > 0.001).length, losses = deltas.filter(d => d < -0.001).length;
  return { n: deltas.length, wins, losses, ties: deltas.length - wins - losses, median_delta: r3(median(deltas)), ci95: bootCI(deltas), p_sign: wins + losses ? r3(binomTwoSided(Math.max(wins, losses), wins + losses)) : null };
}

// ── load ──
const latestIn = (dir, stratum) => { if (!fs.existsSync(dir)) return null; const f = fs.readdirSync(dir).filter(x => x.startsWith(`${stratum}-2`) && x.endsWith('.json')).sort().at(-1); return f ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null; };
const committed = s => latestIn(path.join(EVAL, 'results', 'benchmark'), s);
const mine = s => latestIn(path.join(RES, 'scored'), s);
const isTier = s => s.startsWith('ref-');
// one row per page × engine: { cer, refused, valid } — valid = has a usable reference on this page
function rowsOf(j, stratum, lang) {
  const out = new Map();
  if (!j) return out;
  for (const p of j.pages) {
    if (lang && !isTier(stratum) && p.substratum !== lang) continue;
    if (lang && isTier(stratum) && p.language !== lang) continue;
    const m = new Map();
    for (const [e, v] of Object.entries(p.engines)) {
      if (v.missing || v.error) continue;
      if (isTier(stratum)) m.set(e, { cer: v.aligned ? v.cer : (v.refused ? null : 1), refused: !!v.refused, valid: true, invention: null, loop: false, empty: false });
      else m.set(e, { cer: v.cer ?? null, refused: !!v.refused, valid: !!p.has_ref, invention: v.invention_ref ?? null, loop: !!v.loop, empty: !!v.empty });
    }
    out.set(p.slug, { engines: m, title: p.title || null, script_class: p.script_class || null });
  }
  return out;
}

const result = { preregistration: 'scripts/eval/PREREGISTRATION-engine-wave1-6011.md', scripts: {}, tibetan: null, cost: {}, by_eye_candidates: [] };

for (const sc of SCRIPTS) {
  const block = { title: sc.title, arms: {} };
  const pages = [];   // { stratum, slug, mineRow, commRow }
  for (const st of sc.strata) {
    const M = rowsOf(mine(st), st, sc.lang), C = rowsOf(committed(st), st, sc.lang);
    for (const [slug, mr] of M) pages.push({ stratum: st, slug, mr, cr: C.get(slug) || null });
  }
  for (const arm of NEW) {
    const runs = pages.filter(p => p.mr.engines.has(arm));
    if (!runs.length) continue;
    const ref = runs.filter(p => p.mr.engines.get(arm).valid);
    const ans = ref.filter(p => !p.mr.engines.get(arm).refused);
    const cers = ans.map(p => p.mr.engines.get(arm).cer).filter(x => x != null);
    const a = {
      pages_run: runs.length, referenced: ref.length, refused: ref.length - ans.length,
      empty: runs.filter(p => p.mr.engines.get(arm).empty).length, loop: runs.filter(p => p.mr.engines.get(arm).loop).length,
      median_cer_answered: r3(median(cers)), ci95: bootCI(cers),
      median_cer_refusal_as_1: r3(median([...cers, ...Array(ref.length - ans.length).fill(1)])),
      catastrophic: cers.filter(c => c > 0.5).length,
      median_invention: r3(median(ans.map(p => p.mr.engines.get(arm).invention).filter(x => x != null))),
      vs: {},
    };
    for (const comp of [...COMPARATORS, ...(sc.strata.includes('a5-nonlatin-5700') ? ['served-ocr'] : [])]) {
      const deltas = [], detail = [];
      for (const p of ref) {
        const x = p.mr.engines.get(arm);
        // the comparator's committed per-page CER; A5 has no committed file, its comparators were scored in this run
        const src = p.cr || (p.stratum === 'a5-nonlatin-5700' ? p.mr : null);
        const c = src?.engines.get(comp);
        if (!c || !c.valid || c.refused || c.cer == null || x.refused || x.cer == null) continue;
        deltas.push(c.cer - x.cer); detail.push({ stratum: p.stratum, slug: p.slug, title: p.mr.title, arm_cer: x.cer, comp_cer: c.cer });
      }
      if (deltas.length) { a.vs[comp] = paired(deltas); a.vs[comp].comparator_refused_pages = ref.filter(p => (p.cr || p.mr)?.engines.get(comp)?.refused).length; }
      if (comp === 'gemini-3-flash-preview') for (const d of detail) result.by_eye_candidates.push({ script: sc.id, arm, ...d, delta: r3(d.comp_cer - d.arm_cer) });
    }
    block.arms[arm] = a;
  }
  // the comparators' own medians on the same referenced pages, for the table
  for (const comp of [...COMPARATORS, ...(sc.strata.includes('a5-nonlatin-5700') ? ['served-ocr'] : [])]) {
    const cers = [], ref = []; let refused = 0;
    for (const p of pages) { const src = p.cr || (p.stratum === 'a5-nonlatin-5700' ? p.mr : null); const c = src?.engines.get(comp); if (!c || !c.valid || !p.mr.engines.size) continue; ref.push(p); if (c.refused) refused++; else if (c.cer != null) cers.push(c.cer); }
    if (ref.length) block.arms[comp] = { comparator: true, referenced: ref.length, refused, median_cer_answered: r3(median(cers)), ci95: bootCI(cers), catastrophic: cers.filter(c => c > 0.5).length };
  }
  result.scripts[sc.id] = block;
}

// ── Tibetan (kanjur_align identity; off-index pages excluded) ──
const tibF = path.join(RES, 'tibetan-scores.jsonl');
if (fs.existsSync(tibF)) {
  const rows = fs.readFileSync(tibF, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  // An output too short to align ("too short": < 6 Tibetan syllables) is a page the arm did not read: identity 0, counted as empty.
  for (const r of rows) if (r.identity == null) { r.identity = 0; r.empty = true; }
  const by = new Map(); for (const r of rows) { if (!by.has(r.id)) by.set(r.id, {}); by.get(r.id)[r.arm] = r; }
  const offIndex = [...by].filter(([, a]) => Math.max(...Object.values(a).map(r => r.identity ?? 0)) < 0.5).map(([id]) => id);
  const keep = [...by].filter(([id]) => !offIndex.includes(id));
  const arms = [...new Set(rows.map(r => r.arm))];
  const tib = { measure: 'syllable identity vs Derge (kanjur_align.py, etext-index-full.pkl); higher is better', pages: by.size, off_index: offIndex, arms: {} };
  for (const arm of arms) {
    const ids = keep.filter(([, a]) => a[arm]).map(([, a]) => a[arm].identity);
    const s = { n: ids.length, empty: keep.filter(([, a]) => a[arm]?.empty).length, median_identity: r3(median(ids)), ci95: bootCI(ids), below_0_5: ids.filter(x => x < 0.5).length };
    if (arm !== 'bdrc-yigdzin-v1') {
      const d = keep.filter(([, a]) => a[arm] && a['bdrc-yigdzin-v1']).map(([, a]) => a[arm].identity - a['bdrc-yigdzin-v1'].identity);
      s.vs_yigdzin = paired(d);   // Δ = arm − Yigdzin (positive = arm better)
      for (const [id, a] of keep) if (a[arm] && a['bdrc-yigdzin-v1']) result.by_eye_candidates.push({ script: 'tibetan', arm, slug: id, arm_identity: a[arm].identity, yigdzin_identity: a['bdrc-yigdzin-v1'].identity, delta: r3(a[arm].identity - a['bdrc-yigdzin-v1'].identity) });
    }
    tib.arms[arm] = s;
  }
  result.tibetan = tib;
}

// ── measured cost ──
for (const arm of NEW) {
  const slugs = new Set(); let usd = 0, n = 0, inTok = 0, outTok = 0, thinkTok = 0, secs = 0; const routes = new Set();
  for (const st of fs.existsSync(BENCH) ? fs.readdirSync(BENCH) : []) {
    const f = path.join(BENCH, st, 'out', arm, '_meter.jsonl');
    if (!fs.existsSync(f)) continue;
    for (const r of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))) {
      if (r.error) continue; n++; slugs.add(`${st}|${r.slug}`); usd += r.costUsd || 0; inTok += r.inputTokens || 0; outTok += r.outputTokens || 0; thinkTok += r.thinkingTokens || 0; secs += (r.durationMs || (r.secs || 0) * 1000) / 1000; if (r.route) routes.add(r.route);
    }
  }
  result.cost[arm] = { pages: slugs.size, calls: n, usd: r3(usd * 1000) / 1000, usd_per_1k_pages: slugs.size ? r3(usd / slugs.size * 1000) : null, input_tokens: inTok, output_tokens: outTok, thinking_tokens: thinkTok, routes: [...routes] };
}
const boxF = path.join(RES, 'gpu-box.json');
if (fs.existsSync(boxF)) {
  const box = JSON.parse(fs.readFileSync(boxF, 'utf8'));
  // inference wall time of the runs that read pages (DeepSeek's two failed 4.5 s runs read nothing)
  const wall = Object.fromEntries(GPU_ARMS.map(e => [e, (box.engines?.[e]?.runs || []).filter(r => r.ok > 0).reduce((a, r) => a + r.wall_secs, 0)]));
  const tot = Object.values(wall).reduce((a, b) => a + b, 0);
  const billed = GPU_USD ?? box.billed_usd ?? null;
  for (const e of GPU_ARMS) {
    const n = box.engines?.[e]?.pages_out || 0;
    result.cost[e] = { pages: n, infer_wall_secs: wall[e], usd_per_1k_inference_only: n ? r3(wall[e] / 3600 * box.usd_per_hour / n * 1000) : null,
      usd_per_1k_billed_share: n && billed != null && tot ? r3(billed * (wall[e] / tot) / n * 1000) : null, hardware: box.hardware || box.gpu };
  }
  result.gpu = { billed_usd: billed, usd_per_hour: box.usd_per_hour, gpu: box.gpu, vllm: box.vllm };
}
result.by_eye_candidates.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
fs.writeFileSync(path.join(RES, 'summary.json'), JSON.stringify(result, null, 2) + '\n');

// ── table ──
const f = x => (x == null ? '—' : x.toFixed(3));
const ci = c => (c ? ` [${f(c[0])}, ${f(c[1])}]` : '');
console.log('| script | arm | n ref | refused | median CER (95% CI) | catastrophic | invention | vs flash-preview W/L/T, median Δ (CI) | vs lite W/L/T, median Δ (CI) |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const [id, b] of Object.entries(result.scripts)) {
  for (const [arm, a] of Object.entries(b.arms)) {
    const v = k => { const p = a.vs?.[k]; return p ? `${p.wins}/${p.losses}/${p.ties} (n ${p.n}), ${p.median_delta >= 0 ? '+' : ''}${f(p.median_delta)}${ci(p.ci95)}` : '—'; };
    console.log(`| ${b.title} | ${a.comparator ? `*${arm}*` : `**${arm}**`} | ${a.referenced} | ${a.refused} | ${f(a.median_cer_answered)}${ci(a.ci95)} | ${a.catastrophic} | ${a.comparator ? '—' : f(a.median_invention)} | ${a.comparator ? '' : v('gemini-3-flash-preview')} | ${a.comparator ? '' : v('gemini-3.1-flash-lite')} |`);
  }
}
if (result.tibetan) {
  console.log(`\nTibetan (${result.tibetan.measure}); off-index excluded: ${result.tibetan.off_index.length}`);
  for (const [arm, s] of Object.entries(result.tibetan.arms)) console.log(`| ${arm} | n ${s.n} | identity ${f(s.median_identity)}${ci(s.ci95)} | <0.5: ${s.below_0_5} | ${s.vs_yigdzin ? `vs Yigdzin ${s.vs_yigdzin.wins}/${s.vs_yigdzin.losses}/${s.vs_yigdzin.ties}, Δ ${f(s.vs_yigdzin.median_delta)}${ci(s.vs_yigdzin.ci95)}` : ''} |`);
}
console.log('\ncost:', JSON.stringify(result.cost));
