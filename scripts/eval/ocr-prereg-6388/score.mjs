#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/metrics.mjs (normalizeForScript / normalizeCJK, the existing normalisers, reused
// unchanged; its `cer` is a single-reference Levenshtein and its `scoreAgainstReference` scores against one
// reference passage, so neither can score against a multi-reader key); scripts/eval/lib/paired-stats.mjs
// (`bootstrapCI`, `resetSeed`, reused); scripts/eval/latin-cli-pilot-6375.mjs (the REFUSAL pattern, copied).
// The key and scorer live in panel-key.mjs (shared with the #6429 trend). What is new here is the leave-one-out
// consensus key (plurality per aligned column, ties accept every tied
// reading) that #6388 preregisters; nothing in scripts/eval builds one.
/**
 * score.mjs — #6388 provisional (AI-consensus key) scores, paired gaps, AA band, adjudication spans.
 * Reads reads/*.jsonl and sample.json; writes results.json, results.md and adjudication-<stratum>.jsonl.gz.
 * $0, no network, no Mongo.
 *
 *   node scripts/eval/ocr-prereg-6388/score.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { bootstrapCI, resetSeed, mean } from '../lib/paired-stats.mjs';
import { HERE, STRATA, READERS, isZh, norm, readSample, readArm, makeKey, scoreArm, pageOf, buildNetwork } from './panel-key.mjs';

const SEED = 6386, MIN_EFFECT = 0.01;
const sample = readSample();
const ARMS = ['P', 'L1', 'L2', 'G', 'S', 'O', 'IA'];
const reads = Object.fromEntries(ARMS.map(a => [a, readArm(a)]));

const pages = sample.map(s => pageOf(s, reads));

const fmt = x => (x == null ? '—' : (100 * x).toFixed(1));
function paired(rows, base, x) {
  const ds = rows.filter(r => r[base] != null && r[x] != null).map(r => r[base] - r[x]);
  resetSeed(SEED);
  return { n: ds.length, mean_d: ds.length ? mean(ds) : null, ci: bootstrapCI(ds, 10000) };
}
function verdict(ci, margin) {
  if (!ci) return 'not enough pages';
  if (ci[0] > margin) return 'switch';
  if (ci[1] < margin) return 'no change';
  return 'cannot be told apart';
}

const results = { issue: 6388, label: 'provisional (AI-consensus key)', seed: SEED, min_effect: MIN_EFFECT, generated_at: new Date().toISOString(), strata: {} };
const md = [];
for (const st of STRATA) {
  const P = pages.filter(p => p.stratum === st);
  const R_ = READERS(st);
  const keys = Object.fromEntries([...R_.map(x => [x, R_.filter(y => y !== x)]), ['all', R_]]);
  const scored = {}; const keyStatus = {};
  for (const [kname, karms] of Object.entries(keys)) {
    scored[kname] = []; keyStatus[kname] = { ok: 0, blank: 0, unscorable: 0 };
    const armsToScore = kname === 'all' ? ['P', 'L1', 'L2', 'IA'] : ['P', 'L1', 'L2', kname];
    for (const p of P) {
      const k = makeKey(p, karms);
      keyStatus[kname][k.status]++;
      const row = { uid: p.uid, key_used: k.used };
      for (const a of armsToScore) row[a] = scoreArm(p, k, a);
      scored[kname].push(row);
    }
  }
  const outcomes = Object.fromEntries(ARMS.map(a => [a, P.reduce((o, p) => (o[p.arm[a].outcome] = (o[p.arm[a].outcome] || 0) + 1, o), {})]));
  const stored_models = P.reduce((o, p) => (o[p.stored_ocr_model] = (o[p.stored_ocr_model] || 0) + 1, o), {});
  // AA band per key: the larger absolute end of the 95% CI of CER(L1) − CER(L2).
  const aa = {};
  for (const kname of Object.keys(keys)) {
    const r = paired(scored[kname], 'L1', 'L2');
    aa[kname] = { ...r, band: r.ci ? Math.max(Math.abs(r.ci[0]), Math.abs(r.ci[1])) : null };
  }
  const comps = [];
  const candidates = [...R_.map(x => ({ x, key: x })), ...(isZh(st) ? [{ x: 'P', key: 'all' }] : [{ x: 'IA', key: 'all' }])];
  for (const { x, key } of candidates) {
    for (const base of ['L1', 'P']) {
      if (x === base) continue;
      const r = paired(scored[key], base, x);
      const margin = Math.max(aa[key].band ?? Infinity, MIN_EFFECT);
      const meanX = mean(scored[key].filter(z => z[x] != null && z[base] != null).map(z => z[x]));
      const meanB = mean(scored[key].filter(z => z[x] != null && z[base] != null).map(z => z[base]));
      comps.push({ engine: x, baseline: base, key: keys[key], ...r, mean_cer_engine: meanX, mean_cer_baseline: meanB, margin, verdict: verdict(r.ci, margin) });
    }
  }
  results.strata[st] = { n_pages: P.length, readers: R_, keys, key_status: keyStatus, outcomes, stored_models, aa, comparisons: comps, per_page: scored };

  md.push(`### ${st} (n = ${P.length} works) — provisional (AI-consensus key)`, '');
  md.push(`Stored OCR models: ${Object.entries(stored_models).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '');
  md.push('| engine | baseline | key | n | CER engine | CER baseline | gap (baseline − engine) [95% CI] | margin | verdict |', '|---|---|---|---:|---:|---:|---|---:|---|');
  for (const c of comps) md.push(`| ${c.engine} | ${c.baseline} | {${c.key.join(', ')}} | ${c.n} | ${fmt(c.mean_cer_engine)} | ${fmt(c.mean_cer_baseline)} | ${fmt(c.mean_d)} [${c.ci ? fmt(c.ci[0]) + ', ' + fmt(c.ci[1]) : '—'}] | ${fmt(c.margin)} | ${c.verdict} |`);
  md.push('', '| key | n | AA: CER(L1) − CER(L2) [95% CI] | band |', '|---|---:|---|---:|');
  for (const [k, a] of Object.entries(aa)) md.push(`| {${keys[k].join(', ')}} | ${a.n} | ${fmt(a.mean_d)} [${a.ci ? fmt(a.ci[0]) + ', ' + fmt(a.ci[1]) : '—'}] | ${fmt(a.band)} |`);
  md.push('', `Outcomes: ${ARMS.map(a => `${a} ${Object.entries(outcomes[a]).map(([k, v]) => `${k}:${v}`).join('/')}`).join('; ')}.`, '');
}

// ── adjudication spans: all non-production readers, spaces kept; P shown where it aligns ──
const adjSummary = {};
for (const st of STRATA) {
  const R_ = READERS(st), rows = [];
  let pagesWithSpans = 0;
  for (const p of pages.filter(x => x.stratum === st)) {
    const voters = R_.filter(a => p.arm[a].outcome === 'text');
    if (voters.length < 2) { rows.push({ uid: p.uid, image: p.image, note: `fewer than 2 readers with text (${voters.join(', ') || 'none'})` }); continue; }
    const strs = voters.map(a => norm(p.arm[a].raw, st, true));
    const withP = p.arm.P.outcome === 'text' ? [...strs, norm(p.arm.P.raw, st, true)] : strs;
    const cols = buildNetwork(withP);
    const nv = voters.length;
    const dis = cols.map(c => { const v = c.slice(0, nv); return v.some(x => x !== v[0]); });
    const spans = [];
    for (let i = 0; i < cols.length; i++) {
      if (!dis[i]) continue;
      const last = spans[spans.length - 1];
      if (last && i - last[1] <= 3) last[1] = i; else spans.push([i, i]);
    }
    const ctx = (a, b) => cols.slice(a, b).map(c => c.slice(0, nv).find(x => x !== null) ?? '').join('');
    const read = (a, b, idx) => cols.slice(a, b + 1).map(c => c[idx] ?? '').join('');
    // A span whose readings differ only in word spacing is not a reading to adjudicate (CER removes spaces too).
    const kept = spans.filter(([a, b]) => new Set(voters.map((_, i) => read(a, b, i).replace(/ /g, ''))).size > 1);
    if (kept.length) pagesWithSpans++;
    kept.forEach(([a, b], si) => {
      const reading = idx => read(a, b, idx);
      rows.push({
        uid: p.uid, image: p.image, span: si, readings: Object.fromEntries(voters.map((v, i) => [v, reading(i)])),
        production: withP.length > nv ? reading(nv) : null, before: ctx(Math.max(0, a - 30), a), after: ctx(b + 1, b + 31),
      });
    });
  }
  const spanRows = rows.filter(r => r.span != null);
  adjSummary[st] = { pages: pages.filter(x => x.stratum === st).length, pages_with_spans: pagesWithSpans, spans: spanRows.length, median_spans_per_page: (() => { const c = Object.values(Object.groupBy(spanRows, r => r.uid)).map(v => v.length).sort((x, y) => x - y); return c.length ? c[Math.floor(c.length / 2)] : 0; })() };
  fs.writeFileSync(path.join(HERE, `adjudication-${st}.jsonl.gz`), zlib.gzipSync(rows.map(r => JSON.stringify(r)).join('\n') + '\n'));
}
results.adjudication = adjSummary;
md.push('### Adjudication lists', '', '| stratum | pages | pages with spans | spans | median spans per page |', '|---|---:|---:|---:|---:|');
for (const [st, a] of Object.entries(adjSummary)) md.push(`| ${st} | ${a.pages} | ${a.pages_with_spans} | ${a.spans} | ${a.median_spans_per_page} |`);

const spend = ['L1', 'L2'].reduce((n, a) => n + [...reads[a].values()].reduce((m, r) => m + (r.cost || 0), 0), 0);
results.spend_usd = +spend.toFixed(4);
md.push('', `Paid spend (flash-lite L1 + L2, list price): $${spend.toFixed(3)}.`);
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(results, null, 1) + '\n');
fs.writeFileSync(path.join(HERE, 'results.md'), md.join('\n') + '\n');
console.log(md.filter(l => /^###|verdict|^\| (G|S|O|IA|P) /.test(l)).slice(0, 60).join('\n'));
