#!/usr/bin/env node
// PRIOR ART: scripts/eval/spot-check/score.mjs (rates per round, one frame, no strata, no page grade) and
// scripts/eval/confidence-7866/regrade.mjs (the grade ladder over #7866's judge schema, cut by language/route, not
// by date or hand). gradeOf() is imported from regrade.mjs, words() from route-judge-6740; the REVIEWER.md schema
// (ocr_score/tr_score, serious|moderate|minor) is mapped onto the judge schema gradeOf() reads, below.
/**
 * Why Latin struggles (#7947), stage 3: per cell (era × hand confirmed on the image), sense-changing errors per
 * 1,000 words with a book-cluster bootstrap CI, wrong-text per 1,000, the page grade and the book grade A–D, the
 * error kinds in plain words, and route / abbreviation cuts. Pure: reads files, writes results. No Mongo, no model.
 *
 *   node scripts/eval/latin-strata-7947/analyze.mjs --run <dir> --out <results dir>
 *
 * <dir> holds draw/sample.json(.gz), draw/cells.json, form/forms-merged.json, first/reviews/packet-*.json and
 * (optional) second/verdicts.json [{claim_id, verdict, class}] and misses/reviews/*.json.
 *
 * Severity mapping (REVIEWER.md → gradeOf's MQM fields), stated so a reader can disagree with it:
 *   serious → sense-changing. It is `wrong_text` when the page text carries a span the leaf does not (any I/O
 *   class, and T1/T9/T10/T17: dropped or invented English); `misleads` otherwise (a translation-only sense error).
 *   moderate, minor → `cosmetic` (REVIEWER.md: "wrong but recoverable from context"). Moderate is reported apart.
 *   fidelity = min(ocr_score, tr_score); a wrong leaf (right_page "no") is fidelity 1.
 * Book grade (#7947): D any page fidelity ≤ 2; else A ≤ 1 sense error per 1,000 words, B ≤ 5, C more.
 * CONFIRMED figures keep only the serious calls a second reader confirmed (or reclassified, still serious);
 * `real_not_serious` becomes moderate, `not_an_error` is dropped, `cannot_tell` is dropped from CONFIRMED and kept
 * AS JUDGED.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { gradeOf, bucketOf, GRADES } from '../confidence-7866/regrade.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { classOf, WRONG_TEXT_T, kindOf, claimsOf } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const RUN = opt('run');
const OUT = opt('out');
if (!RUN || !OUT) throw new Error('--run and --out required');
// A committed run keeps the bulky sample gzipped: read <f> or <f>.gz.
const J = (f) => { const p = path.join(RUN, f); return JSON.parse(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : zlib.gunzipSync(fs.readFileSync(`${p}.gz`)).toString('utf8')); };
const exists = (f) => fs.existsSync(path.join(RUN, f));

export const ERAS = ['pre-1450', '1450-1500', '1501-1550', '1551-1600', '1601-1700', '1701+', 'unknown'];
const sample = J('draw/sample.json');
const forms = J('form/forms-merged.json');
const reviews = fs.readdirSync(path.join(RUN, 'first/reviews')).filter((f) => f.endsWith('.json'))
  .flatMap((f) => J(`first/reviews/${f}`).map((r) => ({ ...r, _packet: f })));
const second = exists('second/verdicts.json') ? J('second/verdicts.json') : [];
const verdictOf = new Map(second.map((v) => [v.claim_id, v]));

/** The form a reader sees on the image; the drawn hand when the image check could not tell. */
const formOf = (b) => {
  const f = forms[b.book_id]?.form;
  if (f === 'manuscript') return 'manuscript';
  if (f === 'print' || f === 'blockbook' || f === 'mixed') return 'print';
  return b.hand_drawn;
};
const routeOf = (m) => (/flash-lite/.test(m ?? '') ? 'flash-lite' : /gemini-3-flash/.test(m ?? '') ? '3-flash' : m ?? 'unknown');
const sevAfter = (cl, mode) => {
  if (cl.e.severity !== 'serious' || mode === 'judged') return cl.e.severity;
  const v = verdictOf.get(cl.claim_id);
  if (!v) return 'serious'; // not checked (none should be); counted as judged
  if (v.verdict === 'confirmed' || v.verdict === 'misclassified') return 'serious';
  if (v.verdict === 'real_not_serious') return 'moderate';
  return null; // not_an_error, cannot_tell
};
const classAfter = (cl, mode) => {
  const v = verdictOf.get(cl.claim_id);
  return mode === 'confirmed' && v?.verdict === 'misclassified' && v.class ? v.class : cl.e.class;
};

