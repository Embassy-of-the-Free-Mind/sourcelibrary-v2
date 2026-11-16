#!/usr/bin/env node
// PRIOR ART: scripts/audit/convergent-audit-weekly.mjs `score` (validateOutput on the reader's reviews, serious pages
// by class) and scripts/eval/route-judge-6740/paired-arm.mjs `score` (arms on shared pages, controls, noise floor). The
// first knows no arms; the second reads judge.mjs verdict rows, not the weekly audit's review files. This scores the
// T10 note-rule test (v3#44) from the weekly reader's own output, so its classes are the audit's classes.
/**
 *   node scripts/eval/error-zoo/t10-note-test/score.mjs --run DIR [--out FILE.json]
 * Per arm, on the pages both arms were read on: serious T10 pages, serious pages of every other class (the "no other
 * class rises" check), the notes audit (ok / unsupported / wrong, helpful, missing), note and hedge counts; the
 * paired discordance for T10 with an exact sign test; the controls (wrong-page caught, repeat agreement).
 * Pre-set rule (v3#44, written before the reads): the rule PASSES if serious T10 pages fall on the T10 stratum with a
 * sign-test p < 0.05, no other class rises by more than the repeat noise floor, and helpful-ok notes plus missing-note
 * findings do not move against the rule beyond that floor on either stratum.
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateOutput, keyOf } from '../../second-reader/lib.mjs';
import { wilson } from '../../lib/agreement-stats.mjs';
import { binomTwoSided } from '../../lib/paired-stats.mjs';
import { noteHedges } from '../../../lib/ocr-english-checks.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const R = arg('run'); if (!R) { console.error('--run DIR required'); process.exit(2); }
const J = (...p) => path.join(R, ...p);
const OUT = arg('out', J('score.json'));
const key = JSON.parse(fs.readFileSync(J('key.json'), 'utf8')).rows;
const CODE = /\b([IOTDE]\d{1,2})\b/;
const cls = (e) => (String(e.class || '').match(CODE) || [])[1] || 'other';

function review(row) {
  const recs = JSON.parse(fs.readFileSync(J('packets', `${row.id}.json`), 'utf8'));
  let out = null; try { out = JSON.parse(fs.readFileSync(J('readers', 'opus', 'reviews', `${row.id}.json`), 'utf8')); } catch { return null; }
  const v = validateOutput(out, recs);
  const p = v.pages.get(keyOf(recs[0].book_id, recs[0].pages[0].page_number));
  if (!p) return null;
  const errs = [...(p.ocr_errors || []), ...(p.tr_errors || []), ...(p.other || [])];
  const serious = errs.filter((e) => e.severity === 'serious');
  const na = p.notes_audit || {};
  const items = Array.isArray(na.items) ? na.items : [];
  const en = recs[0].pages[0].translation;
  return { right_page: p.right_page, serious_classes: [...new Set(serious.map(cls))], any_classes: [...new Set(errs.map(cls))],
    t10_serious: serious.filter((e) => cls(e) === 'T10').length, t10_any: errs.filter((e) => cls(e) === 'T10').length,
    notes: noteHedges(en).notes, hedges: noteHedges(en).hedges,
    na_ok: items.filter((x) => x.verdict === 'ok').length, na_unsupported: items.filter((x) => x.verdict === 'unsupported').length,
    na_wrong: items.filter((x) => x.verdict === 'wrong').length, na_helpful_ok: items.filter((x) => x.verdict === 'ok' && x.helpful === true).length,
    na_missing: Array.isArray(na.missing) ? na.missing.length : 0, notes_audit_present: !!p.notes_audit, fabricated_quotes: v.fabricated.length };
}

const got = new Map(key.map((r) => [r.id, review(r)]));
const items = key.filter((r) => r.kind === 'item' && got.get(r.id));
const byPage = new Map();
for (const r of items) { const x = byPage.get(r.page_id) || { stratum: r.stratum, language: r.language }; x[r.arm] = got.get(r.id); byPage.set(r.page_id, x); }
const pairs = [...byPage.entries()].filter(([, x]) => x.A && x.B);
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const kn = (k, n) => ({ k, n, rate: n ? k / n : null, ci: wilson(k, n) });

function block(stratum) {
  const P = pairs.filter(([, x]) => !stratum || x.stratum === stratum).map(([id, x]) => ({ id, ...x }));
  const n = P.length;
  const t10 = { A: kn(P.filter((x) => x.A.t10_serious).length, n), B: kn(P.filter((x) => x.B.t10_serious).length, n) };
  const onlyA = P.filter((x) => x.A.t10_serious && !x.B.t10_serious).length, onlyB = P.filter((x) => !x.A.t10_serious && x.B.t10_serious).length;
  const classes = [...new Set(P.flatMap((x) => [...x.A.serious_classes, ...x.B.serious_classes]))].sort();
  const perClass = Object.fromEntries(classes.map((c) => [c, { A: P.filter((x) => x.A.serious_classes.includes(c)).length, B: P.filter((x) => x.B.serious_classes.includes(c)).length }]));
  const anySerious = { A: kn(P.filter((x) => x.A.serious_classes.length).length, n), B: kn(P.filter((x) => x.B.serious_classes.length).length, n) };
  const anyButT10 = { A: P.filter((x) => x.A.serious_classes.some((c) => c !== 'T10')).length, B: P.filter((x) => x.B.serious_classes.some((c) => c !== 'T10')).length };
  const tot = (arm, f) => sum(P, (x) => x[arm][f]);
  const notes = Object.fromEntries(['notes', 'hedges', 'na_ok', 'na_helpful_ok', 'na_unsupported', 'na_wrong', 'na_missing', 't10_any'].map((f) => [f, { A: tot('A', f), B: tot('B', f) }]));
  return { n_pages: n, t10_serious_pages: t10, t10_discordant: { only_A: onlyA, only_B: onlyB, sign_test_p: binomTwoSided(Math.min(onlyA, onlyB), onlyA + onlyB) },
    any_serious_pages: anySerious, serious_other_than_t10_pages: anyButT10, serious_pages_by_class: perClass, notes_totals: notes,
    notes_audit_missing_field: { A: P.filter((x) => !x.A.notes_audit_present).length, B: P.filter((x) => !x.B.notes_audit_present).length } };
}

// Controls
const wrong = key.filter((r) => r.kind === 'wrong_page').map((r) => ({ ...r, rv: got.get(r.id) }));
const repeats = key.filter((r) => r.kind === 'repeat').map((r) => {
  const orig = items.find((i) => i.page_id === r.page_id && i.arm === 'A');
  const a = orig && got.get(orig.id), b = got.get(r.id);
  return a && b ? { page_id: r.page_id, t10_same: !!a.t10_serious === !!b.t10_serious, any_same: !!a.serious_classes.length === !!b.serious_classes.length,
    class_sets: [a.serious_classes, b.serious_classes], helpful_ok: [a.na_helpful_ok, b.na_helpful_ok], missing: [a.na_missing, b.na_missing] } : { page_id: r.page_id, missing_review: true };
});
const read = key.filter((r) => got.get(r.id)).length;
const res = {
  scored_at: new Date().toISOString(), packets: key.length, reviews_read: read, pages_with_both_arms: pairs.length,
  all: block(null), t10: block('t10'), clean_with_notes: block('clean-with-notes'),
  controls: {
    wrong_page: { caught: wrong.filter((w) => w.rv?.right_page === 'no').length, read: wrong.filter((w) => w.rv).length, n: wrong.length, by_arm: Object.fromEntries(['A', 'B'].map((a) => [a, wrong.filter((w) => w.arm === a).map((w) => w.rv?.right_page ?? 'missing')])) },
    repeats: { n: repeats.length, t10_agree: repeats.filter((x) => x.t10_same).length, any_serious_agree: repeats.filter((x) => x.any_same).length, rows: repeats },
  },
};
fs.writeFileSync(OUT, JSON.stringify(res, null, 1) + '\n');
const f = (x) => `${x.k}/${x.n}`;
for (const s of ['t10', 'clean_with_notes', 'all']) {
  const b = res[s];
  console.log(`${s}: ${b.n_pages} pages | serious T10 A ${f(b.t10_serious_pages.A)} B ${f(b.t10_serious_pages.B)} (only A ${b.t10_discordant.only_A}, only B ${b.t10_discordant.only_B}, p=${b.t10_discordant.sign_test_p?.toFixed(3)}) | any serious A ${f(b.any_serious_pages.A)} B ${f(b.any_serious_pages.B)} | other-than-T10 A ${b.serious_other_than_t10_pages.A} B ${b.serious_other_than_t10_pages.B}`);
  console.log(`   notes ${JSON.stringify(b.notes_totals)}`);
  console.log(`   by class ${JSON.stringify(b.serious_pages_by_class)}`);
}
console.log(`controls: wrong-page caught ${res.controls.wrong_page.caught}/${res.controls.wrong_page.n}; repeats T10 agree ${res.controls.repeats.t10_agree}/${res.controls.repeats.n}, any-serious agree ${res.controls.repeats.any_serious_agree}/${res.controls.repeats.n}`);
