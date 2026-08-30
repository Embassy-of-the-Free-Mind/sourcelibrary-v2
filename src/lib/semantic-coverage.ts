import { supabase } from '@/lib/supabase';

/**
 * Can semantic search actually see this book?
 *
 * ## Why this exists
 *
 * Page vectors live in Supabase `page_translations` and are written by
 * `scripts/workers/embed-gemini.mjs`. When a book has no rows there, the
 * semantic leg returns an empty array — which is indistinguishable, from the
 * caller's side, from "nothing in this book matches your meaning".
 *
 * That is not a hypothetical. Measured 2026-08-07 over 150 sampled visible books
 * with >20 translated pages: **53% fully embedded, 22% under a quarter, 23% with
 * zero rows.** Two of the volumes a reader spent a day searching were among the
 * blind ones — Taylor's 1801 *Metaphysics* at 10 of 520 pages, the 1551 Aldine
 * at 10 of 708. Their conclusion was that the corpus was thin on exactly the
 * passages they wanted. The corpus was fine; the vectors were missing.
 *
 * The reader's own framing of the cost, from a separate report:
 *
 *   > "I can't tell a user a quote is absent from Aristotle, because I can't
 *   > know what fraction of Aristotle exists here in a searchable language.
 *   > Every negative had to be hedged."
 *
 * ## Why a caveat and not an error
 *
 * Throwing would be wrong. The keyword results on an unembedded book are
 * perfectly good and are usually what the caller wanted; failing the whole
 * request because one leg is blind would turn a partial answer into no answer.
 * What the caller needs is to know that a semantic BLANK is not evidence of
 * absence — so this is reported alongside the results, and only when it matters.
 */

export type CoverageStatus = 'full' | 'partial' | 'none' | 'unknown';

export interface SemanticCoverage {
  status: CoverageStatus;
  embedded_pages: number;
  translated_pages: number;
  /** Present when the caller must not read an empty semantic result as absence. */
  caveat?: string;
}

const CAVEAT_NONE =
  'This book has no page embeddings yet, so conceptual/paraphrase matching could not run on it. '
  + 'The keyword results are complete, but the ABSENCE of a semantic hit here is not evidence the '
  + 'passage is missing — do not tell the user the text does not contain it. Try distinctive literal '
  + 'terms from the period translation, or search_concept across the whole corpus.';

const CAVEAT_PARTIAL =
  'Only part of this book has page embeddings, so conceptual/paraphrase matching saw a fraction of '
  + 'it. Treat a missing semantic hit as inconclusive rather than as absence.';

/**
 * Count this book's page vectors. Returns `unknown` rather than throwing — a
 * coverage lookup must never be able to fail a search that already has results.
 */
export async function semanticCoverage(
  bookId: string,
  translatedPages: number,
): Promise<SemanticCoverage> {
  let embedded = 0;
  try {
    const { count, error } = await supabase
      .from('page_translations')
      .select('*', { count: 'exact', head: true })
      .eq('book_id', bookId);
    if (error) return { status: 'unknown', embedded_pages: 0, translated_pages: translatedPages };
    embedded = count ?? 0;
  } catch {
    return { status: 'unknown', embedded_pages: 0, translated_pages: translatedPages };
  }

  if (embedded === 0) {
    return { status: 'none', embedded_pages: 0, translated_pages: translatedPages, caveat: CAVEAT_NONE };
  }
  // A book can carry slightly more vectors than Mongo reports translated pages
  // (untranslated originals get an OCR-derived vector), so compare generously.
  if (translatedPages > 0 && embedded < translatedPages * 0.9) {
    return { status: 'partial', embedded_pages: embedded, translated_pages: translatedPages, caveat: CAVEAT_PARTIAL };
  }
  return { status: 'full', embedded_pages: embedded, translated_pages: translatedPages };
}
