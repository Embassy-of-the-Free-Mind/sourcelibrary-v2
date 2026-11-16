/**
 * Pure helpers for the fortnightly spot check (#5914): the seeded book draw, the page-run pick, and the
 * book-structure counts. No I/O, so `tests/unit/spot-check-draw.test.ts` can pin determinism and the
 * one-run-per-book rule without Mongo.
 *
 * PRIOR ART: ops `rights-screen/2026-10-06-canon-shelves/spot30/draw30.mjs` (month 0) — the logic here is its
 * draw and structure check, moved out of the Mongo loop. It used the pre-#5373 LCG; a new series uses
 * `makeRng` from `../lib/paired-stats.mjs`. `../lib/sampling.mjs` samples PAGES stratified by position,
 * which is the wrong unit here (lesson: pages in a book are one observation).
 */
import { makeRng } from '../lib/paired-stats.mjs';

export const RUN_LENGTH = 3;

/** Seed from a draw date: '2026-10-19' → 20261019. */
export function seedFromDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`bad date ${date}`);
  return Number(date.replace(/-/g, ''));
}

/**
 * Yield the frame's book ids in a seeded random order, without replacement, uniform per BOOK.
 * The frame is sorted first so the order depends on (seed, set of ids) only, never on Mongo's
 * return order. The caller walks it until it has n books that pass the page check.
 */
export function* bookOrder(ids, rng) {
  const pool = [...new Set(ids)].sort();
  // Lazy Fisher–Yates: each step picks uniformly from what is left.
  for (let i = 0; i < pool.length; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    yield pool[i];
  }
}

/**
 * The start of a uniformly chosen run of `len` consecutive translated page numbers, or null when the
 * book has none. `translated` is any iterable of page numbers whose translation is non-empty.
 */
export function pickRun(translated, rng, len = RUN_LENGTH) {
  const ok = new Set(translated);
  const starts = [...ok].filter((n) => {
    for (let k = 1; k < len; k++) if (!ok.has(n + k)) return false;
    return true;
  }).sort((a, b) => a - b);
  if (!starts.length) return null;
  return starts[Math.floor(rng() * starts.length)];
}

/**
 * Draw n books and one run per book. `frame` is a list of ids; `translatedFor(id)` returns the book's
 * translated page numbers (may be async). A book with no qualifying run is recorded as rejected and the
 * walk moves on — so every drawn book contributes exactly one run, and no book appears twice.
 */
export async function drawSample({ frame, n, seed, translatedFor, len = RUN_LENGTH }) {
  const bookRng = makeRng(seed);
  // A second stream for the page runs, so a rejected book does not shift which run later books get.
  const runRng = makeRng(seed ^ 0x9e3779b9);
  const picks = [];
  const rejected = [];
  for (const id of bookOrder(frame, bookRng)) {
    if (picks.length >= n) break;
    const start = pickRun(await translatedFor(id), runRng, len);
    if (start == null) { rejected.push(id); continue; }
    picks.push({ id, start, pages: Array.from({ length: len }, (_, k) => start + k) });
  }
  return { picks, rejected };
}

