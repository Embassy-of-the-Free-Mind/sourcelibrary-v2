/**
 * Rung-2 grounded skeptic — the CONTRACT layer (#3778).
 *
 * The escalation ladder's cheap tier: a Google-Search-grounded Gemini call that
 * tries to REFUTE the position under test. This module is pure (prompt assembly
 * + response parsing/normalization); the API call and all I/O live in the
 * driver (`scripts/eval/ft-ladder.ts`), so the contract is unit-testable.
 *
 * The invariants this layer enforces mechanically, because every one was
 * violated by an earlier instrument:
 *
 *  1. LEGAL ENUMS ONLY. `ft-search-unexamined.mjs` wrote `result:'not_found'`
 *     and `match_key:'work_search'` — both off-enum, so every absence it logged
 *     was invisible to `deriveVerdictFromAttempts` and its rank lookups did NaN
 *     comparisons. The normalizer here can only emit legal values.
 *  2. UNCERTAIN IS NOT ABSENCE. "We asked and could not tell" must never count
 *     as an absence vote. Uncertain rows keep `verdict:'uncertain'`, which the
 *     derive step excludes from absence/refute counting.
 *  3. YEAR IS LOAD-BEARING. A prior without a parseable year cannot be graded
 *     (the first_modern rule turns on it), so its attempt is clamped to
 *     `weak` — below the trust gate — and flagged for escalation.
 *  4. A SINGLE INSTRUMENT IS NEVER 'strong'. Evidence strength is computed
 *     here from what the search documented, capped at `moderate`. Independence
 *     comes from families, not from one model's self-confidence.
 *  5. CATALOG-TIER TRUST. The method is always `gemini_grounded_search`, which
 *     `methodToResolver` maps to `tier1_catalog` — a resolver the nightly
 *     reconcile valve (`--resolver=tier2_agent,human`) does not admit. Rung-2
 *     output can therefore never move a public badge on its own (#3776:
 *     ingest is actuation — this is the structural guarantee, pinned by
 *     tests/unit/ft-skeptic.test.ts).
 */

import type { FirstTranslationAttempt, PriorTranslation } from './attempt-log';
import type { PriorRelationship } from './types';

export const SKEPTIC_PROMPT_VERSION = 'ft-ladder-skeptic/v1-2026-08-08';

/** The model's response contract. Kept in sync with the prompt below. */
export interface SkepticResponse {
  result: 'complete_prior_found' | 'only_partial_exists' | 'none_found' | 'not_applicable' | 'uncertain';
  priors: Array<{
    translator?: string;
    year?: number | string;
    english_title?: string;
    completeness?: string;
    relationship?: string;
    source_url?: string;
    publisher?: string;
  }>;
  queries_run: string[];
  sources_consulted: Array<{ url?: string; found?: string }>;
  scope_flags?: { container?: boolean; witness?: boolean };
  reasoning?: string;
}

export interface SkepticDirection {
  /**
   * 'refute_first'  — the book is badged/claimed first; try to FIND a prior.
   * 'verify_prior'  — a prior has been claimed; verify it is real and complete.
   */
  kind: 'refute_first' | 'verify_prior';
  /** For verify_prior: the claimed priors under test. */
  claimedPriors?: PriorTranslation[];
}

const RESULT_VALUES = new Set([
  'complete_prior_found', 'only_partial_exists', 'none_found', 'not_applicable', 'uncertain',
]);

const LEGAL_RELATIONSHIPS = new Set<PriorRelationship>([
  'same_text', 'same_work_diff_edition', 'different_source_language',
  'related_distinct_work', 'partial', 'adaptation',
]);

