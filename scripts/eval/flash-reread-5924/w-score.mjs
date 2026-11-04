#!/usr/bin/env node
// PRIOR ART: ./score.mjs and ./oc-score.mjs (the #5924 scorers: Wilson interval, the misleading / worse-than-lite /
//   preference measures, contains scored against the reader's not_this_leaf) — they unblind two-arm packets; this
//   unblinds Step T's three-arm packets and applies PREREGISTRATION-7568.md's bars and route rule.
// w-score.mjs — LANG7568=<lang>. Reads $JOB_SCRATCH/<lang>/{agents/T-out-<i>.json, keys/t-key.json, set/, R/, judge2/}.
//   Writes results-7568/<lang>/{step-t.json, score.json}.
import fs from 'node:fs'; import path from 'node:path';
import { lite, servedC, readR } from './w-packets.mjs';
const L = process.env.LANG7568, S = path.join(process.env.JOB_SCRATCH, L), HERE = path.dirname(new URL(import.meta.url).pathname);
const RD = path.join(HERE, 'results-7568', L);
const sample = JSON.parse(fs.readFileSync(path.join(RD, 'sample.json'), 'utf8'));
const key = JSON.parse(fs.readFileSync(path.join(S, 'keys/t-key.json'), 'utf8'));
const wilson = (k, n) => { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [+(100 * (c - h) / d).toFixed(1), +(100 * (c + h) / d).toFixed(1)]; };
const lgam = (x) => { const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const c of g) s += c / ++y; return -t + Math.log(2.5066282746310005 * s / x); };
const binom2 = (k, n) => { if (!n) return 1; const pmf = (i) => Math.exp(lgam(n + 1) - lgam(i + 1) - lgam(n - i + 1) - n * Math.LN2); const lo = Math.min(k, n - k); let s = 0; for (let i = 0; i <= lo; i++) s += pmf(i); return Math.min(1, 2 * s); };
const FILTER = /blocked by Gemini'?s filters|request was blocked/i;
const rows = [], books = [];
sample.books.forEach((b, i) => {
  const f = path.join(S, `agents/T-out-${i}.json`); if (!fs.existsSync(f)) throw new Error(`missing ${f}`);
  const out = JSON.parse(fs.readFileSync(f, 'utf8'));
  const bk = { book_id: b.book_id, title: b.title.slice(0, 70), n: 0, L: 0, C: 0, R: 0, worse_C: 0, worse_R: 0, CR: { C: 0, R: 0, tie: 0 }, outcomes: {} };
  for (const p of b.pages) {
    const rc = out.find(x => x.slug === p.slug); if (!rc) throw new Error(`T missing ${p.slug}`);
    const perm = key[p.slug], arm = { X: perm[0], Y: perm[1], Z: perm[2] }, lab = Object.fromEntries(Object.entries(arm).map(([k, v]) => [v, k]));
    const V = {}, ntl = {}, strip = {}, defects = {};
    for (const a of 'LCR') { const r = rc[lab[a]] || {}; V[a] = r.verdict; ntl[a] = !!r.not_this_leaf; strip[a] = !!r.strip_in; defects[a] = r.defects || []; }
    const pair = (a, c) => {   // the reader's preference between arms a and c
      const k = [lab[a], lab[c]].sort().join(''), r = rc[k] || {};
      const w = r.prefer === 'tie' || !r.prefer ? 'tie' : arm[r.prefer];
      return { prefer: w, loser_material: !!r.loser_material };
    };
    const l = lite(p.slug), c = servedC(p.page_id, l), rr = readR(p.page_id);
    const row = { slug: p.slug, book: i, V, ntl, strip, strip_visible: !!rc.facing_strip_visible, CL: pair('C', 'L'), CR: pair('C', 'R'), RL: pair('R', 'L'), why: rc.why,
      C_outcome: c.outcome, C_reason: c.reason ?? null, C_equals_L: c.text === l, R_failed: !rr.text.trim(), R_filter_cut: FILTER.test(rr.text), R_exit: rr.meta?.exit ?? null, defects };
    row.false_contain = c.outcome === 'contain' && !ntl.L;
    row.true_contain = c.outcome === 'contain' && ntl.L;
    row.worse_C_reasons = [V.C === 'misleading' && V.L !== 'misleading' && 'C misleading, L not', row.CL.prefer === 'L' && row.CL.loser_material && 'L preferred, material', c.outcome === 'no-answer' && 'no answer', row.false_contain && 'false contain'].filter(Boolean);
    row.worse_R_reasons = [V.R === 'misleading' && V.L !== 'misleading' && 'R misleading, L not', row.RL.prefer === 'L' && row.RL.loser_material && 'L preferred, material', row.R_failed && 'R unread'].filter(Boolean);
    rows.push(row);
    bk.n++; bk.L += V.L === 'misleading'; bk.C += V.C === 'misleading'; bk.R += V.R === 'misleading';
    bk.worse_C += row.worse_C_reasons.length > 0; bk.worse_R += row.worse_R_reasons.length > 0; bk.CR[row.CR.prefer]++; bk.outcomes[c.outcome] = (bk.outcomes[c.outcome] || 0) + 1;
  }
  books.push(bk);
});
const n = rows.length, cnt = (f, A = rows) => A.filter(f).length;
const mis = (a, A = rows) => cnt(r => r.V[a] === 'misleading', A);
const mL = mis('L'), mC = mis('C'), mR = mis('R');
const pref = (k) => ({ [k[0]]: cnt(r => r[k].prefer === k[0]), [k[1]]: cnt(r => r[k].prefer === k[1]), tie: cnt(r => r[k].prefer === 'tie'),
  [`material_loss_${k[1]}`]: cnt(r => r[k].prefer === k[0] && r[k].loser_material), [`material_loss_${k[0]}`]: cnt(r => r[k].prefer === k[1] && r[k].loser_material) });
