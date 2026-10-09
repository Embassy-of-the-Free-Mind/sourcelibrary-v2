// PRIOR ART: none for per-token sample-vs-family error correlation — looked in scripts/eval/lib/ (metrics.mjs,
// text-distance.mjs score whole pages) and the #6184 tie-break files (majority only). Implements the measures
// fixed in PREREGISTRATION-reader-diversity-6184.md.
// Usage: node analyze.mjs <slots-final.json> <texts.json> <reads.jsonl> <outDir>
import fs from 'node:fs';
import { norm, scoreRead } from './score-lib.mjs';
const [slotsF, textsF, readsF, outDir] = process.argv.slice(2);
const S = JSON.parse(fs.readFileSync(slotsF, 'utf8'));
const T = JSON.parse(fs.readFileSync(textsF, 'utf8'));
const R = fs.readFileSync(readsF, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// --- exact binomial CI (Clopper–Pearson) via beta quantile bisection
function lbeta(a, b) { return lgamma(a) + lgamma(b) - lgamma(a + b); }
function lgamma(x) { const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x); x -= 1; let a = c[0]; const t = x + g + 0.5; for (let i = 1; i < 9; i++) a += c[i] / (x + i); return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a); }
function ibeta(x, a, b) { // regularized incomplete beta, continued fraction
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta(a, b));
  const cf = (x, a, b) => { let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap; d = 1 / d; let h = d;
    for (let m = 1; m <= 300; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break; } return h; };
  return x < (a + 1) / (a + b + 2) ? bt * cf(x, a, b) / a : 1 - bt * cf(1 - x, b, a) / b; }
function bq(p, a, b) { let lo = 0, hi = 1; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (ibeta(m, a, b) < p) lo = m; else hi = m; } return (lo + hi) / 2; }
const ci = (k, n) => n === 0 ? [NaN, NaN] : [k === 0 ? 0 : bq(0.025, k, n - k + 1), k === n ? 1 : bq(0.975, k + 1, n - k)];
const fmt = (k, n) => n ? `${k}/${n} = ${(100 * k / n).toFixed(0)}% [${(100 * ci(k, n)[0]).toFixed(0)}–${(100 * ci(k, n)[1]).toFixed(0)}]` : '0/0';

// --- score every read on every slot
const cache = new Map();
const reads = {};   // slotId -> arm -> [{right, span}]
let fallbacks = 0, n = 0;
for (const s of S) {
  const t = T.find((x) => x.page_id === s.page_id); const ref = norm(t.flash);
  const add = (arm, text) => { const r = scoreRead(ref, text, s, cache); fallbacks += r.fallback; n++; ((reads[s.id] ||= {})[arm] ||= []).push(r); };
  add('Fs', t.flash);                        // stored served Flash read (Batch, T 0.1) — A-vs-A
  add('Ls', t.lite);                         // stored lite read
  add('P', t.pro);                           // P0: stored Pro read (T 0)
  for (const r of R.filter((r) => r.page_id === s.page_id).sort((a, b) => a.sample - b.sample)) add(r.arm === 'P1' ? 'P' : r.arm, r.text);
}
const sets = { all: S, disputed: S.filter((s) => s.kind === 'disputed'), control: S.filter((s) => s.kind === 'control') };
const out = { fallbacks, scored: n, cost_usd: R.reduce((a, r) => a + r.usd, 0), calls: R.length, by_arm_calls: {}, tables: {} };
for (const r of R) out.by_arm_calls[r.arm] = (out.by_arm_calls[r.arm] || 0) + 1;
const lines = [];
const W = (x) => !x.right;
const key = (x) => x.right ? 'PRINT' : x.span;
const varies = (arr) => new Set(arr.map(key)).size > 1;

// 1. accuracy per arm (pooled over samples)
lines.push('## 1. Accuracy vs print (reads right / reads)', '', '| arm | all | disputed | control |', '|---|---|---|---|');
for (const arm of ['F0', 'Fs', 'F1', 'L1', 'Ls', 'P']) {
  const row = [arm];
  for (const [nm, set] of Object.entries(sets)) { let k = 0, m = 0; for (const s of set) for (const x of reads[s.id][arm] || []) { m++; k += x.right; } row.push(fmt(k, m)); }
  lines.push(`| ${row.join(' | ')} |`);
}
// per-sample accuracy for F1/L1
for (const arm of ['F1', 'L1', 'P']) { const per = []; for (let i = 0; i < 5; i++) { let k = 0, m = 0; for (const s of S) { const x = reads[s.id][arm]?.[i]; if (x) { m++; k += x.right; } } if (m) per.push(`${k}/${m}`); } lines.push('', `${arm} per sample (all slots): ${per.join(', ')}`); }

