#!/usr/bin/env node
// PRIOR ART: scripts/eval/confidence-7866/analyze.mjs (score) — the SAME 800 verdicts, but it answers
// #7866's question (does the confidence score predict a bad book?) and reports one binary outcome per
// book, bad = >= 2 of 5 pages bad. scripts/eval/confidence-7866/results/defect-rates.json carries
// severity rates by stratum and study cell, never by language and never as a page grade.
// scripts/eval/route-judge-6740/defect-rate.mjs words() and SEVERITY_WEIGHTS: imported, not copied.
// scripts/eval/lane-judge-sampler.mjs exportScore: pools by (cell, route) for the router, not by the
// reader-facing grade. .claude/docs/quality-rubric-and-sampling.md §5 defines the four grades and has
// never been computed on any corpus sample. Searched scripts/eval/INDEX.md, `gh issue list --search
// "grade ladder"`, `git grep fit_to_quote`: nothing grades a drawn sample on the published ladder.
/**
 * Re-grade #7866's 800 judged pages on the published page-grade ladder
 * (`.claude/docs/quality-rubric-and-sampling.md` §5) and cut them by language, script and route,
 * so /quality can report a distribution instead of one pass/fail share at an unstated bar (#7933).
 *
 *   node --env-file=.env.production.local scripts/eval/confidence-7866/regrade.mjs
 *
 * Reads: Mongo `lane_judge_verdicts` (lane `confidence-7866`, the 800 items #7866 judged, each with
 * accept, fidelity 1-5 and defects[{class, quote, severity, what}]) and each page's stored text, for
 * the word counts only. Writes ONE file, `results/served-grades.json`, which /quality imports.
 * Read-only everywhere else: no page, book or router write.
 *
 * Three figures, in this order, because they answer different questions:
 *   1. `grades` / `buckets` — the judge's verdicts as they stand.
 *   2. `reread` — the same pages after every misleads / wrong_text tag is resampled from #6740's
 *      blind re-read of 80 such tags on the quote and the leaf alone
 *      (`2026-10-30-defect-rate-router-6740.md`): a fifth of wrong_text and a third of misleads tags
 *      did not hold up as errors, and 17 of 40 misleads were re-read as wrong text. Cosmetic tags
 *      were not re-read and are carried unchanged.
 *   3. `bad_7866` — #7866's own binary rule, kept so the two can be reconciled.
 * The judge also MISSES errors: at a 1% CER bar on pages with a typed reference its sensitivity is
 * 0.42 on print (`2026-11-01-judge-calibration-7866-bar-7263.md`). So (1) and (2) are not an upper
 * bound on quality; they are what one judge saw.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';
import { words } from '../route-judge-6740/defect-rate.mjs';
import { HERE, RESULTS, SEED } from './lib.mjs';

const LANE = 'confidence-7866';
const RUN = 'confidence-validation-7866';

/** The taxonomy's own one-line names (`.claude/docs/page-error-taxonomy.md` headings). */
const CLASS_NAME = {
  I1: 'Image one leaf away from its text', I2: 'Duplicate scan, back to back', I3: 'Spread not split',
  I4: 'Neighbour strip read as content', I5: 'Several leaves in one photograph', I6: 'Pages in reverse order',
  I7: 'Catalogue identity or format wrong',
  O1: 'Confabulation on an illegible leaf', O2: 'Wrong-script fabrication', O3: 'Canonical-text substitution',
  O4: 'Block-level repetition', O5: 'Silent omission inside the page', O6: 'Meaning-changing misread',
  O7: 'Numerals, dates, doses and units', O8: 'Silent normalisation toward the expected',
  O9: 'Convention flips between adjacent pages', O10: 'Secondary script dropped or garbled',
  O11: 'Page furniture mis-tagged', O12: 'Marginalia and apparatus mishandled', O13: 'Later hands read as text',
  O14: 'Non-linear content described, not transcribed', O15: 'Reasoning or notes inside the transcription',
  O16: 'Self-reported tags wrong', O17: 'Table structure invented or lost', O18: 'Engine refusal: page left empty',
  T1: 'Translation truncated', T2: 'Echoed source', T3: 'Translation hidden in a wrapper',
  T4: 'In-block drift', T5: 'Continuity leak', T6: 'Catchword and split-word seams',
  T7: 'Fluent prose over garble', T8: 'Sense inverted or a qualifier dropped', T9: 'Quiet omission',
  T10: 'Invented scholarship in notes', T11: 'Parallel edition mishandled', T12: 'Same-language source rewritten',
  T13: 'Apparatus stripped in translation', T14: 'The two panes come from different reads',
  T15: 'Continuity meta wrong', T16: 'Form imposed or lost', T17: "The model's reply stored as the text",
  D1: 'Markup the renderer does not know', E1: 'Poisoned derived metadata', E2: 'The instruments lie',
};
/** wrong_text of one of these classes is text from somewhere else, not a misread of this page. */
const FROM_ELSEWHERE = /^(O1|O2|O3|I1|T17)$/;
const cls = (d) => String(d.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? 'E2';

export const GRADES = ['fit_to_quote', 'fit_to_read', 'search_only', 'wrong_span', 'from_elsewhere', 'mostly_wrong', 'not_this_page'];
export const GRADE_LABEL = {
  fit_to_quote: 'No slip, or at most two that mislead no one',
  fit_to_read: 'Three or more slips, none of which misleads',
  search_only: 'At least one reading that changes the sense',
  wrong_span: 'A span the page does not carry: a word, a number, a dropped phrase',
  from_elsewhere: 'A span from somewhere else: invented, recited, or another leaf',
  mostly_wrong: 'Substantially wrong or incomplete (fidelity 2)',
  not_this_page: "Not this page's text at all (fidelity 1)",
};
/** The three statements a reader can act on. */
export const BUCKETS = ['says_what_the_page_says', 'misleads_somewhere', 'text_not_on_the_page'];

/**
 * The rubric's grade from the judge's own fields. Its severities are MQM's: cosmetic = minor,
 * misleads = major, wrong_text = critical. Its fidelity scale is in the prompt: 1 = not this page's
 * text at all, 2 = substantially wrong or incomplete, 3 = usable with real errors, 4 = small slips
 * that mislead no one, 5 = faithful and complete.
 */
export function gradeOf(v) {
  const ds = v.defects || [];
  const n = (s) => ds.filter((d) => d.severity === s).length;
  if (Number(v.fidelity) === 1) return 'not_this_page';
  if (Number(v.fidelity) === 2) return 'mostly_wrong';
  if (n('wrong_text')) return ds.some((d) => d.severity === 'wrong_text' && FROM_ELSEWHERE.test(cls(d))) ? 'from_elsewhere' : 'wrong_span';
  if (n('misleads')) return 'search_only';
  if (n('cosmetic') > 2) return 'fit_to_read';
  return 'fit_to_quote';
}
export const bucketOf = (grade) =>
  (['fit_to_quote', 'fit_to_read'].includes(grade) ? 'says_what_the_page_says'
    : grade === 'search_only' ? 'misleads_somewhere' : 'text_not_on_the_page');

/** The word unit of a language's script: rates are comparable within a script, never across. */
/** The book's age band, from `books.published` (free text: the first four-digit run is the year). */
const eraOf = (published) => {
  const y = Number(String(published ?? '').match(/\d{4}/)?.[0]);
  if (!y) return 'no date';
  return y <= 1500 ? 'before 1501' : y <= 1700 ? '1501–1700' : y <= 1900 ? '1701–1900' : 'after 1900';
};
/** Han characters and Tibetan syllables are not words: rates in those units never pool with alphabetic ones. */
const isAlphabetic = (lang) => !/Chinese|Japanese|Korean|Tibetan/.test(lang);
const unitOf = (lang) => (/Chinese|Japanese|Korean/.test(lang) ? 'Han characters' : /Tibetan/.test(lang) ? 'syllables' : 'words');

const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.min(s.length - 1, Math.floor(p * s.length)))]; };
const r4 = (x) => (x == null ? null : +x.toFixed(4));
const r2 = (x) => (x == null ? null : +x.toFixed(2));

