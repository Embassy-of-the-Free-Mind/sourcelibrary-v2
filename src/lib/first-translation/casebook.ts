/**
 * The FT verification CASEBOOK (#3778) — the fourth memory-bank layer.
 *
 * Three layers already exist as data: verified positives (`translation_catalogs`),
 * catalogue absence (`reference_translations`), and search history
 * (`first_translation_attempts`). The fourth — the failure-mode detectors, the
 * policy rules, and the tradition-specific rules — lived only as prose in
 * `.claude/docs/invariants/first-translation-claims.md`, readable by humans and
 * Claude sessions but invisible to the cheap Gemini instruments that do most of
 * the searching. This module makes it machine-readable so every rung of the
 * escalation ladder injects the SAME rubric and routes on the SAME hard classes.
 *
 * Two exports matter:
 *  - `renderRubric(book)` — the rubric block injected into rung-2/3 prompts.
 *  - `routeBook(book, screenSignals)` / `postSearchRoute(priors)` — the routing
 *    function: which rung is allowed to settle this book.
 *
 * Pure data + string assembly. No I/O, no model calls. Every rule carries its
 * provenance so a future session can re-verify it instead of trusting it.
 */

import type { PriorTranslation } from './attempt-log';

export interface CasebookRule {
  id: string;
  kind: 'failure_mode' | 'policy' | 'tradition';
  /** Imperative instruction, written to be injected into a verifier prompt. */
  rule: string;
  /** Where this rule was learned — issue/PR/doc, so it can be re-verified. */
  provenance: string;
}

/* ------------------------------------------------------------------ */
/* Failure modes — the fabrication shapes observed in real Stage-1/2   */
/* output. ~63% of early Stage-1 "a prior exists" claims were          */
/* fabricated; these are the shapes they took.                         */
/* ------------------------------------------------------------------ */

export const FAILURE_MODES: CasebookRule[] = [
  {
    id: 'no_named_translator',
    kind: 'failure_mode',
    rule: 'A claimed prior with no named translator ("anonymous", "various", or an empty field) is the signature of a fabricated citation. Do not accept it without locating the actual edition in a library catalogue.',
    provenance: '#3687 screen; first-translation-claims.md §fabricated priors',
  },
  {
    id: 'amalgamated_citation',
    kind: 'failure_mode',
    rule: 'A translator field containing a disjunction ("Hadock (or Gibbons)") usually fuses two real translators of two DIFFERENT works into one citation. Split and verify each name against its own work.',
    provenance: 'first-translation-claims.md §fabricated priors',
  },
  {
    id: 'study_as_translation',
    kind: 'failure_mode',
    rule: 'A scholarly STUDY of a text (a monograph that quotes, summarizes, or analyses it) is not a translation of it. Check how the holding library itself catalogues the item (e.g. the NLM files Savage-Smith as a work ABOUT the treatise).',
    provenance: 'first-translation-claims.md §fabricated priors',
  },
  {
    id: 'real_scholar_nonexistent_work',
    kind: 'failure_mode',
    rule: 'A real scholar\'s name attached to a nonexistent work ("Deitz and Monfasani 1997") defeats every structural check. Confirm the work exists in the scholar\'s own bibliography or a library catalogue, not merely that the scholar exists.',
    provenance: 'first-translation-claims.md §fabricated priors',
  },
  {
    id: 'fabrication_beside_genuine',
    kind: 'failure_mode',
    rule: 'A fabricated prior can sit BESIDE a genuine defeater in the same answer. Finding one fabrication does not clear the book; verify every cited prior independently.',
    provenance: 'first-translation-claims.md §fabricated priors',
  },
  {
    id: 'wrong_date',
    kind: 'failure_mode',
    rule: 'Dates drift in fabricated citations (Read 1946 cited as "1936"). The year decides the first_modern grade, so verify it against the edition itself, never against the model\'s memory.',
    provenance: 'first-translation-claims.md §fabricated priors; ft-verify SKILL first_modern note',
  },
];

/* ------------------------------------------------------------------ */
/* Policy rules — what defeats a claim and what does not.              */
/* ------------------------------------------------------------------ */