export interface SkepticBook {
  id: string;
  title?: string;
  author?: string;
  language?: string | null;
  original_language?: string | null;
  work_id?: string | null;
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

function describeClaimed(priors: PriorTranslation[]): string {
  return priors
    .map((p) => `- "${p.english_title ?? '?'}" — ${p.translator ?? 'NO TRANSLATOR NAMED'}, ${p.pub_year ?? 'NO YEAR'} (${p.completeness ?? 'completeness unknown'})`)
    .join('\n');
}

export function buildSkepticPrompt(
  book: SkepticBook,
  rubric: string,
  direction: SkepticDirection,
): string {
  const lang = book.original_language ?? book.language ?? 'unknown';
  const mission =
    direction.kind === 'verify_prior'
      ? `Stage 1 claims a PRIOR English translation of this work exists. BE SKEPTICAL — AI invents plausible translators and years. Verify whether EACH claimed prior below actually exists, and whether it is COMPLETE or only partial/excerpt, by locating the actual edition.\n\nCLAIMED PRIOR(S) UNDER TEST:\n${describeClaimed(direction.claimedPriors ?? [])}`
      : `We are about to claim this book is a FIRST English translation — that NO complete prior English translation exists. BE SKEPTICAL: try to REFUTE the claim by FINDING a prior English translation. AI tends to wrongly assume "no prior" — fight that.`;

  return `You are a skeptical bibliographic verifier for a library's "first English translation" audit. Use Google Search to do REAL research, then report the search you actually ran.

WORK UNDER TEST:
- Title: ${book.title ?? '?'}
- Author: ${book.author ?? '?'}
- Source language: ${lang}

${mission}

${rubric}

METHOD:
1. Identify the work precisely; separate it from parent/sibling/derivative works, other same-title works, and other editions. A translation of a DIFFERENT work does not count.
2. Search library catalogues (WorldCat), archive.org, Google Books, HathiTrust, publishers, and the tradition-appropriate sources named above. Weight library catalogues and scholarly publishers; distrust aggregator/forum/AI-mirror sites.
3. For EVERY prior you find or verify: record translator, publication year (a number — mandatory), exact English title, completeness (complete|partial|excerpt|unknown), its relationship to OUR text (same_text|same_work_diff_edition|different_source_language|related_distinct_work|partial|adaptation), and a real URL.
4. If you cannot settle the question (sources unreachable, identity unresolved, tradition catalogue-blind), the answer is "uncertain" — never round it to none_found.

Respond with ONLY JSON (\`\`\`json fences allowed):
{"result":"complete_prior_found|only_partial_exists|none_found|not_applicable|uncertain","priors":[{"translator":"","year":0,"english_title":"","completeness":"complete|partial|excerpt|unknown","relationship":"same_text|same_work_diff_edition|different_source_language|related_distinct_work|partial|adaptation","source_url":"","publisher":""}],"queries_run":["every query, verbatim"],"sources_consulted":[{"url":"...","found":"<one line: what it showed>"}],"scope_flags":{"container":false,"witness":false},"reasoning":"<2-3 sentences>"}
"not_applicable" only if our item is visual art, a plain scripture manuscript, or itself already in English.`;
}

/* ------------------------------------------------------------------ */
/* Parsing + normalization                                             */
/* ------------------------------------------------------------------ */

/** Extract the JSON payload from a model response; null when unparseable. */
export function parseSkepticResponse(text: string): SkepticResponse | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text, text.match(/\{[\s\S]*\}/)?.[0]];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const parsed = JSON.parse(c.trim());
      if (parsed && typeof parsed === 'object' && RESULT_VALUES.has(parsed.result)) {
        return {
          result: parsed.result,
          priors: Array.isArray(parsed.priors) ? parsed.priors : [],
          queries_run: Array.isArray(parsed.queries_run) ? parsed.queries_run.filter((q: unknown) => typeof q === 'string') : [],
          sources_consulted: Array.isArray(parsed.sources_consulted) ? parsed.sources_consulted : [],
          scope_flags: parsed.scope_flags,
          reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
        };
      }
    } catch { /* try next candidate */ }
  }
  return null;
}

export interface NormalizedSkepticAttempt {
  /** Legal-enum fields, ready to spread into a FirstTranslationAttempt. */
  attempt: Pick<
    FirstTranslationAttempt,
    'method' | 'match_key' | 'result' | 'priors' | 'evidence_strength' | 'verdict' | 'independence_score'
  >;
  /** Contract problems found while normalizing — each one escalates. */
  problems: string[];
}

/** Parse a 4-digit year out of the model's year field. */
function parseYear(y: number | string | undefined): number | null {
  const m = String(y ?? '').match(/\b(1[2-9]\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Normalize a parsed skeptic response into legal attempt-ledger fields.
 * Deterministic; every judgement here is a rule, not a model opinion.
 */
export function normalizeSkepticAttempt(
  resp: SkepticResponse,
  grounding: { queries: string[]; sources: string[] },
): NormalizedSkepticAttempt {
  const problems: string[] = [];

  const priors: PriorTranslation[] = [];
  let yearless = 0;
  for (const p of resp.priors) {
    if (!p.english_title && !p.translator) continue;
    const year = parseYear(p.year);
    if (year === null) { yearless++; problems.push(`prior_without_year:${p.english_title ?? p.translator}`); }
    const rel = LEGAL_RELATIONSHIPS.has(p.relationship as PriorRelationship)
      ? (p.relationship as PriorRelationship)
      : undefined;
    if (p.relationship && !rel) problems.push(`illegal_relationship:${p.relationship}`);
    priors.push({
      english_title: p.english_title || undefined,
      translator: p.translator || undefined,
      pub_year: year !== null ? String(year) : undefined,
      publisher: p.publisher || undefined,
      completeness: p.completeness || undefined,
      source_url: p.source_url || undefined,
      // relationship is read by priorDefeatsClaim via a structural cast; carry
      // ONLY legal values (an illegal value would default to defeating).
      ...(rel ? { relationship: rel } : {}),
    } as PriorTranslation);
  }

  // result → the three legal ledger values. `uncertain` maps by whether the
  // model surfaced prior hints, and ALWAYS keeps verdict:'uncertain' so derive
  // excludes it from absence/refute votes.
  const result: FirstTranslationAttempt['result'] =
    resp.result === 'not_applicable' ? 'not_applicable'
    : (resp.result === 'complete_prior_found' || resp.result === 'only_partial_exists' || priors.length > 0) ? 'found'
    : 'none';

  // Evidence strength is COMPUTED, never model-reported, and capped at
  // moderate (a single instrument cannot be 'strong').
  const documented = grounding.queries.length >= 3 && grounding.sources.length >= 2;
  let evidence_strength: FirstTranslationAttempt['evidence_strength'] = 'weak';
  if (resp.result === 'uncertain') {
    evidence_strength = 'weak';
  } else if (result === 'found') {
    const gradeable = priors.length > 0 && yearless === 0
      && priors.every((p) => p.source_url && /^https?:\/\//.test(p.source_url));
    evidence_strength = gradeable ? 'moderate' : 'weak';
  } else if (result === 'none') {
    evidence_strength = documented ? 'moderate' : 'weak';
  } else {
    evidence_strength = 'moderate'; // not_applicable with a documented look
  }

  if (result === 'none' && !documented) problems.push('absence_without_documented_search');

  return {
    attempt: {
      method: 'gemini_grounded_search',
      match_key: 'author_title',
      result,
      priors: priors.length ? priors : undefined,
      evidence_strength,
      verdict: resp.result,
      independence_score: 0.3,
    },
    problems,
  };
}
