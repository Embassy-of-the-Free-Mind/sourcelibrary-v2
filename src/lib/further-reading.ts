/**
 * PRIOR ART: `src/lib/first-translation/derive.ts` already owns the readable
 * threshold (`isTranslationReadable` / `FIRST_TRANSLATION_READABLE_MIN`) and is
 * REUSED here rather than re-implemented — this file adds no second threshold.
 * `src/lib/collections-utils.ts` holds title/thumbnail helpers for collection
 * surfaces but nothing about reading lists; `src/lib/page-counts.ts` counts
 * translated PAGES and has no view of a book's overall readiness. Nothing in
 * `src/lib` resolved an authored id list against fetched books before (the
 * collection page inlined that merge for `highlighted_books`), and nothing
 * described a book we hold but cannot yet read.
 *
 * Further reading — books adjacent to a collection, and the works it lacks.
 *
 * WHAT THIS IS FOR
 * ----------------
 * `collections.further_reading` lists books we HOLD that sit next to a
 * collection's claim without belonging to it. Tagging them into `collections`
 * would inflate `book_count`, reorder the works grid, and blur what the
 * collection asserts; a separate band puts them in front of a reader without
 * any of that. Nothing here touches a counter — see
 * `.claude/docs/invariants/visibility-and-stats.md`: a card must count what its
 * target page renders, and `book_count` / `total_book_count` describe
 * MEMBERSHIP, which further reading deliberately is not.
 *
 * THE HONESTY PROBLEM THIS SOLVES
 * -------------------------------
 * Every book in the first `further_reading` list (forum-of-conscience, #4653)
 * has **zero translated pages** and only a sampled transcription — 25 OCR'd
 * pages of 223 is typical. The band therefore has to render a book we hold and
 * cannot yet read WITHOUT implying it is readable.
 *
 * `isTranslationReadable()` alone cannot answer that, and fails in the
 * dangerous direction: its denominator is `pages_ocr − pages_blank`, so a book
 * with 25 OCR'd pages of 223, all 25 translated, scores 100% and reads as
 * "Translated" while 198 pages have never been transcribed. That is exactly the
 * population this band is made of. So {@link furtherReadingStatus} requires the
 * readable verdict AND a complete transcription before it will say "Translated",
 * and otherwise states raw page counts rather than a verdict. The conjunction is
 * strictly more conservative than the existing bar — it is not a competing one.
 */

import { isTranslationReadable, type TranslationCoverageBook } from './first-translation/derive';

/** An authored entry in `collections.further_reading`. */
export interface FurtherReadingRef {
  /** `books.id` — NOT the Mongo `_id` (16,343 books have a re-minted `_id`). */
  book_id: string;
  /** One short clause on why this book is adjacent. Optional. */
  note?: string;
}

/** The minimum a resolved book needs to render in the band. */
export interface FurtherReadingBook extends TranslationCoverageBook {
  id: string;
  slug?: string;
  /** Required so `bookTitle()` can be called without a coercion at each site. */
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  published?: string;
  language?: string;
  thumbnail?: string;
}

export type FurtherReadingEntry = FurtherReadingBook & { note?: string };

/** An entry in `collections.reading_list_gaps` — a work we do NOT hold. */
export interface ReadingListGap {
  /** Curator's running number ("N01"). Display only; may be absent. */
  n?: string;
  /** The work wanted, as the curator named it. */
  want: string;
  /** Manuscript or edition witnesses, free text. */
  witnesses?: string;
}

export type FurtherReadingStatusKind = 'untranslated' | 'partial' | 'translated';

export interface FurtherReadingStatus {
  kind: FurtherReadingStatusKind;
  /** Reader-facing phrase. Never claims readability the data does not support. */
  label: string;
  /** True only when the whole book is transcribed AND readably translated. */
  readable: boolean;
}

/**
 * What we can honestly say about reading this book today.
 *
 * Three states, in order of how much they claim:
 *   - `untranslated` — no translated pages at all. Says so plainly.
 *   - `partial`      — states counts, never a verdict.
 *   - `translated`   — the full book is transcribed and clears the existing
 *                      readable bar (`FIRST_TRANSLATION_READABLE_MIN`, 90%).
 *
 * `pages_ocr >= pages_count` is the transcription condition. Missing page
 * counts are treated as unknown, not as zero — the same rule
 * `translationCoverage` follows — so a book with no `pages_count` is judged on
 * the readable bar alone rather than being demoted on absent data.
 */
export function furtherReadingStatus(book: TranslationCoverageBook): FurtherReadingStatus {
  const translated = book.pages_translated ?? 0;
  if (translated <= 0) {
    return { kind: 'untranslated', label: 'Not yet translated', readable: false };
  }

  const pages = book.pages_count ?? 0;
  const ocr = book.pages_ocr ?? 0;
  const fullyTranscribed = pages <= 0 || ocr >= pages;

  if (fullyTranscribed && isTranslationReadable(book)) {
    return { kind: 'translated', label: 'Translated', readable: true };
  }

  const denominator = pages > 0 ? pages : Math.max(ocr - (book.pages_blank ?? 0), translated);
  return {
    kind: 'partial',
    label: `${translated.toLocaleString('en-US')} of ${denominator.toLocaleString('en-US')} pages translated`,
    readable: false,
  };
}

/**
 * Resolve authored refs against the books actually fetched, preserving the
 * curator's order.
 *
 * A ref whose book is absent from `books` is DROPPED, silently and on purpose:
 * the loader fetches with `visible: true`, so a hidden or removed book cannot
 * reach this list. Authored prose inside a collection document is a takedown
 * surface (`visibility-and-stats.md` — /collections/freemasonry named 13 removed
 * books for six weeks), and the only structural defence is that a resolve which
 * cannot find the book renders nothing rather than a bare id or a dead link.
 */
export function resolveFurtherReading(
  refs: FurtherReadingRef[] | undefined | null,
  books: FurtherReadingBook[],
): FurtherReadingEntry[] {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const byId = new Map(books.map(b => [b.id, b]));
  return refs.flatMap(ref => {
    const book = ref?.book_id ? byId.get(ref.book_id) : undefined;
    if (!book) return [];
    return [{ ...book, note: ref.note }];
  });
}

/** Drop malformed gap rows — `want` is the only field that must be there. */
export function resolveReadingListGaps(
  gaps: ReadingListGap[] | undefined | null,
): ReadingListGap[] {
  if (!Array.isArray(gaps)) return [];
  return gaps.filter(g => g && typeof g.want === 'string' && g.want.trim().length > 0);
}
