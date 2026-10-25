#!/usr/bin/env node
// PRIOR ART: ./oc-score.mjs (the Opus arm's scorer; its Wilson interval, unblinding and "worse" rule are kept) — it
//   scores O against L and F; this scores the Flash-correction arm (PREREGISTRATION-flash-correct.md): C4 (FC vs L),
//   C5 (FC vs O), the agy second-family judge (d), and the four-arm table.
// fc-score.mjs — unblinds with $JOB_SCRATCH/keys/c{4,5}-key.json and d-key.json. Writes results/fc-step-c4.json,
//   fc-step-c5.json, fc-outcomes.json, fc-judge.json, fc-score.json and fc-reads.jsonl.gz (the corrections and meta).
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { sample, lite, servedO, fcOutcome, Oreads } from './fc-pairs.mjs';
import { diffSyllables } from '../../lib/tibetan-yatags-guard.mjs';
const J = process.env.JOB_SCRATCH, HERE = path.dirname(new URL(import.meta.url).pathname), R = path.join(HERE, 'results');
const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const orig = new Map(rd(path.join(R, 'step-c.json')).map(r => [r.slug, r]));
const origA = new Map(rd(path.join(R, 'step-a.json')).map(r => [r.slug, r]));
const oc2 = new Map(rd(path.join(R, 'oc-step-c2.json')).map(r => [r.slug, r]));
const oc3 = new Map(rd(path.join(R, 'oc-step-c3.json')).map(r => [r.slug, r]));
const key4 = rd(path.join(J, 'keys/c4-key.json')), key5 = rd(path.join(J, 'keys/c5-key.json')), keyD = rd(path.join(J, 'keys/d-key.json'));
const wilson = (k, n) => { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [+(100 * (c - h) / d).toFixed(1), +(100 * (c + h) / d).toFixed(1)]; };
// cli-ocr's 25% cap measures diffSyllables(), which keeps only Tibetan syllables: on Latin both sides tokenize to 0
// and the cap passes everything. The share reported here is the same measure over words (tags dropped, LCS).
const words = (t) => String(t).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean);
function wordChanged(a, b) {
  const A = words(a), B = words(b), n = A.length, m = B.length; let prev = new Uint16Array(m + 1);
  for (let i = 1; i <= n; i++) { const cur = new Uint16Array(m + 1); for (let j = 1; j <= m; j++) cur[j] = A[i - 1] === B[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]); prev = cur; }
  return { changed: Math.max(n, m) - prev[m], draftN: n };
}
const readOut = (tag, i) => { const f = path.join(J, `agents/C${tag}-out-${i}.json`); return fs.existsSync(f) ? rd(f) : []; };
const unblind = (rc, fcIsX, other) => {
  const vA = fcIsX ? rc.X : rc.Y, vB = fcIsX ? rc.Y : rc.X;
  const pref = rc.prefer === 'tie' ? 'tie' : (rc.prefer === 'X') === fcIsX ? 'FC' : other;
  return { vA, vB, pref, ntl_A: !!(fcIsX ? rc.not_this_leaf_X : rc.not_this_leaf_Y), ntl_B: !!(fcIsX ? rc.not_this_leaf_Y : rc.not_this_leaf_X), strip_in_A: !!(fcIsX ? rc.strip_in_X : rc.strip_in_Y), strip_in_B: !!(fcIsX ? rc.strip_in_Y : rc.strip_in_X) };
};
const C4 = [], C5 = [], OUT = [], books = [], reads = [];
sample.books.forEach((b, i) => {
  const c4 = readOut(4, i), c5 = readOut(5, i);
  const bk = { book_id: b.book_id, year: b.year, L: 0, FC: 0, worse: 0, c4_pref: { FC: 0, L: 0, tie: 0 }, c5_FC: 0, c5_O: 0, c5_pref: { FC: 0, O: 0, tie: 0 }, outcomes: {} };
  for (const p of b.pages) {
    const L = lite(p.slug), a = fcOutcome(p.page_id), m = a.meta || {}, o = orig.get(p.slug), sa = origA.get(p.slug);
    const fcText = a.outcome === 'corrected' ? a.text : L;
    const d = a.outcome === 'corrected' ? wordChanged(L, a.text) : null;
    const changed = d ? +(d.changed / Math.max(1, d.draftN)).toFixed(3) : null;
    const syl = a.outcome === 'corrected' ? diffSyllables(L, a.text).draftN : null;
    bk.outcomes[a.outcome] = (bk.outcomes[a.outcome] || 0) + 1;
    OUT.push({ slug: p.slug, book: i, outcome: a.outcome, reason: a.reason ?? null, chars: m.chars ?? null, calls: m.calls ?? 0, rereads: m.rereads ?? 0, nudged: !!m.nudged, tool_calls: m.tool_calls ?? [], draft_text_hash: m.draft?.text_hash ?? null, changed_share: changed, cli_ocr_cap_tokens: syl, over_25pct_cap: changed != null && changed > 0.25 });
    reads.push({ page_id: p.page_id, slug: p.slug, outcome: a.outcome, reason: a.reason ?? null, text: fs.existsSync(path.join(J, 'FC', `${p.page_id}.txt`)) ? fs.readFileSync(path.join(J, 'FC', `${p.page_id}.txt`), 'utf8') : null, raw: fs.existsSync(path.join(J, 'FC', `${p.page_id}.raw.txt`)) ? fs.readFileSync(path.join(J, 'FC', `${p.page_id}.raw.txt`), 'utf8') : null, meta: m });
    // C4: FC vs L
    let row;
    if (key4[p.slug]) {
      const rc = c4.find(x => x.slug === p.slug); if (!rc) throw new Error(`C4 missing ${p.slug}`);
      const u = unblind(rc, key4[p.slug] === 'XFC', 'L');
      row = { slug: p.slug, book: i, shown: true, outcome: a.outcome, C_FC: u.vA.verdict, C_L: u.vB.verdict, prefer: u.pref, loser_material: !!rc.loser_material, why: rc.why, ntl_FC: u.ntl_A, ntl_L: u.ntl_B, strip_visible: !!rc.facing_strip_visible, strip_in_FC: u.strip_in_A, strip_in_L: u.strip_in_B, orig_C_L: o.C_L, defects_FC: u.vA.defects, defects_L: u.vB.defects };
    } else {
      row = { slug: p.slug, book: i, shown: false, outcome: a.outcome, C_FC: o.C_L, C_L: o.C_L, prefer: 'tie', loser_material: false, why: 'FC serves L unchanged (not shown; original Step C L verdict)', ntl_FC: o.ntl_L, ntl_L: o.ntl_L, orig_C_L: o.C_L };
    }
    const flaggedWrongLeaf = !!(o.ntl_L || sa?.not_this_leaf);
    row.false_contain = a.outcome === 'contain' && !flaggedWrongLeaf;
    row.true_contain = a.outcome === 'contain' && flaggedWrongLeaf;
    row.no_answer = a.outcome === 'no-answer';
    row.worse_reasons = [row.C_FC === 'misleading' && row.C_L !== 'misleading' && 'FC misleading, L not', row.prefer === 'L' && row.loser_material && 'L preferred, material', row.no_answer && `no answer (${a.reason})`, row.false_contain && 'false contain'].filter(Boolean);
    row.worse = row.worse_reasons.length > 0;
    C4.push(row);
    bk.L += row.C_L === 'misleading'; bk.FC += row.C_FC === 'misleading'; bk.worse += row.worse; bk.c4_pref[row.prefer]++;
    // C5: FC vs O
    let r5;
    if (key5[p.slug]) {
      const rc = c5.find(x => x.slug === p.slug); if (!rc) throw new Error(`C5 missing ${p.slug}`);
      const u = unblind(rc, key5[p.slug] === 'XFC', 'O');
      r5 = { slug: p.slug, book: i, shown: true, outcome: a.outcome, C_FC: u.vA.verdict, C_O: u.vB.verdict, prefer: u.pref, loser_material: !!rc.loser_material, why: rc.why, ntl_FC: u.ntl_A, ntl_O: u.ntl_B, strip_visible: !!rc.facing_strip_visible, strip_in_FC: u.strip_in_A, strip_in_O: u.strip_in_B, defects_FC: u.vA.defects, defects_O: u.vB.defects };
    } else {
      r5 = { slug: p.slug, book: i, shown: false, outcome: a.outcome, C_FC: row.C_FC, C_O: row.C_FC, prefer: 'tie', loser_material: false, why: 'FC and O serve the same text (not shown; C4 verdict for both)' };
    }
    C5.push(r5);
    bk.c5_FC += r5.C_FC === 'misleading'; bk.c5_O += r5.C_O === 'misleading'; bk.c5_pref[r5.prefer]++;
    void fcText;
  }
  books.push(bk);
});
// (d) the agy second-family judge on O vs L
const D = Object.keys(keyD).map(slug => {
  const j = rd(path.join(J, 'judge', `${slug}.json`)), c2 = oc2.get(slug), oIsX = keyD[slug] === 'XO', ans = j.answer;
  if (!ans) return { slug, calls: j.calls, parsed: false, opus_prefer: c2.prefer, opus_C_O: c2.C_O, opus_C_L: c2.C_L };
  const vO = oIsX ? ans.X : ans.Y, vL = oIsX ? ans.Y : ans.X;
  return { slug, calls: j.calls, parsed: true, gem_prefer: ans.prefer === 'tie' ? 'tie' : (ans.prefer === 'X') === oIsX ? 'O' : 'L', gem_loser_material: !!ans.loser_material, gem_C_O: vO.verdict, gem_C_L: vL.verdict, gem_why: ans.why, gem_errors_O: vO.errors, gem_errors_L: vL.errors, opus_prefer: c2.prefer, opus_loser_material: c2.loser_material, opus_C_O: c2.C_O, opus_C_L: c2.C_L, opus_why: c2.why };
});
const Dp = D.filter(r => r.parsed), cnt = (A, f) => A.filter(f).length;
const judge = { pages: D.length, parsed: Dp.length, calls: D.reduce((s, r) => s + (r.calls || 0), 0),
  gemini: { prefer: { O: cnt(Dp, r => r.gem_prefer === 'O'), L: cnt(Dp, r => r.gem_prefer === 'L'), tie: cnt(Dp, r => r.gem_prefer === 'tie') }, misleading_O: cnt(Dp, r => r.gem_C_O === 'misleading'), misleading_L: cnt(Dp, r => r.gem_C_L === 'misleading') },
  opus_same_pages: { prefer: { O: cnt(Dp, r => r.opus_prefer === 'O'), L: cnt(Dp, r => r.opus_prefer === 'L'), tie: cnt(Dp, r => r.opus_prefer === 'tie') }, misleading_O: cnt(Dp, r => r.opus_C_O === 'misleading'), misleading_L: cnt(Dp, r => r.opus_C_L === 'misleading') },
  gemini_L_where_opus_O: cnt(Dp, r => r.gem_prefer === 'L' && r.opus_prefer === 'O'), gemini_O_where_opus_L: cnt(Dp, r => r.gem_prefer === 'O' && r.opus_prefer === 'L'),
  same_preference: cnt(Dp, r => r.gem_prefer === r.opus_prefer) };
