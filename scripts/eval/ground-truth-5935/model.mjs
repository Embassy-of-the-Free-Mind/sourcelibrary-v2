#!/usr/bin/env node
// #5935 steps 3–5: a partially pooled model of body CER (and the catastrophic share) by covariate cell,
// leave-one-reference-out across Kanripo / CBETA / VRI, the support rule, and the outputs.
//
// Model. One page per book (the arms' `primary` pages). Outcome 1 is log(CER + 0.005): the typical
// (geometric) CER of a cell is exp(θ) − 0.005. Cells nest script → kind (printed / handwritten) → engine →
// period → resolution band; each node's mean is shrunk toward its parent by the usual normal–normal
// weight n/σ² : 1/τ², with σ² the pooled within-node variance and τ² the between-node variance at that
// depth (method of moments, floored). Outcome 2, the share of pages with CER > 0.5, is shrunk the same
// way with a Beta prior of 20 pseudo-pages centred on the parent. Interpretable by construction: every
// estimate is its own data plus a stated pull toward the level above.
//
// Leave-one-reference-out: fit without one reference, predict its pages from the deepest trained node
// each page's covariates reach, and ask whether the reference's measured typical CER and catastrophic
// share fall inside the predicted 95% intervals. A page whose SCRIPT has no trained node has no support:
// no prediction, by the support rule. A "forced" prediction from the root is shown beside it only to
// show how wrong extrapolating across scripts would be.
//
// Support rule (step 4): a corpus cell (language × kind × engine × period, from the #5643 corpus profile,
// visible books) gets an estimate only when its script × kind node holds ≥ 10 referenced books. Every
// other cell — including every language with no typed reference yet — is "outside what we can estimate".
//
// PRIOR ART: scripts/eval/quality-covariates.mjs (#5623/#5643: the covariates, the corpus profile and an
// IRLS logistic regression over judged pages — unpooled, no reference CER, no held-out test; its period /
// resolution definitions are the ones lib.mjs copies); lib/agreement-stats.mjs (wilson). No multilevel
// model exists in scripts/eval.
//
//   node scripts/eval/ground-truth-5935/model.mjs [--date=YYYY-MM-DD]
// Reads /root/ground-truth-5935/{kanripo,cbeta,pali}.jsonl + floor.json; writes
// scripts/eval/output/ground-truth-5935-<date>.jsonl (per page) and
// scripts/eval/output/ground-truth-5935-<date>.estimates.json (per stratum; read by #5918 at build time).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { wilson, r3, mean, median } from './lib.mjs';

const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const WORK = argOf('work', '/root/ground-truth-5935');
const DATE = argOf('date', new Date().toISOString().slice(0, 10));
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const OUTDIR = path.join(ROOT, 'scripts/eval/output');
const EPS = 0.005;
const LEVELS = ['script', 'kind', 'engine', 'period', 'res_band'];
const MIN_SUPPORT_BOOKS = 10;
const PRIOR_PAGES = 20;
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// ── data ──────────────────────────────────────────────────────────────────────
const scriptKey = (r) => (r.ref === 'vri-cscd' ? `pali-${r.script === 'latin' ? 'roman' : r.script}` : 'cjk');
const all = [
  ...readJsonl(`${WORK}/kanripo.jsonl`),
  ...readJsonl(`${WORK}/cbeta.jsonl`),
  ...readJsonl(`${WORK}/pali.jsonl`),
];
const pages = all.filter((r) => r.status === 'scored' && r.primary).map((r) => ({ ...r, script: scriptKey(r), y: Math.log(r.cer + EPS) }));
const REFS = [...new Set(pages.map((r) => r.ref))];
const typical = (th) => Math.max(0, Math.exp(th) - EPS);

