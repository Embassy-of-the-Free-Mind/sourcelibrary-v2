/**
 * Detectors for the five ways a first-translation DEMOTE candidate goes wrong.
 *
 * WHY THIS EXISTS
 * ---------------
 * 16 books were verified one at a time by independent Claude subagents on
 * 2026-08-07 (#3687, rounds 1-2). Every one had been selected *because* it
 * looked like an obvious demote — a canonical work with well-known English
 * translations. **13 of the 16 badges turned out to be correct.**
 *
 * The failures were not scattered. They fell into five shapes, and four of the
 * five are visible in data we already hold, without a single web search. This
 * module is those four (plus one that needs the item's own language), so the
 * expensive agent verification can be reserved for candidates that survive.
 *
 * A DETECTOR IS A REASON TO LOOK, NEVER A VERDICT. Nothing here demotes,
 * promotes or writes. §17 applies with full force: a mechanical signal about a
 * bibliographic claim is a screening queue, not an adjudication. The output
 * ranks candidates by how likely the DEMOTE is to be wrong, so a human or an
 * agent spends its attention where the evidence is thinnest.
 */

/** A translator field that names no person — the fabricated-citation signature. */
const NON_PERSONAL_TRANSLATOR =
  /^\s*(unknown|anonymous|anon\.?|various|multiple|several|n\/?a|none|unattributed|unspecified|not\s+(known|stated|recorded)|attributed\s+to|traditional)\b/i;

/**
 * Titles that name a multi-work CONTAINER rather than a single text.
 *
 * `Opera`/`Works` are the obvious ones; `Lucubrationes` is here because two of
 * the 16 (Chrysostom 1527, Hilary 1523) were Erasmus-edited Froben anthologies
 * and both badges survived. Anchored to word boundaries so "Operation" and
 * "Networks" do not match.
 */
const CONTAINER_TITLE =
  /\b(opera|omnia|posthuma|lucubrationes|varia|opuscula|collectanea|miscellanea|gesammelte|s[äa]mtliche|oeuvres|works|collected\s+works|complete\s+works|corpus\s+reformatorum|thesaurus)\b/i;

/**
 * The item is ITSELF a translation — so a prior that rendered the original is a
 * different-source-language prior and does not defeat the claim (POLICY 2).
 *
 * Matches the ways a title states its own translator or target language:
 * "Tr: Ambrosius Traversarius", "in Latinum versa", "verdeutscht", "translated
 * by", "Arabic Translation", "vertaald".
 */
const ITEM_IS_A_TRANSLATION =
  /(\btr(ans)?\.?\s*:|\btranslated\s+(by|into|from)\b|\btraduit\b|\bvertaald\b|\b[üu]bersetz|\bverdeutscht\b|\bin\s+latinum\s+versa\b|\bversa\b\s*(&|,|$)|\b(arabic|latin|greek|hebrew|syriac|armenian|dutch|german|french|italian|spanish|chinese)\s+translation\b)/i;

/** A prior whose title is expository — a study ABOUT a text, not a rendering of it. */
const EXPOSITORY_PRIOR_TITLE =
  /(:\s*(its|the)\s+\w+|\bits\s+(scientific|theological|historical|literary)\b|\b(the\s+)?(influence|significance|reception|scholarly\s+career|life\s+and\s+works|evolution)\s+of\b|\bin\s+praise\s+of\b|\b(a|an)\s+(study|survey|introduction|essay|account)\s+of\b|\bcommentary\s+on\s+the\s+\w+\s+of\b.*\bsignificance\b)/i;

/** A translator field holding a disjunction — two people fused into one citation. */
const AMALGAMATED_TRANSLATOR = /\(\s*or\s+[^)]+\)|\bor\b\s+[A-Z][a-z]+\s+[A-Z][a-z]+\s*$/;

