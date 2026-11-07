#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-corpus-audit/score.mjs (control gate, per-cell fidelity and flags: run first,
// its report.json is read here for the gate) and analyze-wave2.mjs (post-stratified estimates over a fresh random
// draw, language x arm weights): neither has a transcription verdict to join to. scripts/eval/confidence-7866/
// regrade.mjs carries the #7866 grade ladder, the book weights and the stratified book-cluster bootstrap; imported
// (shares, bootstrap, STRATA), not copied. This joins the two verdicts on the same page (#7968).
/**
 * Translation verdicts on the #7866 pages, joined to #7866's transcription grade on the same page (#7968).
 *
 *   node scripts/eval/translation-corpus-audit/analyze-7866-join.mjs [--dir scripts/eval/results/translation-on-7866-draw] [--judge opus]
 *
 * Reads <dir>/manifest.jsonl (draw-from-7866.mjs), <dir>/verdicts/<judge>/*.jsonl, <dir>/report.json (score.mjs).
 * Writes <dir>/summary.json. No database access.
 *
 * Definitions (all from the judge's own fields; no re-scoring):
 *   major            the English verdict carries a defect of severity "major" (JUDGE-PROMPT.md; fidelity 1-2 must carry one)
 *   ocr_bad          the same judge, with the page image, set ocr_misread or ocr_wrong_leaf (IMAGE-ADDENDUM.md)
 *   e2e_wrong        major OR ocr_bad: the English is wrong for a reader, from either cause
 *   bad_7866         #7866's grade is search_only or worse (regrade.mjs gradeOf: a reading that changes the sense,
 *                    a span the page does not carry, text from elsewhere, mostly wrong, not this page)
 *   inherited        a page with a major English defect whose transcription #7866 graded bad_7866
 * Weighted figures use the #7866 book weights (draw.weight) and its stratified book-cluster bootstrap. A page counts
 * with its book's weight; a book's pages are resampled together. Cells are unweighted page counts; a cell with fewer
 * than 3 books is listed with its counts and no rates.
 */
import fs from 'node:fs';
import path from 'node:path';
import { shares, bootstrap, STRATA } from '../confidence-7866/regrade.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const DIR = args.dir || 'scripts/eval/results/translation-on-7866-draw';
const JUDGE = args.judge || 'opus';
const SEED = 79680;
const B = 4000;

const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const manifest = readJsonl(path.join(DIR, 'manifest.jsonl'));
const report = JSON.parse(fs.readFileSync(path.join(DIR, 'report.json'), 'utf8'));
const V = {};
for (const f of fs.readdirSync(path.join(DIR, 'verdicts', JUDGE)).filter((x) => x.endsWith('.jsonl'))) {
  for (const v of readJsonl(path.join(DIR, 'verdicts', JUDGE, f))) if (v.id && typeof v.fidelity === 'number') V[v.id] = v;
}

const r4 = (x) => (x == null || Number.isNaN(x) ? null : +x.toFixed(4));
const r2 = (x) => (x == null || Number.isNaN(x) ? null : +x.toFixed(2));
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.min(s.length - 1, Math.floor(p * s.length)))]; };

/* ── rows ── */
const rows = manifest.filter((m) => m.kind === 'main' && V[m.id]).map((m) => {
  const v = V[m.id], ds = Array.isArray(v.defects) ? v.defects : [];
  const majors = ds.filter((d) => d.severity === 'major').length;
  const ocrBad = !!(v.ocr_misread || v.ocr_wrong_leaf);
  return {
    id: m.id, book: m.book_id, page: m.page_number, url: m.url, title: m.title, lang: m.language, model: m.model || 'unknown',
    route: m.ocr_route || 'unknown', age: m.age_band, hand: m.script_7866 || 'unknown', stratum: m.stratum, weight: m.weight,
    words: m.english_words, fidelity: v.fidelity, majors, major: majors > 0,
    flags: Object.entries(v.flags || {}).filter(([, x]) => x).map(([k]) => k),
    ocr_misread: !!v.ocr_misread, ocr_wrong_leaf: !!v.ocr_wrong_leaf, ocr_bad: ocrBad, image_seen: v.image_seen !== false,
    e2e_wrong: majors > 0 || ocrBad,
    grade_7866: m.grade_7866, bad_7866: !!m.search_only_or_worse_7866, wrong_text_7866: ['wrong_span', 'from_elsewhere', 'mostly_wrong', 'not_this_page'].includes(m.grade_7866),
    translation_older_than_ocr: m.translation_older_than_ocr,
    reason: v.reason, image_note: v.image_note,
  };
});
const missing = manifest.filter((m) => m.kind === 'main' && !V[m.id]).map((m) => m.id);