/* ── load ── */

async function load() {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db('bookstore');
  const recs = (await db.collection('lane_judge_verdicts')
    .find({ lane: LANE, run_id: RUN, kind: 'item' }).toArray()).filter((r) => r.verdict);
  // Word counts from the stored text. A page whose _id was re-minted is found by (book, page number).
  const texts = new Map();
  for (let i = 0; i < recs.length; i += 100) {
    const batch = recs.slice(i, i + 100);
    const got = await db.collection('pages').find(
      { $or: batch.map((r) => ({ book_id: r.book_id, page_number: r.page_number })) },
      { projection: { book_id: 1, page_number: 1, 'ocr.data': 1 } }).toArray();
    for (const p of got) texts.set(`${p.book_id}:${p.page_number}`, p.ocr?.data ?? '');
  }
  const titles = new Map();
  for (const b of await db.collection('books').find(
    { _id: { $in: [...new Set(recs.map((r) => r.book_id))].map((x) => new ObjectId(x)) } },
    { projection: { title: 1, language: 1, year: 1, year_earliest: 1, published: 1 } }).toArray()) titles.set(String(b._id), b);
  await c.close();
  return { recs, texts, titles };
}

/* ── per page ── */

/** The book's period of production, from `year` (else `year_earliest`, else a 4-digit year in `published`). */
export const PERIODS = ['before 1500', '1500–1599', '1600–1699', '1700–1799', '1800–1899', '1900 and later', 'unknown'];
export function periodOf(b) {
  const raw = b?.year ?? b?.year_earliest ?? String(b?.published ?? '').match(/\b(1[0-9]{3})\b/)?.[1];
  const y = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(y) || y < 100 || y > 2100) return 'unknown';
  if (y < 1500) return 'before 1500';
  if (y >= 1900) return '1900 and later';
  return `${Math.floor(y / 100) * 100}–${Math.floor(y / 100) * 100 + 99}`;
}

