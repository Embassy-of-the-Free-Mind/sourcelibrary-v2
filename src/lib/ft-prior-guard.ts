/**
 * Evidence-Quality Guard for First-Translation Prior Citations
 *
 * Evaluates whether a cited "prior translation" is trustworthy evidence
 * that a book is NOT a first translation. Four guard types:
 *
 * 1. SELF_MATCH     — the cited prior IS the book's own catalog record
 * 2. ANTHOLOGY      — the cited prior is an anthology/collected-works, not a
 *                     translation of this specific work
 * 3. PARTIAL        — the cited prior is partial/excerpts (doesn't defeat "first complete")
 * 4. LOW_CONFIDENCE — source-language mismatch or namesake heuristics (low confidence only)
 *
 * Guards see only the *cited evidence* — passing all guards does NOT prove
 * the book IS a first translation, only that the cited evidence doesn't justify
 * a "not first" determination. See Avicenna case: guard-pass on the partial Gruner
 * citation, but the correct demotion stands because Bakhtiar 1999 (complete)
 * is uncited.
 *
 * This module is standalone — it does NOT import from src/lib/first-translation/*.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BookInput {
  title: string;
  author?: string;
  language?: string;
}

export interface CitedPriorInput {
  english_title?: string;
  translator?: string;
  pub_year?: string;
  completeness?: 'complete' | 'partial' | 'excerpts' | 'unknown';
  publisher?: string;
  series?: string;
  notes?: string;
}

export type GuardId =
  | 'SELF_MATCH'
  | 'ANTHOLOGY'
  | 'PARTIAL'
  | 'LOW_CONFIDENCE';

export interface GuardResult {
  /** true = cited prior is trustworthy evidence; false = at least one guard fired */
  trustworthy: boolean;
  /** Guards that fired (prior is untrustworthy for these reasons) */
  failedGuards: GuardId[];
  /** high = one or more definitive guards fired; low = only heuristic guards fired */
  confidence: 'high' | 'low';
  /** Per-guard detail for debugging */
  detail: Record<GuardId, { fired: boolean; reason: string }>;
}

// ── Text normalisation helpers ─────────────────────────────────────────────────

/**
 * Normalise a string for comparison: lowercase, strip diacritics and punctuation,
 * collapse whitespace.
 */
function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip combining diacritics
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')          // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract significant tokens (length ≥ 4, skip stop-words).
 */
const STOP_WORDS = new Set([
  'the', 'and', 'with', 'from', 'that', 'this', 'for', 'are', 'was',
  'been', 'have', 'has', 'its', 'into', 'upon', 'also', 'very', 'more',
  'some', 'such', 'than', 'being', 'over', 'both', 'each', 'only',
  'english', 'translation', 'translated', 'works', 'text',
]);

function sigTokens(s: string): string[] {
  return normalise(s)
    .split(/\s+/)
    .filter(t => t.length >= 4 && !STOP_WORDS.has(t));
}

/**
 * Jaccard similarity over significant tokens. Returns 0–1.
 */
function tokenOverlap(a: string, b: string): number {
  const ta = new Set(sigTokens(a));
  const tb = new Set(sigTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection++;
  }
  return intersection / Math.max(ta.size, tb.size);
}

// ── Title coverage helper ─────────────────────────────────────────────────────

/**
 * Returns the fraction of book-title tokens that appear in the prior title.
 * This is an asymmetric "containment" score: 1.0 means all book-title tokens
 * are present in the (possibly longer) prior title.
 */
function bookTitleCoverage(bookTitle: string, priorTitle: string): number {
  const bookToks = sigTokens(bookTitle);
  const priorToks = new Set(sigTokens(priorTitle));
  if (bookToks.length === 0) return 0;
  const found = bookToks.filter(t => priorToks.has(t));
  return found.length / bookToks.length;
}

// ── Guard 1: Self-match ───────────────────────────────────────────────────────

/**
 * Fires when the cited prior appears to be the SAME PUBLICATION as the book itself.
 * This is not about same underlying work — it's about identical or near-identical
 * publication metadata: a translation that IS the book being evaluated.
 *
 * Logic:
 *   All book-title significant tokens appear in the prior title (coverage = 1.0)
 *   AND at least one of:
 *     (a) The book's author appears as the cited translator (same person = same pub)
 *     (b) The book's author's most distinctive name token appears in the prior title
 *         as non-author context (e.g. "Boas" in title of "Mythology of the Bella Coola
 *         Indians" by Franz Boas where translator = "Franz Boas")
 *
 * The author-overlap check is REQUIRED to prevent false positives on genuine prior
 * translations of the same underlying work by a different person (e.g. Udall 1548
 * translating Erasmus is NOT the same publication as Erasmus's Latin original on SL).
 */
