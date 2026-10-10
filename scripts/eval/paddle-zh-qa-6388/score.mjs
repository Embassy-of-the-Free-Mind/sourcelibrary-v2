#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-prereg-6388/score.mjs (Wilson / paired bootstrap over one page per work, against an AI
// consensus key) and scripts/eval/ground-truth-5935/kanripo.mjs (Kanripo body CER). Neither scores reviewer VERDICTS,
// planted-error controls or the family rule; the Kanripo leaf rule is reused here through kanripo.jsonl's ref_pb.
//
// #6388 Paddle zh QA: every number in the write-up. Reads only this folder (+ Kanripo text from the GitHub cache).
// No model call, no Mongo. $0.
//   node scripts/eval/paddle-zh-qa-6388/score.mjs   → results.json, results.md
import fs from 'node:fs';
import path from 'node:path';
import { workInfo, pbPages } from '../zh-skqs-5568-kanripo.mjs';
import { bodyText, foldHan, bodyCer, makeRng, wilson, median } from '../ground-truth-5935/lib.mjs';
import { weightedKappa } from '../lib/agreement-stats.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const H = f => path.join(HERE, f);
const readJson = f => JSON.parse(fs.readFileSync(H(f), 'utf8'));
const readJsonl = f => fs.existsSync(H(f)) ? fs.readFileSync(H(f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const last = rows => new Map(rows.map(r => [r.uid, r]));
const HAN = /\p{Script=Han}/gu;
const hanCount = t => (String(t || '').match(HAN) || []).length;
const V = ['clean', 'minor', 'material', 'unusable'];
const vIdx = v => V.indexOf(v) + 1;
const pct = (k, n) => n ? `${(100 * k / n).toFixed(1)}%` : '—';
const ci = (k, n) => { const [a, b] = wilson(k, n); return `${(100 * a).toFixed(1)}–${(100 * b).toFixed(1)}%`; };
const r4 = x => x == null ? null : Math.round(x * 10000) / 10000;

function parse(s) {
  const t = String(s || '').replace(/^```(?:json)?\s*|```\s*$/gm, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { const j = JSON.parse(t.slice(a, b + 1)); return j && V.includes(j.verdict) ? j : null; } catch { return null; }
}
const review = row => row ? (row.json && V.includes(row.json.verdict) ? row.json : parse(row.text)) : null;

const draw = readJson('draw.json');
const rows = draw.rows;
const texts = last(readJsonl('texts.jsonl'));
const kan = last(readJsonl('kanripo.jsonl'));
const pmap = readJson('packet-map.json').items;
const controls = readJson('controls.json');
const R = Object.fromEntries(['R1', 'R2', 'R3', 'A', 'XTO', 'XTG'].map(a => [a, last(readJsonl(`reads/${a}.jsonl`))]));
const T = { P: new Map([...texts].map(([u, r]) => [u, { text: r.text }])), TO: last(readJsonl('reads/TO.jsonl')), TG: last(readJsonl('reads/TG.jsonl')) };
const adjMap = fs.existsSync(H('adjudication-map.json')) ? readJson('adjudication-map.json').items : [];
const xmap = fs.existsSync(H('xreview-map.json')) ? readJson('xreview-map.json').items : [];
const qOf = uid => pmap.find(i => i.uid === uid && i.role === 'sample')?.qid;
const out = { issue: 6388, computed_at: new Date().toISOString(), n: rows.length };
const md = [];

// ── 1. Reviewer verdicts on the 60 Paddle pages ────────────────────────────────────────────────────────────────────
const per = rows.map(r => {
  const q = qOf(r.uid);
  const v = Object.fromEntries(['R1', 'R2', 'R3'].map(a => [a, review(R[a].get(q))]));
  const adj = adjMap.find(m => m.uid === r.uid);
  const A = adj ? review(R.A.get(adj.qid)) : null;
  const final = v.R1 && v.R2 && v.R1.verdict === v.R2.verdict ? v.R1 : A;
  const finalErrors = final ? (final.errors || []) : [];
  return { uid: r.uid, stratum: r.stratum, book_id: r.book_id, title: r.title, page_id: r.page_id, q, R1: v.R1?.verdict ?? null, R2: v.R2?.verdict ?? null, R3: v.R3?.verdict ?? null, A: A?.verdict ?? null, adjudicated: !!adj, final: final?.verdict ?? null, final_from: !adj ? 'R1=R2' : 'A', final_error_chars: final?.error_chars ?? null, final_han: final?.page_han_chars ?? null, invented: finalErrors.filter(e => e.type === 'invented').map(e => e.transcription), invented_chars: finalErrors.filter(e => e.type === 'invented').reduce((s, e) => s + [...String(e.transcription || '')].length, 0), order_errors: finalErrors.filter(e => e.type === 'order').length, kanripo: kan.get(r.uid)?.status === 'scored' ? kan.get(r.uid).cer : null };
});
out.pages = per;
const rate = (subset, key) => {
  const n = subset.filter(p => p[key]).length;
  return Object.fromEntries(V.map(v => { const k = subset.filter(p => p[key] === v).length; return [v, { k, n, p: n ? k / n : null, ci: wilson(k, n) }]; }));
};
const strata = { all: per.filter(p => p.stratum === 'all'), stale: per.filter(p => p.stratum === 'stale'), both: per };
out.rates = Object.fromEntries(Object.entries(strata).map(([s, sub]) => [s, Object.fromEntries(['final', 'R1', 'R2', 'R3'].map(k => [k, rate(sub, k)]))]));
md.push('## Verdicts on the 60 Paddle pages (one page per book; Wilson 95% CI by book)\n');
md.push('| Stratum | Reader | n | clean | minor | material | unusable |', '|---|---|---|---|---|---|---|');
for (const [s, sub] of Object.entries(strata)) for (const k of ['final', 'R1', 'R2', 'R3']) {
  const rr = out.rates[s][k]; const n = rr.clean.n; if (!n) continue;
  md.push(`| ${s === 'all' ? 'ALL (random, 50)' : s === 'stale' ? 'STALE-EN (10)' : 'all 60'} | ${k === 'final' ? '**final**' : k} | ${n} | ${V.map(v => `${rr[v].k} (${pct(rr[v].k, n)}; ${ci(rr[v].k, n)})`).join(' | ')} |`);
}
// "material or worse" and invented
for (const [s, sub] of Object.entries(strata)) {
  const n = sub.filter(p => p.final).length, k = sub.filter(p => p.final === 'material' || p.final === 'unusable').length;
  const ki = sub.filter(p => p.invented_chars > 0).length, ki4 = sub.filter(p => p.invented.some(t => [...t].length >= 4)).length;
  out.rates[s].material_or_worse = { k, n, ci: wilson(k, n) };
  out.rates[s].invented_any = { k: ki, n, ci: wilson(ki, n) };
  out.rates[s].invented_span4 = { k: ki4, n, ci: wilson(ki4, n) };
}
md.push('', `Material or worse (final): ALL ${out.rates.all.material_or_worse.k}/${out.rates.all.material_or_worse.n} (${ci(out.rates.all.material_or_worse.k, out.rates.all.material_or_worse.n)}); all 60 ${out.rates.both.material_or_worse.k}/${out.rates.both.material_or_worse.n} (${ci(out.rates.both.material_or_worse.k, out.rates.both.material_or_worse.n)}).`);
md.push(`Pages with any invented span (final list): ${out.rates.both.invented_any.k}/${out.rates.both.invented_any.n} (${ci(out.rates.both.invented_any.k, out.rates.both.invented_any.n)}); with an invented span of ≥ 4 characters: ${out.rates.both.invented_span4.k}/${out.rates.both.invented_span4.n} (${ci(out.rates.both.invented_span4.k, out.rates.both.invented_span4.n)}).`);
const unus = per.filter(p => p.final === 'unusable').length;
md.push(`Unusable (the #5547 "catastrophic" analogue): ${unus}/${per.length} (${ci(unus, per.length)}); #5547 measured Paddle 0.9% catastrophic on 540 Kanripo pages.`);

// ── 2. Agreement ───────────────────────────────────────────────────────────────────────────────────────────────────
const agree = (a, b) => {
  const pr = per.filter(p => p[a] && p[b]);
  const exact = pr.filter(p => p[a] === p[b]).length;
  const bin = pr.filter(p => (vIdx(p[a]) >= 3) === (vIdx(p[b]) >= 3)).length;
  return { n: pr.length, exact, exact_ci: wilson(exact, pr.length), material_split_agree: bin, kappa_w: pr.length > 1 ? r4(weightedKappa(pr.map(p => [vIdx(p[a]), vIdx(p[b])]), 4)) : null };
};
out.agreement = { R1_R2: agree('R1', 'R2'), R2_R3: agree('R2', 'R3'), R1_R3: agree('R1', 'R3') };
out.adjudicated = { n: per.filter(p => p.adjudicated).length, A_sided_with_R1: per.filter(p => p.adjudicated && p.A === p.R1).length, A_sided_with_R2: per.filter(p => p.adjudicated && p.A === p.R2).length, A_neither: per.filter(p => p.adjudicated && p.A && p.A !== p.R1 && p.A !== p.R2).length };
md.push('', '## Reviewer agreement (page verdicts, 4 levels)\n', '| Pair | n | exact | quadratic-weighted κ | agree on material-or-worse |', '|---|---|---|---|---|');
for (const [k, a] of Object.entries(out.agreement)) md.push(`| ${k.replace('_', ' vs ')} | ${a.n} | ${a.exact} (${pct(a.exact, a.n)}; ${ci(a.exact, a.n)}) | ${a.kappa_w ?? '—'} | ${a.material_split_agree}/${a.n} |`);
md.push('', `R1 ≠ R2 → third read by Opus (high effort) with both lists: **${out.adjudicated.n} pages**; it sided with R1 on ${out.adjudicated.A_sided_with_R1}, with R2 on ${out.adjudicated.A_sided_with_R2}, with neither on ${out.adjudicated.A_neither}.`);

// ── 3. Controls ────────────────────────────────────────────────────────────────────────────────────────────────────
const lcs = (a, b) => { a = [...String(a || '')]; b = [...String(b || '')]; let best = 0; const dp = new Array(b.length + 1).fill(0); for (let i = 1; i <= a.length; i++) { let prev = 0; for (let j = 1; j <= b.length; j++) { const tmp = dp[j]; dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : 0; if (dp[j] > best) best = dp[j]; prev = tmp; } } return best; };
const caught = (span, errs) => errs.some(e => {
  if (span.id === 'P1') return lcs(e.transcription, span.planted) >= 3;
  if (span.id === 'P2') return lcs(e.page, span.original) >= 3;
  return lcs(e.transcription, span.planted) >= 2 || lcs(e.page, span.original) >= 2;
});
out.controls = {};
for (const a of ['R1', 'R2', 'R3']) {
  const plants = controls.plants.map(pl => {
    const q = pmap.find(i => i.uid === pl.uid && i.role === 'plant').qid;
    const j = review(R[a].get(q));
    const errs = j?.errors || [];
    const hit = Object.fromEntries(pl.spans.map(s => [s.id, j ? caught(s, errs) : null]));
    return { uid: pl.uid, q, verdict: j?.verdict ?? null, hit, other_errors: j ? errs.filter(e => !pl.spans.some(s => caught(s, [e]))).length : null };
  });
  const answered = plants.filter(p => p.verdict);
  const spans = answered.flatMap(p => Object.values(p.hit));
  const missed = spans.filter(h => !h).length;
  const reps = controls.repeats.map(u => {
    const qs = pmap.filter(i => i.uid === u).map(i => i.qid);
    const vs = qs.map(q => review(R[a].get(q))?.verdict ?? null);
    return { uid: u, verdicts: vs, same: vs.every(v => v && v === vs[0]) };
  });
  out.controls[a] = { plants, plant_pages_answered: answered.length, spans_scored: spans.length, spans_caught: spans.length - missed, spans_missed: missed + (10 - answered.length) * 3, trusted: missed + (10 - answered.length) * 3 <= 2, by_span: Object.fromEntries(['P1', 'P2', 'P3'].map(id => [id, answered.filter(p => p.hit[id]).length])), plant_verdicts: Object.fromEntries(V.map(v => [v, answered.filter(p => p.verdict === v).length])), repeats: reps, repeats_same: reps.filter(r => r.same).length };
}
md.push('', '## Controls\n', '| Reviewer | planted spans caught (of 30) | P1 insert / P2 delete / P3 substitute | trusted (≤ 2 missed) | plant-page verdicts | repeats: same verdict |', '|---|---|---|---|---|---|');
const NAMES = { R1: 'R1 Opus', R2: 'R2 Gemini 3.8 Flash (High)', R3: 'R3 Gemini 3.1 Pro (High)' };
for (const [a, c] of Object.entries(out.controls)) md.push(`| ${NAMES[a]} | ${30 - c.spans_missed} | ${c.by_span.P1}/${c.by_span.P2}/${c.by_span.P3} of ${c.plant_pages_answered} | ${c.trusted ? 'yes' : '**no**'} | ${V.map(v => `${v} ${c.plant_verdicts[v]}`).join(', ')} | ${c.repeats_same}/5 |`);

// ── 4. Kanripo CER (external instrument) for P, TO, TG; and against the verdicts ───────────────────────────────────
const pbCache = new Map();
async function window(k) {
  const krId = k.repo.replace(/^kanripo\//, '');
  const j = Number(k.ref_pb.match(/_(\d{3})-\d+[ab]$/)[1]);
  const key = `${krId}|${j}`;
  if (!pbCache.has(key)) { const w = await workInfo(krId); pbCache.set(key, await pbPages(krId, 'WYG', (w.juan_files || []).filter(x => Math.abs(x - j) <= 1))); }
  const pbs = pbCache.get(key), i = pbs.findIndex(x => x.pb === k.ref_pb);
  return { W: pbs.slice(Math.max(0, i - 1), i + 2).map(x => x.text).join(''), expected: pbs[i].text.length };
}
const loopy = t => { const ls = String(t || '').split('\n').map(l => l.replace(/\s+/g, '')).filter(l => hanCount(l) >= 4); const c = {}; for (const l of ls) c[l] = (c[l] || 0) + 1; if (Object.values(c).some(n => n >= 3)) return true; const h = (String(t).match(HAN) || []).join(''); return /(.{6,}?)\1{3,}/u.test(h); };
const ENG = ['P', 'TO', 'TG'];
const cer = Object.fromEntries(ENG.map(e => [e, {}]));
for (const r of rows) {
  const k = kan.get(r.uid);
  if (k?.status !== 'scored') continue;
  const { W, expected } = await window(k);
  for (const e of ENG) {
    const row = T[e].get(r.uid);
    const text = row && !row.error ? row.text : '';
    cer[e][r.uid] = r4(bodyCer(foldHan(bodyText(text)), W, { expected }).cer);
  }
}
const scoredU = rows.map(r => r.uid).filter(u => cer.P[u] != null);
const rng = makeRng(6396);
const bootMean = xs => { const ms = []; for (let t = 0; t < 10000; t++) { let s = 0; for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rng() * xs.length)]; ms.push(s / xs.length); } ms.sort((a, b) => a - b); return [r4(ms[250]), r4(ms[9749])]; };
const meanOf = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
out.kanripo = { n: scoredU.length, recomputed_P_matches_stored: scoredU.filter(u => Math.abs(cer.P[u] - kan.get(u).cer) < 0.002).length };
for (const e of ENG) { const xs = scoredU.map(u => cer[e][u]); out.kanripo[e] = { mean: r4(meanOf(xs)), ci: bootMean(xs), median: r4(median(xs)), over_0_10: xs.filter(x => x > 0.1).length, catastrophic_0_5: xs.filter(x => x >= 0.5).length }; }
for (const e of ['TO', 'TG']) { const d = scoredU.map(u => cer[e][u] - cer.P[u]); out.kanripo[`${e}_minus_P`] = { mean: r4(meanOf(d)), ci: bootMean(d), engine_better_pages: d.filter(x => x < -0.005).length, paddle_better_pages: d.filter(x => x > 0.005).length }; }
out.kanripo.per_page = scoredU.map(u => ({ uid: u, P: cer.P[u], TO: cer.TO[u], TG: cer.TG[u] }));
md.push('', `## Transcription vs Kanripo (body CER, capped at 1; ${scoredU.length} pages whose Kanripo leaf aligns; bootstrap 95% CI over pages = works)\n`, '| Engine | mean CER | 95% CI | median | pages > 10% | pages ≥ 50% |', '|---|---|---|---|---|---|');
const ENAME = { P: 'Paddle (stored)', TO: 'Opus (claude -p)', TG: 'Gemini 3.8 Flash Low (agy)' };
for (const e of ENG) { const k = out.kanripo[e]; md.push(`| ${ENAME[e]} | ${(100 * k.mean).toFixed(2)}% | ${(100 * k.ci[0]).toFixed(2)}–${(100 * k.ci[1]).toFixed(2)}% | ${(100 * k.median).toFixed(2)}% | ${k.over_0_10} | ${k.catastrophic_0_5} |`); }
for (const e of ['TO', 'TG']) { const k = out.kanripo[`${e}_minus_P`]; md.push(`\n${ENAME[e]} − Paddle: ${(100 * k.mean).toFixed(2)} pts (95% CI ${(100 * k.ci[0]).toFixed(2)} to ${(100 * k.ci[1]).toFixed(2)}); better on ${k.engine_better_pages} pages, worse on ${k.paddle_better_pages} (±0.5 pt ties excluded).`); }
// verdict vs Kanripo CER
const byV = Object.fromEntries(V.map(v => [v, per.filter(p => p.final === v && p.kanripo != null).map(p => p.kanripo)]));
out.kanripo_by_verdict = Object.fromEntries(V.map(v => [v, { n: byV[v].length, median: r4(median(byV[v])), max: byV[v].length ? Math.max(...byV[v]) : null }]));
const kp = per.filter(p => p.final && p.kanripo != null);
const ranks = xs => { const s = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(xs.length); for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
const spearman = (a, b) => { const ra = ranks(a), rb = ranks(b), ma = meanOf(ra), mb = meanOf(rb); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; } return n / Math.sqrt(da * db); };
out.kanripo_vs_verdict = { n: kp.length, spearman_verdict: r4(spearman(kp.map(p => vIdx(p.final)), kp.map(p => p.kanripo))), spearman_error_rate: r4(spearman(kp.map(p => (p.final_error_chars || 0) / Math.max(1, p.final_han || 1)), kp.map(p => p.kanripo))) };
// 2×2: reviewers say material+ vs Kanripo CER > 5%
const t22 = { both: 0, rev_only: 0, kan_only: 0, neither: 0 };
for (const p of kp) { const a = vIdx(p.final) >= 3, b = p.kanripo > 0.05; t22[a && b ? 'both' : a ? 'rev_only' : b ? 'kan_only' : 'neither']++; }
out.kanripo_vs_verdict.t22_cer5 = t22;
md.push('', '## Reviewers vs Kanripo (Paddle pages)\n', '| Final verdict | n with Kanripo | median CER | max CER |', '|---|---|---|---|');
for (const v of V) { const k = out.kanripo_by_verdict[v]; md.push(`| ${v} | ${k.n} | ${k.median != null ? (100 * k.median).toFixed(1) + '%' : '—'} | ${k.max != null ? (100 * k.max).toFixed(1) + '%' : '—'} |`); }
md.push('', `Spearman ρ (verdict level vs Kanripo CER) = ${out.kanripo_vs_verdict.spearman_verdict}; (reviewer error-char rate vs CER) = ${out.kanripo_vs_verdict.spearman_error_rate}. Material-or-worse vs CER > 5 %: both ${t22.both}, reviewers only ${t22.rev_only}, Kanripo only ${t22.kan_only}, neither ${t22.neither}.`);

// ── 5. Transcription arms by the reviewers (family rule) ──────────────────────────────────────────────────────────
const xrev = (arm, revArm) => new Map(xmap.filter(m => m.arm === arm).map(m => [m.uid, review(R[revArm].get(m.qid))]));
const XO = xrev('TO', 'XTO'), XG = xrev('TG', 'XTG');
const errRate = j => j ? (j.error_chars || 0) / Math.max(1, j.page_han_chars || 1) : null;
const fam = (label, engMap, reviewerArm) => {
  const us = rows.map(r => r.uid).filter(u => engMap.get(u));
  const js = us.map(u => engMap.get(u));
  const vc = Object.fromEntries(V.map(v => [v, js.filter(j => j.verdict === v).length]));
  return { label, n: us.length, verdicts: vc, mean_error_rate: r4(meanOf(js.map(errRate))), ci: bootMean(js.map(errRate)), order_errors: js.reduce((s, j) => s + (j.errors || []).filter(e => e.type === 'order').length, 0), invented_pages: js.filter(j => (j.errors || []).some(e => e.type === 'invented')).length, uids: us };
};
const pBy = a => new Map(per.map(p => [p.uid, review(R[a].get(p.q))]).filter(([, j]) => j));
out.family = {
  gemini_reviewer: { P: fam('Paddle, reviewed by Gemini 3.8 Flash (R2)', pBy('R2')), TO: fam('Opus transcription, reviewed by Gemini 3.8 Flash (XTO)', XO) },
  opus_reviewer: { P: fam('Paddle, reviewed by Opus (R1)', pBy('R1')), TG: fam('Gemini 3.8 transcription, reviewed by Opus (XTG)', XG) },
};
const paired = (A, B) => { const ua = new Set(A.uids); const us = B.uids.filter(u => ua.has(u)); return us; };
for (const [rev, o] of Object.entries(out.family)) {
  const [eng] = Object.keys(o).filter(k => k !== 'P');
  const us = paired(o.P, o[eng]);
  const src = rev === 'gemini_reviewer' ? [pBy('R2'), XO] : [pBy('R1'), XG];
  const d = us.map(u => errRate(src[1].get(u)) - errRate(src[0].get(u)));
  o.paired = { n: us.length, diff_mean: r4(meanOf(d)), ci: bootMean(d) };
  delete o.P.uids; delete o[eng].uids;
}
md.push('', '## Transcription arms by the reviewers (family rule: no family reviews its own text)\n', '| Reviewer | Text | n | clean | minor | material | unusable | mean error-char rate (95% CI) | order errors | pages with invented spans |', '|---|---|---|---|---|---|---|---|---|---|');
for (const [rev, o] of Object.entries(out.family)) for (const [k, f] of Object.entries(o)) if (k !== 'paired') md.push(`| ${rev === 'gemini_reviewer' ? 'Gemini 3.8 Flash' : 'Opus'} | ${ENAME[k]} | ${f.n} | ${V.map(v => f.verdicts[v]).join(' | ')} | ${(100 * f.mean_error_rate).toFixed(2)}% (${(100 * f.ci[0]).toFixed(2)}–${(100 * f.ci[1]).toFixed(2)}%) | ${f.order_errors} | ${f.invented_pages} |`);
for (const [rev, o] of Object.entries(out.family)) md.push(`\n${rev === 'gemini_reviewer' ? 'Opus transcription − Paddle, by Gemini' : 'Gemini transcription − Paddle, by Opus'}: ${(100 * o.paired.diff_mean).toFixed(2)} pts error-char rate (95% CI ${(100 * o.paired.ci[0]).toFixed(2)} to ${(100 * o.paired.ci[1]).toFixed(2)}), n = ${o.paired.n}.`);

// ── 6. Refusals, loops, seconds ────────────────────────────────────────────────────────────────────────────────────
out.ops = {};
for (const e of ENG) {
  const rs = rows.map(r => T[e].get(r.uid));
  const refusals = rs.filter(x => !x || x.error || hanCount(bodyText(x.text)) < 10).length;
  const loops = rs.filter(x => x && !x.error && loopy(bodyText(x.text))).length;
  const secs = rs.map(x => x?.secs).filter(Number.isFinite);
  out.ops[e] = { n: rs.length, refusals_or_empty: refusals, loops, secs_median: secs.length ? r4(median(secs)) : null, nudged: rs.filter(x => x?.nudged || /nudged/.test(x?.status || '')).length, attempts_over_1: rs.filter(x => (x?.attempts || 1) > 1).length };
}
md.push('', '## Refusals, loops, time\n', '| Engine | n | refusal/empty (< 10 Han chars) | loops | median s/page (wall, incl. CLI start) |', '|---|---|---|---|---|');
for (const e of ENG) { const o = out.ops[e]; md.push(`| ${ENAME[e]} | ${o.n} | ${o.refusals_or_empty} | ${o.loops} | ${o.secs_median ?? '— (GPU batch)'} |`); }

// ── 7. Calls ───────────────────────────────────────────────────────────────────────────────────────────────────────
const calls = a => readJsonl(`reads/${a}.jsonl`).reduce((s, r) => s + (r.attempts || 1), 0);
out.calls = { opus: calls('R1') + calls('A') + calls('TO') + calls('XTG'), agy: calls('R2') + calls('R3') + calls('TG') + calls('XTO'), by_arm: Object.fromEntries(['R1', 'R2', 'R3', 'A', 'TO', 'TG', 'XTO', 'XTG'].map(a => [a, calls(a)])) };
md.push('', `Calls: Opus ${out.calls.opus} (cap 450), agy ${out.calls.agy} (cap 450); ${JSON.stringify(out.calls.by_arm)}. API spend $0.`);

fs.writeFileSync(H('results.json'), JSON.stringify(out, null, 1) + '\n');
fs.writeFileSync(H('results.md'), `# #6388 Paddle zh random-sample QA — results (generated by score.mjs, ${out.computed_at})\n\n` + md.join('\n') + '\n');
console.log(md.join('\n'));