// 2. within-arm disagreement
lines.push('', '## 2. Within-arm disagreement (slot varies across samples)', '', '| arm | all | disputed | control |', '|---|---|---|---|');
for (const arm of ['F1', 'L1', 'P']) { const row = [arm]; for (const set of Object.values(sets)) { const k = set.filter((s) => varies(reads[s.id][arm])).length; row.push(fmt(k, set.length)); } lines.push(`| ${row.join(' | ')} |`); }
// F0 vs stored served (A-vs-A at T 0.1)
{ const k = S.filter((s) => key(reads[s.id].F0[0]) !== key(reads[s.id].Fs[0])).length; lines.push('', `A-vs-A at served config (fresh F0 vs stored Batch Flash read): ${k}/${S.length} slots differ`); }

// 3. (a) confident vs uncertain
lines.push('', '## 3. (a) Confident vs uncertain errors', '');
function confUnc(errSlots, arm) { let conf = 0, unc = 0, rightAll = 0; for (const s of errSlots) { const a = reads[s.id][arm]; if (!varies(a)) { if (a[0].right) rightAll++; else conf++; } else unc++; } return { conf, unc, rightAll, n: errSlots.length }; }
const majWrong = (arr) => arr.filter(W).length * 2 > arr.length;
for (const [label, errSlots, arm] of [
  ['F0 (served config) wrong → F1 samples', S.filter((s) => W(reads[s.id].F0[0])), 'F1'],
  ['stored served Flash wrong → F1 samples', S.filter((s) => W(reads[s.id].Fs[0])), 'F1'],
  ['L1 majority wrong → L1 samples', S.filter((s) => majWrong(reads[s.id].L1)), 'L1'],
  ['Pro majority wrong → Pro reads', S.filter((s) => majWrong(reads[s.id].P)), 'P'],
]) { const r = confUnc(errSlots, arm); out.tables[label] = r; lines.push(`- ${label}: n=${r.n}; confident (all samples the same wrong token) ${fmt(r.conf, r.n)}; uncertain (samples vary) ${fmt(r.unc, r.n)}; all samples right ${r.rightAll}`); }

// 4. disagreement predicts error?
lines.push('', '## 4. Does "any sample differs" flag the error?', '');
function auc(scores, labels) { let num = 0, den = 0; for (let i = 0; i < scores.length; i++) if (labels[i]) for (let j = 0; j < scores.length; j++) if (!labels[j]) { den++; num += scores[i] > scores[j] ? 1 : scores[i] === scores[j] ? 0.5 : 0; } return den ? num / den : NaN; }
const minority = (arr) => { const c = {}; for (const x of arr) c[key(x)] = (c[key(x)] || 0) + 1; return 1 - Math.max(...Object.values(c)) / arr.length; };
for (const [label, arm, target] of [
  ['F1 disagreement → F0 wrong', 'F1', (s) => W(reads[s.id].F0[0])],
  ['F1 disagreement → stored served Flash wrong', 'F1', (s) => W(reads[s.id].Fs[0])],
  ['F1 disagreement → F1 majority wrong', 'F1', (s) => majWrong(reads[s.id].F1)],
  ['L1 disagreement → L1 majority wrong', 'L1', (s) => majWrong(reads[s.id].L1)],
  ['Pro (3 reads) disagreement → stored served Flash wrong', 'P', (s) => W(reads[s.id].Fs[0])],
]) for (const [nm, set] of [['all', S], ['control', sets.control]]) {
  const flag = set.map((s) => varies(reads[s.id][arm])), lab = set.map(target), sc = set.map((s) => minority(reads[s.id][arm]));
  const tp = flag.filter((f, i) => f && lab[i]).length, fp = flag.filter((f, i) => f && !lab[i]).length, pos = lab.filter(Boolean).length;
  lines.push(`- ${label} [${nm}]: errors ${pos}/${set.length}; recall ${fmt(tp, pos)}; precision ${fmt(tp, tp + fp)}; AUC ${auc(sc, lab).toFixed(2)}`);
  out.tables[`${label} [${nm}]`] = { tp, fp, pos, n: set.length, auc: auc(sc, lab) };
}

// 5. (b) pairwise error correlation
lines.push('', '## 5. (b) Pairwise error correlation (phi on per-slot wrong/right; P(B wrong | A wrong))', '');
function phi(a, b) { let n11 = 0, n10 = 0, n01 = 0, n00 = 0; for (let i = 0; i < a.length; i++) { if (a[i] && b[i]) n11++; else if (a[i]) n10++; else if (b[i]) n01++; else n00++; }
  const d = Math.sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00)); return { phi: d ? (n11 * n00 - n10 * n01) / d : NaN, cond: n11 + n10 ? n11 / (n11 + n10) : NaN, n11, n10, n01, n00 }; }