function checkSelfMatch(
  book: BookInput,
  prior: CitedPriorInput,
): { fired: boolean; reason: string } {
  if (!prior.english_title) return { fired: false, reason: 'no prior title to compare' };

  const coverage = bookTitleCoverage(book.title, prior.english_title);

  // Author-translator overlap: does the book author match the cited translator?
  const bookAuthorNorm = normalise(book.author ?? '');
  const priorTranslatorNorm = normalise(prior.translator ?? '');
  const priorTitleNorm = normalise(prior.english_title);

  let authorMatchesTranslator = false;
  if (bookAuthorNorm && priorTranslatorNorm) {
    const bookTokens = sigTokens(book.author ?? '');
    const priorTranslatorTokens = sigTokens(prior.translator ?? '');
    const directMatches = bookTokens.filter(t =>
      priorTranslatorTokens.includes(t) || priorTranslatorNorm.includes(t)
    );
    // Require at least one token AND ≥ 33% of book-author tokens matched
    authorMatchesTranslator =
      directMatches.length >= 1 &&
      directMatches.length >= Math.ceil(bookTokens.length * 0.33);
  }

  // Author's main name token appears in the prior title AND matches translator
  // (handles: "Boas" in title + translator = "Franz Boas")
  let authorInTitleWithTranslator = false;
  if (!authorMatchesTranslator && bookAuthorNorm) {
    const authorTokens = sigTokens(book.author ?? '').filter(t => t.length >= 4);
    const longestToken = [...authorTokens].sort((a, b) => b.length - a.length)[0];
    if (longestToken && priorTitleNorm.includes(longestToken) && priorTranslatorNorm.includes(longestToken)) {
      authorInTitleWithTranslator = true;
    }
  }

  const authorSignal = authorMatchesTranslator || authorInTitleWithTranslator;

  const jaccard = tokenOverlap(book.title, prior.english_title);
  // Fire when: title coverage ≥ 0.80 AND author signal
  // -or- title coverage ≥ 0.60 AND strong author-translator match (covers variant spellings
  //   like "Bhagavatam" vs "Bhagawatam" where 2/3 tokens match but author matches exactly)
  // -or- very high Jaccard (≥ 0.75) AND author signal
  const heuristicA = coverage >= 0.80 && authorSignal;
  const heuristicA2 = coverage >= 0.60 && authorMatchesTranslator;
  const heuristicB = jaccard >= 0.75 && authorSignal;

  if (heuristicA || heuristicA2 || heuristicB) {
    return {
      fired: true,
      reason: `Cited prior appears to be the same publication as the book (coverage=${coverage.toFixed(2)}, jaccard=${jaccard.toFixed(2)}, authorMatchesTranslator=${authorMatchesTranslator})`,
    };
  }

  return {
    fired: false,
    reason: `coverage=${coverage.toFixed(2)}, jaccard=${jaccard.toFixed(2)}, authorSignal=${authorSignal}`,
  };
}

// ── Guard 2: Anthology / study ────────────────────────────────────────────────

/**
 * Keywords that, when found in the cited prior's title or series, suggest it
 * is an anthology, collected-works, or scholarly study — not a translation of
 * this specific work.
 */
const ANTHOLOGY_TITLE_KEYWORDS = [
  'anthology',
  'collected works',
  'collected letters',
  'selected works',
  'selected writings',
  'selections from',
  'theatre of the world',
  'theater of the world',
  'reader',                   // "The Kircher Reader" — anthology-form
  'companion',                // "Companion to …" — scholarly study
  'works of',
  'writings of',
  'sources in',
  'sourcebook',
  'collected papers',
  'complete works',           // often a different work from the specific title
];

const ANTHOLOGY_SERIES_KEYWORDS = [
  'collected works',
  'complete works',
  'selected works',
  'opera omnia',
  'omnia opera',
];

/**
 * Fires when the cited prior's title or series contains anthology/study keywords
 * AND the overlap with the book's specific title is low (≤ 0.20).
 *
 * The low-overlap condition prevents false positives: e.g. a book genuinely
 * titled "Selected Works of Paracelsus" that happens to be the specific work.
 */
function checkAnthology(
  book: BookInput,
  prior: CitedPriorInput,
): { fired: boolean; reason: string } {
  const titleToSearch = normalise(prior.english_title ?? '');
  const seriesToSearch = normalise(prior.series ?? '');
  const notesToSearch = normalise(prior.notes ?? '');

  const foundInTitle = ANTHOLOGY_TITLE_KEYWORDS.find(kw => titleToSearch.includes(kw));
  const foundInSeries = ANTHOLOGY_SERIES_KEYWORDS.find(kw => seriesToSearch.includes(kw));
  const keyword = foundInTitle ?? foundInSeries;

  if (!keyword) return { fired: false, reason: 'no anthology keywords found' };

  // If most book-title tokens appear in the prior title, the prior IS about this work
  // (use coverage/containment, not Jaccard, to handle the case where the prior title
  //  is a longer version of the book title: "Arithmologia: The Art of Numbers — Complete Works")
  const titleOverlap = tokenOverlap(book.title, prior.english_title ?? '');
  const coverage = bookTitleCoverage(book.title, prior.english_title ?? '');
  if (titleOverlap >= 0.45 || coverage >= 0.80) {
    return {
      fired: false,
      reason: `keyword "${keyword}" found but title overlap/coverage is high (jaccard=${titleOverlap.toFixed(2)}, coverage=${coverage.toFixed(2)}) — likely is this work`,
    };
  }

  return {
    fired: true,
    reason: `Cited prior contains anthology/study keyword "${keyword}" with low title overlap (${titleOverlap.toFixed(2)}) — likely not a translation of this specific work`,
  };
}

