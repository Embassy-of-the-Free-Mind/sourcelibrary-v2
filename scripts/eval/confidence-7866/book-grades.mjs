#!/usr/bin/env node
// PRIOR ART: scripts/eval/confidence-7866/regrade.mjs reads the SAME 800 verdicts and grades PAGES, each by its single
// worst fault (one slip in ~250 words puts an otherwise clean page under "not usable"); its by_language rows are page
// shares and never a grade a reader can apply to a book. This grades BOOKS, by error rate over their five pages, and
// cuts them by print / manuscript and by date, which nothing in scripts/eval does. Its bootstrap pattern is copied here
// (regrade.mjs does not export it). scripts/eval/route-judge-6740/defect-rate.mjs words() counts a Han character as a
// word; the book rate needs the per-word unit below (Han/kana/Hangul at 1.5 characters a word, Tibetan by tsheg), so it
// is not reused.
/**
 * A grade for each BOOK in #7866's draw, and the weighted distribution of those grades overall, by print / manuscript,
 * by language × form and by date × form, so /quality can lead with a grade a reader can apply to a book (#7933).
 *
 *   node --env-file=.env.production.local scripts/eval/confidence-7866/book-grades.mjs
 *
 * Reads: Mongo `lane_judge_verdicts` (lane `confidence-7866`, run `confidence-validation-7866`, kind `item`: five
 * judged pages per book, each with fidelity 1-5 and defects[{severity}]), the stored text of those pages for the word
 * counts, `books.published` for the date, and forms-by-eye.json for books whose verdict rows carry no script_type.
 * Writes ONE file, results/book-grades.json, which /quality imports. Read-only everywhere else.
 *
 * The grade, from the errors per 1,000 words over the book's five judged pages, where an error is a defect the judge
 * marked `misleads` or `wrong_text` (changes the sense, or text the page does not carry):
 *   A  at most 1 per 1,000, and every page is this page's text
 *   B  at most 5 per 1,000
 *   C  more than 5 per 1,000, but every page is the right page
 *   D  at least one page wrong or mostly wrong (fidelity 1 or 2)
 * One judge made every verdict. It over-tags (in a blind re-read, 10 of 40 `misleads` tags were not errors: REREAD in
 * regrade.mjs) and it misses errors (sensitivity 0.42 on print at a 1% CER bar). Neither correction is applied here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import { HERE, RESULTS, SEED, mulberry32 } from './lib.mjs';

const LANE = 'confidence-7866';
const RUN = 'confidence-validation-7866';
const MIN_BOOKS = 3;
const GRADES = ['A', 'B', 'C', 'D'];
const FORMS = ['print', 'manuscript'];
const YEARS = ['before 1501', '1501–1600', '1601–1800', 'after 1800', 'unknown'];
const STRATA = ['high', 'middle', 'low', 'unmeasured'];

const BY_EYE = JSON.parse(fs.readFileSync(path.join(HERE, 'forms-by-eye.json'), 'utf8')).books;
const EYE_FORM = { MS: 'manuscript', print: 'print' };

/* ── words ── */

const NONCONTENT = /<(meta|warning|vocab|image-desc|note|language|script|page-type|scan-quality|page-num|header)[^>]*>[\s\S]*?<\/\1>/g;
const CJK = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
/** Words on a page: whitespace tokens, except CJK (characters / 1.5) and Tibetan (one per tsheg or shad). */
export function words(text, lang) {
  const body = String(text || '').replace(NONCONTENT, ' ').replace(/<[^>]+>/g, ' ');
  if (/Chinese|Japanese|Korean/.test(lang)) return (body.match(CJK) || []).length / 1.5;
  if (/Tibetan/.test(lang)) return (body.match(/[་།]/g) || []).length;
  return body.split(/\s+/).filter(Boolean).length;
}

/* ── grade, form, year ── */

export function gradeOf(per1k, wrongPage) {
  if (wrongPage) return 'D';
  return per1k <= 1 ? 'A' : per1k <= 5 ? 'B' : 'C';
}
export function yearBucket(y) {
  if (y == null) return 'unknown';
  return y <= 1500 ? 'before 1501' : y <= 1600 ? '1501–1600' : y <= 1800 ? '1601–1800' : 'after 1800';
}
/** First four-digit run in `published` that reads as a year. */
export const yearOf = (published) => {
  const m = String(published ?? '').match(/\d{4}/g)?.map(Number).find((y) => y >= 600 && y <= 2100);
  return m ?? null;
};

