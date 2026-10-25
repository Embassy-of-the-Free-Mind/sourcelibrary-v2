#!/usr/bin/env node
// PRIOR ART: scripts/audit/translation-reasoning-leak.mjs and page-integrity.mjs (phrase and shape rules; none counts
// a script-specific mark); the paddle-zh lane guards (scripts/lib/paddle-zh-lane.mjs) judge catastrophic reads, not
// 丨 fidelity. Nothing measured the dropped headword mark before #6056 round 3 (2026-10-23).
/**
 * headword-mark-drop — pages of Chinese reference works (韻府 / 類書 / 類編 …) whose OCR lost the 丨 marks (#6561, #6056).
 *
 * In 佩文韻府-type works 丨 / 丨丨 stands for the headword inside each quotation. An OCR that drops it leaves
 * quotations with holes, and the translator fills the holes with invented words (vol 664 pp39-40). Per page the
 * 丨 rate is bimodal — 0, or 40-100 per 1,000 Han characters — so a page at 0 in a book whose median is high is
 * the flag. Measured 2026-10-23 on 825 public 佩文韻府 volumes: 34,540 of 74,464 Paddle pages (≥100 Han) score
 * < 1/1k; Opus-read pages 9 of 67. By eye: vol 664 p33 has dozens of 丨丨 on the image and none in the OCR.
 *
 * Model-free, READ-ONLY on Mongo; writes files only. Run it on the job box (bulk reads, #import-cost-and-egress).
 *
 *   node --env-file=.env.production.local scripts/audit/headword-mark-drop.mjs [--book <id>] [--out DIR]
 *        [--titles '韻府|類書|類編|類函|類聚|駢字'] [--min-han 100] [--book-median 20]
 *
 * Writes <out>/summary.json (pages and books by OCR engine, flagged counts) and <out>/flagged.jsonl
 * ({book_id, page_number, han, marks, per1k, book_median, engine}). No page text is written.
 * Positive control: `--book 6a3c64e339b4508b04e2ae39` must flag pages 39 and 40 and not page 41.
 */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { withMongo } from '../lib/mongo.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const BOOK = opt('book', null);
const OUT = opt('out', `scripts/output/headword-mark-drop-${new Date().toISOString().slice(0, 10)}`);
const TITLES = new RegExp(opt('titles', '韻府|類書|類編|類函|類聚|駢字'));
const MIN_HAN = Number(opt('min-han', 100));
const BOOK_MEDIAN = Number(opt('book-median', 20));

const HAN = /[一-鿿]/g;
const MARK = /丨/g;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

mkdirSync(OUT, { recursive: true });
const flaggedFile = join(OUT, 'flagged.jsonl');
writeFileSync(flaggedFile, '');

await withMongo(async (db) => {
  const filter = BOOK ? { id: BOOK } : { visible: true, pages_count: { $gt: 0 }, title: { $regex: TITLES } };
  const books = await db.collection('books').find(filter, { projection: { _id: 0, id: 1, title: 1 } }).toArray();
  const byEngine = {};
  let flaggedPages = 0;
  const flaggedBooks = new Set();
  for (const [i, b] of books.entries()) {
    const pages = await db.collection('pages')
      .find({ book_id: b.id, page_number: { $gt: 0 }, 'ocr.data': { $type: 'string' } },
        { projection: { _id: 0, page_number: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.model': 1 } })
      .toArray();
    const rows = pages.map((p) => {
      const han = (p.ocr.data.match(HAN) || []).length;
      const marks = (p.ocr.data.match(MARK) || []).length;
      return { page_number: p.page_number, han, marks, per1k: han ? (marks / han) * 1000 : 0, engine: `${p.ocr?.source ?? '?'}/${p.ocr?.model ?? ''}` };
    }).filter((r) => r.han >= MIN_HAN);
    const bookMedian = median(rows.map((r) => r.per1k));
    for (const r of rows) {
      const e = (byEngine[r.engine] ??= { pages: 0, han: 0, marks: 0, zero: 0, flagged: 0 });
      e.pages++; e.han += r.han; e.marks += r.marks;
      if (r.per1k < 1) e.zero++;
      if (r.per1k < 1 && bookMedian >= BOOK_MEDIAN) {
        e.flagged++; flaggedPages++; flaggedBooks.add(b.id);
        appendFileSync(flaggedFile, JSON.stringify({ book_id: b.id, page_number: r.page_number, han: r.han, marks: r.marks, per1k: +r.per1k.toFixed(1), book_median: +bookMedian.toFixed(1), engine: r.engine }) + '\n');
      }
    }
    if ((i + 1) % 100 === 0) console.error(`${i + 1}/${books.length} books, ${flaggedPages} pages flagged`);
  }
  for (const e of Object.values(byEngine)) e.per1k = e.han ? +((e.marks / e.han) * 1000).toFixed(1) : 0;
  const summary = { date: new Date().toISOString(), titles: String(TITLES), min_han: MIN_HAN, book_median: BOOK_MEDIAN, books: books.length, flagged_pages: flaggedPages, flagged_books: flaggedBooks.size, by_engine: byEngine };
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(`${books.length} books · ${flaggedPages} pages flagged in ${flaggedBooks.size} books → ${OUT}`);
});