/** One page → its row under a mode ('judged' | 'confirmed'). */
function pageRow(book, drawn, rp, mode) {
  const claims = claimsOf(book.book_id, rp);
  const defects = [];
  let serious = 0, wrongText = 0, moderate = 0;
  const kinds = [];
  for (const cl of claims) {
    const s = sevAfter(cl, mode);
    if (!s) continue;
    const c = classAfter(cl, mode);
    if (s === 'serious') {
      const wt = cl.lane !== 'tr' || WRONG_TEXT_T.test(classOf({ class: c }));
      defects.push({ severity: wt ? 'wrong_text' : 'misleads', class: c });
      serious++; if (wt) wrongText++;
      kinds.push({ kind: kindOf({ ...cl.e, class: c }, cl.lane), lane: cl.lane, class: classOf({ class: c }), claim_id: cl.claim_id, e: cl.e });
    } else {
      defects.push({ severity: 'cosmetic', class: c });
      if (s === 'moderate') moderate++;
    }
  }
  const scores = [rp.ocr_score, rp.tr_score].filter((x) => typeof x === 'number');
  let fidelity = scores.length ? Math.min(...scores) : null;
  if (rp.right_page === 'no') fidelity = 1;
  const grade = fidelity == null ? null : gradeOf({ fidelity: fidelity <= 2 ? fidelity : 3, defects });
  return { page: rp.page_number, words: drawn?.words ?? 0, abbr: drawn?.abbr_per_100_words ?? 0, long_s: drawn?.long_s ?? 0,
    route: routeOf(drawn?.ocr_model), tr_route: routeOf(drawn?.translation_model), fidelity, grade, bucket: grade && bucketOf(grade),
    serious, wrong_text: wrongText, moderate, kinds, right_page: rp.right_page, confidence: rp.confidence };
}

function books(mode) {
  const out = [];
  for (const b of sample) {
    const r = reviews.find((x) => x.book_id === b.book_id);
    if (!r) continue;
    const pages = (r.pages || []).map((rp) => pageRow(b, b.pages.find((p) => p.page_number === rp.page_number), rp, mode));
    const words = pages.reduce((s, p) => s + p.words, 0);
    const serious = pages.reduce((s, p) => s + p.serious, 0);
    const rate = words ? (1000 * serious) / words : 0;
    const grade = pages.some((p) => p.fidelity != null && p.fidelity <= 2) ? 'D' : rate <= 1 ? 'A' : rate <= 5 ? 'B' : 'C';
    const form = formOf(b);
    out.push({ book_id: b.book_id, title: b.book.title, year: b.year, published: b.book.published, place: b.book.place_published ?? null,
      era: b.era, hand_drawn: b.hand_drawn, form, form_image: forms[b.book_id]?.form ?? null, script: forms[b.book_id]?.script ?? null,
      abbreviations_image: forms[b.book_id]?.abbreviations ?? null, cell: `${b.era}|${form}`, packet: r._packet,
      words, serious, wrong_text: pages.reduce((s, p) => s + p.wrong_text, 0), moderate: pages.reduce((s, p) => s + p.moderate, 0),
      rate: +rate.toFixed(2), grade, pages, verdict: r.book_verdict });
  }
  return out;
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.min(s.length - 1, Math.floor(p * s.length)))]; };
/** Ratio of sums over books, with a book-cluster bootstrap 95% CI. */
function rateCI(bs, num, seed, B = 4000) {
  const W = bs.reduce((s, b) => s + b.words, 0);
  const point = W ? (1000 * bs.reduce((s, b) => s + num(b), 0)) / W : null;
  if (bs.length < 2) return { point: point == null ? null : +point.toFixed(2), ci95: null };
  const rng = makeRng(seed);
  const sims = [];
  for (let i = 0; i < B; i++) {
    let n = 0, w = 0;
    for (let k = 0; k < bs.length; k++) { const b = bs[Math.floor(rng() * bs.length)]; n += num(b); w += b.words; }
    sims.push(w ? (1000 * n) / w : 0);
  }
  return { point: +point.toFixed(2), ci95: [+pct(sims, 0.025).toFixed(2), +pct(sims, 0.975).toFixed(2)] };
}

function cellTable(bs, keyOf, seed) {
  const keys = [...new Set(bs.map(keyOf))];
  return keys.map((k, i) => {
    const g = bs.filter((b) => keyOf(b) === k);
    const pages = g.flatMap((b) => b.pages);
    const grades = Object.fromEntries(['A', 'B', 'C', 'D'].map((x) => [x, g.filter((b) => b.grade === x).length]));
    return { key: k, books: g.length, pages: pages.length, words: g.reduce((s, b) => s + b.words, 0),
      sense_per_1000: rateCI(g, (b) => b.serious, seed + i), wrong_text_per_1000: rateCI(g, (b) => b.wrong_text, seed + 100 + i),
      moderate_per_1000: rateCI(g, (b) => b.moderate, seed + 200 + i),
      pages_clean: pages.filter((p) => p.bucket === 'says_what_the_page_says').length,
      pages_fidelity_le2: pages.filter((p) => p.fidelity != null && p.fidelity <= 2).length,
      page_grades: Object.fromEntries(GRADES.map((x) => [x, pages.filter((p) => p.grade === x).length]).filter(([, n]) => n)),
      book_grades: grades };
  });
}
const cellOrder = (a, b) => ERAS.indexOf(a.key.split('|')[0]) - ERAS.indexOf(b.key.split('|')[0]) || a.key.localeCompare(b.key);

