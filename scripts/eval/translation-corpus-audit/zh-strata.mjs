// PRIOR ART: arm.mjs (translation.model → arm; reused here, not copied), ../confidence-7866/lib.mjs routeOf/scriptOf
// (transcription route and hand tag for the #7866 frame, router cells, not a three-way engine split) and draw.mjs
// (book-random, one interior page per book, by language only). None stratifies WITHIN a language. This does it for
// Chinese (#5274, 2026-11-03): translation model × transcription engine as the design strata, kind of text and hand
// tag recorded on every item, and the frame weights needed to weight an oversample back.
//
// Used by draw.mjs --zh-strata N (the monthly Chinese oversample and the one-off 120-book sample) and by
// analyze-zh-strata.mjs. No database writes.

import { armOf } from './arm.mjs';

/** Translation-model arm, as the Chinese strata name it. Flash-Lite preview and GA are one arm. */
export function zhModelOf(model) {
  const a = armOf(model);
  return { flash: '3-flash', lite: 'flash-lite', 'agy-flash': '3.8-flash', opus: 'opus' }[a] || null;
}

/** Transcription engine from a page's ocr stamps: paddle (PaddleOCR-VL), gemini (any Gemini model), other. */
export function zhEngineOf({ model, source } = {}) {
  if (/paddle/i.test(model || '') || source === 'paddle') return 'paddle';
  if (/^gemini/.test(model || '')) return 'gemini';
  return 'other'; // Claude Opus OCR, CBETA XML import, wikisource, manual, unstamped
}

/** Hand, from the PAGE's script_type TAG (a classifier tag, not a reading of the hand; #7947 found such tags wrong on 8 of 109 books). */
export function zhHandOf(scriptType) {
  return { handwritten: 'manuscript', printed: 'print', mixed: 'mixed' }[scriptType] || 'untagged';
}

/**
 * Kind of text: 'reference' (looked up by entry, not read through) or 'prose' (running text: treatise, history,
 * commentary, fiction, poetry). The rule, from the catalogue first and the title second:
 *  1. A Siku/IA subject class 類書類 (encyclopedias: 太平御覽, 淵鑑類函, 古今圖書集成 …) or 小學類 (lexicons, character
 *     dictionaries, rhyme books: 說文, 廣韻, 康熙字典 …) → reference. Any other class (醫家, 數術, 儒家 …) → prose,
 *     even when the book has entry-shaped pages (a materia medica is read by entry but is a treatise by class).
 *  2. No 類-level class (none, or only 子部, as on the 四庫全書薈要 copies): the title names a reference genre (類書 類聚
 *     類函 類編 類要 類苑 類林 類說 事類 御覽 韻府 韻編 韻略 韻會 字典 字彙 字書 辭典 詞典 辭書 爾雅 說文 玉篇 廣雅 釋名
 *     方言 圖書集成 雜字 萬寶全書) or a well-known Siku 類書 (子史精華 圖書編 三才圖會 玉海 冊府元龜 山堂考索 事物紀原
 *     初學記 北堂書鈔 白孔六帖 錦繡萬花谷 格致鏡原 天中記 稗編 記纂淵海 海錄碎事 小學紺珠) → reference.
 *  3. Otherwise prose.
 * Checked by eye on 20 drawn pages (title + page image, 2026-11-03): 19 right; the miss, a 薈要 copy of 子史精華 with no
 * class, is what the title list in rule 2 now catches. See 2026-11-03-chinese-translation-strata-5274.md.
 */
const REF_CLASS = /類書類|小學類/;
const REF_TITLE = /類書|類聚|類函|類編|類要|類苑|類林|類說|事類|御覽|韻府|韻編|韻略|韻會|字典|字彙|字書|辭典|詞典|辭書|爾雅|說文|玉篇|廣雅|釋名|方言|圖書集成|雜字|萬寶全書|子史精華|圖書編|三才圖會|玉海|[冊册]府元龜|山堂考索|群書考索|事物紀原|初學記|書鈔|六帖|萬花谷|格致鏡原|天中記|稗編|記纂淵海|海錄碎事|小學紺珠/;
export function zhKindOf(book) {
  const subjects = book?.catalog_metadata?.subjects || [];
  const classes = subjects.filter((s) => /類$|部$/.test(String(s)));
  if (classes.some((s) => REF_CLASS.test(s))) return { kind: 'reference', by: 'subject' };
  if (classes.some((s) => /類$/.test(String(s)))) return { kind: 'prose', by: 'subject' };
  if (REF_TITLE.test(String(book?.title || ''))) return { kind: 'reference', by: 'title' };
  return { kind: 'prose', by: classes.length ? 'subject' : 'default' };
}

