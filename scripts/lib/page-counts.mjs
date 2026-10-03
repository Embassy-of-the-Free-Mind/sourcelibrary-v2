/**
 * Canonical page-count convention (issue #3293).
 *
 * `books.pages_count` / `pages_ocr` / `pages_translated` are VISIBLE-only:
 * they count pages with `page_number > 0`. Pages with `page_number <= 0`
 * are a deliberate soft-hide — they never render in the reader — so counting
 * them corrupts the read path, which prints `pages_count` as "N scans" and
 * divides by it for `hasTranslations`, the ≥90%-readable filter, and the
 * `TranslatedSiblingNotice` <5% gate.
 *
 * Every writer that recomputes these counters (batch collectors, the split
 * worker, realtime translate) must count visible pages only. This module is
 * the single source of that rule so the convention can't drift per-writer
 * again. Pinned by tests/unit/page-counts.test.ts.
 *
 * It is also the single WRITER of the six counters: recountBook() below, which
 * `$set`s all six together (#5325). Design, decisions and the inventory of
 * writers still to convert: .claude/docs/page-counts.md. The shape guard that
 * keeps new writers out: tests/unit/page-counter-writers.test.ts.
 */

/** Match fragment selecting only visible (renderable) pages. */
export const VISIBLE_PAGE_MATCH = { page_number: { $gt: 0 } };

/** True iff a page renders in the reader (soft-hidden pages have page_number <= 0). */
export function isVisiblePage(page) {
  return (page?.page_number ?? 0) > 0;
}

/** True iff a page carries non-empty OCR text. */
export function hasOcr(page) {
  const data = page?.ocr?.data;
  // Attempted-but-not-legible pages keep `data` for provenance but are not
  // served (#4523) — they do not count as OCR'd.
  if (page?.ocr?.unreadable === true) return false;
  return typeof data === 'string' && data !== '';
}

/** True iff a page carries non-empty translation text. */
export function hasTranslation(page) {
  const data = page?.translation?.data;
  return typeof data === 'string' && data !== '';
}

/** True iff the page is a blank leaf (flyleaf, endpaper, empty verso). */
export function isBlankPage(page) {
  return (page?.page_type ?? '') === 'blank';
}

/**
 * True iff a page carries a non-empty `archived_photo` — the `pages_archived`
 * counter. A `failed:*` marker counts too, exactly as the reconciler
 * (`sync-worker.mjs`) has always counted it: a `$regexMatch` per page was judged
 * too costly for a rare value. Changing that is a definition change, not a
 * refactor — it would move the stored counter on every book carrying one.
 */
export function isArchivedPage(page) {
  const photo = page?.archived_photo;
  return typeof photo === 'string' && photo !== '';
}

/**
 * Tags whose entire content is descriptive/administrative — never page content —
 * so they are stripped wholesale (open tag, content, close tag) when judging
 * whether an `illustration` page carries anything to translate (#4685).
 */
const ILLUSTRATION_STRIP_BLOCK_TAGS = ['image-desc', 'meta', 'warning', 'insert', 'vocab'];

/**
 * Chars remaining on an OCR'd page after: (1) the five descriptive/admin blocks
 * above are removed WITH their content, and (2) every other tag's markup
 * (`<language>en</language>`, `<page-type>`, `<script>`, `<page-num>`, …) is
 * stripped down to whatever prose it wraps — those tags are fixed structural
 * vocabulary, always present, and would otherwise put a floor of ~35-60 chars
 * under every page regardless of content and make the guard below fire on
 * nothing. A tag we didn't anticipate (`<header>`, `<note>`) still contributes
 * its inner text, so real content is never silently discarded.
 */