const CR = pref('CR'), CL = pref('CL'), RL = pref('RL');
const pCR = binom2(CR.C, CR.C + CR.R);
const worseC = rows.filter(r => r.worse_C_reasons.length), worseR = rows.filter(r => r.worse_R_reasons.length);
// The preregistered route rule (PREREGISTRATION-7568.md "Route per language").
let route;
if (mL <= Math.floor(0.02 * n)) route = 'leave lite (misleading(L) ≤ 2%)';
else if (mC <= mR && CR.C > CR.R && pCR < 0.05) route = mC <= mL / 2 ? 'C: Opus correction' : 'C, weak: beats R but does not halve L';
else if (mR <= mC && CR.R > CR.C && pCR < 0.05) route = mR <= mL / 2 ? 'R: Flash re-read' : 'R, weak: beats C but does not halve L';
else route = 'no clear answer';
// The second-family judge (d), if run.
let judge2 = null;
const jk = path.join(S, 'keys/j2-key.json');
if (fs.existsSync(jk)) {
  const k2 = JSON.parse(fs.readFileSync(jk, 'utf8')), res = [];
  for (const [slug, v] of Object.entries(k2)) {
    const f = path.join(S, 'judge2', `${slug}.json`); if (!fs.existsSync(f)) continue;
    const a = JSON.parse(fs.readFileSync(f, 'utf8')).answer; const r = rows.find(x => x.slug === slug);
    if (!a) { res.push({ slug, unparsed: true }); continue; }
    const cIsX = v === 'XC', g = a.prefer === 'tie' ? 'tie' : (a.prefer === 'X') === cIsX ? 'C' : 'R';
    res.push({ slug, gemini: g, gemini_C: (cIsX ? a.X : a.Y)?.verdict, gemini_R: (cIsX ? a.Y : a.X)?.verdict, opus: r.CR.prefer, opus_C: r.V.C, opus_R: r.V.R });
  }
  const ok = res.filter(x => !x.unparsed);
  judge2 = { model: 'gemini-3.8-flash-low (agy)', drawn: Object.keys(k2).length, parsed: ok.length,
    gemini_prefer: { C: cnt(x => x.gemini === 'C', ok), R: cnt(x => x.gemini === 'R', ok), tie: cnt(x => x.gemini === 'tie', ok) },
    opus_prefer_same_pages: { C: cnt(x => x.opus === 'C', ok), R: cnt(x => x.opus === 'R', ok), tie: cnt(x => x.opus === 'tie', ok) },
    gemini_misleading: { C: cnt(x => x.gemini_C === 'misleading', ok), R: cnt(x => x.gemini_R === 'misleading', ok) },
    opus_misleading_same_pages: { C: cnt(x => x.opus_C === 'misleading', ok), R: cnt(x => x.opus_R === 'misleading', ok) }, pages: res };
}
const calls = fs.existsSync(path.join(S, 'set/calls.jsonl')) ? fs.readFileSync(path.join(S, 'set/calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const tok = calls.reduce((s, c) => { const u = c.usage || {}; s.input += u.input || 0; s.output += u.output || 0; s.cache_read += u.cache_read || 0; s.list_cost_usd += u.list_cost_usd || 0; return s; }, { calls: calls.length, input: 0, output: 0, cache_read: 0, list_cost_usd: 0 });
tok.list_cost_usd = +tok.list_cost_usd.toFixed(2);
const outcomes = {}; for (const r of rows) outcomes[r.C_outcome] = (outcomes[r.C_outcome] || 0) + 1;
const res = {
  lang: L, pages: n, books: books.length, C_outcomes: outcomes,
  misleading: { L: [mL, wilson(mL, n)], C: [mC, wilson(mC, n)], R: [mR, wilson(mR, n)] },
  bar_a_halves: { C: mL > 0 && mC <= mL / 2, R: mL > 0 && mR <= mL / 2 },
  worse_than_L: { C: worseC.length, R: worseR.length }, bar_b_no_page_worse: { C: worseC.length === 0, R: worseR.length === 0 },
  bar_c_C_beats_R: mC <= mR && CR.C > CR.R,
  prefer: { CR, CL, RL }, sign_test_CR_p: +pCR.toPrecision(3),
  route,
  contains: rows.filter(r => r.C_outcome === 'contain').map(r => ({ slug: r.slug, true_contain: r.true_contain, reason: r.C_reason })),
  R_unread: cnt(r => r.R_failed), R_filter_cut: cnt(r => r.R_filter_cut),
  books_failing_25_check_L: books.filter(b => b.L >= 2).length,
  strip: { visible: cnt(r => r.strip_visible), in_L: cnt(r => r.strip.L), in_C: cnt(r => r.strip.C), in_R: cnt(r => r.strip.R) },
  identical_C_L_verdict_mismatch: cnt(r => r.C_equals_L && r.V.C !== r.V.L),
  worse_C_list: worseC.map(r => ({ slug: r.slug, reasons: r.worse_C_reasons, why: r.why })),
  worse_R_list: worseR.map(r => ({ slug: r.slug, reasons: r.worse_R_reasons, why: r.why })),
  judge2, claude_correction_tokens: tok, by_book: books,
};
fs.writeFileSync(path.join(RD, 'step-t.json'), JSON.stringify(rows, null, 1));
fs.writeFileSync(path.join(RD, 'score.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify({ ...res, worse_C_list: undefined, worse_R_list: undefined, judge2: judge2 && { ...judge2, pages: undefined }, by_book: undefined }, null, 1));
for (const b of books) console.log(`${b.book_id} L ${b.L} C ${b.C} R ${b.R} worseC ${b.worse_C} worseR ${b.worse_R} CR ${JSON.stringify(b.CR)} ${JSON.stringify(b.outcomes)} ${b.title}`);
