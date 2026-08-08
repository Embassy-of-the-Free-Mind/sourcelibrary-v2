/**
 * Derive a graded verdict from the accumulated attempt ledger (issue #2564 / #2805).
 *
 * The attempt log (`first_translation_attempts`) is the durable, approach-agnostic
 * record of every search ever run for a book. This module turns that pile into a
 * single `book.first_translation` verdict — "verdict = f(accumulated evidence)".
 * It does NOT write the public `is_first_translation` boolean; that stays a
 * derived read materialized only by the sign-off-gated reconcile (derive.ts).
 *
 * Pure over an injected attempts array + the book (the book is needed to run the
 * evidence-quality guard on cited priors), so it is unit-testable without a DB.
 *
 * HARDENED against the real, legacy-backfilled ledger (a spot-check found two
 * failure modes the naive mapping produced):
 *
 *  1. Studies miscounted as translations → FALSE DEMOTES. The legacy backfill
 *     recorded scholarly studies that merely CITE a work (e.g. Needham's
 *     *Science and Civilisation in China* for 武備志) as "found" priors, with a
 *     URL. A bare URL proves a URL exists, not that a *translation* exists. So a
 *     found prior now defeats a first ONLY when it is a TRUSTWORTHY sighting:
 *     non-weak evidence AND (a registry `found_refs` id OR a prior that passes
 *     `evaluatePrior`). All the legacy study/guess rows are `weak` → excluded.
 *
 *  2. `not_applicable` collapsed into absence → FALSE PROMOTES. An agent judging
 *     a book "not an English-translation candidate" was stored as `result:none`
 *     and counted as an absence vote. It is now detected (result, legacy
 *     "not_applicable: …" notes, or the backfill's mid-notes
 *     "status=not_applicable" / "disposition=not_applicable" form) and either
 *     yields a `not_applicable` verdict (from an independent agent/human) or is
 *     excluded from the absence count.
 *
 *  3. Undocumented "none" counted as an absence vote → FALSE PROMOTES. Legacy
 *     rows with `result:none` but NO recorded sources_checked/queries are a
 *     stored opinion, not a search; counting them let two miscoded legacy rows
 *     fake cross-family independence and promote English originals (found in
 *     the 2026-07-02 reconcile dry-run). Absence votes now require recorded
 *     search coverage.
 *
 *  4. Refute-precedence (§17, the 2026-07-02 census: 11 tier-2-SAVED firsts
 *     re-proposed as demotes). A higher-tier refute (agent/human searched and
 *     could not confirm the prior) now forces needs_review instead of letting
 *     older lower-tier "found" rows demote over the conflict.
 *
 *  5. Verdict grading (SoT §6): trustworthy priors that are ALL pre-1900 grade
 *     first_modern (still a badgeable first-family claim), not not_first — the
 *     2026-07-02 diff had 30 pre-1900-only cases wrongly collapsed.
 *
 * The asymmetry is enforced: a DEMOTE needs a trustworthy positive sighting; a
 * PROMOTE needs clean, independent absence with NO prior hint at all. Anything
 * ambiguous (a weak/unconfirmable "found" hint) returns null — change nothing,
 * defer to the existing/legacy state — rather than guess in either direction.
 */

import { attemptFamily } from './prior-evidence';
import {
  strongestAttempt,
  type FirstTranslationAttempt,
} from './attempt-log';
import { evaluatePrior, type BookInput, type CitedPriorInput } from '../ft-prior-guard';
import type {
  FirstTranslation,
  FirstTranslationBook,
  MatchKey,
  Resolver,
} from './types';

/** Map an attempt's method to the resolver tier that should own the verdict. */
function methodToResolver(method: FirstTranslationAttempt['method']): Resolver {
  switch (method) {
    case 'tier2_agent': return 'tier2_agent';
    case 'claude_subagent_verify': return 'tier2_agent';
    case 'human': return 'human';
    case 'tier0_linked': return 'tier0_linked';
    // tier1_catalog and the gemini instruments are all catalog-grounded searches.
    default: return 'tier1_catalog';
  }
}

const MATCH_RANK: Record<MatchKey, number> = { work_id: 3, transliteration: 2, author_title: 1, none: 0 };

function bestMatchKey(attempts: FirstTranslationAttempt[]): MatchKey {
  let best: MatchKey = 'none';
  for (const a of attempts) if (MATCH_RANK[a.match_key] > MATCH_RANK[best]) best = a.match_key;
  return best;
}

function bookInput(book: FirstTranslationBook): BookInput {
  return {
    title: book.title ?? '',
    author: book.author,
    language: book.original_language ?? book.language ?? undefined,
  };
}