function kindsByCell(bs) {
  const out = {};
  for (const b of bs) for (const p of b.pages) for (const k of p.kinds) {
    const c = (out[b.cell] ??= {});
    const x = (c[k.kind] ??= { n: 0, examples: [] });
    x.n++;
    if (x.examples.length < 3) x.examples.push({ book: b.book_id, page: p.page, url: `https://sourcelibrary.org/book/${b.book_id}/page/${p.page}`,
      class: k.class, stored: k.e.ocr ?? k.e.english ?? null, page_says: k.e.image ?? k.e.source ?? null, problem: k.e.problem ?? k.e.note ?? null });
  }
  return out;
}

/** Route within cell: only cells where both routes appear. */
function routeCut(bs, seed) {
  const rows = [];
  const cells = [...new Set(bs.map((b) => b.cell))];
  for (const c of cells) {
    const pages = bs.filter((b) => b.cell === c).flatMap((b) => b.pages.map((p) => ({ ...p, book: b.book_id })));
    const routes = [...new Set(pages.map((p) => p.route))];
    for (const r of routes) {
      const ps = pages.filter((p) => p.route === r);
      // cluster = book-within-route
      const byBook = Object.values(ps.reduce((m, p) => ((m[p.book] ??= { words: 0, serious: 0 }), (m[p.book].words += p.words), (m[p.book].serious += p.serious), m), {}));
      rows.push({ cell: c, route: r, books: byBook.length, pages: ps.length, sense_per_1000: rateCI(byBook, (b) => b.serious, seed + rows.length) });
    }
  }
  return rows;
}

function abbrCut(bs, seed) {
  const all = bs.flatMap((b) => b.pages.map((p) => ({ ...p, book: b.book_id, form: b.form, early: ['pre-1450', '1450-1500'].includes(b.era) })));
  const band = (x) => (x < 0.5 ? '<0.5 marks/100 words' : x < 3 ? '0.5–3' : '≥3');
  const out = [];
  for (const grp of [['early (before 1501)', (p) => p.early], ['1501 and later / undated', (p) => !p.early]]) {
    for (const k of ['<0.5 marks/100 words', '0.5–3', '≥3']) {
      const ps = all.filter((p) => grp[1](p) && band(p.abbr) === k);
      const byBook = Object.values(ps.reduce((m, p) => ((m[p.book] ??= { words: 0, serious: 0 }), (m[p.book].words += p.words), (m[p.book].serious += p.serious), m), {}));
      out.push({ group: grp[0], abbreviation_marks_kept_in_ocr: k, pages: ps.length, books: byBook.length, sense_per_1000: rateCI(byBook, (b) => b.serious, seed + out.length) });
    }
  }
  // by the image-read density (the form check), which does not depend on what the OCR kept
  for (const k of ['heavy', 'some', 'few']) {
    const g = bs.filter((b) => b.abbreviations_image === k);
    out.push({ group: 'all, by abbreviation density seen on the image', abbreviation_marks_on_image: k, books: g.length, pages: g.length * 3, sense_per_1000: rateCI(g, (b) => b.serious, seed + 50 + out.length) });
  }
  return out;
}

function trOrigin(bs) {
  const o = {};
  for (const b of bs) for (const p of b.pages) for (const k of p.kinds) {
    const x = (o[b.cell] ??= { ocr_or_page: 0, tr_from_ocr: 0, tr_own: 0 });
    if (k.lane !== 'tr') x.ocr_or_page++;
    else if (k.kind === 'translation error carried from the OCR') x.tr_from_ocr++;
    else x.tr_own++;
  }
  return o;
}