/**
 * The item IS a commentary, or bundles a base text with APPARATUS.
 *
 * Both shapes break the same way: a prior that renders the BASE text does not
 * cover this item.
 *  - bundled — Boethius' *De Consolatione Philosophiae* "comm. Thomas Waleys":
 *    Walsh 1999 and Green 1962 translate Boethius and not a word of Waleys.
 *  - standalone — Cardano's *In Cl. Ptolemaei de Astrorum Iudiciis Commentaria*:
 *    a translation of Ptolemy's Tetrabiblos is not a translation of Cardano.
 *
 * The marker sits in the AUTHOR field as often as the title, so both are checked.
 *
 * ⚠️ The Latin declines: commentaria / commentarii / commentarius / commentariis
 * / commentario / commentarium. An earlier version of this pattern listed only
 * some of those endings and let Cardano through on the live queue — the gold set
 * did not contain a `-aria` form, so only running it on real data caught it.
 */
const WORK_PLUS_APPARATUS =
  /(\bcomm\.|\bcommentar(y|ies|ia|ii|io|ium|iis|ius)\b|\bscholia\b|\bcum\s+(commentariis|notis|scholiis)\b|\bwith\s+(the\s+)?(commentary|notes|annotations)\b|\bannotat(ed|ionibus)\b|\bglossa\b|\bin\s+\w+\s+(libros|librum)\b)/i;

const norm = (s) => String(s ?? '').trim();

/**
 * Screen one demote candidate.
 *
 * @param {object} book  { title, author, language, original_language }
 * @param {Array}  priors [{ translator, pub_year, english_title, completeness }]
 * @returns {{signals: Array, riskScore: number, strongestReason: string|null}}
 *   `riskScore` is the count of DISTINCT signals that the demote is unsafe.
 *   It is an ordering key for human attention, not a probability.
 */
export function screenDemoteCandidate(book, priors = []) {
  const signals = [];
  const title = norm(book.title);
  const author = norm(book.author);

  // `text_role` is the field that SHOULD make witness-detection trivial. Where
  // it is set correctly this is exact; see the blind spot noted in KNOWN_LIMITS.
  if (/translation/i.test(norm(book.text_role))) {
    signals.push({
      code: 'item_is_a_witness',
      severity: 'high',
      detail: 'text_role marks this item as a translation, so a prior rendering the original is a '
        + 'different-source-language prior and does not defeat the claim (POLICY 2).',
    });
  }

  if (WORK_PLUS_APPARATUS.test(title) || WORK_PLUS_APPARATUS.test(author)) {
    signals.push({
      code: 'work_plus_apparatus',
      severity: 'high',
      detail: 'The item bundles a base text with a commentary, scholia or notes. A prior covering the '
        + 'base text does not cover the apparatus — scope the claim before grading it.',
    });
  }

  if (ITEM_IS_A_TRANSLATION.test(title)) {
    signals.push({
      code: 'item_is_a_witness',
      severity: 'high',
      detail: 'The item declares itself a translation, so a prior that rendered the original is a '
        + 'different-source-language prior and does not defeat the claim (POLICY 2).',
    });
  }

  if (CONTAINER_TITLE.test(title)) {
    signals.push({
      code: 'container_title',
      severity: 'high',
      detail: 'Title names a multi-work container. Completeness must be judged against the CONTAINER, '
        + 'and a prior covering one constituent work does not defeat it.',
    });
  }

  // Priors with no year cannot be graded: the first_modern rule turns on it.
  let yearlessPriors = 0;

  for (const p of priors) {
    const t = norm(p.translator);
    const et = norm(p.english_title);

    if (!t || NON_PERSONAL_TRANSLATOR.test(t)) {
      signals.push({
        code: 'no_named_translator',
        severity: 'high',
        detail: `Prior "${et.slice(0, 60)}" names no translator (${t || 'empty'}) — the fabricated-citation `
          + 'signature. Verify it exists in ESTC/Wing/WorldCat before trusting it.',
      });
    }

    if (AMALGAMATED_TRANSLATOR.test(t)) {
      signals.push({
        code: 'amalgamated_translator',
        severity: 'high',
        detail: `Prior translator "${t}" is a disjunction, not an attribution — two people are likely `
          + 'fused into one citation, of two different works.',
      });
    }

    if (et && EXPOSITORY_PRIOR_TITLE.test(et)) {
      signals.push({
        code: 'prior_is_a_study',
        severity: 'medium',
        detail: `Prior "${et.slice(0, 70)}" reads as a study ABOUT the text rather than a rendering of it. `
          + 'A work that quotes and analyses is not a translation.',
      });
    }

    if (!norm(p.pub_year)) yearlessPriors++;
  }

  if (yearlessPriors) {
    signals.push({
      code: 'prior_without_year',
      severity: 'medium',
      detail: `${yearlessPriors} prior(s) carry no pub_year. The first_modern rule turns on the year — `
        + 'a pre-1900-only prior is a badgeable first, not a defeat — so an ungraded year can collapse '
        + 'a genuine first_modern to not_first.',
    });
  }

  // Every prior partial/excerpt: by the survivor rules the badge already stands.
  const graded = priors.filter((p) => norm(p.completeness));
  if (graded.length && graded.every((p) => /partial|excerpt/i.test(norm(p.completeness)))) {
    signals.push({
      code: 'no_complete_prior_claimed',
      severity: 'high',
      detail: 'Every cited prior is partial or excerpt. Under the survivor rules a demote requires a '
        + 'COMPLETE prior, so this one is unsupported on its own evidence.',
    });
  }

  // Only pre-1900 complete priors → first_modern, a first-family badge.
  const completeYears = priors
    .filter((p) => /complete/i.test(norm(p.completeness)))
    .map((p) => parseInt(norm(p.pub_year), 10))
    .filter((y) => Number.isFinite(y));
  if (completeYears.length && completeYears.every((y) => y < 1900)) {
    signals.push({
      code: 'first_modern_candidate',
      severity: 'high',
      detail: `All complete priors are pre-1900 (${completeYears.join(', ')}). That grades the text `
        + 'first_modern — a first-family BADGE — not not_first.',
    });
  }

  const order = { high: 2, medium: 1 };
  const strongest = signals.slice().sort((a, b) => order[b.severity] - order[a.severity])[0];
  return {
    signals,
    riskScore: new Set(signals.map((s) => s.code)).size,
    strongestReason: strongest?.code ?? null,
  };
}