const booksOf = (rs) => {
  const by = new Map();
  for (const r of rs) {
    const b = by.get(r.book) ?? { id: r.book, stratum: r.stratum, weight: r.weight, lang: r.lang, pages: [] };
    b.pages.push(r); by.set(r.book, b);
  }
  return [...by.values()];
};
const books = booksOf(rows);

/** Weighted share of pages where pred holds, with regrade.mjs's stratified book-cluster bootstrap. */
function wShare(bks, pred, seed) {
  const key = (p) => (pred(p) ? 'yes' : 'no');
  const s = shares(bks, key, ['yes', 'no']);
  return { share: r4(s.share.yes), ci95: bootstrap(bks, key, ['yes', 'no'], seed, B).yes, pages: bks.reduce((a, b) => a + b.pages.length, 0), books: bks.length, k: bks.reduce((a, b) => a + b.pages.filter(pred).length, 0) };
}
/** Weighted ratio sum(w·num)/sum(w·den) with the same resampling (books within strata, B draws). */
function wRatio(bks, num, den, seed, per = 1000) {
  const est = (bs) => { let n = 0, d = 0; for (const b of bs) for (const p of b.pages) { n += b.weight * num(p); d += b.weight * den(p); } return d ? (n / d) * per : null; };
  const rng = mulberry32(seed);
  const groups = STRATA.map((s) => bks.filter((b) => b.stratum === s)).filter((g) => g.length);
  const draws = [];
  for (let i = 0; i < B; i++) {
    const samp = [];
    for (const g of groups) for (let j = 0; j < g.length; j++) samp.push(g[Math.floor(rng() * g.length)]);
    const e = est(samp); if (e != null) draws.push(e);
  }
  return { value: r2(est(bks)), ci95: [r2(pctl(draws, 0.025)), r2(pctl(draws, 0.975))] };
}
/** Any statistic of the weighted book set, with the same resampling. stat(books) -> number | null. */
function wStat(bks, stat, seed) {
  const rng = mulberry32(seed);
  const groups = STRATA.map((s) => bks.filter((b) => b.stratum === s)).filter((g) => g.length);
  const draws = [];
  for (let i = 0; i < B; i++) {
    const samp = [];
    for (const g of groups) for (let j = 0; j < g.length; j++) samp.push(g[Math.floor(rng() * g.length)]);
    const e = stat(samp); if (e != null && Number.isFinite(e)) draws.push(e);
  }
  return { value: r4(stat(bks)), ci95: [r4(pctl(draws, 0.025)), r4(pctl(draws, 0.975))] };
}
/** Weighted P(pred | given) over a book set. */
const wp = (bs, given, pred) => { let n = 0, d = 0; for (const b of bs) for (const p of b.pages) if (given(p)) { d += b.weight; if (pred(p)) n += b.weight; } return d ? n / d : null; };
/**
 * The inherited share counts every major English defect on a bad transcription as inherited. But the English also
 * fails on GOOD transcriptions; the part of the inherited share the transcription explains is the attributable
 * fraction among the major pages: AF = P(bad | major) x (1 - 1/RR), RR = P(major | bad) / P(major | not bad).
 */
