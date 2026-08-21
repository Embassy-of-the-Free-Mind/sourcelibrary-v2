/**
 * One render decision for every badge surface, whatever fed it (#3726 Tier 3).
 *
 * Card surfaces render from two payloads for the same book: the Supabase
 * `books_catalog` row (a projection) and the Atlas doc (complete). Before this
 * helper, every card passed the legacy `ft_disposition` and let the claim
 * default to `candidate` — so the graded verdict the rebuilt FT system produces
 * never reached a card, and a cross-checked first rendered exactly like a
 * legacy shim.
 *
 * `ftRenderProps` accepts either payload shape and returns the two values
 * `firstTranslationBadge` needs:
 *
 *  - `claim` — 'confirmed' only when the REAL classifier
 *    (`classifyFirstTranslationClaim`) says so; every other state, including
 *    the ones a catalog row cannot express, collapses to 'candidate'. The
 *    collapse direction is the invariant: a payload that cannot prove the
 *    stronger register never gets it (#3686 — assert the payload can answer,
 *    fail toward the weaker claim).
 *  - `disposition` — verdict-mapped when a graded verdict is present
 *    (VERDICT_TO_DISPOSITION), falling back to the legacy disposition
 *    otherwise. In the candidate register the badge ignores disposition, so
 *    the fallback only ever shades labels for confirmed books.
 */

import { classifyFirstTranslationClaim, type ScreenedBook } from './candidate';
import { resolveFirstTranslation } from './derive';
import {
  VERDICT_TO_DISPOSITION,
  type EvidenceStrength,
  type FirstTranslation,
  type FirstTranslationVerdict,
  type OurCompleteness,
} from './types';

/**
 * The loose union of an Atlas doc and a `books_catalog` row. Every field is
 * optional — the helper is honest about absent data by construction.
 */
export interface FtRenderSource {
  // Atlas shapes (preferred when present)
  first_translation?: FirstTranslation | null;
  translation_verification?: { disposition?: string; translations_found?: unknown[] } | null;
  source_language_screen?: { verdict?: string } | null;
  translator_author_screen?: { verdict?: string } | null;
  // Catalog-row projections of the same facts
  ft_verdict?: string | null;
  ft_evidence_strength?: string | null;
  ft_our_completeness?: string | null;
  ft_source_screen?: string | null;
  ft_translator_screen?: string | null;
  ft_disposition?: string | null;
  // Shared render-gate fields
  language?: string | null;
  visible?: boolean;
  pages_translated?: number | null;
  is_first_translation?: boolean;
}

export interface FtRenderProps {
  claim: 'confirmed' | 'candidate';
  disposition: string | undefined;
}

/** Rebuild the minimal ScreenedBook the classifier needs from either payload. */
function toScreenedBook(b: FtRenderSource): ScreenedBook {
  const first_translation: FirstTranslation | null =
    b.first_translation?.verdict
      ? b.first_translation
      : b.ft_verdict
        ? {
            verdict: b.ft_verdict as FirstTranslationVerdict,
            evidence_strength: (b.ft_evidence_strength ?? 'weak') as EvidenceStrength,
            our_completeness: (b.ft_our_completeness ?? 'unknown') as OurCompleteness,
            match_key: 'none',
            resolver: 'tier1_catalog',
          }
        : null;

  const sourceVerdict = b.source_language_screen?.verdict ?? b.ft_source_screen ?? undefined;
  const translatorVerdict =
    b.translator_author_screen?.verdict ?? b.ft_translator_screen ?? undefined;

  return {
    first_translation,
    translation_verification: b.translation_verification ?? undefined,
    language: b.language ?? undefined,
    // Card feeds are visible-only surfaces; an Atlas doc says for itself.
    visible: b.visible ?? true,
    pages_translated: b.pages_translated ?? 0,
    source_language_screen: sourceVerdict
      ? { verdict: sourceVerdict as NonNullable<ScreenedBook['source_language_screen']>['verdict'] }
      : null,
    translator_author_screen: translatorVerdict === 'hold' ? { verdict: 'hold' } : null,
  };
}

export function ftRenderProps(b: FtRenderSource): FtRenderProps {
  const book = toScreenedBook(b);
  const { claim } = classifyFirstTranslationClaim(book);
  const resolved = resolveFirstTranslation(book);
  const disposition =
    (resolved?.verdict ? VERDICT_TO_DISPOSITION[resolved.verdict] : undefined) ??
    b.ft_disposition ??
    b.translation_verification?.disposition ??
    undefined;
  return {
    // Only the earned register asserts; every other state — candidate,
    // defeated, not_applicable, unknown — renders the search statement.
    claim: claim === 'confirmed' ? 'confirmed' : 'candidate',
    disposition,
  };
}