export const DETECTORS = [
  'item_is_a_witness', 'work_plus_apparatus', 'container_title', 'no_named_translator',
  'amalgamated_translator', 'prior_is_a_study', 'prior_without_year',
  'no_complete_prior_claimed', 'first_modern_candidate',
];

/**
 * MEASURED BLIND SPOT — read this before trusting a clean screen.
 *
 * Coornhert's *De dolinghe van Ulysse* is a Dutch translation of Homer whose
 * badge survived verification, and the screen does NOT flag it. Its record says
 * `language: "Dutch"`, `author: "Homer"`, **`text_role: "original"`** — and that
 * last value is simply wrong: the item is a translation. With `text_role` right,
 * the witness detector above catches it exactly.
 *
 * So the gap is a DATA defect, not a missing rule, and the fix belongs upstream
 * in work identity (#2318 / #3258), not in another regex here. Catching it by
 * pattern would mean asserting "Homer wrote in Greek" from a hand-written
 * author-language table — the exact unverifiable-assertion list that
 * `source-language-match.mjs` deliberately refuses to keep, and that reproduces
 * its bug on the first wrong entry.
 *
 * Consequence for the caller: **a zero risk score is not a clearance.** It means
 * no known-unsafe pattern matched, and the known patterns do not cover a
 * mislabelled witness. Treat the screen as ordering attention, never as a filter
 * that removes candidates from review.
 */
export const KNOWN_LIMITS = {
  gold_set_recall: '13 of 14 surviving badges flagged (2026-08-07, n=16)',
  blind_spot: 'a translation whose text_role is mislabelled `original` — e.g. Coornhert/Homer',
  upstream_fix: 'work identity + correct text_role (#2318, #3258)',
};