// ── the pooled tree ───────────────────────────────────────────────────────────
function fit(rows) {
  const sigma2 = (() => { // pooled within-leaf variance of y
    const g = new Map();
    for (const r of rows) { const k = LEVELS.map((l) => r[l]).join('|'); if (!g.has(k)) g.set(k, []); g.get(k).push(r.y); }
    let ss = 0, df = 0;
    for (const ys of g.values()) { const m = mean(ys); ss += ys.reduce((a, y) => a + (y - m) ** 2, 0); df += ys.length - 1; }
    return df > 0 ? ss / df : 1;
  })();
  const root = { key: [], n: rows.length, ybar: mean(rows.map((r) => r.y)), k: rows.filter((r) => r.catastrophic).length };
  root.theta = root.ybar; root.v = sigma2 / root.n; root.rate = root.k / root.n;
  root.books = new Set(rows.map((r) => r.book_id)).size;
  const nodes = new Map([['', root]]);
  const tau2 = {};
  let parentsKeys = [''];
  for (let d = 0; d < LEVELS.length; d++) {
    const groups = new Map();
    for (const r of rows) { const k = LEVELS.slice(0, d + 1).map((l) => r[l]).join('|'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    // τ² at this depth: spread of child means around their parents', beyond what sampling explains.
    const dev = [];
    for (const [k, rs] of groups) { const par = nodes.get(k.split('|').slice(0, d).join('|')); const yb = mean(rs.map((r) => r.y)); dev.push({ sq: (yb - par.ybar) ** 2, se: sigma2 / rs.length, w: rs.length }); }
    const t = dev.length > 1 ? dev.reduce((a, x) => a + x.sq - x.se, 0) / dev.length : 0;
    tau2[LEVELS[d]] = Math.max(t, 0.01);
    for (const [k, rs] of groups) {
      const par = nodes.get(k.split('|').slice(0, d).join('|'));
      const n = rs.length, ybar = mean(rs.map((r) => r.y)), kk = rs.filter((r) => r.catastrophic).length;
      const prec = n / sigma2 + 1 / tau2[LEVELS[d]];
      const w = (n / sigma2) / prec;
      const theta = w * ybar + (1 - w) * par.theta;
      const v = 1 / prec + (1 - w) ** 2 * par.v;
      const rate = (kk + PRIOR_PAGES * par.rate) / (n + PRIOR_PAGES);
      nodes.set(k, { key: k.split('|'), depth: d + 1, n, books: new Set(rs.map((r) => r.book_id)).size, ybar, theta, v, w, k: kk, rate, parent: par });
    }
    parentsKeys = [...groups.keys()];
  }
  return { nodes, sigma2, tau2, root };
}
const deepest = (model, r) => {
  let best = null;
  for (let d = 1; d <= LEVELS.length; d++) { const n = model.nodes.get(LEVELS.slice(0, d).map((l) => r[l]).join('|')); if (!n) break; best = n; }
  return best;
};
const cell = (n, sigma2) => ({
  books: n.books,
  typical_cer: r3(typical(n.theta)), typical_cer_ci95: [r3(typical(n.theta - 1.96 * Math.sqrt(n.v))), r3(typical(n.theta + 1.96 * Math.sqrt(n.v)))],
  raw_typical_cer: r3(typical(n.ybar)), pooling_weight: r3(n.w ?? 1),
  catastrophic_share: r3(n.rate), catastrophic_ci95: wilson(Math.round(n.rate * (n.n + PRIOR_PAGES)), n.n + PRIOR_PAGES).map(r3), catastrophic_raw: `${n.k}/${n.n}`,
});

const model = fit(pages);

// ── leave one reference out ──────────────────────────────────────────────────
const loro = [];
for (const held of REFS) {
  const train = pages.filter((r) => r.ref !== held), test = pages.filter((r) => r.ref === held);
  const m = fit(train);
  const preds = test.map((r) => ({ r, node: deepest(m, r) }));
  const supported = preds.filter((p) => p.node);
  const measured = { books: test.length, typical_cer: r3(typical(mean(test.map((r) => r.y)))), catastrophic: `${test.filter((r) => r.catastrophic).length}/${test.length}`, catastrophic_share: r3(test.filter((r) => r.catastrophic).length / test.length) };
  const predict = (ps, label) => {
    if (!ps.length) return null;
    // The reference's mean log CER: average of the cells' θ; its variance adds the extrapolation term τ²
    // of the deepest level reached (a held-out reference is a new cell, not more pages of an old one).
    const th = mean(ps.map((p) => p.node.theta));
    const dlev = LEVELS[Math.min(...ps.map((p) => p.node.depth ?? 0)) - 1] || LEVELS[0];
    const v = mean(ps.map((p) => p.node.v)) + (m.tau2[dlev] ?? 1);
    const lo = th - 1.96 * Math.sqrt(v), hi = th + 1.96 * Math.sqrt(v);
    const yMeasured = mean(ps.map((p) => p.r.y));
    const rate = mean(ps.map((p) => p.node.rate));
    const nEff = PRIOR_PAGES;   // the prediction's own weight: a prior's worth of pages
    const rci = wilson(Math.round(rate * nEff), nEff);
    const kMeas = ps.filter((p) => p.r.catastrophic).length / ps.length;
    return {
      basis: label, pages: ps.length, deepest_level: dlev,
      predicted_typical_cer: r3(typical(th)), predicted_ci95: [r3(typical(lo)), r3(typical(hi))],
      measured_typical_cer: r3(typical(yMeasured)), cer_inside: yMeasured >= lo && yMeasured <= hi,
      predicted_catastrophic: r3(rate), predicted_catastrophic_ci95: rci.map(r3), measured_catastrophic: r3(kMeas), catastrophic_inside: kMeas >= rci[0] && kMeas <= rci[1],
    };
  };
  const forced = preds.map((p) => ({ r: p.r, node: p.node || { ...m.root, depth: 1 } }));
  loro.push({
    held_out: held, trained_on: REFS.filter((x) => x !== held), measured,
    supported_pages: supported.length, unsupported_pages: test.length - supported.length,
    prediction: predict(supported, 'supported pages, deepest trained cell'),
    forced_from_root: supported.length < test.length ? predict(forced.filter((p) => !preds.find((q) => q.r === p.r).node), 'unsupported pages forced to the root (NOT an estimate: shown to size the extrapolation error)') : null,
  });
}

// ── corpus cells and the support rule ─────────────────────────────────────────
const profileFile = fs.readdirSync(OUTDIR).filter((f) => /^corpus-page-profile-.*-typeface\.jsonl\.gz$/.test(f)).sort().pop();
const profile = zlib.gunzipSync(fs.readFileSync(path.join(OUTDIR, profileFile))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const engineOfModel = (m) => { const s = String(m || '').toLowerCase(); return /paddle/.test(s) ? 'paddleocr-vl' : /flash-lite/.test(s) ? 'gemini-flash-lite' : /flash/.test(s) ? 'gemini-flash' : /pro/.test(s) ? 'gemini-pro' : s || 'none'; };
const corpusScript = (b) => {
  const lang = String(b.language || '');
  if (/chinese/i.test(lang) || (b.family === 'cjk' && !/japanese|korean/i.test(lang))) return 'cjk';
  if (/^pali/i.test(lang)) return b.script === 'handwritten' ? 'pali-sinhala' : 'pali-roman';
  return `${lang || 'unknown'}`.toLowerCase();
};
const cells = new Map();
for (const b of profile) {
  const c = { script: corpusScript(b), language: b.language || 'unknown', kind: b.script === 'handwritten' ? 'handwritten' : b.script === 'printed' ? 'printed' : 'unknown', engine: engineOfModel(b.ocr_model), period: b.period || 'unknown' };
  const k = [c.script, c.kind, c.engine, c.period].join('|');
  if (!cells.has(k)) cells.set(k, { ...c, books: 0, pages: 0 });
  const x = cells.get(k); x.books++; x.pages += b.pages_count || 0;
}
const floor = fs.existsSync(`${WORK}/floor.json`) ? JSON.parse(fs.readFileSync(`${WORK}/floor.json`, 'utf8')) : {};
const floorFor = (script) => (script === 'cjk' ? { 'kanripo-wyg': floor['kanripo-wyg'] || null, cbeta: floor.cbeta || null } : script.startsWith('pali') ? { 'vri-cscd': floor['vri-cscd'] || null } : null);
const strata = [];
for (const c of cells.values()) {
  const sk = model.nodes.get([c.script, c.kind].join('|'));
  const supported = !!sk && sk.books >= MIN_SUPPORT_BOOKS;
  let node = null;
  if (supported) { node = sk; for (const key of [[c.script, c.kind, c.engine], [c.script, c.kind, c.engine, c.period]]) { const n = model.nodes.get(key.join('|')); if (n) node = n; else break; } }
  strata.push({
    script: c.script, language: c.language, kind: c.kind, engine: c.engine, period: c.period, corpus_books: c.books, corpus_pages: c.pages,
    support: supported ? 'estimated' : 'outside-what-we-can-estimate',
    support_reason: supported ? `${sk.books} referenced books in ${c.script} × ${c.kind}; estimate from cell ${node.key.join(' × ')}` : sk ? `only ${sk.books} referenced books in ${c.script} × ${c.kind} (< ${MIN_SUPPORT_BOOKS})` : `no typed-reference pages in ${c.script} × ${c.kind}`,
    estimate: supported ? { ...cell(node, model.sigma2), basis: node.key.length >= 3 ? 'referenced pages from this engine' : 'pooled across engines (no referenced page from this engine; leave-one-out says this transfer held for Chinese)', measure: 'accuracy (typed reference, extrapolated by covariate cell)', floor: floorFor(c.script) } : null,
  });
}
strata.sort((a, b) => b.corpus_pages - a.corpus_pages);
const totPages = strata.reduce((a, s) => a + s.corpus_pages, 0), estPages = strata.filter((s) => s.support === 'estimated').reduce((a, s) => a + s.corpus_pages, 0);

// ── outputs ───────────────────────────────────────────────────────────────────
fs.mkdirSync(OUTDIR, { recursive: true });
const perPage = all.map((r) => ({ ...r, ...(r.status === 'scored' ? { script: scriptKey(r) } : {}) }));
fs.writeFileSync(path.join(OUTDIR, `ground-truth-5935-${DATE}.jsonl`), perPage.map((r) => JSON.stringify(r)).join('\n') + '\n');
const byRef = Object.fromEntries(REFS.map((ref) => {
  const rs = pages.filter((r) => r.ref === ref);
  const allScored = all.filter((r) => r.ref === ref && r.status === 'scored');
  const k = rs.filter((r) => r.catastrophic).length;
  return [ref, { books: rs.length, median_cer: r3(median(rs.map((r) => r.cer))), mean_cer: r3(mean(rs.map((r) => r.cer))), typical_cer: r3(typical(mean(rs.map((r) => r.y)))), catastrophic: `${k}/${rs.length}`, catastrophic_ci95: wilson(k, rs.length).map(r3), engines: rs.reduce((m, r) => ((m[r.engine] = (m[r.engine] || 0) + 1), m), {}), all_scored_pages: allScored.length, floor: floor[ref] || null }];
}));
const nodesOut = [...model.nodes.values()].filter((n) => n.depth).map((n) => ({ cell: Object.fromEntries(LEVELS.slice(0, n.depth).map((l, i) => [l, n.key[i]])), ...cell(n, model.sigma2) }));
const est = {
  issue: 5935, as_of: DATE, measure: 'accuracy', unit: 'body CER after alignment (margins excluded; Han variants / Pali niggahita and circumflex folded); one page per book',
  generated_by: 'scripts/eval/ground-truth-5935/model.mjs',
  catastrophic_threshold: 0.5, min_support_books: MIN_SUPPORT_BOOKS,
  model: { levels: LEVELS, outcome: `log(CER + ${EPS}); typical CER = geometric mean`, sigma2: r3(model.sigma2), tau2: Object.fromEntries(Object.entries(model.tau2).map(([k, v]) => [k, r3(v)])), catastrophic_prior_pages: PRIOR_PAGES },
  references: byRef,
  leave_one_reference_out: loro,
  cells: nodesOut,
  coverage: { corpus_profile: profileFile, corpus_pages: totPages, estimated_pages: estPages, estimated_share: r3(estPages / totPages) },
  strata,
  caveats: [
    'Typed references are canonical and cleanly printed or copied, so the referenced pages are easier than the corpus by construction; the support rule and the leave-one-out test are the guard, not a correction.',
    'CER includes genuine textual variants and the reference\'s own errors; read it beside the floor (share of differences on the 30 worst pages per reference that were not ours).',
    'Kanripo pages with no trusted leaf (unaligned) and CBETA pages without two fitted neighbours are not scored; their counts are in the per-page file.',
  ],
};
fs.writeFileSync(path.join(OUTDIR, `ground-truth-5935-${DATE}.estimates.json`), JSON.stringify(est, null, 1));
console.log(JSON.stringify({ references: byRef, loro, coverage: est.coverage, sigma2: est.model.sigma2, tau2: est.model.tau2 }, null, 1));
console.log('supported strata', strata.filter((s) => s.support === 'estimated').map((s) => `${s.script}|${s.kind}|${s.engine}|${s.period} ${s.corpus_books}b ${s.estimate.typical_cer} [${s.estimate.typical_cer_ci95}] cat ${s.estimate.catastrophic_share}`).join('\n'));
console.log('top unsupported', strata.filter((s) => s.support !== 'estimated').slice(0, 12).map((s) => `${s.script}|${s.kind}|${s.engine}|${s.period} ${s.corpus_pages}p`).join('\n'));