/** A printed page number as an integer: Arabic, Devanagari or Chinese digits; else null. */
export function printedToNum(s) {
  if (!s) return null;
  s = String(s).trim();
  if (/^\d+$/.test(s)) return +s;
  const dev = '०१२३४५६७८९';
  if ([...s].every((ch) => dev.includes(ch))) return +[...s].map((ch) => dev.indexOf(ch)).join('');
  const zh = { '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  if ([...s].every((ch) => ch in zh)) return +[...s].map((ch) => zh[ch]).join('');
  return null;
}

/**
 * Book-structure counts from all of a book's page records (sorted by page_number):
 * records vs distinct page numbers, pages with OCR, pages translated, and the printed page-number
 * sequence read from `<page-num>` — backsteps (a printed number lower than the one before) and repeats.
 * Counts, not verdicts: a backstep can be a misread leaf numeral (month 0's 籌海圖編) as easily as a splice.
 */
export function structureCounts(pages) {
  const nums = [];
  for (const p of pages) {
    const raw = (p.ocr?.data ?? '').match(/<page-num>\s*([^<]*?)\s*<\/page-num>/)?.[1];
    const printed = printedToNum(raw);
    if (printed != null) nums.push(printed);
  }
  let backsteps = 0, repeats = 0;
  const seen = new Set();
  for (let i = 1; i < nums.length; i++) if (nums[i] < nums[i - 1]) backsteps++;
  for (const x of nums) { if (seen.has(x)) repeats++; seen.add(x); }
  const distinct = new Set(pages.map((p) => p.page_number));
  return {
    page_records: pages.length,
    distinct_page_numbers: distinct.size,
    duplicate_records: pages.length - distinct.size,
    pages_with_ocr: pages.filter((p) => p.ocr?.data?.trim()).length,
    pages_translated: pages.filter((p) => p.translation?.data?.trim()).length,
    with_printed_number: nums.length,
    printed_backsteps: backsteps,
    printed_repeats: repeats,
  };
}

/** The image a reviewer should open: the leaf of record, mirroring `getPageSource` in src/lib/page-image-url.ts. */
export function pageImageUrl(p) {
  const usable = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
  if (usable(p.cropped_photo)) return p.cropped_photo;
  if (p.split_from_spread && usable(p.photo)) return p.photo;
  if (typeof p.archived_photo === 'string' && p.archived_photo.startsWith('failed:')) return null;
  for (const k of ['enhanced_photo', 'archived_photo', 'photo_original', 'photo']) if (usable(p[k])) return p[k];
  return null;
}

// ── text the reader is not served (v3#154) ───────────────────────────────────
// On an English leaf of an English edition the reader, /quote, /text and the exports serve the TRANSCRIPTION; a
// stored `translation` there is a model's rewording nobody is shown (#7100). exposureOf() calls such a page
// `rewrite_not_served`. Round 7 (2026-11-13) handed reviewers that stored text and counted 7 serious findings in it
// in the headline: 5 of 30 pages, where the text readers meet gave 2 of 30.

const REWRITE_NOT_SERVED = 'rewrite_not_served';

/**
 * The translation fields of a packet page: what the reviewer is given. On a `rewrite_not_served` page the stored
 * text is left out and a note says why, so the reviewer judges the transcription against the image as the reader's
 * English and files nothing against text no reader sees.
 */
export function packetTranslation(page, exposure) {
  if (exposure === REWRITE_NOT_SERVED) {
    return { translation: '', translation_model: null, translation_source: null,
      translation_note: 'English leaf of an English edition: the reader is served the transcription. The stored English is not served and is not in this packet; tr_score is null.' };
  }
  return { translation: page.translation?.data ?? '', translation_model: page.translation?.model ?? null, translation_source: page.translation?.source ?? null };
}

/**
 * A run's results as SCORED: findings in text the reader is not served are taken out. `exposure` is the run's
 * draw-log.json `exposure` ({ book_id: { page_number: exposure } }). On a `rewrite_not_served` page the `tr_errors`
 * are findings in the stored rewrite and are dropped; `ocr_errors`, `other` and `right_page` stay, because the
 * transcription and the image are what the reader gets. A run whose draw recorded no such page is returned as it is,
 * so earlier rounds score as they did.
 * Returns { results, notServed: { pages, books, findings, serious } }; `pages` and `books` count where something
 * was dropped. Pure: the input is not changed.
 */
export function servedResults(results, exposure = {}) {
  const notServed = { pages: 0, books: 0, findings: 0, serious: 0 };
  const out = results.map((r) => {
    let touched = false;
    const pages = (r.pages ?? []).map((p) => {
      if (exposure?.[r.book_id]?.[p.page_number] !== REWRITE_NOT_SERVED) return p;
      const dropped = (p.tr_errors ?? []).filter((e) => e && typeof e === 'object');
      if (!dropped.length) return p;
      touched = true;
      notServed.pages++; notServed.findings += dropped.length; notServed.serious += dropped.filter((e) => e.severity === 'serious').length;
      return { ...p, tr_errors: [], tr_errors_not_served: dropped };
    });
    if (touched) notServed.books++;
    return touched ? { ...r, pages } : r;
  });
  return { results: out, notServed };
}
