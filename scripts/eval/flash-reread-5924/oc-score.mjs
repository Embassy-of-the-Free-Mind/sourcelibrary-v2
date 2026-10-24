#!/usr/bin/env node
// PRIOR ART: ./score.mjs (the original Step C scorer; its Wilson interval and verdict mapping are kept) — it scores
//   L vs F only; this scores the Opus-correction arm against PREREGISTRATION-opus-correct.md.
// oc-score.mjs — unblinds Step C2 (O vs L) and C3 (O vs F) with $JOB_SCRATCH/keys/c{2,3}-key.json. Writes
//   results/oc-step-c2.json, results/oc-step-c3.json, results/oc-outcomes.json and results/oc-score.json.
import fs from 'node:fs'; import path from 'node:path';
const J = process.env.JOB_SCRATCH, SET = process.env.SET_DIR || path.join(J, 'set'), FL = process.env.FLASH_JOB || '/data/scratch/sl/jobs/flash-reread-test-5924';
const HERE = path.dirname(new URL(import.meta.url).pathname); const R = path.join(HERE, 'results');
const sample = JSON.parse(fs.readFileSync(path.join(R, 'sample.json'), 'utf8'));
const orig = new Map(JSON.parse(fs.readFileSync(path.join(R, 'step-c.json'), 'utf8')).map(r => [r.slug, r]));
const origA = new Map(JSON.parse(fs.readFileSync(path.join(R, 'step-a.json'), 'utf8')).map(r => [r.slug, r]));
const key2 = JSON.parse(fs.readFileSync(path.join(J, 'keys/c2-key.json'), 'utf8')), key3 = JSON.parse(fs.readFileSync(path.join(J, 'keys/c3-key.json'), 'utf8'));
const wilson = (k, n) => { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [+(100 * (c - h) / d).toFixed(1), +(100 * (c + h) / d).toFixed(1)]; };
const readOut = (tag, i) => { const f = path.join(J, `agents/C${tag}-out-${i}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; };
const unblind = (rc, oIsX, other) => {
  const vO = oIsX ? rc.X : rc.Y, vB = oIsX ? rc.Y : rc.X;
  const pref = rc.prefer === 'tie' ? 'tie' : (rc.prefer === 'X') === oIsX ? 'O' : other;
  return { vO, vB, pref, ntl_O: !!(oIsX ? rc.not_this_leaf_X : rc.not_this_leaf_Y), ntl_B: !!(oIsX ? rc.not_this_leaf_Y : rc.not_this_leaf_X), strip_in_O: !!(oIsX ? rc.strip_in_X : rc.strip_in_Y), strip_in_B: !!(oIsX ? rc.strip_in_Y : rc.strip_in_X) };
};
const C2 = [], C3 = [], OUT = [], books = [];
sample.books.forEach((b, i) => {
  const c2 = readOut(2, i), c3 = readOut(3, i);
  const bk = { book_id: b.book_id, year: b.year, n: 25, L: 0, O: 0, F3: 0, O3: 0, worse: 0, c2_pref: { O: 0, L: 0, tie: 0 }, c3_pref: { O: 0, F: 0, tie: 0 }, outcomes: {} };
  for (const p of b.pages) {
    const m = JSON.parse(fs.readFileSync(path.join(SET, 'reads', `${p.page_id}.meta.json`), 'utf8'));
    const o = orig.get(p.slug), a = origA.get(p.slug);
    bk.outcomes[m.outcome] = (bk.outcomes[m.outcome] || 0) + 1;
    OUT.push({ slug: p.slug, book: i, outcome: m.outcome, reason: m.reason, chars: m.chars, call_id: m.call_id ?? null });
    // C2
    let row;
    if (key2[p.slug]) {
      const rc = c2.find(x => x.slug === p.slug); if (!rc) throw new Error(`C2 missing ${p.slug}`);
      const u = unblind(rc, key2[p.slug] === 'XO', 'L');
      row = { slug: p.slug, book: i, shown: true, outcome: m.outcome, C_O: u.vO.verdict, C_L: u.vB.verdict, prefer: u.pref, loser_material: !!rc.loser_material, why: rc.why, ntl_O: u.ntl_O, ntl_L: u.ntl_B, strip_visible: !!rc.facing_strip_visible, strip_in_O: u.strip_in_O, strip_in_L: u.strip_in_B, orig_C_L: o.C_L, defects_O: u.vO.defects, defects_L: u.vB.defects };
    } else {
      row = { slug: p.slug, book: i, shown: false, outcome: m.outcome, C_O: o.C_L, C_L: o.C_L, prefer: 'tie', loser_material: false, why: 'O serves L unchanged (not shown; original Step C L verdict)', ntl_O: o.ntl_L, ntl_L: o.ntl_L, orig_C_L: o.C_L };
    }
    const flaggedWrongLeaf = !!(o.ntl_L || a?.not_this_leaf);
    row.false_contain = m.outcome === 'contain' && !flaggedWrongLeaf;
    row.true_contain = m.outcome === 'contain' && flaggedWrongLeaf;
    row.no_answer = m.outcome === 'no-answer';
    row.worse_reasons = [row.C_O === 'misleading' && row.C_L !== 'misleading' && 'O misleading, L not', row.prefer === 'L' && row.loser_material && 'L preferred, material', row.no_answer && 'no answer', row.false_contain && 'false contain'].filter(Boolean);
    row.worse = row.worse_reasons.length > 0;
    C2.push(row);
    bk.L += row.C_L === 'misleading'; bk.O += row.C_O === 'misleading'; bk.worse += row.worse; bk.c2_pref[row.prefer]++;
    // C3
    const rc3 = c3.find(x => x.slug === p.slug); if (!rc3) throw new Error(`C3 missing ${p.slug}`);
    const u3 = unblind(rc3, key3[p.slug] === 'XO', 'F');
    const r3 = { slug: p.slug, book: i, outcome: m.outcome, C_O: u3.vO.verdict, C_F: u3.vB.verdict, prefer: u3.pref, loser_material: !!rc3.loser_material, why: rc3.why, ntl_O: u3.ntl_O, ntl_F: u3.ntl_B, strip_visible: !!rc3.facing_strip_visible, strip_in_O: u3.strip_in_O, strip_in_F: u3.strip_in_B, orig_C_F: o.C_F, defects_O: u3.vO.defects, defects_F: u3.vB.defects };
    C3.push(r3);
    bk.O3 += r3.C_O === 'misleading'; bk.F3 += r3.C_F === 'misleading'; bk.c3_pref[r3.prefer]++;
  }
  books.push(bk);
});
const n = C2.length, cnt = (A, f) => A.filter(f).length;
const mL = cnt(C2, r => r.C_L === 'misleading'), mO = cnt(C2, r => r.C_O === 'misleading');
const mO3 = cnt(C3, r => r.C_O === 'misleading'), mF3 = cnt(C3, r => r.C_F === 'misleading');
const worse = C2.filter(r => r.worse);
const shown = C2.filter(r => r.shown);
const pref3 = { O: cnt(C3, r => r.prefer === 'O'), F: cnt(C3, r => r.prefer === 'F'), tie: cnt(C3, r => r.prefer === 'tie') };
const outcomes = {}; for (const o of OUT) outcomes[o.outcome] = (outcomes[o.outcome] || 0) + 1;
const calls = fs.readFileSync(path.join(SET, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const tok = calls.reduce((s, c) => { const u = c.usage || {}; s.input += u.input || 0; s.output += u.output || 0; s.cache_read += u.cache_read || 0; s.list_cost_usd += u.list_cost_usd || 0; return s; }, { calls: calls.length, input: 0, output: 0, cache_read: 0, list_cost_usd: 0 });
tok.list_cost_usd = +tok.list_cost_usd.toFixed(2);
const bar_a = mL > 0 && mO <= mL / 2, bar_b = worse.length === 0;
const res = {
  pages: n, books: books.length, outcomes,
  contains: OUT.filter(o => o.outcome === 'contain').map(o => ({ slug: o.slug, reason: o.reason, true_contain: C2.find(r => r.slug === o.slug).true_contain })),
  no_answers: OUT.filter(o => o.outcome === 'no-answer').map(o => ({ slug: o.slug, reason: o.reason })),
  c2: { shown: shown.length, misleading_L: [mL, wilson(mL, n)], misleading_O: [mO, wilson(mO, n)],
    prefer: { O: cnt(C2, r => r.prefer === 'O'), L: cnt(C2, r => r.prefer === 'L'), tie: cnt(C2, r => r.prefer === 'tie') },
    material_loss_L: cnt(C2, r => r.prefer === 'O' && r.loser_material), material_loss_O: cnt(C2, r => r.prefer === 'L' && r.loser_material),
    L_misleading_O_not: cnt(C2, r => r.C_L === 'misleading' && r.C_O !== 'misleading'), O_misleading_L_not: cnt(C2, r => r.C_O === 'misleading' && r.C_L !== 'misleading'),
    L_verdict_agreement_with_original_C_on_shown: { both_misleading: cnt(shown, r => r.C_L === 'misleading' && r.orig_C_L === 'misleading'), c2_only: cnt(shown, r => r.C_L === 'misleading' && r.orig_C_L !== 'misleading'), orig_only: cnt(shown, r => r.C_L !== 'misleading' && r.orig_C_L === 'misleading') },
    strip: { visible: cnt(shown, r => r.strip_visible), in_L: cnt(shown, r => r.strip_in_L), in_O: cnt(shown, r => r.strip_in_O) } },
  bar_a_halves: bar_a, worse_pages: worse.length, bar_b_no_page_worse: bar_b,
  worse_list: worse.map(r => ({ slug: r.slug, reasons: r.worse_reasons, why: r.why })),
  c3: { misleading_O: [mO3, wilson(mO3, n)], misleading_F: [mF3, wilson(mF3, n)], prefer: pref3,
    material_loss_F: cnt(C3, r => r.prefer === 'O' && r.loser_material), material_loss_O: cnt(C3, r => r.prefer === 'F' && r.loser_material),
    F_verdict_agreement_with_original_C: { both_misleading: cnt(C3, r => r.C_F === 'misleading' && r.orig_C_F === 'misleading'), c3_only: cnt(C3, r => r.C_F === 'misleading' && r.orig_C_F !== 'misleading'), orig_only: cnt(C3, r => r.C_F !== 'misleading' && r.orig_C_F === 'misleading') },
    strip: { visible: cnt(C3, r => r.strip_visible), in_O: cnt(C3, r => r.strip_in_O), in_F: cnt(C3, r => r.strip_in_F) } },
  bar_c_beats_F: mO3 <= mF3 && pref3.O > pref3.F,
  correction_recommended_over_F: bar_a && bar_b && mO3 <= mF3 && pref3.O > pref3.F,
  excluding_wrong_leaf_book: (() => { const D = C2.filter(r => r.book !== 9), D3 = C3.filter(r => r.book !== 9); return { pages: D.length, L: cnt(D, r => r.C_L === 'misleading'), O: cnt(D, r => r.C_O === 'misleading'), worse: cnt(D, r => r.worse), O3: cnt(D3, r => r.C_O === 'misleading'), F3: cnt(D3, r => r.C_F === 'misleading') }; })(),
  second_family_judge: 'not run (no agy meter readable from l7a; see the prereg) — single-family',
  claude_tokens: tok,
  by_book: books,
};
fs.writeFileSync(path.join(R, 'oc-step-c2.json'), JSON.stringify(C2, null, 1));
fs.writeFileSync(path.join(R, 'oc-step-c3.json'), JSON.stringify(C3, null, 1));
fs.writeFileSync(path.join(R, 'oc-outcomes.json'), JSON.stringify(OUT, null, 1));
fs.writeFileSync(path.join(R, 'oc-score.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify({ ...res, by_book: undefined }, null, 1));
for (const b of books) console.log(`${b.book_id} ${b.year} L ${b.L} O ${b.O} worse ${b.worse} | C3 O ${b.O3} F ${b.F3} pref ${JSON.stringify(b.c3_pref)} | ${JSON.stringify(b.outcomes)}`);