const vec = (set, arm, i) => set.map((s) => W(reads[s.id][arm][i]));
function pairs(set, A, B, same) { const res = []; const na = A === 'P' ? 3 : 5, nb = B === 'P' ? 3 : 5;
  for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) { if (same && j <= i) continue; if (!same && A !== 'P' && B !== 'P' && i !== j) continue; res.push(phi(vec(set, A, i), vec(set, B, j))); }
  const mean = (k) => { const v = res.map((r) => r[k]).filter((x) => !isNaN(x)); return v.reduce((a, b) => a + b, 0) / v.length; };
  return { phi: mean('phi'), cond: mean('cond'), pairs: res.length }; }
lines.push('| pair | all: phi | all: P(B✗|A✗) | control: phi | control: P(B✗|A✗) |', '|---|---|---|---|---|');
for (const [label, A, B, same] of [['Flash T1 sample i vs j', 'F1', 'F1', true], ['lite T1 sample i vs j', 'L1', 'L1', true], ['Pro read i vs j', 'P', 'P', true], ['Flash vs lite (T1, sample i vs i)', 'F1', 'L1', false], ['Flash vs Pro', 'F1', 'P', false], ['lite vs Pro', 'L1', 'P', false]]) {
  const a = pairs(S, A, B, same), c = pairs(sets.control, A, B, same); out.tables[`phi ${label}`] = { all: a, control: c };
  lines.push(`| ${label} | ${a.phi.toFixed(2)} | ${a.cond.toFixed(2)} | ${c.phi.toFixed(2)} | ${isNaN(c.cond) ? '—' : c.cond.toFixed(2)} |`);
}

// 6. direction
lines.push('', '## 6. Direction of wrong reads (aligned span vs print length)', '', '| arm | omission (shorter) | insertion (longer) | substitution |', '|---|---|---|---|');
for (const arm of ['F0', 'Fs', 'F1', 'L1', 'Ls', 'P']) { let o = 0, i = 0, u = 0; for (const s of S) for (const x of reads[s.id][arm] || []) if (!x.right) { const d = x.span.length - norm(s.core || s.print).length; if (d < 0) o++; else if (d > 0) i++; else u++; } lines.push(`| ${arm} | ${o} | ${i} | ${u} |`); }

// 7. majority
lines.push('', '## 7. Majority vote = print (strict majority; tie or wrong plurality = not right)', '', '| voters | all | disputed | control |', '|---|---|---|---|');
const strict = (arr) => arr.filter((x) => x.right).length * 2 > arr.length;
for (const [label, f] of [
  ['served Flash alone (F0)', (s) => [reads[s.id].F0[0]]],
  ['5× Flash T1', (s) => reads[s.id].F1],
  ['5× lite T1', (s) => reads[s.id].L1],
  ['Flash F0 + lite L1[0] + Pro P0 (one per family)', (s) => [reads[s.id].F0[0], reads[s.id].L1[0], reads[s.id].P[0]]],
  ['stored Flash + stored lite + Pro P0 (the tie-break)', (s) => [reads[s.id].Fs[0], reads[s.id].Ls[0], reads[s.id].P[0]]],
  ['3× Flash T1 + Pro P0 (needs ≥3 of 4)', (s) => [...reads[s.id].F1.slice(0, 3), reads[s.id].P[0]]],
  ['3× Pro', (s) => reads[s.id].P],
]) { const row = [label]; for (const set of Object.values(sets)) row.push(fmt(set.filter((s) => strict(f(s))).length, set.length)); lines.push(`| ${row.join(' | ')} |`); }

// per-slot listing
lines.push('', '## Per slot (1 = right; F0 | Fs | F1×5 | L1×5 | Ls | P0 P1 P1)', '');
for (const s of S) { const r = reads[s.id]; const b = (a) => a.map((x) => +x.right).join(''); lines.push(`- ${s.id} ${s.kind} ${s.book_id.slice(-4)}:${s.page} ${s.print} — ${b(r.F0)} | ${b(r.Fs)} | ${b(r.F1)} | ${b(r.L1)} | ${b(r.Ls)} | ${b(r.P)}`); }
out.per_slot = S.map((s) => ({ id: s.id, kind: s.kind, book_id: s.book_id, page: s.page, print: s.print, conf: s.conf,
  reads: Object.fromEntries(Object.entries(reads[s.id]).map(([k, v]) => [k, v.map((x) => ({ right: x.right, span: x.span, fallback: x.fallback }))])) }));
lines.unshift(`# Reader diversity (#6184): results`, '', `${S.length} slots (${sets.disputed.length} disputed, ${sets.control.length} control) on ${new Set(S.map((s) => s.page_id)).size} pages; ${R.length} new reads, metered $${out.cost_usd.toFixed(2)} at list price; ${fallbacks} of ${n} slot-reads scored by the page-wide fallback.`, '');
fs.writeFileSync(`${outDir}/results.md`, lines.join('\n') + '\n');
fs.writeFileSync(`${outDir}/results.json`, JSON.stringify(out, null, 1));
console.log(lines.join('\n'));