function toCited(p: NonNullable<FirstTranslationAttempt['priors']>[number]): CitedPriorInput {
  const c = p.completeness;
  const completeness =
    c === 'complete' || c === 'partial' || c === 'excerpts' || c === 'unknown' ? c : undefined;
  return {
    english_title: p.english_title,
    translator: p.translator,
    pub_year: p.pub_year,
    completeness,
    publisher: p.publisher,
  };
}

/**
 * Does this prior actually DEFEAT a first-translation claim?
 *
 * Two conditions, both of which the model already promised and neither of which
 * the grader was checking.
 *
 * 1. COMPLETENESS. A demote requires a COMPLETE prior. The ft-verify contract
 *    has always said so ("demote survives only if result == confirmed_complete")
 *    but the grader keyed on `result === 'found'` and the priors' YEARS alone,
 *    never their completeness — so an `excerpt` defeated a claim exactly as a
 *    complete edition did. Measured 2026-08-08: of 429 books graded `not_first`,
 *    31 had NO complete prior anywhere and 7 had already lost their badge —
 *    al-Jāḥiẓ's *Kitāb al-Ḥayawān* among them, whose every English rendering is
 *    a fragment and for which no complete translation exists in any catalogue.
 *
 * 2. RELATIONSHIP. `PriorRelationship` is documented in types.ts as the field
 *    that "determines whether the candidate defeats first" — and the grader
 *    hardcoded `same_text`, the value that always defeats, while the ingest
 *    never carried the agent's actual judgement. So a prior verified as
 *    translating a DIFFERENT WITNESS (Kerns 2008 renders Yonge's Middle English,
 *    not the Latin *Secretum secretorum*) or a DIFFERENT WORK was recorded
 *    faithfully and then read as a defeater. Only `same_text` and
 *    `same_work_diff_edition` defeat; `different_source_language` and
 *    `related_distinct_work` explicitly do not, per POLICY 2.
 *
 * An ABSENT relationship keeps the old default (`same_text`), because most
 * historical rows predate the field and silently reversing them would be its own
 * mass rewrite. Absence is not evidence of a non-defeating relationship.
 */
export function priorDefeatsClaim(
  p: NonNullable<FirstTranslationAttempt['priors']>[number],
): boolean {
  const rel = (p as { relationship?: string }).relationship;
  if (rel && rel !== 'same_text' && rel !== 'same_work_diff_edition') return false;
  return /^complete$/i.test(String(p.completeness ?? ''));
}

const NOT_APPLICABLE_RE = /^\s*not[_ ]applicable\b/i;
// Legacy backfills embed the judgment mid-notes ("[legacy_ai] status=not_applicable; …"),
// which the anchored form misses — so an "original English work, FT does not apply"
// row counted as an absence vote and promoted English originals to first_no_prior
// (the Book of Kells / Religio Medici class in the 2026-07-02 reconcile dry-run).
const LEGACY_NA_RE = /\b(?:status|disposition|result)=not[_ ]applicable\b/i;
function isNotApplicable(a: FirstTranslationAttempt): boolean {
  return (
    a.result === 'not_applicable'
    || NOT_APPLICABLE_RE.test(a.notes ?? '')
    || LEGACY_NA_RE.test(a.notes ?? '')
  );
}

/**
 * An absence vote is only evidence when the attempt documents what it searched.
 * A negative claim is exactly as strong as its recorded coverage (the module's
 * first principle) — a legacy row with no sources and no queries is a stored
 * opinion, not a search, and must not count toward first_no_prior independence.
 */
function hasSearchCoverage(a: FirstTranslationAttempt): boolean {
  return (a.sources_checked?.length ?? 0) > 0 || (a.queries?.length ?? 0) > 0;
}

/**
 * "We asked and could not tell" is not "we asked and found nothing" (#3778).
 * The rung-2 skeptic records an unsettleable question as result:'none' (no
 * priors surfaced) with verdict:'uncertain'; counting that row as an absence
 * vote — or letting it refute a found — would turn an unrun check into a
 * confident negative, the single most common way this system lies. Excluding
 * it is strictly conservative: fewer absence votes, fewer refutes.
 */
function isUncertain(a: FirstTranslationAttempt): boolean {
  return a.verdict === 'uncertain';
}

/** A prior is *locatable* when it carries a resolvable http(s) grounding link. */
function hasResolvableUrl(p: NonNullable<FirstTranslationAttempt['priors']>[number]): boolean {
  const u = p.source_url;
  return typeof u === 'string' && /^https?:\/\/\S/i.test(u.trim());
}