const attributable = (bs) => {
  const pb = wp(bs, (p) => p.bad_7866, (p) => p.major), pc = wp(bs, (p) => !p.bad_7866, (p) => p.major), pbm = wp(bs, (p) => p.major, (p) => p.bad_7866);
  if (pb == null || pc == null || pbm == null || !pb) return null;
  return pbm * (1 - pc / pb);
};

/** Conditional share: of pages where `given` holds, the weighted share where `pred` holds; books with no such page drop out. */
function wConditional(bks, given, pred, seed) {
  const sub = bks.map((b) => ({ ...b, pages: b.pages.filter(given) })).filter((b) => b.pages.length);
  return { ...wShare(sub, pred, seed), of_pages: sub.reduce((a, b) => a + b.pages.length, 0) };
}

/* ── cells (unweighted) ── */
const MIN_BOOKS = 3;
function cell(rs) {
  const nb = new Set(rs.map((r) => r.book)).size;
  const w = rs.reduce((a, r) => a + r.words, 0);
  const majorPages = rs.filter((r) => r.major);
  const base = { books: nb, pages: rs.length, english_words: w, major_pages: majorPages.length, e2e_wrong_pages: rs.filter((r) => r.e2e_wrong).length, inherited_pages: majorPages.filter((r) => r.bad_7866).length };
  if (nb < MIN_BOOKS) return { ...base, rated: false };
  return {
    ...base, rated: true,
    fidelity_dist: [1, 2, 3, 4, 5].map((k) => rs.filter((r) => r.fidelity === k).length),
    fidelity_ge4: r4(rs.filter((r) => r.fidelity >= 4).length / rs.length),
    major_share: r4(majorPages.length / rs.length),
    major_per_1k_words: w ? r2((rs.reduce((a, r) => a + r.majors, 0) / w) * 1000) : null,
    ocr_bad_share: r4(rs.filter((r) => r.ocr_bad).length / rs.length),
    e2e_wrong_share: r4(rs.filter((r) => r.e2e_wrong).length / rs.length),
    bad_7866_share: r4(rs.filter((r) => r.bad_7866).length / rs.length),
    inherited_share: majorPages.length ? r4(majorPages.filter((r) => r.bad_7866).length / majorPages.length) : null,
  };
}
const cutBy = (keyOf) => Object.fromEntries(Object.entries(rows.reduce((o, r) => ((o[keyOf(r)] ||= []).push(r), o), {}))
  .sort((a, b) => b[1].length - a[1].length).map(([k, rs]) => [k, cell(rs)]));

/* ── agreement: this judge's ocr flags vs #7866 ── */
function agree(a, b) {
  const t = { both: 0, only_a: 0, only_b: 0, neither: 0 };
  for (const r of rows) { const x = a(r), y = b(r); t[x && y ? 'both' : x ? 'only_a' : y ? 'only_b' : 'neither']++; }
  const n = rows.length, po = (t.both + t.neither) / n;
  const pa = (t.both + t.only_a) / n, pb = (t.both + t.only_b) / n, pe = pa * pb + (1 - pa) * (1 - pb);
  return { ...t, n, observed_agreement: r4(po), cohen_kappa: r4(pe < 1 ? (po - pe) / (1 - pe) : null),
    a_positive: t.both + t.only_a, b_positive: t.both + t.only_b,
    p_b_given_a: t.both + t.only_a ? r4(t.both / (t.both + t.only_a)) : null, p_a_given_b: t.both + t.only_b ? r4(t.both / (t.both + t.only_b)) : null };
}