const result = { issue: 7947, generated: new Date().toISOString().slice(0, 10), mapping: 'see analyze.mjs header', modes: {} };
for (const mode of ['judged', 'confirmed']) {
  const bs = books(mode);
  const early = (b) => (['pre-1450', '1450-1500'].includes(b.era) ? 'before 1501' : b.era === 'unknown' ? 'undated' : '1501 and later');
  result.modes[mode] = {
    books: bs.length, pages: bs.reduce((s, b) => s + b.pages.length, 0),
    by_cell: cellTable(bs, (b) => b.cell, 7947).sort(cellOrder),
    by_era: cellTable(bs, (b) => b.era, 8947).sort((a, b) => ERAS.indexOf(a.key) - ERAS.indexOf(b.key)),
    by_form: cellTable(bs, (b) => b.form, 9947),
    by_age_form: cellTable(bs, (b) => `${early(b)}|${b.form}`, 10947),
    kinds: kindsByCell(bs), kinds_all: Object.entries(bs.flatMap((b) => b.pages.flatMap((p) => p.kinds.map((k) => k.kind)))
      .reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]),
    route: routeCut(bs, 11947), abbreviation: abbrCut(bs, 12947), translation_origin: trOrigin(bs),
    // Pooled within form (and within before-1501 print): the cells alone are too small to compare routes.
    route_by_form: routeCut(bs.map((b) => ({ ...b, cell: b.form === 'print' && ['pre-1450', '1450-1500'].includes(b.era) ? 'print before 1501' : b.form })), 13947),
    kinds_by_group: Object.fromEntries(Object.entries(kindsByCell(bs.map((b) => ({ ...b, cell: `${early(b)}|${b.form}` }))))
      .map(([g, ks]) => [g, Object.fromEntries(Object.entries(ks).sort((x, y) => y[1].n - x[1].n))])),
    book_rows: bs.map(({ pages, ...b }) => ({ ...b, pages: pages.map(({ kinds, ...p }) => ({ ...p, kinds: kinds.map((k) => `${k.lane}:${k.class}:${k.kind}`) })) })),
  };
}
result.second_reader = second.length ? Object.entries(second.reduce((m, v) => ((m[v.verdict] = (m[v.verdict] ?? 0) + 1), m), {})) : null;
result.reclassified_forms = sample.filter((b) => formOf(b) !== b.hand_drawn).map((b) => ({ book_id: b.book_id, title: b.book.title, drawn: b.hand_drawn, image: forms[b.book_id]?.form, note: forms[b.book_id]?.note }));
result.corpus_cells = J('draw/cells.json');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'analysis.json'), JSON.stringify(result, null, 1));

// The experiments-lint defect_rates shape (#6740): per (form, OCR route), CONFIRMED calls. misleads = serious calls that
// are not text-not-on-the-leaf (translation-only sense errors); fidelity = min(ocr_score, tr_score) per page.
const dr = {};
for (const b of books('confirmed')) for (const p of b.pages) {
  const k = `${b.form}|${['pre-1450', '1450-1500'].includes(b.era) ? 'before-1501' : b.era === 'unknown' ? 'undated' : '1501+'}|${p.route}`;
  const x = (dr[k] ??= { books: new Set(), pages: 0, words: 0, misleads: 0, wrong_text: 0, fid: [] });
  x.books.add(b.book_id); x.pages++; x.words += p.words; x.misleads += p.serious - p.wrong_text; x.wrong_text += p.wrong_text;
  if (p.fidelity != null) x.fid.push(p.fidelity);
}
const per1k = (n, w) => (w ? +((1000 * n) / w).toFixed(2) : null);
fs.writeFileSync(path.join(OUT, 'defect-rates.json'), JSON.stringify({
  issue: 7947, note: 'Confirmed serious calls (second reader) per (form on the image | age | OCR route). Not stratum-weighted: these are the drawn books. One reader per page plus a second reader on serious calls; REVIEWER.md scale, not the #6740 judge prompt.',
  study_cells: Object.fromEntries(Object.entries(dr).sort().map(([k, x]) => [k, { books: x.books.size, pages: x.pages, words: x.words,
    misleads_per_1k: per1k(x.misleads, x.words), wrong_text_per_1k: per1k(x.wrong_text, x.words),
    fidelity_mean: x.fid.length ? +(x.fid.reduce((s, v) => s + v, 0) / x.fid.length).toFixed(2) : null }])),
}, null, 1));

const fmt = (r) => (r.point == null ? '–' : `${r.point}${r.ci95 ? ` [${r.ci95[0]}–${r.ci95[1]}]` : ''}`);
for (const mode of ['judged', 'confirmed']) {
  console.log(`\n== ${mode} ==`);
  for (const r of result.modes[mode].by_cell) console.log(r.key.padEnd(22), String(r.books).padStart(3), String(r.pages).padStart(4), fmt(r.sense_per_1000).padEnd(22), fmt(r.wrong_text_per_1000).padEnd(22), JSON.stringify(r.book_grades));
  for (const r of result.modes[mode].by_age_form) console.log(r.key.padEnd(28), String(r.books).padStart(3), fmt(r.sense_per_1000), JSON.stringify(r.book_grades));
}