judge.self_preference_suspected = judge.gemini_L_where_opus_O >= 10;

const n = C4.length;
const mL = cnt(C4, r => r.C_L === 'misleading'), mFC = cnt(C4, r => r.C_FC === 'misleading'), worse = C4.filter(r => r.worse), shown4 = C4.filter(r => r.shown);
const m5FC = cnt(C5, r => r.C_FC === 'misleading'), m5O = cnt(C5, r => r.C_O === 'misleading');
const pref5 = { FC: cnt(C5, r => r.prefer === 'FC'), O: cnt(C5, r => r.prefer === 'O'), tie: cnt(C5, r => r.prefer === 'tie') };
const outcomes = {}; for (const o of OUT) outcomes[o.outcome] = (outcomes[o.outcome] || 0) + 1;
const ledger = fs.readdirSync('/root/agy-quota/jobs').filter(f => f.endsWith('.csv')).flatMap(f => fs.readFileSync(path.join('/root/agy-quota/jobs', f), 'utf8').split('\n')).filter(l => l.split(',')[1] === 'flash-correct-latin-5924');
const fcCalls = OUT.reduce((s, o) => s + o.calls, 0);
const bar_a = mL > 0 && mFC <= mL / 2, bar_b = worse.length === 0, bar_c = m5FC <= m5O + 3 && pref5.O <= 1.5 * pref5.FC;
const oc = rd(path.join(R, 'oc-score.json')), fs0 = rd(path.join(R, 'score.json'));
const res = {
  pages: n, outcomes, correction_calls: fcCalls, calls_per_page: +(fcCalls / n).toFixed(3), judge_calls: judge.calls, ledger_rows_this_job: ledger.length,
  cost_per_1k_pages_usd_at_plan_fee: +(fcCalls / n * 1000 * 200 / (52 / 12) / 77500).toFixed(2),
  contains: OUT.filter(o => o.outcome === 'contain').map(o => ({ slug: o.slug, reason: o.reason, true_contain: C4.find(r => r.slug === o.slug).true_contain })),
  no_answers: OUT.filter(o => o.outcome === 'no-answer').map(o => ({ slug: o.slug, reason: o.reason })),
  changed_share: { corrected: cnt(OUT, o => o.changed_share != null), over_25pct_cap: OUT.filter(o => o.over_25pct_cap).map(o => [o.slug, o.changed_share]), cli_ocr_cap_sees_zero_tokens: cnt(OUT, o => o.cli_ocr_cap_tokens === 0), median: (() => { const v = OUT.map(o => o.changed_share).filter(x => x != null).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] ?? null; })() },
  opus_changed_share_same_measure: (() => { const v = sample.books.flatMap(b => b.pages).map(p => { const o = Oreads.get(p.page_id); if (o.outcome !== 'corrected') return null; const d = wordChanged(lite(p.slug), o.text); return d.changed / Math.max(1, d.draftN); }).filter(x => x != null).sort((a, b) => a - b); return { corrected: v.length, median: +v[Math.floor(v.length / 2)].toFixed(3), over_25pct: v.filter(x => x > 0.25).length }; })(),
  c4: { shown: shown4.length, misleading_L: [mL, wilson(mL, n)], misleading_FC: [mFC, wilson(mFC, n)],
    prefer: { FC: cnt(C4, r => r.prefer === 'FC'), L: cnt(C4, r => r.prefer === 'L'), tie: cnt(C4, r => r.prefer === 'tie') },
    material_loss_L: cnt(C4, r => r.prefer === 'FC' && r.loser_material), material_loss_FC: cnt(C4, r => r.prefer === 'L' && r.loser_material),
    L_verdict_agreement_with_original_C_on_shown: { both_misleading: cnt(shown4, r => r.C_L === 'misleading' && r.orig_C_L === 'misleading'), c4_only: cnt(shown4, r => r.C_L === 'misleading' && r.orig_C_L !== 'misleading'), orig_only: cnt(shown4, r => r.C_L !== 'misleading' && r.orig_C_L === 'misleading') },
    strip: { visible: cnt(shown4, r => r.strip_visible), in_L: cnt(shown4, r => r.strip_in_L), in_FC: cnt(shown4, r => r.strip_in_FC) } },
  bar_a_halves: bar_a, worse_pages: worse.length, bar_b_no_page_worse: bar_b,
  worse_list: worse.map(r => ({ slug: r.slug, reasons: r.worse_reasons, why: r.why })),
  c5: { shown: cnt(C5, r => r.shown), misleading_FC: [m5FC, wilson(m5FC, n)], misleading_O: [m5O, wilson(m5O, n)], prefer: pref5,
    material_loss_O: cnt(C5, r => r.prefer === 'FC' && r.loser_material), material_loss_FC: cnt(C5, r => r.prefer === 'O' && r.loser_material),
    O_verdict_vs_c2: { c5_O_misleading: m5O, c2_O_misleading: oc.c2.misleading_O[0] } },
  bar_c_stands_in_for_O: bar_c, flash_correct_can_stand_in_for_opus: bar_a && bar_b && bar_c,
  excluding_wrong_leaf_book: (() => { const X4 = C4.filter(r => r.book !== 9), X5 = C5.filter(r => r.book !== 9); return { pages: X4.length, L: cnt(X4, r => r.C_L === 'misleading'), FC: cnt(X4, r => r.C_FC === 'misleading'), worse: cnt(X4, r => r.worse), c5_FC: cnt(X5, r => r.C_FC === 'misleading'), c5_O: cnt(X5, r => r.C_O === 'misleading'), c5_pref: { FC: cnt(X5, r => r.prefer === 'FC'), O: cnt(X5, r => r.prefer === 'O'), tie: cnt(X5, r => r.prefer === 'tie') } }; })(),
  four_arms: {
    lite: { misleading: `C: ${fs0.misleading.stepC_L[0]} · C2: ${oc.c2.misleading_L[0]} · C4: ${mL}` },
    flash_reread: { misleading: fs0.misleading.stepC_F[0], worse: fs0.worse_pages, prefer_vs_L: fs0.prefer },
    opus_correct: { misleading: oc.c2.misleading_O[0], worse: oc.worse_pages, prefer_vs_L: oc.c2.prefer, vs_F: oc.c3 && { O: oc.c3.misleading_O[0], F: oc.c3.misleading_F[0], prefer: oc.c3.prefer } },
    flash_correct: { misleading: mFC, worse: worse.length, prefer_vs_L: { FC: cnt(C4, r => r.prefer === 'FC'), L: cnt(C4, r => r.prefer === 'L'), tie: cnt(C4, r => r.prefer === 'tie') }, vs_O: { FC: m5FC, O: m5O, prefer: pref5 } },
  },
  flash_reread_worse_pages_under_FC: [...orig.values()].filter(r => r.worse).map(r => { const c = C4.find(x => x.slug === r.slug); return { slug: r.slug, F_filter_cut: r.F_filter_cut, FC_outcome: c.outcome, C4_FC: c.C_FC, C4_L: c.C_L, prefer: c.prefer, FC_worse: c.worse }; }),
  second_family_judge: judge,
  by_book: books,
};
void Oreads; void oc3; void servedO;
fs.writeFileSync(path.join(R, 'fc-step-c4.json'), JSON.stringify(C4, null, 1));
fs.writeFileSync(path.join(R, 'fc-step-c5.json'), JSON.stringify(C5, null, 1));
fs.writeFileSync(path.join(R, 'fc-outcomes.json'), JSON.stringify(OUT, null, 1));
fs.writeFileSync(path.join(R, 'fc-judge.json'), JSON.stringify(D, null, 1));
fs.writeFileSync(path.join(R, 'fc-reads.jsonl.gz'), zlib.gzipSync(reads.map(r => JSON.stringify(r)).join('\n') + '\n'));
fs.writeFileSync(path.join(R, 'fc-score.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify({ ...res, by_book: undefined }, null, 1));
for (const b of books) console.log(`${b.book_id} ${b.year} L ${b.L} FC ${b.FC} worse ${b.worse} | C5 FC ${b.c5_FC} O ${b.c5_O} pref ${JSON.stringify(b.c5_pref)} | ${JSON.stringify(b.outcomes)}`);
