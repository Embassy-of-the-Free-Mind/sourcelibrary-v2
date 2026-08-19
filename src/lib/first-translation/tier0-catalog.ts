/**
 * Tier 0 — deterministic catalog / work_id match (issue #2780).
 *
 * The free, deterministic front of the effort cascade specified in resolve.ts
 * but never implemented: before spending a single model call, ask "do we ALREADY
 * hold a checkable prior English translation of THIS text?" by matching the book
 * against our own `translation_catalogs` registry (UNESCO, LoC, Loeb, the
 * harvested census priors, …) and the `work_id` cluster.
 *
 * Why this matters (Derek, 2026-06-27): the badge-setting cron only ever queried
 * Open Library / Google Books / Internet Archive — never our own registry — so
 * 358 books are badged "first" while we hold a checkable contradicting prior.
 * Tier 0 is the step that closes that gap, for free, on every book.
 *
 * The asymmetry (principle #1) is wired in:
 *  - a FOUND prior is decisive ONLY when it survives the evidence-quality guard
 *    (same source-language, complete, not anthology/self-match, person-
 *    disambiguated). Then: verdict not_first, strong, TERMINAL — done, no spend.
 *  - a catalog MISS is weak absence ("effectively unsearched" — our catalog is
 *    incomplete), so it never terminates: it escalates to the paid tiers.
 *
 * I/O is injected (a `CatalogLookup`), keeping this module pure and unit-testable
 * and keeping the Mongo query in the caller — exactly the resolve.ts contract.
 */
import type { Tier, ResolvableBook } from './resolve';
import type { FirstTranslationAttempt, PriorTranslation } from './attempt-log';
import { makeAttemptId } from './attempt-log';
import type { FirstTranslation, MatchKey } from './types';
import { evaluatePrior, type CitedPriorInput } from '../ft-prior-guard';
import { canonicalLanguage } from './source-language-match';

/** A candidate prior row as returned from `translation_catalogs`. */
export interface CatalogPrior {
  english_title?: string;
  translator?: string;
  pub_year?: string;
  /** 'complete' | 'partial' | 'excerpts' | 'unknown' */
  completeness?: string;
  /** Source language of the translated text (catalog stores ISO or name). */
  source_language?: string;
  /** Grounding link — a prior is only checkable with one. */
  source_url?: string;
  publisher?: string;
  series?: string;
  /** Which catalog the row came from (unesco_master, loeb, …). */
  source?: string;
  /** How the lookup matched this row to the book. */
  matched_by?: 'work_id' | 'author_title';
}

/** Injected I/O: given a book, return candidate priors from the registry. */
export type CatalogLookup = (book: ResolvableBook) => Promise<CatalogPrior[]>;

/**
 * Normalize a language label (ISO code, MARC code, or display name) to a
 * canonical comparison key, or '' when unknown.
 *
 * Delegates to the SHARED source-language-match table so BOTH sides of the
 * guard normalize identically (#3460/#3785): `translation_catalogs` stores ISO
 * buckets ('la', 'grc', 'fa' — see translation-catalog-record.mjs), books
 * store names ('Latin') — the private one-sided map this replaced silently
 * never matched the buckets outside its ten entries, and compared unmapped raw
 * strings as if they were languages. '' means UNKNOWN, and the caller must
 * never read unknown as mismatch.
 *
 * A compound like "latin-german" keys on its first segment, matching the
 * toSourceIso() convention: the leading language is the one translated from.
 */
export function langKey(l?: string | null): string {
  if (!l) return '';
  const direct = canonicalLanguage(l);
  if (direct) return direct;
  const first = String(l).split(/[-/;,]/)[0].trim();
  return (first && canonicalLanguage(first)) || '';
}

function toCited(p: CatalogPrior): CitedPriorInput {
  const c = p.completeness;
  return {
    english_title: p.english_title,
    translator: p.translator,
    pub_year: p.pub_year,
    completeness:
      c === 'complete' || c === 'partial' || c === 'excerpts' || c === 'unknown' ? c : undefined,
    publisher: p.publisher,
    series: p.series,
  };
}