// ── Guard 3: Partial completeness ─────────────────────────────────────────────

/**
 * Fires when the cited prior is explicitly partial, excerpts, or an annotated
 * selection — which does not defeat a claim of being the "first complete" English
 * translation.
 */
function checkPartial(
  _book: BookInput,
  prior: CitedPriorInput,
): { fired: boolean; reason: string } {
  const completeness = prior.completeness;
  if (completeness === 'partial' || completeness === 'excerpts') {
    return {
      fired: true,
      reason: `Cited prior completeness is "${completeness}" — does not defeat a first-complete-translation claim`,
    };
  }
  // Also check title / notes for partial signals when completeness field is unknown
  const textToSearch = normalise(
    [prior.english_title, prior.notes].filter(Boolean).join(' ')
  );
  const partialKeywords = ['excerpts', 'selections', 'partial', 'first book', 'book 1', 'abridged', 'extract'];
  const found = partialKeywords.find(kw => textToSearch.includes(kw));
  if (found && completeness !== 'complete') {
    return {
      fired: true,
      reason: `Cited prior contains partial-signal keyword "${found}" and completeness is not "complete"`,
    };
  }
  return { fired: false, reason: `completeness=${completeness ?? 'not set'}` };
}

// ── Guard 4: Low-confidence heuristics ───────────────────────────────────────

/**
 * Heuristic guard (low confidence): fires when there are weak signals that the
 * cited prior may be a namesake or different work from a different source language.
 *
 * This guard fires at LOW confidence only — it should not be the sole basis for
 * treating a demotion as invalid.
 */
function checkLowConfidence(
  book: BookInput,
  prior: CitedPriorInput,
): { fired: boolean; reason: string } {
  // If the book's author surname doesn't appear anywhere in the cited prior
  const bookAuthorNorm = normalise(book.author ?? '');
  const bookTokens = sigTokens(book.author ?? '');
  if (bookTokens.length === 0) return { fired: false, reason: 'no book author to compare' };

  const priorText = normalise(
    [prior.english_title, prior.translator, prior.publisher, prior.notes].filter(Boolean).join(' ')
  );

  const authorFound = bookTokens.some(t => priorText.includes(t));

  if (!authorFound) {
    return {
      fired: true,
      reason: `No token from book author "${book.author}" found in cited prior — possible namesake or different author`,
    };
  }

  return { fired: false, reason: 'author token found in cited prior' };
}

// ── Main evaluator ────────────────────────────────────────────────────────────

/**
 * Evaluate whether a cited prior is trustworthy evidence that a book is not
 * a first translation.
 *
 * @param book       The book being assessed
 * @param citedPrior The first cited prior from translation_verification
 * @returns GuardResult — trustworthy=false means at least one definitive guard fired
 */
export function evaluatePrior(
  book: BookInput,
  citedPrior: CitedPriorInput,
): GuardResult {
  const selfMatch = checkSelfMatch(book, citedPrior);
  const anthology = checkAnthology(book, citedPrior);
  const partial = checkPartial(book, citedPrior);
  const lowConf = checkLowConfidence(book, citedPrior);

  const detail: GuardResult['detail'] = {
    SELF_MATCH: { fired: selfMatch.fired, reason: selfMatch.reason },
    ANTHOLOGY:  { fired: anthology.fired, reason: anthology.reason },
    PARTIAL:    { fired: partial.fired, reason: partial.reason },
    LOW_CONFIDENCE: { fired: lowConf.fired, reason: lowConf.reason },
  };

  // Definitive guards (high confidence when fired)
  const definitiveGuards: GuardId[] = [];
  if (selfMatch.fired) definitiveGuards.push('SELF_MATCH');
  if (anthology.fired) definitiveGuards.push('ANTHOLOGY');
  if (partial.fired) definitiveGuards.push('PARTIAL');

  // Heuristic guard (low confidence)
  const heuristicGuards: GuardId[] = [];
  if (lowConf.fired) heuristicGuards.push('LOW_CONFIDENCE');

  const failedGuards: GuardId[] = [...definitiveGuards, ...heuristicGuards];
  // trustworthy = no definitive guard fired (LOW_CONFIDENCE alone does not make untrustworthy)
  const trustworthy = definitiveGuards.length === 0;
  const confidence: 'high' | 'low' = definitiveGuards.length > 0 ? 'high' : 'low';

  return { trustworthy, failedGuards, confidence, detail };
}