export function stripIllustrationBoilerplate(ocrText) {
  let t = ocrText || '';
  for (const tag of ILLUSTRATION_STRIP_BLOCK_TAGS) {
    t = t.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, 'gi'), '');
  }
  t = t.replace(/<\/?[a-zA-Z][a-zA-Z0-9_-]*(?:\s[^>]*)?\/?>/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

/** Below this many chars of stripped content, an `illustration` page counts as text-free. */
export const ILLUSTRATION_TEXT_FREE_THRESHOLD = 40;

/**
 * True iff an `illustration` page's OCR, after stripIllustrationBoilerplate, carries
 * no real content — a binding photo, fore-edge, bookplate stamp, calibration card
 * (#4685: 37/40 sampled illustration+digitizer-insert pages had nothing to
 * translate). The exclusion is illustration-ONLY and guarded, not blanket: 1 of the
 * 40 was a mistagged manuscript spread carrying a full Latin prayer under an
 * `illustration` tag, and `diagram`/`map` pages (2/2 and 1/1 substantive in the
 * same sample — Chinese cosmological diagrams with labels) are never guarded here
 * at all, only `illustration` is.
 *
 * A page with no OCR yet returns false (not text-free) — pending OCR is pending
 * work, not proven-empty work, same rule isTranslatablePageForCount already
 * applies to every other page type.
 */
export function isTextFreeIllustration(page) {
  if ((page?.page_type ?? '') !== 'illustration') return false;
  if (!hasOcr(page)) return false;
  return stripIllustrationBoilerplate(page.ocr.data).length < ILLUSTRATION_TEXT_FREE_THRESHOLD;
}

/**
 * True iff a page counts toward `pages_translated`.
 *
 * A blank leaf does NOT, even though it carries translation text: the
 * translator writes the literal placeholder "[Blank page — no translatable
 * content]" onto every blank page. Measured 2026-08-08, that was 87,777 pages
 * — flyleaves and endpapers — counted as translations, 99.8% of them under 120
 * characters.
 *
 * It also made `translation_pct` exceed 100 on 6,228 live books (32% of the
 * public library), because blank pages are subtracted from the denominator
 * (`pages_ocr - pages_blank`) while still being counted in the numerator. The
 * Blue Qur'an reported **1000% translated**: 60 pages, 54 of them blank, over a
 * denominator of 6.
 */
export function isTranslatedPage(page) {
  return hasTranslation(page) && !isBlankPage(page);
}

/**
 * Page types that will never carry a translation, whatever we spend.
 *
 * `digitizer-insert` added #4685/#4507: 10/10 sampled digitizer-insert pages were
 * scanning-service boilerplate (Google/IA/ProQuest cover sheets), never book content —
 * unlike `illustration`, which sometimes IS content (see isTextFreeIllustration below),
 * this type is safe to exclude outright.
 *
 * Kept as a literal rather than imported from `translate-core.mjs` because that
 * module imports THIS one; the two must stay in step and
 * `tests/unit/page-counts.test.ts` is where that is asserted.
 */
export const NEVER_TRANSLATED_PAGE_TYPES = ['blank', 'exlibris', 'bookplate', 'digitizer-notice', 'digitizer-insert'];

/**
 * True iff a page is work the translator could actually do — the honest
 * DENOMINATOR for translation completeness (#4442).
 *
 * `pages_count` is the wrong denominator and always has been: it counts every
 * visible page, including ones no amount of money will ever translate.
 *
 * EXACT, corpus-wide, after the 2026-08-31 backfill — every live book now carries
 * `pages_translatable`, so this is a count and not an estimate:
 *
 *   complete by the naive measure (pages_translated >= pages_count):  3,244  10.2%
 *   complete by the honest measure (>= pages_translatable):          14,984  47.2%
 *   nothing translatable at all (no OCR yet, or all plates):          1,563   4.9%
 *
 * **11,740 finished books currently display as unfinished.**
 *
 * Two earlier figures for this are wrong and should not be repeated. "~41%" came
 * from extrapolating a sample restricted to books with a 1-25 page apparent tail,
 * which structurally cannot see a complete book carrying a hundred pages of plates.
 * "49.9%" was an unrestricted 800-book sample — sound method, just superseded by the
 * exact count. A sample frame chosen for one question is rarely valid for the next.
 *
 * A page qualifies unless it is a never-translated type or the model has permanently
 * refused it.
 *
 * CRUCIALLY, a page with no OCR yet still counts. "Not yet OCR'd" is PENDING work, not
 * IMPOSSIBLE work, and excluding it is how a book gets badged finished while half of it
 * is blank. The first version of this did exactly that: Theatrum Chemicum vol. 6 —
 * 4,198 pages, only 2,003 OCR'd — displayed 100% translated with 2,195 pages carrying
 * no text at all, and 1,701 books (11.4% of everything badged complete) had more than
 * a fifth of the book un-OCR'd. Overstating completeness is a worse failure than the
 * understatement this field exists to fix, because a reader can see it.
 */
export function isTranslatablePageForCount(page) {
  if (!isVisiblePage(page)) return false;
  if (NEVER_TRANSLATED_PAGE_TYPES.includes(page?.page_type ?? '')) return false;
  if (isTextFreeIllustration(page)) return false;
  if (page?.translation?.recitation_blocked === true) return false;
  if (page?.translation?.safety_blocked === true) return false;
  if (page?.ocr?.recitation_blocked === true) return false;
  if (page?.ocr?.fail_blocked === true) return false;
  return true;
}

/**
 * Mongo twin of isTranslatablePageForCount(), shared by the denominator and its numerator.
 *
 * The illustration guard is expressed here as a read of the stamped `ocr.text_free`
 * boolean, NOT a re-derivation of isTextFreeIllustration's regex tag-stripping — Mongo
 * has no exact way to strip `<image-desc>…</image-desc>`-style blocks and count what's
 * left (no regex-replace-and-measure primitive). `ocr.text_free` is written by
 * recount-page-stats.mjs immediately before it reads this pipeline, computed by the
 * exact JS function on the same pages, so denominator and stamp never disagree for a
 * book that has gone through a recount. A page whose stamp is missing (never recounted
 * since this shipped) reads as `false` here and stays IN the denominator — the same
 * "pending, not proven-empty" default every other unclassified page already gets.
 */
const TRANSLATABLE_COND = {
  $and: [
    // No `ocr.data` requirement — see isTranslatablePageForCount. A page awaiting OCR
    // is pending work and belongs in the denominator.
    { $not: [{ $in: [{ $ifNull: ['$page_type', ''] }, NEVER_TRANSLATED_PAGE_TYPES] }] },
    {
      $not: [
        {
          $and: [
            { $eq: [{ $ifNull: ['$page_type', ''] }, 'illustration'] },
            { $eq: [{ $ifNull: ['$ocr.text_free', false] }, true] },
          ],
        },
      ],
    },
    { $ne: ['$translation.recitation_blocked', true] },
    { $ne: ['$translation.safety_blocked', true] },
    { $ne: ['$ocr.recitation_blocked', true] },
    { $ne: ['$ocr.fail_blocked', true] },
  ],
};

/** Mongo twin of `typeof field === 'string' && field !== ''` — hasOcr/hasTranslation's test. */
const nonEmptyString = (field) => ({
  $and: [
    { $eq: [{ $type: field }, 'string'] },
    { $gt: [{ $strLenCP: field }, 0] },
  ],
});

/** Mirrors hasOcr(). Attempted-but-not-legible pages keep `data` for provenance but are not served (#4523). */
const HAS_OCR_COND = { $and: [nonEmptyString('$ocr.data'), { $ne: ['$ocr.unreadable', true] }] };

/** Mirrors hasTranslation(). */
const HAS_TRANSLATION_COND = nonEmptyString('$translation.data');

/** Mirrors isBlankPage(). */
const IS_BLANK_COND = { $eq: [{ $ifNull: ['$page_type', ''] }, 'blank'] };

/**
 * The `$group` body for every page-count aggregation — per book and corpus-wide.
 * One object, so the per-book recount and the reconciler cannot count differently
 * (#5325; five private copies existed before this). Each accumulator has a JS
 * predicate twin, and `countVisiblePageStats()` is built from those twins;
 * `tests/integration/page-counts-parity.test.ts` runs both on the same edge pages.
 *
 *   total                    → pages_count         isVisiblePage (the $match)
 *   with_ocr                 → pages_ocr           hasOcr
 *   with_translation         → pages_translated    isTranslatedPage
 *   translatable             → pages_translatable  isTranslatablePageForCount
 *   translated_translatable  → (not stored)        translatable && hasTranslation
 *   blank                    → pages_blank         isBlankPage && hasOcr
 *   archived                 → pages_archived      isArchivedPage
 *
 * `blank` is `page_type: 'blank'` only (design decision 3, `.claude/docs/page-counts.md`).
 * It is subtracted from the denominator that `with_translation` is divided by, so the
 * two must exclude the SAME set (#3747): `with_translation` excludes `blank` and
 * nothing else. The other never-translated types (exlibris, bookplate, digitizer
 * notices and inserts) leave the denominator through `translatable`, not `blank`.
 */
export const PAGE_COUNT_ACCUMULATORS = Object.freeze({
  total: { $sum: 1 },
  with_ocr: { $sum: { $cond: [HAS_OCR_COND, 1, 0] } },
  // Blank leaves carry the placeholder "[Blank page — no translatable content]",
  // not a translation. Counting them is what put the Blue Qur'an at 1000%.
  with_translation: {
    $sum: { $cond: [{ $and: [HAS_TRANSLATION_COND, { $not: [IS_BLANK_COND] }] }, 1, 0] },
  },
  // The honest denominator (#4442) and its matching numerator. A numerator must
  // exclude whatever its denominator excludes — getting that wrong is what produced
  // a 105.6% reading on Hugh of Santalla while the field was being written.
  translatable: { $sum: { $cond: [TRANSLATABLE_COND, 1, 0] } },
  translated_translatable: {
    $sum: { $cond: [{ $and: [TRANSLATABLE_COND, HAS_TRANSLATION_COND] }, 1, 0] },
  },
  blank: { $sum: { $cond: [{ $and: [IS_BLANK_COND, HAS_OCR_COND] }, 1, 0] } },
  archived: { $sum: { $cond: [nonEmptyString('$archived_photo'), 1, 0] } },
});

/**
 * Aggregation pipeline that returns
 * { total, with_ocr, with_translation, translatable, translated_translatable, blank, archived }
 * for the VISIBLE pages of one book.
 */
export function buildVisiblePageCountPipeline(bookId) {
  return [
    { $match: { book_id: bookId, ...VISIBLE_PAGE_MATCH } },
    { $group: { _id: null, ...PAGE_COUNT_ACCUMULATORS } },
  ];
}

/**
 * The same counts for every book at once, grouped by `book_id` (`_id` of each row).
 * For the reconciler (#5326), which walks the whole `pages` collection every 2 h.
 */
export function buildCorpusPageCountPipeline() {
  return [
    { $match: { ...VISIBLE_PAGE_MATCH } },
    { $group: { _id: '$book_id', ...PAGE_COUNT_ACCUMULATORS } },
  ];
}

/**
 * Pure JS twin of the pipeline: count visible-page stats from an in-memory
 * page array. Same convention as buildVisiblePageCountPipeline; used where a
 * writer already holds the pages, and by the test that pins the rule.
 */
export function countVisiblePageStats(pages) {
  const visible = (pages ?? []).filter(isVisiblePage);
  const translatable = visible.filter(isTranslatablePageForCount);
  return {
    total: visible.length,
    with_ocr: visible.filter(hasOcr).length,
    with_translation: visible.filter(isTranslatedPage).length,
    translatable: translatable.length,
    translated_translatable: translatable.filter(hasTranslation).length,
    blank: visible.filter(p => isBlankPage(p) && hasOcr(p)).length,
    archived: visible.filter(isArchivedPage).length,
  };
}

/** The six stored counters, in the order they are documented. */
export const PAGE_COUNTERS = Object.freeze([
  'pages_count', 'pages_ocr', 'pages_translated', 'pages_translatable', 'pages_blank', 'pages_archived',
]);

/** Map an aggregation row (or countVisiblePageStats() result) onto the six stored counters. */
export function pageCountersFromStats(stats) {
  return {
    pages_count: stats?.total ?? 0,
    pages_ocr: stats?.with_ocr ?? 0,
    pages_translated: stats?.with_translation ?? 0,
    pages_translatable: stats?.translatable ?? 0,
    pages_blank: stats?.blank ?? 0,
    pages_archived: stats?.archived ?? 0,
  };
}

/**
 * The counters a NEW book declares at insert, before any page has been processed:
 * every page is pending, so every page is translatable and nothing else has
 * happened yet. Honest, not a guess — the first job or the reconciler recounts it.
 * Used by book creation via makeBookDoc() (#5328).
 */
export function initialPageCounters(n) {
  const pages = Math.max(0, Math.trunc(Number(n) || 0));
  return {
    pages_count: pages,
    pages_ocr: 0,
    pages_translated: 0,
    pages_translatable: pages,
    pages_blank: 0,
    pages_archived: 0,
  };
}

/**
 * THE writer of a book's page counters (#5325, `.claude/docs/page-counts.md`).
 *
 * Recounts the book's visible pages with buildVisiblePageCountPipeline() and
 * `$set`s all six counters together, plus `page_counts_at`. Never a subset, never
 * `$inc`: each private writer that counted its own subset is how two definitions
 * of `pages_ocr` and `pages_blank` came to alternate on live books every two hours.
 *
 * `bookId` is the book's string `id`, the value `pages.book_id` carries. The book
 * is addressed by `id`, never `_id`, which is re-minted on restore.
 *
 * A book with no visible pages is written as zeros — that is its true count.
 * `updated_at` is bumped only when a counter moved, so a no-op recount does not
 * make the catalog sync re-read the book; `page_counts_at` is stamped every time,
 * because it records when the count was last verified, not when it last changed.
 *
 * Does not stamp `ocr.text_free` (recount-page-stats.mjs does, before calling this)
 * and does not write translation flags (the reconciler derives those).
 *
 * @param {import('mongodb').Db} db
 * @param {string} bookId
 * @param {{ reason: string, now?: Date }} opts  `reason` names the caller, for logs.
 * @returns {Promise<{ matched: boolean, reason: string, before: object|null, after: object, changed: string[] }>}
 */
export async function recountBook(db, bookId, { reason, now = new Date() } = {}) {
  if (typeof bookId !== 'string' || bookId === '') throw new Error('recountBook: bookId must be a non-empty string');
  if (typeof reason !== 'string' || reason === '') throw new Error('recountBook: pass { reason } naming the caller');

  const books = db.collection('books');
  const projection = Object.fromEntries(PAGE_COUNTERS.map(c => [c, 1]));
  const book = await books.findOne({ id: bookId }, { projection });
  const [row] = await db.collection('pages').aggregate(buildVisiblePageCountPipeline(bookId)).toArray();
  const after = pageCountersFromStats(row);
  if (!book) return { matched: false, reason, before: null, after, changed: [] };

  const before = Object.fromEntries(PAGE_COUNTERS.map(c => [c, book[c] ?? null]));
  const changed = PAGE_COUNTERS.filter(c => before[c] !== after[c]);
  const $set = { ...after, page_counts_at: now };
  if (changed.length) $set.updated_at = now;
  await books.updateOne({ id: bookId }, { $set });
  return { matched: true, reason, before, after, changed };
}

/**
 * Mongo clause: pages this MODEL has not permanently given up on (#4674).
 *
 * A give-up must not outlive the model that caused it. When we blocked per-page,
 * 959 of the 967 blocked pages had not been retried in over a month — and half of
 * a re-probed sample read cleanly on the first attempt against the current model.
 * They were not unreadable; they were blocked by a transcriber we no longer run.
 *
 * So the block is scoped: a page is out of the queue only while the model that
 * failed it is still the model we would send it to. Point the pipeline at a new
 * model and the whole backlog becomes eligible again, with no sweep to remember
 * to run. Pages blocked before this field existed carry no model and stay
 * blocked — deliberately: re-opening 967 pages is a spend decision, not a
 * migration side effect.
 */
export function notBlockedForModel(model) {
  return {
    $or: [
      { 'ocr.fail_blocked': { $ne: true } },
      { 'ocr.fail_blocked_model': { $nin: [null, model] } },
    ],
  };
}

/** JS twin of notBlockedForModel(), for callers holding the page in memory. */
export function isBlockedForModel(page, model) {
  if (page?.ocr?.fail_blocked !== true) return false;
  const blockedBy = page?.ocr?.fail_blocked_model;
  return blockedBy == null || blockedBy === model;
}

/**
 * Minimum share of the book's translatable pages that must be OCR'd before
 * `is_fully_translated` / `over_90_translated` may be set (#5063).
 */
export const FULL_TRANSLATION_MIN_OCR_COVERAGE = 0.9;

/**
 * The stored translation flags on a `books` document, from its page counters.
 * Single writer of the rule: `scripts/workers/sync-worker.mjs` calls this for
 * every book, every 2 h. Pinned by tests/unit/page-counts.test.ts.
 *
 * THE RULE (#5063): completion AND coverage, not completion alone.
 *
 *   readable   = pages_ocr - pages_blank            (what the translator could read)
 *   whole book = pages_count - pages_blank          (what a reader expects)
 *   is_fully_translated = translated > 0
 *                      && translated >= readable
 *                      && pages_ocr  >= 0.9 * whole book
 *
 * The flag used to be completion only — `translated >= readable`. The
 * denominator was OCR'd pages, so a book whose only OCR was the 25-page preview
 * (envelope mode, `image_download_failed`, `low_ocr_coverage`) had
 * pages_ocr = 25, pages_translated = 25, and read as DONE. On 2026-09-25 that
 * was 2,086 books, 1,369 of them visible (10.4% of every visible book badged
 * fully translated) — De sensu rerum et magia at 23/332, Trithemius' Chronicon
 * Hirsaugiense at 26/350. It is the mirror of #3804: there the NUMERATOR had
 * to exclude what the denominator excludes; here the DENOMINATOR excluded
 * pages that were never read, and the flag said the book was finished.
 *
 * `readable` stays as the completion denominator (it is the canonical one —
 * `src/lib/first-translation/derive.ts`); the coverage clause is what keeps
 * an unread book out. `over_90_translated` gets the same coverage clause.
 *
 * `translation_pct` is a different quantity: it answers "how much of THIS
 * BOOK can I read", so its denominator is the whole book —
 * `pages_translatable` when the book has been recounted (#4442), else
 * `pages_count - pages_blank` — exactly the rule in
 * `src/lib/translation-completeness.ts` and `sync-books-catalog.mjs`, so the
 * stored value agrees with the rendered one. A 4%-read book cannot read 100%.
 * Clamped to 100 for the same reason those two are (the Blue Qur'an's 1000%).
 */
export function computeTranslationMetrics(counts) {
  const pagesCount = Math.max(0, counts?.pages_count ?? 0);
  const pagesOcr = Math.max(0, counts?.pages_ocr ?? 0);
  const pagesTranslated = Math.max(0, counts?.pages_translated ?? 0);
  const pagesBlank = Math.max(0, counts?.pages_blank ?? 0);

  const readable = pagesOcr - pagesBlank;
  const wholeBook = Math.max(0, pagesCount - pagesBlank);
  const coverage = pagesOcr >= FULL_TRANSLATION_MIN_OCR_COVERAGE * wholeBook;

  const is_fully_translated = pagesTranslated > 0 && pagesTranslated >= readable && coverage;
  const over_90_translated = pagesTranslated > 0 && pagesTranslated >= readable * 0.9 && coverage;

  const exact = typeof counts?.pages_translatable === 'number' && counts.pages_translatable >= 0;
  const pctDenominator = exact ? counts.pages_translatable : wholeBook;
  const translation_pct = pctDenominator > 0
    ? Math.min(100, Math.round((pagesTranslated / pctDenominator) * 10000) / 100) // 2 decimal places
    : 0;

  return { translation_pct, is_fully_translated, over_90_translated };
}

/**
 * Rule version for `books.translation_state`. Bump it whenever the rule below
 * changes: sync-worker compares the stored version and re-stamps every book on
 * its next pass, so no backfill script is ever needed (single writer).
 */
export const TRANSLATION_STATE_VERSION = 1;

/** The ladder, lowest first. A book sits on exactly one rung. */
export const TRANSLATION_RUNGS = ['no_pages', 'no_text', 'transcribing', 'transcribed', 'translating', 'readable', 'complete'];

/** Share of translatable pages that makes a book `readable` (the existing 90% bar, not a new one). */
export const READABLE_MIN_TRANSLATED = 0.9;

const ENGLISH_LANGUAGE_TOKENS = new Set(['english', 'en', 'eng']);

/**
 * True iff the edition's own language is English — the FIRST language named in
 * `books.language` ("English and Hebrew" counts, "Latin; English" does not).
 * `books.language` is the EDITION's language, not the source's
 * (.claude/docs/invariants/language-fields.md), which is exactly the question
 * here: can a reader read this edition without a translation? Same tokeniser as
 * the ops spend dashboard (`lang-tally.mjs`), so the two agree on who is English.
 */
export function isEnglishOriginal(language) {
  const first = String(language ?? '').toLowerCase()
    .split(/[;,/&+]| and /)[0]
    .trim()
    .replace(/\s*\(.*\)$/, '');
  return ENGLISH_LANGUAGE_TOKENS.has(first);
}

/**
 * The translation-state ladder for one book (#5284, design:
 * .claude/docs/translation-state.md). ONE rung per book, stored as
 * `books.translation_state` by sync-worker and read by every surface, so "how
 * many books are translated" has one answer instead of seven.
 *
 *   no_pages     pages_count 0, or content_type 'artwork' — out of every denominator
 *   no_text      pages_ocr 0
 *   transcribing pages_ocr < 0.9 · whole      (a preview-only book lands here, #5063)
 *   transcribed  coverage met, nothing translated
 *   translating  coverage met, 0 < translated < 0.9 · translatable
 *   readable     coverage met, translated >= 0.9 · translatable
 *   complete     coverage met, translated >= translatable
 *
 *   whole        = pages_count − pages_blank                 (what a reader expects)
 *   translatable = pages_translatable when stamped (#4442), else whole
 *
 * The fallback denominator is never smaller than the exact one, so an
 * unrecounted book can only read LOWER than it will once recounted — the safe
 * direction. A book with nothing translatable (all plates) and nothing
 * translated is `transcribed`, never `complete`: 0 ≥ 0 is not a finished book.
 *
 * Pure function of the counters. Inputs are returned alongside the rung so a
 * wrong rung can be traced to the number that produced it; `computed_at` is the
 * writer's to add. Mirror: src/lib/page-counts.ts (parity-tested).
 */
export function computeTranslationState(counts, { language, content_type } = {}) {
  const pagesCount = Math.max(0, counts?.pages_count ?? 0);
  const ocr = Math.max(0, counts?.pages_ocr ?? 0);
  const translated = Math.max(0, counts?.pages_translated ?? 0);
  const pagesBlank = Math.max(0, counts?.pages_blank ?? 0);

  const whole = Math.max(0, pagesCount - pagesBlank);
  const exact = typeof counts?.pages_translatable === 'number' && counts.pages_translatable >= 0;
  const translatable = exact ? counts.pages_translatable : whole;
  const coverage = ocr >= FULL_TRANSLATION_MIN_OCR_COVERAGE * whole;

  let rung;
  if (pagesCount === 0 || content_type === 'artwork') rung = 'no_pages';
  else if (ocr === 0) rung = 'no_text';
  else if (!coverage) rung = 'transcribing';
  else if (translated === 0) rung = 'transcribed';
  else if (translated >= translatable) rung = 'complete';
  else if (translated >= READABLE_MIN_TRANSLATED * translatable) rung = 'readable';
  else rung = 'translating';

  return {
    rung,
    english_original: isEnglishOriginal(language),
    translated,
    translatable,
    whole,
    ocr,
    exact,
    version: TRANSLATION_STATE_VERSION,
  };
}

// ── Named views over the ladder (#5286, translation-state.md § Named views) ──
// Every headline count reads one of these BY NAME; never re-type the rule in a
// caller. Mirror: src/lib/page-counts.ts (parity-tested). Both forms read the
// stored `translation_state`, so a book sync-worker has not stamped yet is in
// no view — translationStateStampCoverage() is the read-side check for that.

/** `readable_in_english` rungs for a non-English edition. */
export const READABLE_RUNGS = Object.freeze(['readable', 'complete']);
/** Extra rungs at which an English original is already readable (its text IS English). */
export const ENGLISH_ORIGINAL_READABLE_RUNGS = Object.freeze(['transcribed', 'translating']);

/** `readable_in_english` as a Mongo query filter (spread it beside `visible`/`pages_count`). */
export const READABLE_IN_ENGLISH_FILTER = Object.freeze({
  $or: [
    { 'translation_state.rung': { $in: [...READABLE_RUNGS] } },
    { 'translation_state.english_original': true, 'translation_state.rung': { $in: [...ENGLISH_ORIGINAL_READABLE_RUNGS] } },
  ],
});

/** `readable_in_english` as an aggregation boolean (for `$cond` inside a `$group`). */
export const READABLE_IN_ENGLISH_EXPR = Object.freeze({
  $or: [
    { $in: [{ $ifNull: ['$translation_state.rung', null] }, [...READABLE_RUNGS]] },
    {
      $and: [
        { $eq: ['$translation_state.english_original', true] },
        { $in: [{ $ifNull: ['$translation_state.rung', null] }, [...ENGLISH_ORIGINAL_READABLE_RUNGS]] },
      ],
    },
  ],
});

/** True iff a stored state is in `readable_in_english` (the JS form of the filter above). */
export function isReadableInEnglish(state) {
  if (!state?.rung) return false;
  return READABLE_RUNGS.includes(state.rung) ||
    (state.english_original === true && ENGLISH_ORIGINAL_READABLE_RUNGS.includes(state.rung));
}

/**
 * Share of books matching `filter` that carry a stamped `translation_state`.
 * A view counted before sync-worker has stamped the corpus reads as a collapse
 * (0 on 2026-10-01, the morning step 1 merged), so a headline writer checks
 * this and refuses to publish a view below `min` instead of writing the hole.
 */
export async function translationStateStampCoverage(books, filter, { min = 0.99 } = {}) {
  const [total, stamped] = await Promise.all([
    books.countDocuments(filter),
    books.countDocuments({ ...filter, 'translation_state.rung': { $type: 'string' } }),
  ]);
  const share = total ? stamped / total : 1;
  return { total, stamped, share, ok: share >= min };
}

/**
 * The two values the Supabase `books_catalog` mirror carries (#5288). The stored
 * stamp wins when it is at the current rule version; otherwise the SAME function
 * sync-worker uses is applied to the book's stored counters. That fallback is a
 * mirror of the rule, not a second writer: nothing goes back to Mongo, and
 * whenever the stored counters are current (sync-worker bumps `updated_at` when
 * they are not, which re-syncs the row) it yields the rung sync-worker stamps.
 * The projection must carry the counters, `pages_translatable`, `language`,
 * `content_type` and `translation_state`.
 */
export function catalogTranslationColumns(book) {
  const stored = book?.translation_state;
  const state = stored && stored.version === TRANSLATION_STATE_VERSION && typeof stored.rung === 'string'
    ? stored
    : computeTranslationState(book, { language: book?.language, content_type: book?.content_type });
  return { translation_rung: state.rung, english_original: state.english_original === true };
}
