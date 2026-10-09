// Score the Clef/Jev arms (#6184 addendum): accuracy with exact CIs, flip rate, phi vs each Gemini arm,
// accuracy where the Gemini arms split. Reads clef-jev/calls.jsonl + the reader-diversity results.json.
// Run from /root/rd-6184: node clef-jev-analyze.mjs <results.json> [outdir]
import fs from 'node:fs';
const [RES, OUT = 'clef-jev'] = process.argv.slice(2);
const R = JSON.parse(fs.readFileSync(RES, 'utf8'));
const calls = fs.readFileSync(`${OUT}/calls.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
const slots = R.per_slot;
// Clopper-Pearson via beta quantile by bisection on the binomial CDF
const lgam = (z) => { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let x = z, y = z, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const k of c) s += k / ++y; return -t + Math.log(2.5066282746310005 * s / x); };
const binCdf = (k, n, p) => { let s = 0; for (let i = 0; i <= k; i++) s += Math.exp(lgam(n + 1) - lgam(i + 1) - lgam(n - i + 1) + i * Math.log(p) + (n - i) * Math.log(1 - p)); return s; };
const bis = (f) => { let lo = 0, hi = 1; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; f(m) ? (lo = m) : (hi = m); } return lo; };
const cp = (k, n) => [k === 0 ? 0 : bis((p) => 1 - binCdf(k - 1, n, p) < 0.025), k === n ? 1 : bis((p) => binCdf(k, n, p) > 0.025)];
const fmt = (k, n) => { if (!n) return '–'; const [a, b] = cp(k, n); return `${k}/${n} = ${Math.round(100 * k / n)}% [${Math.round(100 * a)}–${Math.round(100 * b)}]`; };
const phi = (x, y) => { // x,y arrays of booleans "wrong"
  let a = 0, b = 0, c = 0, d = 0; x.forEach((xi, i) => { const yi = y[i]; if (xi && yi) a++; else if (xi) b++; else if (yi) c++; else d++; });
  const den = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d)); return { phi: den ? +((a * d - b * c) / den).toFixed(2) : null, both: a, onlyX: b, onlyY: c };
};
// Gemini arms, one read each (first sample), plus the Pro-3 majority
const maj = (rs) => rs.filter((r) => r.right).length * 2 > rs.length;
const G = {
  F0: (s) => s.reads.F0[0].right, 'Flash stored': (s) => s.reads.Fs[0].right, 'lite stored': (s) => s.reads.Ls[0].right,
  F1: (s) => s.reads.F1[0].right, L1: (s) => s.reads.L1[0].right, P0: (s) => s.reads.P[0].right, 'Pro-3 maj': (s) => maj(s.reads.P),
};
const arms = [...new Set(calls.filter((c) => c.choice).map((c) => c.arm))];
const byKey = Object.fromEntries(calls.filter((c) => c.choice).map((c) => [`${c.id}|${c.arm}|${c.order}`, c]));
const verdict = (id, arm) => { const a = byKey[`${id}|${arm}|RW`], b = byKey[`${id}|${arm}|WR`]; if (!a || !b) return null; return { right: a.right && b.right, flip: a.right !== b.right, single: a.right }; };
const split = (s) => { const v = [G.F0(s), G.L1(s), G.P0(s)]; return v.some(Boolean) && !v.every(Boolean); };
const sets = { 'disputed 36': slots.filter((s) => s.kind === 'disputed'), 'controls 27': slots.filter((s) => s.kind === 'control'), 'all 63': slots, 'Gemini split (F0/L1/P0)': slots.filter(split) };
const out = { arms: {}, gemini: {}, cost: 0, calls: calls.filter((c) => c.choice).length, errors: calls.filter((c) => c.error).length, skips: calls.filter((c) => c.skip).length };
out.cost = +calls.reduce((a, c) => a + (c.usd || 0), 0).toFixed(4);
const md = ['| arm | ' + Object.keys(sets).join(' | ') + ' | flips (orders disagree) | single order (A/B only), disputed |', '|---' .repeat(Object.keys(sets).length + 3) + '|'];
for (const arm of arms) {
  const row = []; const A = (out.arms[arm] = {});
  for (const [name, ss] of Object.entries(sets)) { const v = ss.map((s) => verdict(s.id, arm)).filter(Boolean); A[name] = { right: v.filter((x) => x.right).length, n: v.length }; row.push(fmt(A[name].right, A[name].n)); }
  const v = slots.map((s) => verdict(s.id, arm)).filter(Boolean); A.flips = { k: v.filter((x) => x.flip).length, n: v.length };
  const vd = sets['disputed 36'].map((s) => verdict(s.id, arm)).filter(Boolean);
  // position preference: share of calls answering "A"
  const ac = calls.filter((c) => c.arm === arm && c.choice); A.saysA = +(ac.filter((c) => c.choice === 'A').length / ac.length).toFixed(2);
  md.push(`| ${arm} | ${row.join(' | ')} | ${fmt(A.flips.k, A.flips.n)} (says "A" ${Math.round(100 * A.saysA)}%) | ${fmt(vd.filter((x) => x.single).length, vd.length)} |`);
}
md.push('');
md.push('| Gemini arm (one read) | ' + Object.keys(sets).join(' | ') + ' |', '|---'.repeat(Object.keys(sets).length + 1) + '|');
for (const [g, f] of Object.entries(G)) md.push(`| ${g} | ${Object.values(sets).map((ss) => fmt(ss.filter(f).length, ss.length)).join(' | ')} |`);
md.push('', '**phi of wrongness, all 63 (both = wrong together; only-X = this arm alone wrong)**', '', '| arm | ' + Object.keys(G).join(' | ') + ' |', '|---'.repeat(Object.keys(G).length + 1) + '|');
for (const arm of arms) {
  const ss = slots.filter((s) => verdict(s.id, arm)); const w = ss.map((s) => !verdict(s.id, arm).right);
  out.arms[arm].phi = {};
  md.push(`| ${arm} | ${Object.entries(G).map(([g, f]) => { const p = phi(w, ss.map((s) => !f(s))); out.arms[arm].phi[g] = p; return `${p.phi} (${p.both}/${p.onlyX}/${p.onlyY})`; }).join(' | ')} |`);
}
// reference phi between Gemini arms
md.push(`| *Flash stored vs others* | ${Object.entries(G).map(([g, f]) => phi(slots.map((s) => !G['Flash stored'](s)), slots.map((s) => !f(s))).phi).join(' | ')} |`);
// per-slot table
md.push('', '| slot | print | ' + arms.join(' | ') + ' | F0 | L1 | P0 |', '|---'.repeat(arms.length + 5) + '|');
for (const s of slots) md.push(`| ${s.id} | ${s.print} | ${arms.map((a) => { const v = verdict(s.id, a); return !v ? '–' : v.right ? '✓' : v.flip ? 'flip' : '✗'; }).join(' | ')} | ${['F0', 'L1', 'P0'].map((g) => (G[g](s) ? '✓' : '✗')).join(' | ')} |`);
md.push('', `calls ${out.calls}, errors ${out.errors}, skipped ${out.skips}, cost $${out.cost} (Clef at list $/Mtok × reported input tokens; Jev = gateway marketCost)`);
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(out, null, 1));
fs.writeFileSync(`${OUT}/results.md`, md.join('\n') + '\n');
console.log(md.join('\n'));