function toPrior(p: CatalogPrior): PriorTranslation {
  return {
    english_title: p.english_title,
    translator: p.translator,
    pub_year: p.pub_year,
    publisher: p.publisher,
    completeness: p.completeness,
    source_url: p.source_url,
  };
}

/** Is this catalog row a trustworthy, decisive defeat of a first-translation claim? */
export function isDecisivePrior(book: ResolvableBook, p: CatalogPrior): boolean {
  const bookLang = langKey(book.original_language ?? book.language);
  const priorLang = langKey(p.source_language);
  // Same source-language: a Greek→En translation does NOT defeat a Latin→En first.
  // Both sides pass through the SAME normalizer, and UNKNOWN never reads as
  // MISMATCH (#3460 discipline): block only when both sides RESOLVE to a known
  // language and disagree. If either side is unknown we don't block on it, but
  // completeness + the evidence-quality guard still apply.
  const sameLang = !priorLang || !bookLang || priorLang === bookLang;
  // Only a COMPLETE prior defeats a first; partial/excerpt/unknown does not.
  const complete = p.completeness === 'complete';
  // Evidence-quality guard (#2579): not an anthology / self-match / namesake.
  const guard = evaluatePrior(
    { title: book.title ?? '', author: book.author, language: book.original_language ?? book.language ?? undefined },
    toCited(p),
  ).trustworthy;
  return sameLang && complete && guard;
}

/**
 * Build the Tier-0 catalog matcher. `lookup` supplies candidate priors (the I/O);
 * this function owns only the deterministic decision.
 */
export function makeTier0Catalog(lookup: CatalogLookup): Tier {
  return async (book, ctx) => {
    const bookId = book.id ?? String(book._id ?? 'unknown');
    const date = ctx.now;
    const candidates = await lookup(book);
    const defeats = candidates.filter((p) => isDecisivePrior(book, p));

    if (defeats.length > 0) {
      const matchKey: MatchKey = defeats.some((p) => p.matched_by === 'work_id') ? 'work_id' : 'author_title';
      const sources = [...new Set(['translation_catalogs', ...defeats.map((p) => p.source).filter(Boolean) as string[]])];
      const attempt: FirstTranslationAttempt = {
        attempt_id: makeAttemptId(bookId, 'tier0_linked', date),
        book_id: bookId,
        work_id: book.work_id ?? null,
        date,
        method: 'tier0_linked',
        match_key: matchKey,
        sources_checked: sources,
        queries: [],
        result: 'found',
        priors: defeats.map(toPrior),
        evidence_strength: 'strong', // a checkable, complete, same-language prior is decisive
        independence_score: 0.5, // registry match — deterministic, but a single catalog family
        model: 'deterministic-catalog',
        notes: `Tier-0 catalog match (${matchKey}): ${defeats.length} complete same-language prior(s) in ${sources.join(', ')}.`,
      };
      const verdict: FirstTranslation = {
        verdict: 'not_first',
        evidence_strength: 'strong',
        our_completeness: 'unknown',
        match_key: matchKey,
        prior_relationship: 'same_text',
        resolver: 'tier0_linked',
        resolved_at: date,
      };
      return { verdict, attempt, terminal: true };
    }

    // No decisive prior. The registry is incomplete, so a miss is WEAK absence —
    // never terminal; escalate to the paid tiers. We still log the attempt so the
    // search coverage accumulates (and so a later identical run can see it ran).
    const attempt: FirstTranslationAttempt = {
      attempt_id: makeAttemptId(bookId, 'tier0_linked', date),
      book_id: bookId,
      work_id: book.work_id ?? null,
      date,
      method: 'tier0_linked',
      match_key: 'none',
      sources_checked: ['translation_catalogs'],
      queries: [],
      result: 'none',
      priors: [],
      evidence_strength: 'weak',
      independence_score: 0.5,
      model: 'deterministic-catalog',
      notes: candidates.length
        ? `${candidates.length} catalog candidate(s) but none complete + same-language + guard-passing.`
        : 'No matching row in translation_catalogs.',
    };
    return { verdict: null, attempt, terminal: false };
  };
}
