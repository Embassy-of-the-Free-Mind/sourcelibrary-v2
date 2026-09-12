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

/**
 * Aggregation pipeline that returns
 * { total, with_ocr, with_translation, translatable, translated_translatable, blank }
 * for the VISIBLE pages of one book. Used by the batch collectors and the recount.
 */
export function buildVisiblePageCountPipeline(bookId) {
  return [
    { $match: { book_id: bookId, ...VISIBLE_PAGE_MATCH } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        with_ocr: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ['$ocr.data', null] },
                { $ne: ['$ocr.data', ''] },
                { $ifNull: ['$ocr.data', false] },
                // Attempted-but-not-legible pages retain `data` for provenance
                // but are not served (#4523) — not counted as OCR'd.
                { $ne: ['$ocr.unreadable', true] },
              ] },
              1, 0,
            ],
          },
        },
        // Mirrors isTranslatedPage(): blank leaves carry a placeholder, not a
        // translation, and must not count here — they are already excluded
        // from the denominator via `pages_blank`.
        with_translation: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ['$translation.data', null] },
                { $ne: ['$translation.data', ''] },
                { $ifNull: ['$translation.data', false] },
                { $ne: [{ $ifNull: ['$page_type', ''] }, 'blank'] },
              ] },
              1, 0,
            ],
          },
        },
        // The honest denominator and ITS matching numerator (#4442). Mirrors
        // isTranslatablePageForCount(). `translatable` is what could ever be
        // translated; `translated_translatable` is how much of that has been —
        // and it is deliberately NOT `with_translation`, because a numerator
        // must exclude whatever its denominator excludes. Getting that wrong is
        // what produced the Blue Qur'an's 1000% above, and a 105.6% reading on
        // Hugh of Santalla while this was being written.
        translatable: {
          $sum: { $cond: [TRANSLATABLE_COND, 1, 0] },
        },
        // Pages that legitimately carry no translation — the `pages_blank` counter.
        // Named for the historical field; the set is every never-translated type that
        // nonetheless has OCR, which is what the translation job has always recorded.
        blank: {
          $sum: {
            $cond: [
              { $and: [
                { $in: [{ $ifNull: ['$page_type', ''] }, NEVER_TRANSLATED_PAGE_TYPES] },
                { $ne: ['$ocr.data', null] },
                { $ne: ['$ocr.data', ''] },
                { $ifNull: ['$ocr.data', false] },
              ] },
              1, 0,
            ],
          },
        },
        translated_translatable: {
          $sum: {
            $cond: [
              { $and: [
                TRANSLATABLE_COND,
                { $ne: ['$translation.data', null] },
                { $ne: ['$translation.data', ''] },
                { $ifNull: ['$translation.data', false] },
              ] },
              1, 0,
            ],
          },
        },
      },
    },
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
    blank: visible.filter(p => NEVER_TRANSLATED_PAGE_TYPES.includes(p?.page_type ?? '') && hasOcr(p)).length,
  };
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