export const POLICY_RULES: CasebookRule[] = [
  {
    id: 'complete_same_text_defeats',
    kind: 'policy',
    rule: 'A prior defeats a first-translation claim ONLY if it is COMPLETE and renders the SAME text. Report every prior\'s completeness explicitly: complete | partial | excerpt | unknown.',
    provenance: '#3753; derive-from-evidence.ts priorDefeatsClaim',
  },
  {
    id: 'different_source_language_no_defeat',
    kind: 'policy',
    rule: 'If OUR item is itself a translation (a witness), a prior rendered from a DIFFERENT source language or witness does not defeat a first-from-source claim. Report relationship: different_source_language.',
    provenance: 'POLICY 2; types.ts PriorRelationship',
  },
  {
    id: 'all_partial_first_complete',
    kind: 'policy',
    rule: 'If every prior you can find is partial or an excerpt, that is a POSITIVE finding (the claim grades first_complete), not a defeat. Say so; do not round it to "a prior exists".',
    provenance: 'first-translation-claims.md §"All fragments" vs "could not tell"',
  },
  {
    id: 'unknown_completeness_needs_review',
    kind: 'policy',
    rule: '"All priors are fragments" and "I could not determine completeness" are DIFFERENT verdicts. If any prior\'s completeness is unknown, mark it unknown — never guess complete or partial.',
    provenance: 'first-translation-claims.md §"All fragments" vs "could not tell"',
  },
  {
    id: 'pre1900_first_modern',
    kind: 'policy',
    rule: 'A complete prior that is pre-1900 does NOT defeat the claim outright — it grades the text "first modern translation". The publication YEAR of every prior is therefore mandatory, as a number, in a structured field.',
    provenance: 'ft-verify SKILL §first_modern (Whittington 1547 mis-grade)',
  },
  {
    id: 'container_partial_no_defeat',
    kind: 'policy',
    rule: 'If OUR item is a multi-work container, a multi-volume work, or text-plus-commentary, a prior covering only PART of it (one constituent, one volume, the base text without the apparatus) does not defeat it. Scope the claim before grading.',
    provenance: '#3687 verified outcomes (Hagakure vol. 2, one juan of 106); ft-demote-screen container_title/work_plus_apparatus',
  },
  {
    id: 'absence_is_bounded',
    kind: 'policy',
    rule: 'You cannot prove no prior exists — only report the bounded search you ran. Record every query verbatim and what each source showed. "I could not search this tradition" must be reported as uncertain, never as none_found.',
    provenance: '#3459; first-translation-claims.md header',
  },
];

/* ------------------------------------------------------------------ */
/* Tradition rules — keyed by source language.                         */
/* ------------------------------------------------------------------ */

export interface TraditionRule extends CasebookRule {
  /** Case-insensitive test against the book's (original_)language string. */
  appliesTo: RegExp;
}

export const TRADITION_RULES: TraditionRule[] = [
  {
    id: 'latin_greek_modern_imprints',
    kind: 'tradition',
    appliesTo: /latin|greek|grc|\bla\b/i,
    rule: 'Prior English translations of Latin/Greek works are usually POST-1950 scholarly imprints (Loeb, Brill, university presses) — 80.8% of known priors. Early-modern catalogues (ESTC, Wing) cannot see them; search modern scholarly publishing and WorldCat, not just antiquarian sources.',
    provenance: 'first-translation-claims.md §recall (ESTC covers 1473–1800)',
  },
  {
    id: 'cjk_catalogue_blind',
    kind: 'tradition',
    appliesTo: /chin|japan|korea|cjk/i,
    rule: 'Western catalogues are nearly blind to CJK works (romanization varies, MARC 880 coverage is 2.3%). Search ctext.org, romanized AND native-script titles, and sinological/japanological scholarship. Beware the container trap: one translated juan/fascicle of a large work is a partial, not a defeat.',
    provenance: 'first-translation-claims.md §depth-vs-reachability; #3687 Sancai Tuhui / one juan of 106',
  },
  {
    id: 'hebrew_title_collisions',
    kind: 'tradition',
    appliesTo: /hebrew|aramaic|judeo/i,
    rule: 'Kabbalistic and rabbinic titles collide: multiple UNRELATED works share a title (Shaʿarei Ẓedek vs Shaʿarei Orah vs a third unrelated same-title text). Establish WHICH work by author and incipit before accepting any prior. Sefaria hosts community translations — report them, but flag them as practitioner/community sources for policy review.',
    provenance: '#3687 verified outcomes; practitioner-PDF policy held for human (project_ft_v2_state)',
  },
  {
    id: 'tibetan_practitioner_pdfs',
    kind: 'tradition',
    appliesTo: /tibet|dzongkha/i,
    rule: 'Search 84000, BDRC, and Lotsawa House. Practitioner/dharma-community PDFs may exist without appearing in any catalogue — report them with URLs but flag as practitioner sources; whether they count as priors is a HUMAN policy decision, not yours.',
    provenance: 'project_ft_v2_state practitioner-PDF hold (Kunzang Gongdü)',
  },
  {
    id: 'arabic_syriac_series',
    kind: 'tradition',
    appliesTo: /arab|syriac|persian|farsi|ottoman|turkish/i,
    rule: 'Check the standard translation series (Brill, Gibb Memorial, Bibliotheca Persica, JAOS scholarship) and both transliteration schemes for the title/author. Many "priors" are partial editions of long works — completeness is the usual failure point, not existence.',
    provenance: '#3687 al-Jāḥiẓ class (every English rendering a fragment)',
  },
];

