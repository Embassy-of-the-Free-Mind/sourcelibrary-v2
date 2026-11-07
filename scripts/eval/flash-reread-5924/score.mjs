#!/usr/bin/env node
// PRIOR ART: none for this shape — the prereg's bar (misleading halves, no page worse) read off the blind Step C
//   verdicts; spotcheck-latin-5924 tallied by hand.
// score.mjs — unblinds Step C with keys/c-key.json and scores against PREREGISTRATION.md (#5924).
// Writes results/step-a.json, results/step-c.json (verdicts by arm, no page text beyond the readers' short quotes)
// and results/score.json.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const J = process.env.JOB_SCRATCH; const HERE = path.dirname(new URL(import.meta.url).pathname); const R = path.join(HERE, 'results');
const sample = JSON.parse(fs.readFileSync(path.join(R, 'sample.json'), 'utf8'));
const key = JSON.parse(fs.readFileSync(path.join(J, 'keys/c-key.json'), 'utf8'));
const F = new Map(zlib.gunzipSync(fs.readFileSync(path.join(R, 'F-reads.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.page_id, r]));
const wilson = (k, n) => { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [+(100 * (c - h) / d).toFixed(1), +(100 * (c + h) / d).toFixed(1)]; };
const FILTER = /blocked by Gemini'?s filters|request was blocked/i;
const A = [], C = [], books = [];
sample.books.forEach((b, i) => {
  const a = JSON.parse(fs.readFileSync(path.join(J, `agents/A-out-${i}.json`), 'utf8'));
  const c = JSON.parse(fs.readFileSync(path.join(J, `agents/C-out-${i}.json`), 'utf8'));
  const bk = { book_id: b.book_id, year: b.year, title: b.title.slice(0, 70), n: 25, A_L: 0, C_L: 0, C_F: 0, prefF: 0, prefL: 0, tie: 0, F_material_loss: 0, L_material_loss: 0 };
  b.pages.forEach((p, j) => {
    const ra = a.find(x => x.slug === p.slug) || a[j], rc = c.find(x => x.slug === p.slug) || c[j];
    if (ra.slug !== p.slug || rc.slug !== p.slug) throw new Error(`order mismatch ${p.slug}`);
    const fIsX = key[p.slug] === 'XF';
    const vF = fIsX ? rc.X : rc.Y, vL = fIsX ? rc.Y : rc.X;
    const pref = rc.prefer === 'tie' ? 'tie' : (rc.prefer === 'X') === fIsX ? 'F' : 'L';
    const ftext = F.get(p.page_id)?.text || '';
    const row = { slug: p.slug, book: i, A_L: ra.verdict, C_L: vL.verdict, C_F: vF.verdict, prefer: pref, loser_material: !!rc.loser_material, why: rc.why,
      ntl_L: !!(fIsX ? rc.not_this_leaf_Y : rc.not_this_leaf_X), ntl_F: !!(fIsX ? rc.not_this_leaf_X : rc.not_this_leaf_Y),
      strip_visible: !!rc.facing_strip_visible, strip_in_F: !!(fIsX ? rc.strip_in_X : rc.strip_in_Y), strip_in_L: !!(fIsX ? rc.strip_in_Y : rc.strip_in_X),
      F_filter_cut: FILTER.test(ftext), F_failed: !ftext.trim(), defects_F: vF.defects, defects_L: vL.defects };
    row.worse = (row.C_F === 'misleading' && row.C_L !== 'misleading') || (pref === 'L' && row.loser_material) || row.F_failed;
    C.push(row); A.push({ slug: p.slug, verdict: ra.verdict, defects: ra.defects, not_this_leaf: !!ra.not_this_leaf });
    bk.A_L += ra.verdict === 'misleading'; bk.C_L += row.C_L === 'misleading'; bk.C_F += row.C_F === 'misleading';
    bk[pref === 'F' ? 'prefF' : pref === 'L' ? 'prefL' : 'tie']++; if (pref === 'L' && row.loser_material) bk.F_material_loss++; if (pref === 'F' && row.loser_material) bk.L_material_loss++;
  });
  books.push(bk);
});
const n = C.length, cnt = f => C.filter(f).length;
const mL = cnt(r => r.C_L === 'misleading'), mF = cnt(r => r.C_F === 'misleading'), mA = A.filter(r => r.verdict === 'misleading').length;
const worse = C.filter(r => r.worse);
const res = {
  pages: n, books: books.length,
  misleading: { stepA_L: [mA, wilson(mA, n)], stepC_L: [mL, wilson(mL, n)], stepC_F: [mF, wilson(mF, n)] },
  bar1_halves: mL > 0 && mF <= mL / 2,
  worse_pages: worse.length, bar2_no_page_worse: worse.length === 0,
  pass: mL > 0 && mF <= mL / 2 && worse.length === 0,
  worse_breakdown: { F_misleading_L_not: cnt(r => r.C_F === 'misleading' && r.C_L !== 'misleading'), L_misleading_F_not: cnt(r => r.C_L === 'misleading' && r.C_F !== 'misleading'), L_preferred_material: cnt(r => r.prefer === 'L' && r.loser_material), F_preferred_material: cnt(r => r.prefer === 'F' && r.loser_material), F_unread: cnt(r => r.F_failed) },
  prefer: { F: cnt(r => r.prefer === 'F'), L: cnt(r => r.prefer === 'L'), tie: cnt(r => r.prefer === 'tie') },
  agreement_A_vs_C_on_L: { both_misleading: cnt((r, i) => r.C_L === 'misleading' && A[C.indexOf(r)].verdict === 'misleading'), A_only: C.filter((r, i) => r.C_L !== 'misleading' && A[i].verdict === 'misleading').length, C_only: C.filter((r, i) => r.C_L === 'misleading' && A[i].verdict !== 'misleading').length },
  F_filter_cut_pages: cnt(r => r.F_filter_cut), F_filter_cut_by_book: Object.fromEntries(books.map((b, i) => [b.book_id, cnt(r => r.book === i && r.F_filter_cut)]).filter(([, v]) => v)),
  strip: { visible: cnt(r => r.strip_visible), in_L: cnt(r => r.strip_in_L), in_F: cnt(r => r.strip_in_F) },
  excluding_wrong_leaf_book: (() => { const D = C.filter(r => r.book !== 9); const l = D.filter(r => r.C_L === 'misleading').length, f = D.filter(r => r.C_F === 'misleading').length; return { pages: D.length, L: [l, wilson(l, D.length)], F: [f, wilson(f, D.length)], worse: D.filter(r => r.worse).length }; })(),
  books_failing_25_check: { stepC_L_ge2: books.filter(b => b.C_L >= 2).length, stepA_L_ge2: books.filter(b => b.A_L >= 2).length },
  by_book: books,
};
fs.writeFileSync(path.join(R, 'step-a.json'), JSON.stringify(A, null, 1));
fs.writeFileSync(path.join(R, 'step-c.json'), JSON.stringify(C, null, 1));
fs.writeFileSync(path.join(R, 'score.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify({ ...res, by_book: undefined }, null, 1));
for (const b of books) console.log(`${b.book_id} ${b.year} A_L ${b.A_L} C_L ${b.C_L} C_F ${b.C_F} pref F/L/tie ${b.prefF}/${b.prefL}/${b.tie} Fmat ${b.F_material_loss} Lmat ${b.L_material_loss}`);
