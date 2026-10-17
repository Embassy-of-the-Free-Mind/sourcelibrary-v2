// Question-shaped search (#6875), step 4: precision@10 per arm with question-level bootstrap CIs, paired differences
// against the served baselines, latency and $/query. Writes a summary JSON and prints the table.
//
// PRIOR ART: scripts/eval/lib/paired-stats.mjs (bootstrapCI, binomTwoSided — used here, not copied). Differences are
//   paired by question: the CI is a bootstrap of the per-question difference, and the sign test counts wins/losses.
//
//   node scripts/eval/question-search-6875/analyze.mjs <pooldir> <jevdir> <outdir> <summary.json>
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapCI, binomTwoSided, mean, resetSeed } from '../lib/paired-stats.mjs';

const [POOLS, JEV, OUT, SUMMARY] = process.argv.slice(2);
const arms = JSON.parse(fs.readFileSync(path.join(OUT, 'arms.json'), 'utf8'));
const ARMS = ['A', 'B', 'C', 'D'];
const NAMES = { A: 'search_translations (served)', B: 'search_concept (served)', C: 'Jev re-rank, full pool', D: 'Jev re-rank, first 300 + A + B' };
const CONC = 48;

// Makespan of n calls with these per-call latencies on CONC workers (greedy, in pool order).
function makespan(ms) {
  const w = new Array(CONC).fill(0);
  for (const m of ms) { let i = 0; for (let j = 1; j < CONC; j++) if (w[j] < w[i]) i = j; w[i] += m; }
  return Math.max(...w);
}
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

const rows = [];
for (const id of Object.keys(arms).sort()) {
  const jf = path.join(OUT, 'judge', `${id}.json`);
  if (!fs.existsSync(jf)) continue;
  const J = JSON.parse(fs.readFileSync(jf, 'utf8')).grades;
  const P = JSON.parse(fs.readFileSync(path.join(POOLS, `${id}.json`), 'utf8'));
  const jev = fs.readFileSync(path.join(JEV, `${id}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const jevBy = new Map(jev.map((r) => [r.key, r]));
  const rankOf = new Map(P.pool.map((p) => [p.key, p]));
  const small = P.pool.filter((p) => p.rank < 300 || p.lanes.includes('A') || p.lanes.includes('B')).map((p) => jevBy.get(p.key)?.ms).filter(Boolean);
  const r = { id, q: arms[id].q, pool_n: P.pool.length, kw_ms: P.kw_ms, sem_ms: P.sem_ms, A_ms: P.A.ms, B_ms: P.B.ms,
    jev_cost: jev.reduce((s, x) => s + (x.cost || 0), 0), jev_cost_small: small.length / jev.length * jev.reduce((s, x) => s + (x.cost || 0), 0),
    jev_wall_full_ms: makespan(jev.map((x) => x.ms)), jev_wall_small_ms: makespan(small), jev_call_ms: med(jev.map((x) => x.ms)) };
  for (const a of ARMS) {
    const keys = arms[id][a];
    const g = keys.map((k) => J[k]?.grade ?? 0);
    r[a] = { n: keys.length, strict: g.filter((x) => x === 2).length / 10, lenient: g.filter((x) => x >= 1).length / 10,
      found_by: keys.map((k) => rankOf.get(k)?.lanes.join('+')) };
  }
  rows.push(r);
}

resetSeed(6875);
const summary = { n_questions: rows.length, arms: {}, diffs: {}, by_kind: {} };
for (const a of ARMS) {
  for (const m of ['strict', 'lenient']) {
    const xs = rows.map((r) => r[a][m]);
    const ci = bootstrapCI(xs, 10000);
    summary.arms[a] = { ...(summary.arms[a] || {}), name: NAMES[a], [m]: { mean: mean(xs), ci } };
  }
}
for (const [x, y] of [['C', 'A'], ['C', 'B'], ['D', 'A'], ['D', 'B'], ['C', 'D'], ['B', 'A']]) {
  for (const m of ['strict', 'lenient']) {
    const dx = rows.map((r) => r[x][m] - r[y][m]);
    const wins = dx.filter((v) => v > 0).length, losses = dx.filter((v) => v < 0).length;
    summary.diffs[`${x}-${y}`] = { ...(summary.diffs[`${x}-${y}`] || {}), [m]: { delta: +mean(dx).toFixed(3), ci: bootstrapCI(dx, 10000).map((v) => +v.toFixed(3)), wins, losses, sign_p: +binomTwoSided(wins, wins + losses).toFixed(4) } };
  }
}
const questions = JSON.parse(fs.readFileSync(new URL('./questions.json', import.meta.url), 'utf8'));
const kindOf = new Map(questions.map((q) => [q.id, q.kind]));
for (const k of [...new Set(questions.map((q) => q.kind))]) {
  const rs = rows.filter((r) => kindOf.get(r.id) === k);
  if (!rs.length) continue;
  summary.by_kind[k] = Object.fromEntries(ARMS.map((a) => [a, +mean(rs.map((r) => r[a].strict)).toFixed(3)]));
  summary.by_kind[k].n = rs.length;
}
summary.latency_ms = {
  A_served_median: med(rows.map((r) => r.A_ms)), B_served_median: med(rows.map((r) => r.B_ms)),
  pool_keyword_deep_median: med(rows.map((r) => r.kw_ms)), pool_semantic_median: med(rows.map((r) => r.sem_ms)),
  jev_call_median: med(rows.map((r) => r.jev_call_ms)),
  jev_rerank_full_median: med(rows.map((r) => r.jev_wall_full_ms)), jev_rerank_small_median: med(rows.map((r) => r.jev_wall_small_ms)),
  concurrency: CONC,
};
summary.cost_usd = { jev_full_per_query: mean(rows.map((r) => r.jev_cost)), jev_small_per_query: mean(rows.map((r) => r.jev_cost_small)),
  jev_total: rows.reduce((s, r) => s + r.jev_cost, 0), pool_median: med(rows.map((r) => r.pool_n)) };
summary.per_question = rows.map((r) => ({ id: r.id, q: r.q, A: r.A.strict, B: r.B.strict, C: r.C.strict, D: r.D.strict,
  A_len: r.A.lenient, B_len: r.B.lenient, C_len: r.C.lenient, D_len: r.D.lenient, C_found_by: r.C.found_by }));
fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 1));

const pct = (x) => (100 * x).toFixed(0);
console.log(`n = ${rows.length} questions`);
for (const a of ARMS) {
  const s = summary.arms[a];
  console.log(`${a} ${NAMES[a].padEnd(32)} P@10 strict ${pct(s.strict.mean)}% [${pct(s.strict.ci[0])}–${pct(s.strict.ci[1])}]  lenient ${pct(s.lenient.mean)}% [${pct(s.lenient.ci[0])}–${pct(s.lenient.ci[1])}]`);
}
for (const [k, d] of Object.entries(summary.diffs)) console.log(k, 'strict', JSON.stringify(d.strict), 'lenient', JSON.stringify(d.lenient));
console.log('by kind', JSON.stringify(summary.by_kind));
console.log('latency', JSON.stringify(summary.latency_ms));
console.log('cost', JSON.stringify(summary.cost_usd));
for (const r of summary.per_question) console.log(r.id, r.A, r.B, r.C, r.D, '|', r.q);