/* ------------------------------------------------------------------ */
/* Routing — which rung may settle a book.                             */
/* ------------------------------------------------------------------ */

/**
 * Screen-signal codes (scripts/lib/ft-demote-screen.mjs) that mark a book as a
 * HARD class: the question is work identity or scope, which the cheap grounded
 * skeptic reliably gets wrong. These route to rung 3 (Claude) without paying
 * for rung 2 first. Measured basis: the five detectors predicted 13/16 verified
 * outcomes with zero searches (#3778); every rung-3 case was an identity
 * question (#3778 addendum).
 */
export const HARD_CLASS_SIGNALS = new Set([
  'container_title',
  'work_plus_apparatus',
  'item_is_a_witness',
  'amalgamated_translator',
]);

/** Domains whose priors raise a POLICY question only a human may settle. */
export const POLICY_HOLD_DOMAINS = [/sefaria\.org/i, /lotsawahouse\.org/i];

export interface RouteDecision {
  route: 'gemini' | 'claude' | 'human';
  reasons: string[];
}

/**
 * Pre-search routing: decide the cheapest rung allowed to settle this book.
 * `screenSignalCodes` are the codes from `screenDemoteCandidate(book, priors)`.
 */
export function routeBook(
  book: { title?: string; author?: string; language?: string | null },
  screenSignalCodes: string[],
): RouteDecision {
  const hard = screenSignalCodes.filter((c) => HARD_CLASS_SIGNALS.has(c));
  if (hard.length > 0) {
    return { route: 'claude', reasons: hard.map((c) => `hard_class:${c}`) };
  }
  return { route: 'gemini', reasons: [] };
}

/**
 * Post-search routing: after rung 2 returns, escalate anything it is not
 * allowed to settle. `uncertain` and disagreement escalation live in the
 * driver (they need the stored verdict); this handles the policy holds.
 */
export function postSearchRoute(priors: PriorTranslation[]): RouteDecision {
  const policyHits = priors.filter((p) =>
    POLICY_HOLD_DOMAINS.some((d) => d.test(p.source_url ?? '')));
  if (policyHits.length > 0) {
    return {
      route: 'human',
      reasons: policyHits.map((p) => `policy_hold:practitioner_source:${p.source_url}`),
    };
  }
  return { route: 'gemini', reasons: [] };
}

/* ------------------------------------------------------------------ */
/* Rubric rendering                                                    */
/* ------------------------------------------------------------------ */

/** Tradition rules applicable to a book's source language. */
export function traditionRulesFor(language?: string | null): TraditionRule[] {
  const l = String(language ?? '');
  return TRADITION_RULES.filter((r) => r.appliesTo.test(l));
}

/**
 * Render the casebook as a rubric block for injection into a verifier prompt
 * (rung 2 and rung 3 get the SAME rubric — the point is that hard-won rules
 * stop living only in prose no instrument reads).
 */
export function renderRubric(book: { language?: string | null; original_language?: string | null }): string {
  const lang = book.original_language ?? book.language;
  const lines: string[] = [];
  lines.push('KNOWN FAILURE MODES (each observed in real verification output — check your own answer against every one):');
  for (const r of FAILURE_MODES) lines.push(`- ${r.rule}`);
  lines.push('');
  lines.push('POLICY RULES (what defeats a first-translation claim and what does not):');
  for (const r of POLICY_RULES) lines.push(`- ${r.rule}`);
  const trad = traditionRulesFor(lang);
  if (trad.length > 0) {
    lines.push('');
    lines.push(`TRADITION-SPECIFIC RULES for this book's source language (${lang}):`);
    for (const r of trad) lines.push(`- ${r.rule}`);
  }
  return lines.join('\n');
}