function pageRows({ recs, texts, titles }) {
  return recs.map((r) => {
    const v = r.verdict, ds = v.defects || [];
    const n = (s) => ds.filter((d) => d.severity === s).length;
    const lang = r.lang ?? titles.get(r.book_id)?.language ?? 'unknown';
    return {
      book: r.book_id, page: r.page_number, title: titles.get(r.book_id)?.title ?? null,
      lang, unit: unitOf(lang), period: periodOf(titles.get(r.book_id)), era: eraOf(titles.get(r.book_id)?.published), script: r.script_type ?? 'unknown', route: r.route, cell: r.cell_real,
      stratum: r.draw?.stratum ?? 'unmeasured', weight: r.draw?.weight ?? 1,
      fidelity: Number(v.fidelity), accept: !!v.accept, grade: gradeOf(v),
      bad_7866: !v.accept || n('wrong_text') > 0,
      cosmetic: n('cosmetic'), misleads: n('misleads'), wrong_text: n('wrong_text'),
      words: words(texts.get(`${r.book_id}:${r.page_number}`) ?? ''),
      defects: ds.map((d) => ({ c: cls(d), s: d.severity, quote: String(d.quote ?? '').slice(0, 180), what: String(d.what ?? '').slice(0, 220) })),
      note: String(v.reader_note ?? '').slice(0, 300),
    };
  });
}

/* ── weighted shares, stratified book-cluster bootstrap ── */

const STRATA = ['high', 'middle', 'low', 'unmeasured'];
function shares(books, keyOf, keys) {
  let W = 0; const num = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const b of books) for (const p of b.pages) { W += b.weight; const k = keyOf(p); if (k in num) num[k] += b.weight; }
  return { W, share: Object.fromEntries(keys.map((k) => [k, W ? num[k] / W : null])) };
}
function bootstrap(books, keyOf, keys, seed, B = 4000) {
  const rng = mulberry32(seed);
  const groups = STRATA.map((s) => books.filter((b) => b.stratum === s)).filter((g) => g.length);
  const draws = Object.fromEntries(keys.map((k) => [k, []]));
  for (let i = 0; i < B; i++) {
    const samp = [];
    for (const g of groups) for (let j = 0; j < g.length; j++) samp.push(g[Math.floor(rng() * g.length)]);
    const { share } = shares(samp, keyOf, keys);
    for (const k of keys) draws[k].push(share[k]);
  }
  return Object.fromEntries(keys.map((k) => {
    const a = draws[k].filter((x) => x != null);
    return [k, a.length ? [r4(pctl(a, 0.025)), r4(pctl(a, 0.975))] : null];
  }));
}

/* ── #6740's blind re-read of the judge's own tags ── */

