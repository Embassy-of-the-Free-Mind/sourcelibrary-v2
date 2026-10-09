#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/embed-format/score.mjs — the same arms and measures
 * over two separate 8–10K pools with 3072-d realtime vectors. This scores the
 * single 100K pool (build-pool-100k.mjs) from the Batch vectors (batch-embed.mjs),
 * with the gold additions in gold-100k/ and the bar in DESIGN-100k.md.
 *
 *   node --env-file=.env.production.local scripts/eval/embed-format/score-100k.mjs --dir D [--json out.json]
 *
 * Query vectors (plain and `task: search result | query: …`) are embedded once,
 * realtime, into D/queries-100k.json (a few cents, logged as eval/embed-format).
 * A hit: set A — the gold page or a confirmed equivalent page of another edition
 * (gold-100k/a-equivalents.json) in the top 10 pages of the pool; set B — a page
 * of any edition of an expected work in the top 10. Rows whose vector failed in
 * either format are left out of BOTH formats, so arms rank the same candidates.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson } from '../lib/agreement-stats.mjs';
import { binomTwoSided } from '../lib/paired-stats.mjs';
import { arg, readJsonl, MODELS, QUERY_FORMS, embedBatch, recordSpend } from './common.mjs';

const DIR = arg('--dir');
const K = 10;
const DIMS = 768;
const here = path.dirname(fileURLToPath(import.meta.url));
const G = path.join(here, 'gold-100k');
const rows = readJsonl(path.join(DIR, 'pool.jsonl'));
const N = rows.length;
const keyOf = (b, p) => `${b}:${p}`;
const rowByKey = new Map(rows.map((r) => [keyOf(r.book_id, r.page_number), r.i]));

// ── gold ──
const aOld = JSON.parse(fs.readFileSync(path.join(here, '../orig-lang-recall/gold.json'), 'utf8')).queries;
const aNew = JSON.parse(fs.readFileSync(path.join(G, 'a-new.json'), 'utf8')).queries;
const aEq = JSON.parse(fs.readFileSync(path.join(G, 'a-equivalents.json'), 'utf8')).equivalents;
const bOld = JSON.parse(fs.readFileSync(path.join(here, '../librarian-search/golden-set.json'), 'utf8')).queries;
const bNew = JSON.parse(fs.readFileSync(path.join(G, 'b-new.json'), 'utf8')).queries;
const setA = [...aOld.map((q) => ({ id: q.qid, query: q.query, part: 'orig', stratum: q.lang, book_id: q.book_id, page_number: q.page_number })),
  ...aNew.map((q) => ({ id: q.qid, query: q.query, part: 'new', stratum: q.lang, book_id: q.book_id, page_number: q.page_number }))].map((q) => {
  const gold = new Set([rowByKey.get(keyOf(q.book_id, q.page_number))]);
  for (const e of aEq.filter((x) => x.qid === q.id)) gold.add(rowByKey.get(keyOf(e.book_id, e.page_number)));
  if ([...gold].some((x) => x === undefined)) throw new Error(`${q.id}: gold page not in pool`);
  return { ...q, gold };
});
const workOfSlug = new Map(rows.filter((r) => r.slug).map((r) => [r.slug, r.work_id]));
const setB = [...bOld.map((q) => ({ id: q.id, query: q.query, part: 'orig', stratum: q.category, works: new Set(q.expected.map((e) => workOfSlug.get(e.book_slug)).filter(Boolean)), slugs: new Set(q.expected.map((e) => e.book_slug)) })),
  ...bNew.map((q) => ({ id: q.id, query: q.query, part: 'new', stratum: q.category, works: new Set([q.work_id]), slugs: new Set() }))].map((q) => {
  const gold = new Set(rows.filter((r) => q.slugs.has(r.slug) || (r.work_id && q.works.has(r.work_id))).map((r) => r.i));
  return { ...q, gold };
});

