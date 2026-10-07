/**
 * Canonical page-count convention (issue #3293) — TS twin of
 * scripts/lib/page-counts.mjs. Keep the two in lock-step:
 * tests/integration/page-counts-parity.test.ts runs both twins' pipelines against
 * the same edge pages and fails if they disagree with each other or with the
 * .mjs JS predicates.
 *
 * `books.pages_count` / `pages_ocr` / `pages_translated` are VISIBLE-only:
 * they count pages with `page_number > 0`. Pages with `page_number <= 0` are
 * a deliberate soft-hide — they never render in the reader — so counting them
 * corrupts the read path (which divides by `pages_count` for readability
 * gates).
 *
 * The six counters have ONE writer: recountBook() below (and its .mjs twin).
 * Design and the writer inventory: .claude/docs/page-counts.md.
 */

import type { Db, Document } from 'mongodb';

/** Match fragment selecting only visible (renderable) pages. */
export const VISIBLE_PAGE_MATCH = { page_number: { $gt: 0 } } as const;

/**
 * Page types that will never carry a translation. Mirror of the .mjs list.
 *
 * `digitizer-insert` added #4685/#4507: 10/10 sampled digitizer-insert pages were
 * scanning-service boilerplate (Google/IA/ProQuest cover sheets), never book content.
 */
export const NEVER_TRANSLATED_PAGE_TYPES = ['blank', 'exlibris', 'bookplate', 'digitizer-notice', 'digitizer-insert'];

/**
 * Shared by the `translatable` denominator and its numerator, so they cannot drift.
 *
 * The illustration guard (#4685) reads the stamped `ocr.text_free` boolean rather than
 * re-deriving it: Mongo cannot exactly strip `<image-desc>…</image-desc>`-style blocks
 * and measure what remains. `ocr.text_free` is computed exactly, in JS, by
 * `isTextFreeIllustration` in scripts/lib/page-counts.mjs (the tag-stripping regex has
 * no TS twin — it only ever runs against pages already fetched into memory) and stamped
 * by recount-page-stats.mjs immediately before this pipeline runs. A page whose stamp
 * is missing reads as `false` and stays IN the denominator — "pending, not proven
 * empty," the same default every other unclassified page already gets.
 */
const TRANSLATABLE_COND = {
  $and: [
    // No `ocr.data` requirement: a page awaiting OCR is PENDING work, not impossible
    // work, and excluding it badges half-OCR'd books as 100% translated. Mirror of the
    // .mjs rule — keep the two in step.
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
    // A page the OCR model permanently gave up on (#4674). This twin lacked the
    // clause until the parity test (#5325) put both twins on the same fixture.
    { $ne: ['$ocr.fail_blocked', true] },
  ],
};

/** Mongo twin of `typeof field === 'string' && field !== ''`. */
const nonEmptyString = (field: string) => ({
  $and: [
    { $eq: [{ $type: field }, 'string'] },
    { $gt: [{ $strLenCP: field }, 0] },
  ],
});

/** Attempted-but-not-legible pages keep `data` for provenance but are not served (#4523). */
const HAS_OCR_COND = { $and: [nonEmptyString('$ocr.data'), { $ne: ['$ocr.unreadable', true] }] };
const HAS_TRANSLATION_COND = nonEmptyString('$translation.data');
const IS_BLANK_COND = { $eq: [{ $ifNull: ['$page_type', ''] }, 'blank'] };

/**
 * The `$group` body for every page-count aggregation. Mirror of the .mjs
 * PAGE_COUNT_ACCUMULATORS — see that file for the counter ↔ predicate table.
 *
 * `blank` is `page_type: 'blank'` only (design decision 3): it is subtracted from
 * the denominator `with_translation` is divided by, so the two exclude the same set
 * (#3747). The other never-translated types leave through `translatable`.
 */