/* ── load ── */

async function load() {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  try {
    const db = c.db('bookstore');
    const recs = (await db.collection('lane_judge_verdicts')
      .find({ lane: LANE, run_id: RUN, kind: 'item' }).toArray()).filter((r) => r.verdict);
    const texts = new Map();
    for (let i = 0; i < recs.length; i += 100) {
      const batch = recs.slice(i, i + 100);
      const got = await db.collection('pages').find(
        { $or: batch.map((r) => ({ book_id: r.book_id, page_number: r.page_number })) },
        { projection: { book_id: 1, page_number: 1, 'ocr.data': 1 } }).toArray();
      for (const p of got) texts.set(`${p.book_id}:${p.page_number}`, p.ocr?.data ?? '');
    }
    // A book may be keyed by its `id` or its `_id` (book-deletion-and-identity.md): look up both.
    const ids = [...new Set(recs.map((r) => r.book_id))];
    const meta = new Map();
    for (const b of await db.collection('books').find(
      { $or: [{ _id: { $in: ids.filter(ObjectId.isValid).map((x) => new ObjectId(x)) } }, { id: { $in: ids } }] },
      { projection: { id: 1, title: 1, language: 1, published: 1 } }).toArray()) {
      meta.set(String(b._id), b);
      if (b.id) meta.set(String(b.id), b);
    }
    return { recs, texts, meta };
  } finally {
    await c.close();
  }
}

/* ── per book ── */

function bookRows({ recs, texts, meta }) {
  const byBook = new Map();
  for (const r of recs) {
    const m = meta.get(r.book_id);
    const b = byBook.get(r.book_id) ?? {
      id: r.book_id, title: m?.title ?? null, lang: r.lang ?? m?.language ?? 'unknown', published: m?.published ?? null,
      weight: r.draw?.weight ?? 1, stratum: r.draw?.stratum ?? 'unmeasured', scripts: {}, pages: [],
    };
    const st = r.script_type ?? 'unknown';
    b.scripts[st] = (b.scripts[st] ?? 0) + 1;
    const ds = r.verdict.defects || [];
    b.pages.push({
      fidelity: Number(r.verdict.fidelity),
      words: words(texts.get(`${r.book_id}:${r.page_number}`), b.lang),
      errors: ds.filter((d) => d.severity === 'misleads' || d.severity === 'wrong_text').length,
    });
    byBook.set(r.book_id, b);
  }
  return [...byBook.values()].map((b) => {
    const W = b.pages.reduce((s, p) => s + p.words, 0);
    const errors = b.pages.reduce((s, p) => s + p.errors, 0);
    const per1k = W ? (errors / W) * 1000 : (errors ? Infinity : 0);
    const wrongPage = b.pages.some((p) => p.fidelity <= 2);
    let form = Object.entries(b.scripts).sort((x, y) => y[1] - x[1])[0][0];
    let formSource = 'verdict script_type';
    if (!FORMS.includes(form) && BY_EYE[b.id]) { form = EYE_FORM[BY_EYE[b.id].form] ?? BY_EYE[b.id].form; formSource = 'by eye'; }
    const year = yearOf(b.published);
    return {
      id: b.id, title: b.title, language: b.lang, form, form_source: formSource, year, year_bucket: yearBucket(year),
      weight: b.weight, stratum: b.stratum, pages: b.pages.length, words: Math.round(W), errors,
      per_1k: Number.isFinite(per1k) ? +per1k.toFixed(2) : null, wrong_page: wrongPage, grade: gradeOf(per1k, wrongPage),
    };
  });
}

/* ── weighted shares, stratified book bootstrap (regrade.mjs's pattern) ── */

const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.min(s.length - 1, Math.floor(p * s.length)))]; };
const r4 = (x) => (x == null ? null : +x.toFixed(4));

