/**
 * The one rule for "is this book shown as a first English translation?", as a query.
 *
 * PRIOR ART: src/components/book/FirstTranslationEvidence.tsx computes the same gate in JSX for one book
 * (verdict ?? legacy disposition, in FIRST_FAMILY, plus the stored flag and translated pages); it cannot be
 * used as a filter. src/lib/first-translation/derive.ts resolveFirstTranslation adds an evidence gate the
 * page does not apply. This module mirrors the PAGE, because the page is what a reader checks a count against.
 *
 * WHY (#3687, measured 2026-11-11). `books.is_first_translation` has been frozen since the book-grain
 * machinery was retired (#4536, 2026-09-01). The resolver's last run, 2026-08-31 05:30, rewrote 210 verdicts
 * to `not_first`; the reconcile step that would have cleared their flag never ran again. The book page reads
 * the verdict and shows no badge on those books, but search, listings and counts read the flag alone, so 333
 * live books (214 not_first, 101 needs_review, 18 with no first-family evidence) were served as first
 * translations everywhere except their own page. This gate brings every surface to the page's answer. It
 * changes no stored claim: the contested books wait for Translation Card review, as the freeze intends.
 */
import { DISPOSITION_TO_VERDICT, FIRST_FAMILY, type LegacyDisposition } from './types';

/** Graded verdicts that badge as a first. */
export const FIRST_FAMILY_VERDICTS: string[] = [...FIRST_FAMILY];

/** Legacy dispositions whose mapped verdict badges as a first (used only when there is no graded verdict). */
export const FIRST_FAMILY_DISPOSITIONS: string[] = (Object.keys(DISPOSITION_TO_VERDICT) as LegacyDisposition[])
  .filter((d) => FIRST_FAMILY.has(DISPOSITION_TO_VERDICT[d]));

/**
 * Mongo condition: the book page would show the first-translation badge. Visibility is the caller's job.
 * Combine with `withFirstTranslationGate()` rather than spreading, so a caller's own `$or` survives.
 */
export const FIRST_TRANSLATION_GATE = Object.freeze({
  is_first_translation: true,
  pages_translated: { $gt: 0 },
  $or: [
    { 'first_translation.verdict': { $in: FIRST_FAMILY_VERDICTS } },
    { 'first_translation.verdict': { $in: [null] }, 'translation_verification.disposition': { $in: FIRST_FAMILY_DISPOSITIONS } },
  ],
});

/** `match` AND the gate, safe when `match` carries its own `$or`/`$and`. */
export function withFirstTranslationGate<T extends Record<string, unknown>>(match: T): Record<string, unknown> {
  return { $and: [match, FIRST_TRANSLATION_GATE] };
}

/**
 * The same gate for the Supabase `books_catalog` mirror (columns `ft_verdict`, `ft_disposition`, synced by
 * scripts/workers/sync-books-catalog.mjs). Apply with `applyFirstTranslationGateSb(query)`.
 */
export const FIRST_TRANSLATION_GATE_SB_OR =
  `ft_verdict.in.(${FIRST_FAMILY_VERDICTS.join(',')}),` +
  `and(ft_verdict.is.null,ft_disposition.in.(${FIRST_FAMILY_DISPOSITIONS.join(',')}))`;

interface SbFilterable<Q> {
  eq(column: string, value: unknown): Q;
  gt(column: string, value: unknown): Q;
  or(filters: string): Q;
}

export function applyFirstTranslationGateSb<Q extends SbFilterable<Q>>(query: Q): Q {
  return query.eq('is_first_translation', true).gt('pages_translated', 0).or(FIRST_TRANSLATION_GATE_SB_OR);
}

/** The gate for a single in-memory row (catalog row or Mongo doc). */
export function passesFirstTranslationGate(row: {
  is_first_translation?: boolean | null;
  pages_translated?: number | null;
  ft_verdict?: string | null;
  ft_disposition?: string | null;
  first_translation?: { verdict?: string | null } | null;
  translation_verification?: { disposition?: string | null } | null;
}): boolean {
  if (!row.is_first_translation || !((row.pages_translated ?? 0) > 0)) return false;
  const verdict = row.first_translation?.verdict ?? row.ft_verdict ?? null;
  if (verdict) return FIRST_FAMILY_VERDICTS.includes(verdict);
  const disp = row.translation_verification?.disposition ?? row.ft_disposition ?? null;
  return !!disp && FIRST_FAMILY_DISPOSITIONS.includes(disp);
}