// ── query vectors ──
const qFile = path.join(DIR, 'queries-100k.json');
if (!fs.existsSync(qFile)) {
  const all = [...setA, ...setB];
  const out = {};
  let tokens = 0; let chars = 0;
  for (const form of ['plain', 'search']) {
    const texts = all.map((q) => QUERY_FORMS[form](q.query));
    for (let k = 0; k < texts.length; k += 50) {
      const r = await embedBatch(MODELS.preview, texts.slice(k, k + 50));
      tokens += r.tokens; chars += texts.slice(k, k + 50).reduce((s, t) => s + t.length, 0);
      r.vectors.forEach((v, j) => { (out[form] ??= {})[all[k + j].id] = v.slice(0, DIMS); });
    }
  }
  await recordSpend(DIR, { model: MODELS.preview, what: 'queries-100k', texts: all.length * 2, chars, tokens });
  fs.writeFileSync(qFile, JSON.stringify(out));
}
const Q = JSON.parse(fs.readFileSync(qFile, 'utf8'));
const unit = (v) => { const n = Math.hypot(...v) || 1; return Float32Array.from(v, (x) => x / n); };

// ── document vectors ──
function loadFormat(format) {
  const m = new Float32Array(N * DIMS);
  const have = new Uint8Array(N);
  const vdir = path.join(DIR, `vec-${format}`);
  for (const f of fs.readdirSync(vdir).filter((x) => x.endsWith('.rows.json'))) {
    const idx = JSON.parse(fs.readFileSync(path.join(vdir, f), 'utf8'));
    const b = fs.readFileSync(path.join(vdir, f.replace('.rows.json', '.f32')));
    const v = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    idx.forEach((i, k) => { m.set(v.subarray(k * DIMS, (k + 1) * DIMS), i * DIMS); have[i] = 1; });
  }
  return { m, have };
}
const D = { plain: loadFormat('plain'), prefix: loadFormat('prefix') };
// EXPLORATORY, added after the bar was scored (not part of it): the prefix only on
// OCR-only documents (src 'ocr'), translated documents left plain — the shape of a
// re-embed limited to the untranslated rows of page_translations.
D.mixed = { m: new Float32Array(D.plain.m), have: D.plain.have };
for (const r of rows) if (r.src === 'ocr') D.mixed.m.set(D.prefix.m.subarray(r.i * DIMS, (r.i + 1) * DIMS), r.i * DIMS);
const cand = [];
for (let i = 0; i < N; i++) if (D.plain.have[i] && D.prefix.have[i]) cand.push(i);
console.log(`pool ${N} rows; ${cand.length} with a vector in both formats`);
const candSet = new Set(cand);

function rankOf(qv, m, gold) {
  const q = unit(qv);
  const sc = new Float32Array(N);
  for (const i of cand) { let s = 0; const o = i * DIMS; for (let k = 0; k < DIMS; k++) s += m[o + k] * q[k]; sc[i] = s; }
  let best = -2; for (const i of gold) if (candSet.has(i) && sc[i] > best) best = sc[i];
  if (best === -2) return null;
  let better = 0; for (const i of cand) if (!gold.has(i) && sc[i] > best) better++;
  return better + 1;
}