/**
 * A found prior counts as a real defeat only when it is a TRUSTWORTHY sighting:
 * non-weak evidence AND a corroborated prior.
 *
 * The `found_refs` pointer is NOT trusted on its own (#3045). It points into
 * `translation_catalogs`, which contained ~302 `source: ft_verification_discovery`
 * rows — unverified, url-less Gemini discovery-pass output, often fabricated (the
 * "Madame Dupin" translation of Reuchlin that nearly triggered a false demote).
 * A bare `found_refs` id is exactly as trustworthy as the row it points at, which
 * a pure function can't resolve — so a `found_refs`-backed defeat requires the
 * attempt to have copied a RESOLVABLE `source_url` off the referenced row (the
 * fabricated discovery rows are url-less, so this excludes them). An agent/human
 * that cited a structured prior directly (no `found_refs`) is trusted the old way:
 * a prior that survives the evidence-quality guard. Legacy study/guess rows are
 * `weak` and excluded upstream either way.
 */
function isTrustworthyFound(a: FirstTranslationAttempt, bi: BookInput): boolean {
  if (a.result !== 'found') return false;
  if (a.evidence_strength === 'weak') return false;
  const priors = a.priors ?? [];
  if (a.found_refs && a.found_refs.length > 0) {
    return priors.some(hasResolvableUrl);
  }
  return priors.some((p) => evaluatePrior(bi, toCited(p)).trustworthy);
}

/**
 * Evidence-family tier for conflict resolution: a refute only outranks a found
 * when it comes from a HIGHER-effort family (the §17 Arithmologia incident —
 * a tier-2 agent failed to confirm the cited prior, yet older catalog "found"
 * rows silently demoted anyway). human > agent > catalog > model_knowledge.
 */
function familyTier(a: FirstTranslationAttempt): number {
  switch (attemptFamily(a)) {
    case 'human': return 3;
    case 'agent': return 2;
    case 'catalog': return 1;
    default: return 0;
  }
}