// 2026-10-30-defect-rate-router-6740.md, "Calibration (steer 1 A)": 40 misleads and 40 wrong_text,
// one a page, round-robin across classes, each re-read by a fresh Opus call that saw only the quoted
// span and the page image. Rows are counts of how that re-read labelled them.
const REREAD = {
  wrong_text: { wrong_text: 28, misleads: 4, cosmetic: 3, none: 5 },
  misleads: { wrong_text: 17, misleads: 8, cosmetic: 5, none: 10 },
};
const CUM = Object.fromEntries(Object.entries(REREAD).map(([tag, row]) => {
  const tot = Object.values(row).reduce((a, b) => a + b, 0); let s = 0;
  return [tag, Object.entries(row).map(([lab, k]) => { s += k / tot; return [lab, s]; })];
}));

function rereadShares(books, seed, B = 4000) {
  const rng = mulberry32(seed);
  const keys = [...BUCKETS, 'fit_to_quote'];
  const draws = Object.fromEntries(keys.map((k) => [k, []]));
  const groups = STRATA.map((s) => books.filter((b) => b.stratum === s)).filter((g) => g.length);
  for (let i = 0; i < B; i++) {
    // Resample books within strata AND resample every tag: the interval has to carry the sampling
    // error as well as the tag error, or the corrected figure reads as the more precise one.
    const samp = [];
    for (const g of groups) for (let j = 0; j < g.length; j++) samp.push(g[Math.floor(rng() * g.length)]);
    const Wtot = samp.reduce((a, b) => a + b.weight * b.pages.length, 0);
    const num = Object.fromEntries(keys.map((k) => [k, 0]));
    for (const b of samp) for (const p of b.pages) {
      let wt = 0, mis = 0, cos = p.cosmetic;
      for (const d of p.defects) {
        if (d.s === 'cosmetic') continue;
        const u = rng();
        const lab = CUM[d.s].find(([, c]) => u <= c)[0];
        if (lab === 'wrong_text') wt++; else if (lab === 'misleads') mis++; else if (lab === 'cosmetic') cos++;
      }
      const bk = p.fidelity <= 2 || wt ? 'text_not_on_the_page' : mis ? 'misleads_somewhere' : 'says_what_the_page_says';
      num[bk] += b.weight;
      if (p.fidelity > 2 && !wt && !mis && cos <= 2) num.fit_to_quote += b.weight;
    }
    for (const k of keys) draws[k].push(num[k] / Wtot);
  }
  return Object.fromEntries(keys.map((k) => [k, {
    share: r4(pctl(draws[k], 0.5)), ci95: [r4(pctl(draws[k], 0.025)), r4(pctl(draws[k], 0.975))],
  }]));
}

/* ── build ── */