export const stratumKey = (model, engine) => `${model}|${engine}`;

/**
 * Per book × stratum translated-page counts for a frame of Chinese books (one $group over pages, ~45 s for the
 * 2,904-book frame on 2026-11-03). Returns { perBook: {book_id: {stratum: pages}}, pages: {stratum: pages} }.
 */
export async function censusZh(pagesColl, bookIds) {
  const perBook = {}, pages = {};
  for (let i = 0; i < bookIds.length; i += 200) {
    const rows = await pagesColl.aggregate([
      { $match: { book_id: { $in: bookIds.slice(i, i + 200) }, 'translation.data': { $type: 'string' } } },
      { $group: { _id: { b: '$book_id', tm: '$translation.model', om: '$ocr.model', os: '$ocr.source' }, n: { $sum: 1 } } },
    ], { maxTimeMS: 600000, allowDiskUse: true }).toArray();
    for (const r of rows) {
      const m = zhModelOf(r._id.tm); if (!m) continue;
      const s = stratumKey(m, zhEngineOf({ model: r._id.om, source: r._id.os }));
      (perBook[r._id.b] ||= {})[s] = (perBook[r._id.b][s] || 0) + r.n;
      pages[s] = (pages[s] || 0) + r.n;
    }
  }
  return { perBook, pages };
}

/**
 * Frame weights per stratum, two estimands:
 *   pages   share of live translated pages (a random PAGE of the frame) — the Part 1 report's weighting
 *   books   Σ over books of the book's page share in the stratum / n books — the probability that draw.mjs's
 *           book-random draw (random book, then a random page) lands in the stratum. The monthly headline uses this,
 *           so the Chinese cell keeps the estimand of every other language.
 * A stratum is non-empty when it holds ≥ minBooks books and ≥ minShare of pages; the rest are listed, not drawn.
 */
export function frameWeights({ perBook, pages }, { minBooks = 12, minShare = 0.001 } = {}) {
  const totalPages = Object.values(pages).reduce((s, x) => s + x, 0);
  const nBooks = Object.keys(perBook).length;
  const books = {}, bookCount = {};
  for (const cells of Object.values(perBook)) {
    const tot = Object.values(cells).reduce((s, x) => s + x, 0);
    for (const [s, n] of Object.entries(cells)) { books[s] = (books[s] || 0) + n / tot / nBooks; bookCount[s] = (bookCount[s] || 0) + 1; }
  }
  const strata = {}, dropped = {};
  for (const s of Object.keys(pages)) {
    const row = { pages: pages[s], books_with_pages: bookCount[s] || 0, w_pages: pages[s] / totalPages, w_books: books[s] || 0 };
    (row.books_with_pages >= minBooks && row.w_pages >= minShare ? strata : dropped)[s] = row;
  }
  return { total_pages: totalPages, n_books: nBooks, strata, dropped };
}

/** Allocation of N books over the non-empty strata: a floor of `min` each, the rest by page share (largest remainder). */
export function allocate(strata, N, min = Math.round(N / 10)) {
  const keys = Object.keys(strata).sort();
  const alloc = Object.fromEntries(keys.map((k) => [k, Math.min(min, strata[k].books_with_pages)]));
  let left = N - Object.values(alloc).reduce((s, x) => s + x, 0);
  if (left > 0) {
    const tot = keys.reduce((s, k) => s + strata[k].w_pages, 0);
    const raw = keys.map((k) => ({ k, x: left * strata[k].w_pages / tot }));
    for (const r of raw) alloc[r.k] += Math.floor(r.x);
    left = N - Object.values(alloc).reduce((s, x) => s + x, 0);
    for (const r of raw.sort((a, b) => (b.x % 1) - (a.x % 1)).slice(0, left)) alloc[r.k] += 1;
  }
  return alloc;
}