/* ── summary ── */
const majorRows = rows.filter((r) => r.major);
const fdist = [1, 2, 3, 4, 5].map((k) => rows.filter((r) => r.fidelity === k).length);
const out = {
  generated_at: new Date().toISOString(),
  issue: 7968, judge: `${JUDGE} (claude -p --model opus), JUDGE-PROMPT.md + IMAGE-ADDENDUM.md, 15-item packets`,
  joined_to: { lane: 'confidence-7866', run_id: 'confidence-validation-7866', grade: 'regrade.mjs gradeOf' },
  gate: report.controls_gate,
  controls: { swap: { n: report.controls.swap.n, caught: report.controls.swap.caught_fidelity_le2 }, drop: { n: report.controls.drop.n, flagged: report.controls.drop.flagged_omission }, repeat: { n: report.controls.repeat.n, within1: report.controls.repeat.within1, exact: report.controls.repeat.exact } },
  n: { pages: rows.length, books: books.length, english_words: rows.reduce((a, r) => a + r.words, 0), missing_verdicts: missing.length, image_not_seen: rows.filter((r) => !r.image_seen).length },
  definitions: {
    major: 'English verdict carries a defect with severity "major"',
    ocr_bad: 'the translation judge, with the image, set ocr_misread or ocr_wrong_leaf',
    e2e_wrong: 'major OR ocr_bad',
    bad_7866: '#7866 grade search_only or worse (a reading that changes the sense, or worse)',
    inherited: 'major English defect on a page whose #7866 grade is bad_7866',
  },
  translator: {
    fidelity_dist_unweighted: { 1: fdist[0], 2: fdist[1], 3: fdist[2], 4: fdist[3], 5: fdist[4] },
    fidelity_ge4_weighted: wShare(books, (p) => p.fidelity >= 4, SEED + 1),
    fidelity_le2_weighted: wShare(books, (p) => p.fidelity <= 2, SEED + 2),
    major_page_share_weighted: wShare(books, (p) => p.major, SEED + 3),
    major_per_1k_english_words_weighted: wRatio(books, (p) => p.majors, (p) => p.words, SEED + 4),
    major_per_1k_english_words_unweighted: r2((rows.reduce((a, r) => a + r.majors, 0) / rows.reduce((a, r) => a + r.words, 0)) * 1000),
    major_defects: rows.reduce((a, r) => a + r.majors, 0),
  },
  end_to_end: {
    e2e_wrong_weighted: wShare(books, (p) => p.e2e_wrong, SEED + 5),
    ocr_bad_weighted: wShare(books, (p) => p.ocr_bad, SEED + 6),
    // the same, with #7866's verdict in place of this judge's image flags
    major_or_bad_7866_weighted: wShare(books, (p) => p.major || p.bad_7866, SEED + 7),
  },
  agreement: {
    ocr_misread_vs_bad_7866: agree((r) => r.ocr_misread, (r) => r.bad_7866),
    ocr_bad_vs_bad_7866: agree((r) => r.ocr_bad, (r) => r.bad_7866),
    ocr_bad_vs_wrong_text_7866: agree((r) => r.ocr_bad, (r) => r.wrong_text_7866),
    note: 'a = this judge (translation audit, image addendum); b = #7866 transcription grade. Two different instruments with different bars: #7866 tags any sense-changing reading (misleads) on a full read of the page; the addendum asks only for a misreading visible at this resolution, and to leave it false when unsure.',
  },
  inherited: {
    of_major_pages: majorRows.length,
    bad_7866: majorRows.filter((r) => r.bad_7866).length,
    share_weighted: wConditional(books, (p) => p.major, (p) => p.bad_7866, SEED + 8),
    // the base rate it has to beat: bad_7866 among pages with NO major English defect
    bad_7866_share_on_clean_english_weighted: wConditional(books, (p) => !p.major, (p) => p.bad_7866, SEED + 9),
    share_using_this_judges_ocr_flag_weighted: wConditional(books, (p) => p.major, (p) => p.ocr_bad, SEED + 10),
    major_given_bad_7866_weighted: wStat(books, (bs) => wp(bs, (p) => p.bad_7866, (p) => p.major), SEED + 12),
    major_given_not_bad_7866_weighted: wStat(books, (bs) => wp(bs, (p) => !p.bad_7866, (p) => p.major), SEED + 13),
    risk_ratio_weighted: wStat(books, (bs) => { const a = wp(bs, (p) => p.bad_7866, (p) => p.major), c = wp(bs, (p) => !p.bad_7866, (p) => p.major); return a != null && c ? a / c : null; }, SEED + 14),
    attributable_fraction_of_major_pages_weighted: wStat(books, attributable, SEED + 15),
    attributable_note: 'AF = P(bad_7866 | major) x (1 - P(major | not bad_7866) / P(major | bad_7866)): the share of major-defect pages the bad transcription accounts for, once the rate at which the English fails on a good transcription is subtracted. Observational: books with bad transcriptions also differ in language and hand.',
    sensitivity_excluding_translation_older_than_ocr: wConditional(booksOf(rows.filter((r) => !r.translation_older_than_ocr)), (p) => p.major, (p) => p.bad_7866, SEED + 11),
  },
  by_language: cutBy((r) => r.lang),
  by_translation_model: cutBy((r) => r.model),
  by_ocr_route: cutBy((r) => r.route),
  by_age_band: cutBy((r) => r.age),
  // Hand from #7866's script_type TAGS (book majority), not from the image: #7947 reclassified 8 of 109 books on the image.
  // #7947 found Latin's transcription weakness is the hand, not the age; so hand is cut first-class, and hand x age.
  by_hand_tag: cutBy((r) => r.hand),
  by_hand_tag_x_age: cutBy((r) => `${r.hand} · ${r.age}`),
  by_language_x_hand_tag: cutBy((r) => `${r.lang} · ${r.hand}`),
  by_7866_grade: cutBy((r) => r.grade_7866),
  major_pages: majorRows.map((r) => ({ id: r.id, url: r.url, lang: r.lang, model: r.model, route: r.route, fidelity: r.fidelity, grade_7866: r.grade_7866, ocr_bad: r.ocr_bad, flags: r.flags, reason: String(r.reason || '').slice(0, 300), image_note: String(r.image_note || '').slice(0, 200) })),
  missing_verdicts: missing,
};
fs.writeFileSync(path.join(DIR, 'summary.json'), JSON.stringify(out, null, 1) + '\n');
const pc = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
const ci = (c) => (c ? `[${pc(c[0])}–${pc(c[1])}]` : '');
console.log(`gate ${out.gate.pass ? 'PASS' : 'FAIL'}; ${rows.length} pages, ${books.length} books, ${missing.length} missing`);
console.log(`fidelity>=4 ${pc(out.translator.fidelity_ge4_weighted.share)} ${ci(out.translator.fidelity_ge4_weighted.ci95)}; major pages ${pc(out.translator.major_page_share_weighted.share)} ${ci(out.translator.major_page_share_weighted.ci95)}; major/1k words ${out.translator.major_per_1k_english_words_weighted.value} [${out.translator.major_per_1k_english_words_weighted.ci95.join('–')}]`);
console.log(`end to end wrong ${pc(out.end_to_end.e2e_wrong_weighted.share)} ${ci(out.end_to_end.e2e_wrong_weighted.ci95)}`);
console.log(`inherited ${out.inherited.bad_7866}/${out.inherited.of_major_pages}; weighted ${pc(out.inherited.share_weighted.share)} ${ci(out.inherited.share_weighted.ci95)}; base rate on clean English ${pc(out.inherited.bad_7866_share_on_clean_english_weighted.share)}`);
console.log(`P(major|bad) ${JSON.stringify(out.inherited.major_given_bad_7866_weighted)} P(major|not bad) ${JSON.stringify(out.inherited.major_given_not_bad_7866_weighted)} RR ${JSON.stringify(out.inherited.risk_ratio_weighted)} AF ${JSON.stringify(out.inherited.attributable_fraction_of_major_pages_weighted)}`);
console.log(`ocr_misread vs bad_7866: kappa ${out.agreement.ocr_misread_vs_bad_7866.cohen_kappa}, ${JSON.stringify(out.agreement.ocr_misread_vs_bad_7866)}`);