export const PAGE_COUNT_ACCUMULATORS: Readonly<Document> = Object.freeze({
  total: { $sum: 1 },
  with_ocr: { $sum: { $cond: [HAS_OCR_COND, 1, 0] } },
  // Blank leaves carry the placeholder "[Blank page — no translatable content]",
  // not a translation; counting them pushed `translation_pct` over 100 on 6,228
  // live books.
  with_translation: {
    $sum: { $cond: [{ $and: [HAS_TRANSLATION_COND, { $not: [IS_BLANK_COND] }] }, 1, 0] },
  },
  // The honest denominator for translation completeness (#4442) and its numerator.
  translatable: { $sum: { $cond: [TRANSLATABLE_COND, 1, 0] } },
  translated_translatable: {
    $sum: { $cond: [{ $and: [TRANSLATABLE_COND, HAS_TRANSLATION_COND] }, 1, 0] },
  },
  blank: { $sum: { $cond: [{ $and: [IS_BLANK_COND, HAS_OCR_COND] }, 1, 0] } },
  // Any non-empty archived_photo, `failed:*` included — the reconciler's rule.
  archived: { $sum: { $cond: [nonEmptyString('$archived_photo'), 1, 0] } },
});

/** One row of either pipeline. */
export interface PageCountStats {
  total: number;
  with_ocr: number;
  with_translation: number;
  translatable: number;
  translated_translatable: number;
  blank: number;
  archived: number;
}

/**
 * Aggregation pipeline returning PageCountStats for the VISIBLE pages of one book.
 * Mirror of the .mjs implementation.
 */
export function buildVisiblePageCountPipeline(bookId: string): Document[] {
  return [
    { $match: { book_id: bookId, ...VISIBLE_PAGE_MATCH } },
    { $group: { _id: null, ...PAGE_COUNT_ACCUMULATORS } },
  ];
}

/** The same counts for every book at once, grouped by `book_id`. For the reconciler. */
export function buildCorpusPageCountPipeline(): Document[] {
  return [
    { $match: { ...VISIBLE_PAGE_MATCH } },
    { $group: { _id: '$book_id', ...PAGE_COUNT_ACCUMULATORS } },
  ];
}

/** The six stored counters. */
export const PAGE_COUNTERS = [
  'pages_count', 'pages_ocr', 'pages_translated', 'pages_translatable', 'pages_blank', 'pages_archived',
] as const;

export type PageCounter = (typeof PAGE_COUNTERS)[number];
export type PageCounters = Record<PageCounter, number>;

/** Map a pipeline row onto the six stored counters. */
export function pageCountersFromStats(stats: Partial<PageCountStats> | null | undefined): PageCounters {
  return {
    pages_count: stats?.total ?? 0,
    pages_ocr: stats?.with_ocr ?? 0,
    pages_translated: stats?.with_translation ?? 0,
    pages_translatable: stats?.translatable ?? 0,
    pages_blank: stats?.blank ?? 0,
    pages_archived: stats?.archived ?? 0,
  };
}