function build(rows) {
  const byBook = new Map();
  for (const r of rows) {
    const b = byBook.get(r.book) ?? { id: r.book, title: r.title, lang: r.lang, stratum: r.stratum, weight: r.weight, pages: [] };
    b.pages.push(r); byBook.set(r.book, b);
  }
  const books = [...byBook.values()];
  const total = (ps, f) => ps.reduce((a, r) => a + f(r), 0);

  const gS = shares(books, (p) => p.grade, GRADES), gCi = bootstrap(books, (p) => p.grade, GRADES, SEED.bootstrap + 10);
  const bS = shares(books, (p) => bucketOf(p.grade), BUCKETS), bCi = bootstrap(books, (p) => bucketOf(p.grade), BUCKETS, SEED.bootstrap + 11);

  const langRows = [...new Set(rows.map((r) => r.lang))].map((L) => {
    const ps = rows.filter((r) => r.lang === L), bks = books.filter((b) => b.lang === L);
    const w = total(ps, (r) => r.words);
    const s = shares(bks, (p) => bucketOf(p.grade), BUCKETS).share;
    return {
      language: L, books: bks.length, pages: ps.length, words: w, unit: unitOf(L),
      scripts: [...new Set(ps.map((r) => r.script))].sort(),
      routes: Object.entries(ps.reduce((a, r) => ((a[r.route] = (a[r.route] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).map(([route, n]) => ({ route, pages: n })),
      ...Object.fromEntries(BUCKETS.map((k) => [k, r4(s[k])])),
      fit_to_quote: r4(ps.filter((r) => r.grade === 'fit_to_quote').length / ps.length),
      severe_per_1k: w ? r2(((total(ps, (r) => r.misleads) + total(ps, (r) => r.wrong_text)) / w) * 1000) : null,
      wrong_text_per_1k: w ? r2((total(ps, (r) => r.wrong_text) / w) * 1000) : null,
      bad_7866_books: bks.filter((b) => b.pages.filter((p) => p.bad_7866).length >= 2).length,
    };
  }).sort((a, b) => b.pages - a.pages);

  /** The rates the experiment header's `defect_rates` field wants, per group of pages. */
  const rates = (ps) => {
    const w = total(ps, (r) => r.words);
    return {
      words: w,
      cosmetic_per_1k: w ? r2((total(ps, (r) => r.cosmetic) / w) * 1000) : null,
      misleads_per_1k: w ? r2((total(ps, (r) => r.misleads) / w) * 1000) : null,
      wrong_text_per_1k: w ? r2((total(ps, (r) => r.wrong_text) / w) * 1000) : null,
      fidelity_mean: ps.length ? r2(total(ps, (r) => r.fidelity) / ps.length) : null,
      accept: `${ps.filter((r) => r.accept).length}/${ps.length}`,
    };
  };
  const cutBy = (keyOf, from = rows) => Object.fromEntries([...new Set(from.map(keyOf))].map((v) => {
    const ps = from.filter((r) => keyOf(r) === v), w = total(ps, (r) => r.words);
    return [v, {
      pages: ps.length, books: new Set(ps.map((r) => r.book)).size,
      languages: [...new Set(ps.map((r) => r.lang))].sort(),
      says_what_the_page_says: r4(ps.filter((r) => bucketOf(r.grade) === 'says_what_the_page_says').length / ps.length),
      misleads_somewhere: r4(ps.filter((r) => bucketOf(r.grade) === 'misleads_somewhere').length / ps.length),
      text_not_on_the_page: r4(ps.filter((r) => bucketOf(r.grade) === 'text_not_on_the_page').length / ps.length),
      fit_to_quote: r4(ps.filter((r) => r.grade === 'fit_to_quote').length / ps.length),
      severe_per_1k: w ? r2(((total(ps, (r) => r.misleads) + total(ps, (r) => r.wrong_text)) / w) * 1000) : null,
      ...rates(ps),
    }];
  }).sort((a, b) => b[1].pages - a[1].pages));
  // `study_cells`: the per-(cell, route) rates in defect-rates.json's shape. A stratified draw of
  // stored text, so these are the study's own rates, never a cell's waiting-page frame — nothing
  // here is router evidence (the header says so).
  const studyCells = Object.fromEntries([...new Set(rows.map((r) => `${r.cell} ${r.route}`))].map((k) => {
    const ps = rows.filter((r) => `${r.cell} ${r.route}` === k);
    return [k, { pages: ps.length, books: new Set(ps.map((r) => r.book)).size, ...rates(ps) }];
  }).sort((a, b) => b[1].pages - a[1].pages));

  const defs = rows.flatMap((r) => r.defects.map((d) => ({ ...d, lang: r.lang, book: r.book, page: r.page, title: r.title })));
  const classes = {};
  for (const d of defs) {
    const t = (classes[d.c] ??= { class: d.c, name: CLASS_NAME[d.c] ?? d.c, total: 0, cosmetic: 0, misleads: 0, wrong_text: 0, languages: {}, examples: [] });
    t.total++; t[d.s] = (t[d.s] ?? 0) + 1; t.languages[d.lang] = (t.languages[d.lang] ?? 0) + 1;
  }
  // Up to three examples a class, severest first, each from a different book: the judge's own quote
  // and its one-line reason. A model's words about our text, labelled as such on the page.
  for (const d of [...defs].sort((a, b) => ['wrong_text', 'misleads', 'cosmetic'].indexOf(a.s) - ['wrong_text', 'misleads', 'cosmetic'].indexOf(b.s))) {
    const t = classes[d.c];
    if (!d.quote || t.examples.length >= 3 || t.examples.some((e) => e.book === d.book)) continue;
    t.examples.push({ severity: d.s, language: d.lang, quote: d.quote, what: d.what, book: d.book, page: d.page, title: d.title });
  }

  const bookBucket = (b) => {
    const nOff = b.pages.filter((p) => bucketOf(p.grade) === 'text_not_on_the_page').length;
    if (b.pages.some((p) => ['not_this_page', 'mostly_wrong'].includes(p.grade))) return 'a_page_wholly_wrong';
    if (nOff >= 2) return 'two_or_more_pages_off';
    if (nOff === 1) return 'one_page_off';
    if (b.pages.some((p) => p.grade === 'search_only')) return 'only_misleading_readings';
    return 'clean_on_all_five';
  };
  const BB = ['clean_on_all_five', 'only_misleading_readings', 'one_page_off', 'two_or_more_pages_off', 'a_page_wholly_wrong'];
  const Wb = books.reduce((a, b) => a + b.weight, 0);

  return {
    generated_at: new Date().toISOString(),
    source: { lane: LANE, run_id: RUN, record: 'scripts/eval/experiments/2026-10-31-confidence-validation-7866.md', issue: 7866 },
    judge: 'claude-opus-5-5 (claude -p), route-judge-6740 judgePrompt, against the page image. One judge, no person has checked these verdicts.',
    ladder: 'the four grades of .claude/docs/quality-rubric-and-sampling.md §5, from the judge\'s own severities and fidelity',
    books: books.length, pages: rows.length, words: rows.reduce((a, r) => a + r.words, 0),
    grade_label: GRADE_LABEL,
    grades: Object.fromEntries(GRADES.map((g) => [g, {
      pages: rows.filter((r) => r.grade === g).length, share: r4(gS.share[g]), ci95: gCi[g],
    }])),
    buckets: Object.fromEntries(BUCKETS.map((k) => [k, {
      pages: rows.filter((r) => bucketOf(r.grade) === k).length, share: r4(bS.share[k]), ci95: bCi[k],
    }])),
    reread: { ...rereadShares(books, SEED.bootstrap + 12), note: REREAD },
    bad_7866: {
      pages: rows.filter((r) => r.bad_7866).length,
      books: books.filter((b) => b.pages.filter((p) => p.bad_7866).length >= 2).length,
      by_grade: Object.fromEntries(GRADES.map((g) => {
        const ps = rows.filter((r) => r.grade === g);
        return [g, { pages: ps.length, counted_bad: ps.filter((r) => r.bad_7866).length }];
      })),
    },
    by_language: langRows,
    by_script: cutBy((r) => r.script),
    by_route: cutBy((r) => r.route),
    by_period: cutBy((r) => r.period),
    // The engine cut above is confounded: each engine was given different languages (Greek and
    // Sanskrit to 3 Flash, Korean to Flash-Lite, Chinese to Paddle). Compare engines only WITHIN a
    // language, and the age and hand of the book only within alphabetic scripts, where the unit is
    // the same. Unweighted: page counts, not shares of the library.
    by_language_route: cutBy((r) => `${r.lang} · ${r.route}`),
    by_era_alphabetic: cutBy((r) => (r.script === 'manuscript' ? 'manuscript' : r.era), rows.filter((r) => isAlphabetic(r.lang))),
    by_era_route_alphabetic: cutBy((r) => `${r.script === 'manuscript' ? 'manuscript' : r.era} · ${r.route}`, rows.filter((r) => isAlphabetic(r.lang))),
    study_cells: studyCells,
    defect_totals: { all: defs.length, ...Object.fromEntries(['cosmetic', 'misleads', 'wrong_text'].map((s) => [s, defs.filter((d) => d.s === s).length])) },
    defect_classes: Object.values(classes).sort((a, b) => b.total - a.total).map((t) => ({
      ...t, languages: Object.entries(t.languages).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([language, pages]) => ({ language, pages })),
    })),
    books_weighted: Object.fromEntries(BB.map((k) => [k, {
      books: books.filter((b) => bookBucket(b) === k).length,
      share: r4(books.filter((b) => bookBucket(b) === k).reduce((a, b) => a + b.weight, 0) / Wb),
    }])),
  };
}

// Run only as a script: #7947 imports gradeOf() without loading Mongo or rewriting served-grades.json.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rows = pageRows(await load());
  const out = build(rows);
  const file = path.join(RESULTS, 'served-grades.json');
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`${path.relative(path.resolve(HERE, '../../..'), file)}: ${out.pages} pages, ${out.books} books, ${out.words.toLocaleString('en-US')} words`);
  for (const k of BUCKETS) console.log(`  ${k}: ${out.buckets[k].pages} pages, ${(out.buckets[k].share * 100).toFixed(1)}% weighted (${out.buckets[k].ci95.map((x) => (x * 100).toFixed(0)).join('-')}%)`);
  console.log(`  after #6740's blind re-read of the tags: says what the page says ${(out.reread.says_what_the_page_says.share * 100).toFixed(1)}%`);
}