function shares(books) {
  const W = books.reduce((a, b) => a + b.weight, 0);
  return Object.fromEntries(GRADES.map((g) => [g, W ? books.filter((b) => b.grade === g).reduce((a, b) => a + b.weight, 0) / W : null]));
}
let seedOffset = 30;
function cell(books, B = 4000) {
  const rng = mulberry32(SEED.bootstrap + seedOffset++);
  const groups = STRATA.map((s) => books.filter((b) => b.stratum === s)).filter((g) => g.length);
  const draws = Object.fromEntries(GRADES.map((g) => [g, []]));
  for (let i = 0; i < B; i++) {
    const samp = [];
    for (const g of groups) for (let j = 0; j < g.length; j++) samp.push(g[Math.floor(rng() * g.length)]);
    const s = shares(samp);
    for (const g of GRADES) draws[g].push(s[g]);
  }
  const s = shares(books);
  return {
    books: books.length,
    ...Object.fromEntries(GRADES.map((g) => [g, {
      books: books.filter((b) => b.grade === g).length,
      share: r4(s[g]),
      ci95: [r4(pctl(draws[g], 0.025)), r4(pctl(draws[g], 0.975))],
    }])),
  };
}
/** Cells of `rows` grouped by `keyOf`, at least MIN_BOOKS books each, largest first. */
function cutBy(rows, keyOf) {
  const groups = new Map();
  for (const b of rows) { const k = keyOf(b); if (k != null) groups.set(k, [...(groups.get(k) ?? []), b]); }
  return [...groups.entries()].filter(([, bs]) => bs.length >= MIN_BOOKS)
    .sort((a, b) => b[1].length - a[1].length).map(([k, bs]) => ({ key: k, ...cell(bs) }));
}

/* ── build ── */

const books = bookRows(await load());
const forms = (b) => (FORMS.includes(b.form) ? b.form : null);
const out = {
  generated_at: new Date().toISOString(),
  source: { lane: LANE, run_id: RUN, issue: 7866, page_grades: 'results/served-grades.json', forms_by_eye: 'forms-by-eye.json' },
  judge: 'claude-opus-5-5 (claude -p), route-judge-6740 judgePrompt, against the page image. One judge, no person has checked these verdicts.',
  rule: {
    error: 'a defect the judge marked misleads (changes the sense) or wrong_text (text the page does not carry)',
    unit: 'words; Chinese, Japanese and Korean at 1.5 characters a word; Tibetan by syllable',
    A: 'at most 1 error per 1,000 words, and every page is this page’s text',
    B: 'at most 5 errors per 1,000 words, and every page is this page’s text',
    C: 'more than 5 errors per 1,000 words, but every page is this page’s text',
    D: 'at least one of the five pages is another page’s text, or mostly wrong (fidelity 1 or 2)',
  },
  min_books_per_cell: MIN_BOOKS,
  books: books.length,
  pages: books.reduce((a, b) => a + b.pages, 0),
  words: books.reduce((a, b) => a + b.words, 0),
  form_sources: Object.fromEntries(['verdict script_type', 'by eye'].map((s) => [s, books.filter((b) => b.form_source === s).length])),
  overall: cell(books),
  by_form: cutBy(books, forms),
  by_language_form: cutBy(books, (b) => (forms(b) ? `${b.language}|${b.form}` : null))
    .map(({ key, ...c }) => ({ language: key.split('|')[0], form: key.split('|')[1], ...c })),
  by_year_form: cutBy(books, (b) => (forms(b) ? `${b.year_bucket}|${b.form}` : null))
    .map(({ key, ...c }) => ({ years: key.split('|')[0], form: key.split('|')[1], ...c }))
    .sort((a, b) => YEARS.indexOf(a.years) - YEARS.indexOf(b.years) || FORMS.indexOf(a.form) - FORMS.indexOf(b.form)),
  book_list: books.sort((a, b) => a.language.localeCompare(b.language) || (a.per_1k ?? 1e9) - (b.per_1k ?? 1e9)),
};
for (const r of out.by_form) { r.form = r.key; delete r.key; }

const file = path.join(RESULTS, 'book-grades.json');
fs.mkdirSync(RESULTS, { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
const line = (c) => GRADES.map((g) => `${g} ${(c[g].share * 100).toFixed(0)}%`).join('  ');
console.log(`${path.relative(path.resolve(HERE, '../../..'), file)}: ${out.books} books, ${out.pages} pages (forms by eye: ${out.form_sources['by eye']})`);
console.log(`  overall      n=${out.overall.books}  ${line(out.overall)}`);
for (const r of out.by_form) console.log(`  ${r.form.padEnd(12)} n=${r.books}  ${line(r)}`);
for (const r of out.by_language_form) console.log(`  ${`${r.language} / ${r.form}`.padEnd(24)} n=${String(r.books).padStart(2)}  ${line(r)}`);
for (const r of out.by_year_form) console.log(`  ${`${r.years} / ${r.form}`.padEnd(24)} n=${String(r.books).padStart(2)}  ${line(r)}`);