/** Parse a 4-digit year out of a prior's pub_year (free-text in the ledger). */
function priorYear(p: NonNullable<FirstTranslationAttempt['priors']>[number]): number | null {
  const m = String(p.pub_year ?? '').match(/\b(1[2-9]\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Resolve the accumulated attempts for ONE book into a graded verdict, or null
 * when the pile doesn't justify any verdict (ambiguous → defer, change nothing).
 * Pure — no DB, no clock.
 */
export function deriveVerdictFromAttempts(
  attempts: FirstTranslationAttempt[],
  book: FirstTranslationBook,
): FirstTranslation | null {
  if (attempts.length === 0) return null;
  const bi = bookInput(book);

  // 1) A trustworthy prior sighting → a graded found-verdict. The ONLY path that
  //    can demote — but graded, not collapsed:
  //    - a HIGHER-tier refute (agent/human searched and found nothing) forces
  //      needs_review, never a silent not_first over the conflict (§17);
  //    - priors that are all pre-1900 grade first_modern per the SoT §6 taxonomy
  //      (a badgeable claim), not not_first.
  const trustFound = attempts.filter((a) => isTrustworthyFound(a, bi));
  if (trustFound.length > 0) {
    const strongest = strongestAttempt(trustFound)!;
    const maxFoundTier = Math.max(...trustFound.map(familyTier));
    const refutes = attempts.filter(
      (a) => a.result === 'none' && !isNotApplicable(a) && !isUncertain(a) && hasSearchCoverage(a),
    );
    const maxRefuteTier = refutes.length ? Math.max(...refutes.map(familyTier)) : -1;
    if (maxRefuteTier >= 2 && maxRefuteTier > maxFoundTier) {
      // An agent/human went looking for the cited prior and could not confirm it,
      // and no equally-trustworthy tier re-found it. Conflict → review, not demote.
      return {
        verdict: 'needs_review',
        evidence_strength: 'weak',
        our_completeness: 'unknown',
        match_key: bestMatchKey(trustFound),
        resolver: methodToResolver(strongest.method),
        best_attempt_id: strongest.attempt_id,
      };
    }
    const hasRegistryRef = trustFound.some((a) => (a.found_refs?.length ?? 0) > 0);
    const trustworthyPriors = trustFound
      .flatMap((a) => a.priors ?? [])
      .filter((p) => evaluatePrior(bi, toCited(p)).trustworthy);

    // ONLY priors that actually defeat the claim may grade it. See
    // priorDefeatsClaim: complete, and of a defeating relationship.
    const defeating = trustworthyPriors.filter(priorDefeatsClaim);
    const families = new Set(trustFound.map(attemptFamily)).size;

    // A found sighting with nothing that defeats is NOT a demote. A registry ref
    // still counts (its completeness is unknown by construction, and the
    // registry is the layer that resolved it), so it keeps the old path.
    if (!hasRegistryRef && trustworthyPriors.length > 0 && defeating.length === 0) {
      // Distinguish "we found only fragments" from "we could not tell". The
      // first is a real, badgeable finding — our edition may be the first
      // COMPLETE one. The second is an unrun check and must not read as either.
      const allKnownPartial = trustworthyPriors.every((p) =>
        /^(partial|excerpts?)$/i.test(String(p.completeness ?? '')));
      return {
        verdict: allKnownPartial ? 'first_complete' : 'needs_review',
        evidence_strength: allKnownPartial && families >= 2 ? 'moderate' : 'weak',
        our_completeness: 'unknown',
        match_key: bestMatchKey(trustFound),
        prior_relationship: 'partial',
        prior_refs: strongest.found_refs?.length ? strongest.found_refs : undefined,
        resolver: methodToResolver(strongest.method),
        best_attempt_id: strongest.attempt_id,
      };
    }

    // Grade by the DEFEATING priors' years: registry refs (year unknown) and any
    // post-1900 prior defeat outright; all-parseable-and-pre-1900 → first_modern.
    const years = (defeating.length ? defeating : trustworthyPriors).map(priorYear);
    const allPre1900 =
      !hasRegistryRef && years.length > 0 && years.every((y) => y !== null && y < 1900);
    return {
      verdict: allPre1900 ? 'first_modern' : 'not_first',
      evidence_strength: families >= 2 ? 'strong' : 'moderate',
      our_completeness: 'unknown',
      match_key: bestMatchKey(trustFound),
      prior_relationship: 'same_text',
      prior_refs: strongest.found_refs?.length ? strongest.found_refs : undefined,
      resolver: methodToResolver(strongest.method),
      best_attempt_id: strongest.attempt_id,
    };
  }

  // 2) An independent agent/human judged it not a candidate → not_applicable.
  const naHi = attempts.find(
    (a) => isNotApplicable(a) && (attemptFamily(a) === 'agent' || attemptFamily(a) === 'human'),
  );
  if (naHi) {
    return {
      verdict: 'not_applicable',
      evidence_strength: 'moderate',
      our_completeness: 'unknown',
      match_key: 'none',
      resolver: methodToResolver(naHi.method),
      best_attempt_id: naHi.attempt_id,
    };
  }

  // 3) Any UNconfirmable "found" hint (weak/guard-failing) makes a "first" claim
  //    unsafe — we can't demote (not trustworthy) but mustn't promote over a
  //    possible prior either. Defer: change nothing — UNLESS a higher-effort
  //    family ran a TARGETED refutation. Symmetric §17 refute-precedence: an
  //    agent/human demote-check that went looking for the SPECIFIC cited prior
  //    and reported it non-existent (verdict 'not_found', with recorded search
  //    coverage) refutes the hints when it outranks every hint's family — the
  //    Tier-2 pilot proved Stage-1 priors can be fabricated outright (a
  //    "Letter 82: On Pleasure" the publisher's own TOC disproves). A GENERIC
  //    absence sweep does NOT qualify: it can simply miss a real prior (the
  //    Bacon/Davis case below keeps deferring). Refuted hints fall through to
  //    clean-absence grading.
  const foundHints = attempts.filter((a) => a.result === 'found');
  if (foundHints.length > 0) {
    const targetedRefutes = attempts.filter(
      (a) =>
        a.result === 'none' &&
        a.verdict === 'not_found' &&
        !isNotApplicable(a) &&
        hasSearchCoverage(a),
    );
    const maxHintTier = Math.max(...foundHints.map(familyTier));
    const maxRefuteTier = targetedRefutes.length
      ? Math.max(...targetedRefutes.map(familyTier))
      : -1;
    if (!(maxRefuteTier >= 2 && maxRefuteTier > maxHintTier)) return null;
  }

  // 4) Clean absence only. Count independent FAMILIES (not raw methods);
  //    exclude not_applicable rows (not absence votes) and rows with no recorded
  //    search coverage (an undocumented "none" is not evidence of absence).
  const absences = attempts.filter(
    (a) => a.result === 'none' && !isNotApplicable(a) && !isUncertain(a) && hasSearchCoverage(a),
  );
  if (absences.length === 0) return null;
  const families = new Set(absences.map(attemptFamily)).size;
  const strongest = strongestAttempt(absences)!;
  const ownerMethod =
    absences.find((a) => attemptFamily(a) === 'agent')?.method ??
    absences.find((a) => attemptFamily(a) === 'human')?.method ??
    strongest.method;
  return {
    verdict: 'first_no_prior',
    // Independence by family. Never 'strong' from absence here.
    evidence_strength: families >= 2 ? 'moderate' : 'weak',
    our_completeness: 'unknown',
    match_key: bestMatchKey(absences),
    resolver: methodToResolver(ownerMethod),
    best_attempt_id: strongest.attempt_id,
  };
}
