/**
 * ONE formula for "how translated is this book" (#4505).
 *
 * Before this, five surfaces each computed it their own way — `pages_count`,
 * `pages_count - pages_blank`, an aggregate total, a local `blankAdj` — so the same
 * book showed a different percentage depending on where you looked, and three of the
 * five could exceed 100%.
 *
 * TWO RULES, both from the product decision on #4505:
 *
 *  1. **Never display over 100%.** The value is clamped. A percentage above 100 is
 *     always a bug in the inputs, and it has shipped repeatedly: the Blue Qur'an once
 *     rendered **1000% translated** (60 pages, 54 blank, over a denominator of 6), and
 *     6,228 live books — 32% of the public library — were over 100 at once. Clamping
 *     does not fix the inputs; it stops the reader paying for them.
 *
 *  2. **Blanks and other never-translated leaves are skipped**, on both sides of the
 *     ratio. `pages_translatable` is the denominator: visible pages that have OCR to
 *     translate from and are not a flyleaf, ex-libris, bookplate or digitizer notice.
 *     A book whose every translatable page is done reads 100%, even though a few
 *     leaves in it will never carry text — which is the honest statement about the
 *     work. Measured 2026-08-31: ~10% of live books report complete under the old
 *     denominator; ~50% actually are.
 *
 * The numerator must exclude whatever the denominator excludes, or the ratio exceeds
 * 1 — that is exactly how the 1000% happened. `pages_translated` already excludes
 * blank placeholders (`isTranslatedPage` in page-counts), so the pair is consistent;
 * the clamp is the backstop for records written before that rule, and for the
 * fallback path below.
 */

import { TRANSLATION_RUNGS, type TranslationRung } from './page-counts';

export interface TranslationCountsSource {
  pages_count?: number | null;
  pages_translated?: number | null;
  /** The honest denominator. Absent on records not yet recounted — see fallback. */
  pages_translatable?: number | null;
  pages_blank?: number | null;
}

export interface TranslationCompleteness {
  /** 0–100, integer, never above 100. */
  percent: number;
  /** Pages counted as done. */
  translated: number;
  /** Pages that could ever be translated — the denominator actually used. */
  translatable: number;
  /** True when `pages_translatable` was present; false when the fallback was used. */
  exact: boolean;
}

/**
 * Compute the completeness of one book.
 *
 * Falls back to `pages_count - pages_blank` when `pages_translatable` is absent, which
 * is the best of the old denominators and is what `admin/kdp` already used. The
 * fallback overstates the denominator (it does not exclude ex-libris, bookplates,
 * digitizer notices or pages with no OCR), so it UNDERSTATES completeness — the safe
 * direction, and it never reports a book as more finished than it is.
 */
export function translationCompleteness(book: TranslationCountsSource): TranslationCompleteness {
  const translated = Math.max(0, book.pages_translated ?? 0);

  const exact = typeof book.pages_translatable === 'number' && book.pages_translatable >= 0;
  const denominator = exact
    ? (book.pages_translatable as number)
    : Math.max(0, (book.pages_count ?? 0) - (book.pages_blank ?? 0));

  if (denominator <= 0) {
    // Nothing translatable: a book of plates, or one not yet OCR'd. Neither is "100%
    // translated" — reporting 100 for an empty denominator is how a book with no text
    // at all ends up badged complete.
    return { percent: 0, translated, translatable: 0, exact };
  }

  const raw = (translated / denominator) * 100;
  return {
    percent: Math.min(100, Math.round(raw)),
    translated: Math.min(translated, denominator),
    translatable: denominator,
    exact,
  };
}

/** Convenience for the many call sites that only want the number. */
export function translationPercent(book: TranslationCountsSource): number {
  return translationCompleteness(book).percent;
}

// ── The stored rung (#5287) ─────────────────────────────────────────────────
// Book-level "is this translated" questions read `books.translation_state`, the
// ladder stamped by sync-worker (#5284, `computeTranslationState()` in
// page-counts). Call sites never compute a rung. When the field is absent the
// book is UNSTAMPED, not untranslated: the helpers below return `null` and the
// caller keeps its pre-ladder arithmetic as the fallback. Design and the view
// definitions: .claude/docs/translation-state.md.

/** The slice of `books.translation_state` a reader needs. Project both keys. */
export interface StoredTranslationState {
  rung?: string | null;
  english_original?: boolean | null;
}

export interface TranslationStateSource {
  translation_state?: StoredTranslationState | null;
}

/** Mongo projection for {@link TranslationStateSource}; spread into inclusion projections. */
export const TRANSLATION_STATE_PROJECTION = {
  'translation_state.rung': 1,
  'translation_state.english_original': 1,
} as const;

/** The stamped rung, or `null` when the book is unstamped (or carries an unknown value). */
export function storedRung(book: TranslationStateSource | null | undefined): TranslationRung | null {
  const rung = book?.translation_state?.rung;
  return typeof rung === 'string' && (TRANSLATION_RUNGS as readonly string[]).includes(rung)
    ? (rung as TranslationRung)
    : null;
}

/** `readable` or `complete`: the translation can be read as the book's primary text. */
export function isReadableRung(rung: TranslationRung): boolean {
  return rung === 'readable' || rung === 'complete';
}

/**
 * The `readable_in_english` view for one book: translated to the 90% bar, or an
 * English original that is transcribed. `null` = unstamped.
 */
export function isReadableInEnglish(book: TranslationStateSource | null | undefined): boolean | null {
  const rung = storedRung(book);
  if (rung === null) return null;
  if (isReadableRung(rung)) return true;
  return !!book?.translation_state?.english_original && (rung === 'transcribed' || rung === 'translating');
}

/**
 * The one reader-facing verdict, so a book shows the same label everywhere
 * (decision 2 in the design doc: "Translated" from `readable`, "Complete" only
 * at `complete`):
 *   - `complete`         rung `complete` (100% of translatable pages)
 *   - `translated`       rung `readable` (≥ 90%)
 *   - `english_original` readable as printed — an English edition, transcribed
 *   - `none`             stamped but below the bar: show a percentage, not a verdict
 *   - `null`             unstamped — the caller falls back to its own counters
 */
export type TranslationVerdict = 'complete' | 'translated' | 'english_original' | 'none';

export function translationVerdict(book: TranslationStateSource | null | undefined): TranslationVerdict | null {
  const rung = storedRung(book);
  if (rung === null) return null;
  if (rung === 'complete') return 'complete';
  if (rung === 'readable') return 'translated';
  return isReadableInEnglish(book) ? 'english_original' : 'none';
}
