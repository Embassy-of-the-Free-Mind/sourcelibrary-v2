// PRIOR ART: analyze.mjs (same directory) — the preregistered measures for the original arms; its tables are
// fixed to F0/F1/L1/P. This adds the plain-prompt arms of the prereg addendum (FP, LP) with the SAME scoring
// (score-lib.mjs), CI and phi definitions, and compares them with F0 (same model, v19.1 prompt) and P (Pro).
// Usage: node analyze-plain.mjs <slots-final.json> <texts.json> <reads.jsonl> <reads-plain.jsonl> <outDir>
import fs from 'node:fs';
import { norm, scoreRead } from './score-lib.mjs';
const [slotsF, textsF, readsF, plainF, outDir] = process.argv.slice(2);
const S = JSON.parse(fs.readFileSync(slotsF, 'utf8'));
const T = JSON.parse(fs.readFileSync(textsF, 'utf8'));
const jl = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const R = jl(readsF), RP = jl(plainF);

// exact CI (same as analyze.mjs)
function lgamma(x) { const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x); x -= 1; let a = c[0]; const t = x + g + 0.5; for (let i = 1; i < 9; i++) a += c[i] / (x + i); return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a); }
const lbeta = (a, b) => lgamma(a) + lgamma(b) - lgamma(a + b);
function ibeta(x, a, b) { if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta(a, b));
  const cf = (x, a, b) => { let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap; d = 1 / d; let h = d;
    for (let m = 1; m <= 300; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break; } return h; };
  return x < (a + 1) / (a + b + 2) ? bt * cf(x, a, b) / a : 1 - bt * cf(1 - x, b, a) / b; }
function bq(p, a, b) { let lo = 0, hi = 1; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (ibeta(m, a, b) < p) lo = m; else hi = m; } return (lo + hi) / 2; }
const ci = (k, n) => [k === 0 ? 0 : bq(0.025, k, n - k + 1), k === n ? 1 : bq(0.975, k + 1, n - k)];
const fmt = (k, n) => n ? `${k}/${n} = ${(100 * k / n).toFixed(0)}% [${(100 * ci(k, n)[0]).toFixed(0)}–${(100 * ci(k, n)[1]).toFixed(0)}]` : '0/0';

const cache = new Map(); const reads = {}; let fallbacks = 0, n = 0;
for (const s of S) {
  const t = T.find((x) => x.page_id === s.page_id); const ref = norm(t.flash);
  const add = (arm, text) => { const r = scoreRead(ref, text, s, cache); fallbacks += r.fallback; n++; ((reads[s.id] ||= {})[arm] ||= []).push(r); };
  add('P', t.pro);
  for (const r of [...R, ...RP].filter((r) => r.page_id === s.page_id).sort((a, b) => a.sample - b.sample)) add(r.arm === 'P1' ? 'P' : r.arm, r.text);
}
const sets = { all: S, disputed: S.filter((s) => s.kind === 'disputed'), control: S.filter((s) => s.kind === 'control') };
const W = (x) => !x.right;
const out = { calls: RP.length, cost_usd: RP.reduce((a, r) => a + r.usd, 0), by_arm: {}, tables: {} };
for (const r of RP) { const b = (out.by_arm[r.arm] ||= { calls: 0, usd: 0, in: 0, out: 0 }); b.calls++; b.usd += r.usd; b.in += r.in; b.out += r.out; }
const L = [];
L.push('# Plain-prompt arms (#6184 prereg addendum): results', '',
  `${S.length} slots on ${new Set(S.map((s) => s.page_id)).size} pages; ${RP.length} new reads (FP, LP ×3 per page), metered $${out.cost_usd.toFixed(3)} at list price; ${fallbacks} of ${n} slot-reads (all arms re-scored here) decided by the page-wide fallback.`,
  '', ...Object.entries(out.by_arm).map(([a, b]) => `- ${a}: ${b.calls} calls, $${(b.usd / b.calls).toFixed(4)}/page, mean in ${(b.in / b.calls).toFixed(0)} / out ${(b.out / b.calls).toFixed(0)} tokens`));

L.push('', '## Accuracy vs print (reads right / reads, pooled over samples)', '', '| arm | all | disputed | control |', '|---|---|---|---|');
const acc = {};
for (const arm of ['F0', 'FP', 'LP', 'L1', 'P']) {
  const row = [arm];
  for (const [nm, set] of Object.entries(sets)) { let k = 0, m = 0; for (const s of set) for (const x of reads[s.id][arm] || []) { m++; k += x.right; } row.push(fmt(k, m)); (acc[arm] ||= {})[nm] = { k, m }; }
  L.push(`| ${row.join(' | ')} |`);
}
out.tables.accuracy = acc;
for (const arm of ['FP', 'LP']) { const per = [0, 1, 2].map((i) => S.filter((s) => reads[s.id][arm][i]?.right).length); L.push('', `${arm} per sample (all 63): ${per.join(', ')}`); }