/** The counters a NEW book declares at insert: every page pending, so every page translatable. */
export function initialPageCounters(n: number): PageCounters {
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

export interface RecountResult {
  matched: boolean;
  reason: string;
  before: Record<PageCounter, number | null> | null;
  after: PageCounters;
  changed: PageCounter[];
}

/**
 * THE writer of a book's page counters. Mirror of the .mjs recountBook(): recounts
 * the book's visible pages and `$set`s all six counters plus `page_counts_at`;
 * never a subset, never `$inc`. `bookId` is the book's string `id` (what
 * `pages.book_id` carries), never `_id`. `updated_at` moves only when a counter did.
 */
export async function recountBook(
  db: Db,
  bookId: string,
  { reason, now = new Date() }: { reason: string; now?: Date },
): Promise<RecountResult> {
  if (typeof bookId !== 'string' || bookId === '') throw new Error('recountBook: bookId must be a non-empty string');
  if (typeof reason !== 'string' || reason === '') throw new Error('recountBook: pass { reason } naming the caller');

  const books = db.collection('books');
  const projection = Object.fromEntries(PAGE_COUNTERS.map(c => [c, 1]));
  const book = await books.findOne({ id: bookId }, { projection });
  const [row] = await db.collection('pages').aggregate<PageCountStats>(buildVisiblePageCountPipeline(bookId)).toArray();
  const after = pageCountersFromStats(row);
  if (!book) return { matched: false, reason, before: null, after, changed: [] };

  const before = Object.fromEntries(PAGE_COUNTERS.map(c => [c, book[c] ?? null])) as Record<PageCounter, number | null>;
  const changed = PAGE_COUNTERS.filter(c => before[c] !== after[c]);
  const $set: Document = { ...after, page_counts_at: now };
  if (changed.length) $set.updated_at = now;
  await books.updateOne({ id: bookId }, { $set });
  return { matched: true, reason, before, after, changed };
}

// ── Translation state (#5284) ──────────────────────────────────────────────
// TS twin of computeTranslationState() in scripts/lib/page-counts.mjs; the
// rule, its reasons and the ladder table live there and in
// .claude/docs/translation-state.md. Keep the two in lock-step:
// tests/unit/page-counts.test.ts imports BOTH over one fixture table.

/** Rule version; a bump makes sync-worker re-stamp every book. Mirror of the .mjs constant. */
export const TRANSLATION_STATE_VERSION = 1;

export const TRANSLATION_RUNGS = ['no_pages', 'no_text', 'transcribing', 'transcribed', 'translating', 'readable', 'complete'] as const;
export type TranslationRung = (typeof TRANSLATION_RUNGS)[number];

/** Minimum OCR'd share of the whole book before any rung above `transcribing` (#5063). */
export const FULL_TRANSLATION_MIN_OCR_COVERAGE = 0.9;
/** Share of translatable pages that makes a book `readable`. */
export const READABLE_MIN_TRANSLATED = 0.9;

/** Stored shape of `books.translation_state` (written only by sync-worker). */
export interface TranslationState {
  rung: TranslationRung;
  english_original: boolean;
  translated: number;
  translatable: number;
  whole: number;
  ocr: number;
  /** `pages_translatable` was present; false means the `whole` fallback was used. */
  exact: boolean;
  version: number;
  computed_at?: Date;
}

export interface TranslationStateCounts {
  pages_count?: number | null;
  pages_ocr?: number | null;
  pages_translated?: number | null;
  pages_blank?: number | null;
  pages_translatable?: number | null;
}

const ENGLISH_LANGUAGE_TOKENS = new Set(['english', 'en', 'eng']);

/** True iff the FIRST language named in `books.language` (the edition's language) is English. */
export function isEnglishOriginal(language: unknown): boolean {
  const first = String(language ?? '').toLowerCase()
    .split(/[;,/&+]| and /)[0]
    .trim()
    .replace(/\s*\(.*\)$/, '');
  return ENGLISH_LANGUAGE_TOKENS.has(first);
}

export function computeTranslationState(
  counts: TranslationStateCounts | null | undefined,
  { language, content_type }: { language?: unknown; content_type?: unknown } = {},
): Omit<TranslationState, 'computed_at'> {
  const pagesCount = Math.max(0, counts?.pages_count ?? 0);
  const ocr = Math.max(0, counts?.pages_ocr ?? 0);
  const translated = Math.max(0, counts?.pages_translated ?? 0);
  const pagesBlank = Math.max(0, counts?.pages_blank ?? 0);

  const whole = Math.max(0, pagesCount - pagesBlank);
  const pt = counts?.pages_translatable;
  const exact = typeof pt === 'number' && pt >= 0;
  const translatable = exact ? pt : whole;
  const coverage = ocr >= FULL_TRANSLATION_MIN_OCR_COVERAGE * whole;

  let rung: TranslationRung;
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
// TS twin of the block at the end of scripts/lib/page-counts.mjs. Every
// headline count reads one of these BY NAME; never re-type the rule in a caller.

/** `readable_in_english` rungs for a non-English edition. */
export const READABLE_RUNGS: readonly TranslationRung[] = ['readable', 'complete'];
/** Extra rungs at which an English original is already readable (its text IS English). */
export const ENGLISH_ORIGINAL_READABLE_RUNGS: readonly TranslationRung[] = ['transcribed', 'translating'];

/** `readable_in_english` as a Mongo query filter (spread it beside `visible`/`pages_count`). */
export const READABLE_IN_ENGLISH_FILTER: Readonly<Document> = Object.freeze({
  $or: [
    { 'translation_state.rung': { $in: [...READABLE_RUNGS] } },
    { 'translation_state.english_original': true, 'translation_state.rung': { $in: [...ENGLISH_ORIGINAL_READABLE_RUNGS] } },
  ],
});

/** `readable_in_english` as an aggregation boolean (for `$cond` inside a `$group`). */
export const READABLE_IN_ENGLISH_EXPR: Readonly<Document> = Object.freeze({
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
export function isReadableInEnglish(
  state: Pick<TranslationState, 'rung' | 'english_original'> | null | undefined,
): boolean {
  if (!state?.rung) return false;
  return READABLE_RUNGS.includes(state.rung) ||
    (state.english_original === true && ENGLISH_ORIGINAL_READABLE_RUNGS.includes(state.rung));
}