const ARMS = [
  ['1f plain query, plain docs (production format)', 'plain', 'plain'],
  ['2 query prefix, plain docs', 'search', 'plain'],
  ['2d plain query, prefixed docs', 'plain', 'prefix'],
  ['4 prefix both sides', 'search', 'prefix'],
  ['x1 (exploratory) plain query, prefix on OCR-only docs', 'plain', 'mixed'],
  ['x2 (exploratory) query prefix, prefix on OCR-only docs', 'search', 'mixed'],
];
const BASE = ARMS[0][0];
function summarise(per) {
  const n = per.length; const hits = per.filter((r) => r.rank <= K).length;
  const strata = {};
  for (const r of per) { const s = (strata[r.stratum] ??= { n: 0, hits: 0 }); s.n++; if (r.rank <= K) s.hits++; }
  return { n, hits, recall: hits / n, ci: wilson(hits, n), mrr: per.reduce((s, r) => s + 1 / r.rank, 0) / n, top1: per.filter((r) => r.rank === 1).length, strata };
}
const out = { k: K, pool: N, candidates: cand.length, sets: {} };
for (const [name, set] of [['A', setA], ['B', setB]]) {
  const queries = set.filter((q) => [...q.gold].some((i) => candSet.has(i)));
  const per = {};
  for (const [arm, qf, df] of ARMS) per[arm] = queries.map((q) => ({ id: q.id, part: q.part, stratum: q.stratum, rank: rankOf(Q[qf][q.id], D[df].m, q.gold) }));
  const res = { queries: queries.length, dropped: set.length - queries.length, views: {} };
  for (const view of ['all', 'orig', 'new']) {
    const v = { arms: {} };
    for (const [arm] of ARMS) {
      const p = per[arm].filter((r) => view === 'all' || r.part === view);
      if (!p.length) continue;
      v.arms[arm] = summarise(p);
    }
    const base = per[BASE].filter((r) => view === 'all' || r.part === view);
    for (const [arm] of ARMS.slice(1)) {
      const p = per[arm].filter((r) => view === 'all' || r.part === view);
      if (!p.length) continue;
      let gained = 0, lost = 0, up = 0, down = 0;
      const strataGL = {};
      p.forEach((r, k) => {
        const b = base[k].rank;
        const s = (strataGL[r.stratum] ??= { n: 0, gained: 0, lost: 0 }); s.n++;
        if (r.rank <= K && b > K) { gained++; s.gained++; }
        if (r.rank > K && b <= K) { lost++; s.lost++; }
        if (r.rank < b) up++; else if (r.rank > b) down++;
      });
      v.arms[arm].vsBase = { delta: v.arms[arm].recall - v.arms[BASE].recall, gained, lost, rankBetter: up, rankWorse: down, signP: binomTwoSided(up, up + down), strata: strataGL };
    }
    res.views[view] = v;
    console.log(`\n### set ${name} · ${view} (${base.length} queries; baseline ${BASE})`);
    const strata = Object.keys(v.arms[BASE].strata);
    console.log(`| arm | R@10 | 95% | MRR | top-1 | Δ R@10 | gained/lost | ranks better/worse (sign p) | ${strata.join(' | ')} |`);
    console.log(`|${'---|'.repeat(8 + strata.length)}`);
    for (const [arm, a] of Object.entries(v.arms)) {
      const d = a.vsBase;
      console.log(`| ${arm} | ${a.recall.toFixed(2)} (${a.hits}/${a.n}) | [${a.ci.map((x) => x.toFixed(2)).join(', ')}] | ${a.mrr.toFixed(2)} | ${a.top1} | ${d ? (d.delta >= 0 ? '+' : '') + d.delta.toFixed(3) : 'base'} | ${d ? `${d.gained}/${d.lost}` : ''} | ${d ? `${d.rankBetter}/${d.rankWorse} (${d.signP.toFixed(3)})` : ''} | ${strata.map((s) => `${a.strata[s].hits}/${a.strata[s].n}`).join(' | ')} |`);
    }
  }
  res.perQuery = Object.fromEntries(queries.map((q, k) => [q.id, { part: q.part, stratum: q.stratum, query: q.query, gold_rows: q.gold.size, ...Object.fromEntries(ARMS.map(([arm]) => [arm, per[arm][k].rank])) }]));
  out.sets[name] = res;
}

// ── the bar (DESIGN-100k.md) ──
const verdict = {};
for (const [arm] of ARMS.slice(1)) {
  const a = out.sets.A.views.all.arms[arm].vsBase; const b = out.sets.B.views.all.arms[arm].vsBase;
  const reversals = [];
  if (a.lost > a.gained) reversals.push('set A');
  if (b.lost > b.gained) reversals.push('set B');
  for (const [s, x] of Object.entries(a.strata)) if (x.n >= 5 && x.lost > x.gained) reversals.push(`A/${s}`);
  verdict[arm] = { deltaA: +a.delta.toFixed(3), deltaB: +b.delta.toFixed(3), reversals, meetsBar: a.delta >= 0.05 && b.delta >= 0.05 && reversals.length === 0 };
}
out.verdict = verdict;
console.log('\n### against the bar (ΔR@10 ≥ +0.05 on A and B, no reversal)');
for (const [arm, v] of Object.entries(verdict)) console.log(`${arm}: A ${v.deltaA >= 0 ? '+' : ''}${v.deltaA}, B ${v.deltaB >= 0 ? '+' : ''}${v.deltaB}, reversals [${v.reversals.join(', ')}] → ${v.meetsBar ? 'MEETS' : 'misses'}`);
if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(out, null, 1));
