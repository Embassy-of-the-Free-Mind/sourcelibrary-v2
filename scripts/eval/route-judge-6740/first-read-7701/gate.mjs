// PRIOR ART: scripts/eval/route-judge-6740/fresh-gate-7517.mjs (the same Beta(1+k, 1+n-k) draws, for #7517's rule).
// This applies RULE.md (beside the #7701 results), fixed before judging, to arm A; the router table decides with arm B.
//   node scripts/eval/route-judge-6740/first-read-7701/gate.mjs <route-judge DIR>
// #7701 gate: (a) all drawn pages, (b) written set; Beta(1+k,1+n-k) P(acc>=0.8), seeded draws.
import fs from 'node:fs';
const R = process.argv[2];
const key = JSON.parse(fs.readFileSync(`${R}/key.json`)), s = JSON.parse(fs.readFileSync(`${R}/sample.json`));
const V = new Map(fs.readFileSync(`${R}/verdicts-opus.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
let seed = 7701; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
const normal = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const gamma = (k) => { if (k < 1) return gamma(k + 1) * rnd() ** (1 / k); const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { x = normal(); v = 1 + c * x; } while (v <= 0); v = v ** 3; const u = rnd(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; } };
const post = (k, n) => { const xs = Array.from({ length: 40000 }, () => { const a = gamma(1 + k), b = gamma(1 + n - k); return a / (a + b); }).sort((a, b) => a - b); return { mean: +((1 + k) / (2 + n)).toFixed(3), ci90: [+xs[2000].toFixed(3), +xs[38000].toFixed(3)], p_ge_080: +(xs.filter((x) => x >= 0.8).length / xs.length).toFixed(3) }; };
const wt = (v) => (v.defects || []).some((d) => d.severity === 'wrong_text');
const out = {};
for (const [cell, cs] of Object.entries(s.cells)) {
  const route = cs.routes[0];
  const dry = JSON.parse(fs.readFileSync(`${R}/dry-${cell}.json`));
  const written = new Set(dry.written_page_ids?.length ? dry.written_page_ids : []);
  // dry runs record no written_page_ids: rebuild from skipped_pages (every drawn page not skipped would be written)
  const skipped = dry.skipped_pages || {};
  const drawn = cs.pages.map((p) => p.page_id);
  const willWrite = drawn.filter((id) => !(id in skipped));
  const ver = (id) => { const k = key.find((x) => x.cell === cell && x.route === route && x.kind === 'item' && x.page_id === id); return k && V.get(k.judged_as); };
  const ctrl = key.filter((x) => x.cell === cell && x.kind === 'wrong_page').map((k) => V.get(k.judged_as));
  const A = { n: drawn.length, k: drawn.filter((id) => ver(id)?.accept).length, w: drawn.filter((id) => ver(id) && wt(ver(id))).length };
  const B = { n: willWrite.length, k: willWrite.filter((id) => ver(id)?.accept).length, w: willWrite.filter((id) => ver(id) && wt(ver(id))).length };
  const pb = post(B.k, B.n), pa = post(A.k, A.n);
  const control = ctrl.length === 2 && ctrl.every((v) => v && !v.accept && Number(v.fidelity) <= 2);
  const passWT = B.w / B.n <= 0.04, notHold = pb.p_ge_080 >= 0.9;
  out[cell] = { route, control_passed: control,
    all_drawn: { accept: `${A.k}/${A.n}`, wrong_text: `${A.w}/${A.n}`, posterior: pa, wrong_text_bar_004: A.w / A.n <= 0.04 },
    written: { accept: `${B.k}/${B.n}`, wrong_text: `${B.w}/${B.n}`, posterior: pb, wrong_text_bar_004: passWT, hold: !notHold },
    not_written: Object.entries(skipped).filter(([id]) => drawn.includes(id)).reduce((t, [, w]) => { const k = w.replace(/:.*/, ''); t[k] = (t[k] || 0) + 1; return t; }, {}),
    wrong_text_pages: drawn.filter((id) => ver(id) && wt(ver(id))).map((id) => ({ page_id: id, written: willWrite.includes(id), defects: ver(id).defects.filter((d) => d.severity === 'wrong_text').map((d) => `${d.class}: ${String(d.quote).slice(0, 80)} — ${d.what ?? ''}`.slice(0, 220)) })),
    decision: control && passWT && notHold ? 'SCHEDULE' : 'NOT SCHEDULED' };
}
fs.writeFileSync(`${R}/gate-7701.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