// decision rule (addendum): FP pooled per-read accuracy on all slots ≥ 85% (Pro's CI lower bound) → PROMPT
const fp = acc.FP.all, pr = acc.P.all, prLo = ci(pr.k, pr.m)[0];
const verdict = fp.k / fp.m >= 0.85 ? 'PROMPT' : 'MODEL';
out.decision = { fp: fp.k / fp.m, pro: pr.k / pr.m, pro_ci_lo: prLo, threshold: 0.85, verdict };
L.push('', `**Decision rule (addendum):** FP ${(100 * fp.k / fp.m).toFixed(1)}% vs threshold 85% (Pro ${(100 * pr.k / pr.m).toFixed(1)}%, CI lower ${(100 * prLo).toFixed(1)}%) → lever is the **${verdict}**.`);

// within-arm variation at T 0.1
const key = (x) => x.right ? 'PRINT' : x.span;
L.push('', '## Within-arm variation at T 0.1 (slot varies across the 3 samples)', '');
for (const arm of ['FP', 'LP']) L.push(`- ${arm}: ${Object.entries(sets).map(([nm, set]) => `${nm} ${fmt(set.filter((s) => new Set(reads[s.id][arm].map(key)).size > 1).length, set.length)}`).join('; ')}`);

// phi
function phi(a, b) { let n11 = 0, n10 = 0, n01 = 0, n00 = 0; for (let i = 0; i < a.length; i++) { if (a[i] && b[i]) n11++; else if (a[i]) n10++; else if (b[i]) n01++; else n00++; }
  const d = Math.sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00)); return { phi: d ? (n11 * n00 - n10 * n01) / d : NaN, cond: n11 + n10 ? n11 / (n11 + n10) : NaN }; }
const vec = (set, arm, i) => set.map((s) => W(reads[s.id][arm][i]));
const cnt = (arm) => reads[S[0].id][arm].length;
function pairs(set, A, B) { const res = [];
  for (let i = 0; i < cnt(A); i++) for (let j = 0; j < cnt(B); j++) { if (A === B && j <= i) continue; res.push(phi(vec(set, A, i), vec(set, B, j))); }
  const mean = (k) => { const v = res.map((r) => r[k]).filter((x) => !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
  return { phi: mean('phi'), cond: mean('cond'), pairs: res.length }; }
L.push('', '## Pairwise error correlation (phi; P(B✗|A✗)), mean over all read pairs', '', '| pair | all: phi | all: P(B✗|A✗) | control: phi | control: P(B✗|A✗) |', '|---|---|---|---|---|');
const f2 = (x) => isNaN(x) ? '—' : x.toFixed(2);
for (const [A, B] of [['FP', 'FP'], ['FP', 'P'], ['F0', 'P'], ['FP', 'F0'], ['FP', 'F1'], ['LP', 'LP'], ['LP', 'P'], ['FP', 'LP'], ['P', 'P']]) {
  const a = pairs(S, A, B), c = pairs(sets.control, A, B); out.tables[`phi ${A}-${B}`] = { all: a, control: c };
  L.push(`| ${A} vs ${B} | ${f2(a.phi)} | ${f2(a.cond)} | ${f2(c.phi)} | ${f2(c.cond)} |`);
}

// direction
L.push('', '## Direction of wrong reads', '', '| arm | omission | insertion | substitution |', '|---|---|---|---|');
for (const arm of ['F0', 'FP', 'LP', 'P']) { let o = 0, i = 0, u = 0; for (const s of S) for (const x of reads[s.id][arm]) if (!x.right) { const d = x.span.length - norm(s.core || s.print).length; if (d < 0) o++; else if (d > 0) i++; else u++; } L.push(`| ${arm} | ${o} | ${i} | ${u} |`); }

// majority
const strict = (arr) => arr.filter((x) => x.right).length * 2 > arr.length;
L.push('', '## Majority vote = print (strict)', '', '| voters | all | disputed | control |', '|---|---|---|---|');
for (const [label, f] of [['3× FP', (s) => reads[s.id].FP], ['3× LP', (s) => reads[s.id].LP], ['3× Pro', (s) => reads[s.id].P],
  ['FP[0] + LP[0] + Pro P0', (s) => [reads[s.id].FP[0], reads[s.id].LP[0], reads[s.id].P[0]]]]) {
  const row = [label]; for (const set of Object.values(sets)) row.push(fmt(set.filter((s) => strict(f(s))).length, set.length)); L.push(`| ${row.join(' | ')} |`);
}

// slots where Pro (majority) and FP (majority) differ
L.push('', '## Per slot (1 = right; F0 | FP×3 | LP×3 | P0 P1 P1)', '');
const b = (a) => a.map((x) => +x.right).join('');
for (const s of S) { const r = reads[s.id]; L.push(`- ${s.id} ${s.kind} ${s.book_id.slice(-4)}:${s.page} ${s.print} — ${b(r.F0)} | ${b(r.FP)} | ${b(r.LP)} | ${b(r.P)}`); }
out.per_slot = S.map((s) => ({ id: s.id, kind: s.kind, reads: Object.fromEntries(['FP', 'LP'].map((k) => [k, reads[s.id][k].map((x) => ({ right: x.right, span: x.span, fallback: x.fallback }))])) }));
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}/results.md`, L.join('\n') + '\n');
fs.writeFileSync(`${outDir}/results.json`, JSON.stringify(out, null, 1));
console.log(L.join('\n'));
