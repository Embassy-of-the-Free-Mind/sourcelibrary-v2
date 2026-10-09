#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/embed-format/build-pools.mjs — the #6170 pools (A 10K
 * untranslated pages, B 8K translated pages), each scored on its own; both
 * baselines sat at the ceiling (R@10 0.93 / 0.97). This builds ONE pool of
 * ~100K pages that both gold sets search, mixed the way `page_translations` is
 * (translated pages as English, OCR-only pages as the original), with whole
 * clusters of near-duplicate editions. Same seed family, same text cleaning.
 *
 * build-pool-100k — the pool for the #6170 follow-up (job embed-next-6173).
 *
 * Rows, in this order (each book once; first role wins):
 *   a-gold     the 40 set-A gold books: up to 60 OCR pages, gold page forced in.
 *              OCR even where the book has since been translated — set A is the
 *              cross-lingual test (English query → original-language page).
 *   a-sib      other editions of a set-A gold work (same work_id): up to 40
 *              pages, production text. Their own-language OCR is kept as
 *              `ocr_orig` so score-100k.mjs can find the gold passage in them.
 *   b-exp      every set-B expected book and every other edition of its work:
 *              PAGES translated pages each.
 *   dup        near-duplicate editions: works with >= 3 live translated
 *              editions, up to 4 editions per work, PAGES pages each.
 *   ocr        OCR-only books (no translation): 30 pages each, production text
 *              (the cleaned OCR), mostly Chinese — as in the live table.
 *   tr         random live translated books, PAGES pages each.
 * Filler (dup / ocr / tr) never takes a book in --exclude (the concept-lane
 * stage-1 books: their envelopes would meter each other's spend).
 * The pool stops when the estimated Batch cost of embedding it in BOTH formats
 * reaches --max-usd.
 *
 *   node --env-file=.env.production.local scripts/eval/embed-format/build-pool-100k.mjs --dir D [--exclude books.json] [--max-usd 8.6]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../../lib/mongo.mjs';
import { cleanPageText, pageEmbeddingInput } from '../../lib/page-embedding-text.mjs';
import { estimateTextTokens, usdForTokens } from '../../lib/embedding-usage.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { arg, DOC_FORMS } from './common.mjs';

const DIR = arg('--dir');
if (!DIR) { console.error('--dir required'); process.exit(1); }
const PAGES = Number(arg('--pages', 20));
const MAX_USD = Number(arg('--max-usd', 8.6));
const TARGET = { dup: Number(arg('--dup-works', 260)), ocr: Number(arg('--ocr-books', 900)), tr: Number(arg('--tr-books', 2200)) };
const here = path.dirname(fileURLToPath(import.meta.url));
const goldA = JSON.parse(fs.readFileSync(path.join(here, '../orig-lang-recall/gold.json'), 'utf8')).queries;
const goldB = JSON.parse(fs.readFileSync(path.join(here, '../librarian-search/golden-set.json'), 'utf8')).queries;
const exclude = new Set(arg('--exclude') ? JSON.parse(fs.readFileSync(arg('--exclude'), 'utf8')).map((b) => b.book_id) : []);
const rng = makeRng(61701);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const MIN = (lang) => (/chinese|japanese/i.test(lang || '') ? 100 : 300);

fs.mkdirSync(DIR, { recursive: true });
const out = fs.createWriteStream(path.join(DIR, 'pool.jsonl'));
let n = 0; let usd = 0;
const taken = new Set();
const tally = {};
const costOf = (row) => usdForTokens(estimateTextTokens(DOC_FORMS.plain(row).slice(0, 8000)) + estimateTextTokens(DOC_FORMS.prefix(row).slice(0, 8000)), { batch: true });
const push = (row) => {
  const r = { i: n++, ...row };
  usd += costOf(r);
  out.write(JSON.stringify(r) + '\n');
  tally[row.role] = (tally[row.role] || 0) + 1;
};
const BOOK_PROJ = { id: 1, slug: 1, title: 1, display_title: 1, language: 1, work_id: 1, pages_translated: 1, year: 1, author: 1 };
const LIVE = { visible: true, pages_count: { $gt: 0 }, content_type: { $ne: 'artwork' } };

await withMongo(async (db) => {
  const books = db.collection('books');
  const pagesC = db.collection('pages');
  const meta = (b) => ({ book_id: b.id, slug: b.slug || '', work_id: b.work_id ? String(b.work_id) : null, title: b.display_title || b.title || '', lang: b.language || '' });

  /** Up to `k` seeded-random usable pages of a book, production text (or OCR when `ocrOnly`). */
  async function drawPages(b, k, { ocrOnly = false, keepOrig = false, force = null, translatedOnly = false } = {}) {
    const docs = await pagesC.find({ book_id: b.id, page_number: { $gt: 0 } })
      .project({ id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1, 'ocr.unreadable': 1, translation_withheld: 1 }).toArray();
    const usable = [];
    for (const p of docs) {
      if (p.ocr?.unreadable) continue;
      let text, src;
      if (ocrOnly) { text = cleanPageText(p.ocr?.data); src = 'ocr'; }
      else { const c = pageEmbeddingInput(p); if (!c) continue; text = c.text; src = c.hasTranslation ? 'translation' : 'ocr'; }
      if (translatedOnly && src !== 'translation') continue;
      if ((text || '').length < MIN(src === 'ocr' ? b.language : 'English')) continue;
      usable.push({ page_id: String(p.id ?? p._id), page_number: p.page_number, src, text, ...(keepOrig ? { ocr_orig: cleanPageText(p.ocr?.data) } : {}) });
    }
    const forced = force != null ? usable.filter((p) => p.page_number === force) : [];
    const rest = shuffle(usable.filter((p) => !forced.includes(p))).slice(0, Math.max(0, k - forced.length));
    return [...forced, ...rest].sort((x, y) => x.page_number - y.page_number);
  }

  // ── a-gold ──
  const aWorks = new Set();
  for (const q of goldA) {
    if (taken.has(q.book_id)) continue;
    const b = await books.findOne({ id: q.book_id }, { projection: BOOK_PROJ });
    const lang = q.lang;
    const rows = await drawPages({ ...b, language: lang }, 60, { ocrOnly: true, force: q.page_number });
    if (!rows.some((r) => r.page_number === q.page_number)) throw new Error(`${q.qid}: gold page has no usable OCR`);
    for (const r of rows) push({ ...meta(b), ...r, lang, role: 'a-gold' });
    taken.add(b.id); if (b.work_id) aWorks.add(String(b.work_id));
  }
  // ── a-sib ──
  for (const w of aWorks) {
    for (const b of await books.find({ ...LIVE, work_id: w, id: { $nin: [...taken] } }).project(BOOK_PROJ).toArray()) {
      for (const r of await drawPages(b, 40, { keepOrig: true })) push({ ...meta(b), ...r, role: 'a-sib' });
      taken.add(b.id);
    }
  }
  console.log(`a: ${tally['a-gold']} gold-book pages, ${tally['a-sib'] || 0} sibling pages; est $${usd.toFixed(2)}`);
  // ── b-exp (+ every edition of an expected work) ──
  const slugs = [...new Set(goldB.flatMap((q) => q.expected.map((e) => e.book_slug)))];
  const expected = await books.find({ slug: { $in: slugs } }).project(BOOK_PROJ).toArray();
  const bWorks = [...new Set(expected.map((b) => b.work_id).filter(Boolean).map(String))];
  const sibs = await books.find({ ...LIVE, work_id: { $in: bWorks }, pages_translated: { $gte: 5 } }).project(BOOK_PROJ).toArray();
  for (const b of [...expected, ...sibs]) {
    if (taken.has(b.id)) continue;
    for (const r of await drawPages(b, PAGES, { translatedOnly: true })) push({ ...meta(b), ...r, role: 'b-exp' });
    taken.add(b.id);
  }
  console.log(`b: ${tally['b-exp']} pages; est $${usd.toFixed(2)}`);
  // ── dup: near-duplicate edition clusters ──
  const groups = await books.aggregate([
    { $match: { ...LIVE, pages_translated: { $gte: PAGES }, work_id: { $exists: true, $ne: null } } },
    { $group: { _id: '$work_id', ids: { $push: '$id' }, n: { $sum: 1 } } },
    { $match: { n: { $gte: 3 } } }, { $sort: { _id: 1 } },
  ]).toArray();
  let works = 0;
  for (const g of shuffle(groups)) {
    if (works >= TARGET.dup || usd > MAX_USD * 0.45) break;
    const ids = shuffle(g.ids.filter((id) => !taken.has(id) && !exclude.has(id))).slice(0, 4);
    if (ids.length < 3) continue;
    for (const b of await books.find({ id: { $in: ids } }).project(BOOK_PROJ).toArray()) {
      for (const r of await drawPages(b, PAGES, { translatedOnly: true })) push({ ...meta(b), ...r, role: 'dup' });
      taken.add(b.id);
    }
    works++;
  }
  console.log(`dup: ${works} works, ${tally.dup || 0} pages; est $${usd.toFixed(2)}`);
  // ── ocr: OCR-only books ──
  const ocrBooks = shuffle(await books.find({ ...LIVE, pages_translated: { $in: [0, null] }, pages_ocr: { $gte: 30 } }).project(BOOK_PROJ).sort({ id: 1 }).toArray());
  let nb = 0;
  for (const b of ocrBooks) {
    if (nb >= TARGET.ocr || usd > MAX_USD * 0.7) break;
    if (taken.has(b.id) || exclude.has(b.id)) continue;
    const rows = await drawPages(b, 30, { ocrOnly: true });
    if (rows.length < 10) continue;
    for (const r of rows) push({ ...meta(b), ...r, role: 'ocr' });
    taken.add(b.id); nb++;
  }
  console.log(`ocr: ${nb} books, ${tally.ocr || 0} pages; est $${usd.toFixed(2)}`);
  // ── tr: random translated filler, until the budget ──
  const trBooks = shuffle(await books.find({ ...LIVE, pages_translated: { $gte: PAGES } }).project(BOOK_PROJ).sort({ id: 1 }).toArray());
  nb = 0;
  for (const b of trBooks) {
    if (nb >= TARGET.tr || usd > MAX_USD) break;
    if (taken.has(b.id) || exclude.has(b.id)) continue;
    const rows = await drawPages(b, PAGES, { translatedOnly: true });
    if (rows.length < PAGES / 2) continue;
    for (const r of rows) push({ ...meta(b), ...r, role: 'tr' });
    taken.add(b.id); nb++;
  }
  await new Promise((r) => out.end(r));
  const summary = { pages: n, books: taken.size, by_role: tally, est_usd_both_formats: +usd.toFixed(2), excluded_books: exclude.size, seed: 61701 };
  fs.writeFileSync(path.join(DIR, 'pool-summary.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary));
}, { timeoutMs: 7_200_000 });
