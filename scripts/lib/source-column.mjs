/**
 * Which part of a bilingual page is already in the reader's language?
 *
 * ## The question this answers
 *
 * `src/lib/localized.ts` states the open problem in as many words: a book
 * WRITTEN in Spanish needs no `pages_translated_es` counter, because its pages
 * already are Spanish — but *"a bilingual edition is its own question (the
 * Ximénez Popol Vuh carries K'iche' and Spanish in parallel columns and is
 * catalogued under K'iche'). Widen this only with a decision about what a
 * bilingual page owes a Spanish reader."*
 *
 * The decision, and the reason this module exists: **a bilingual parallel-text
 * page owes a Spanish reader its Spanish COLUMN — whole, verbatim, and labelled
 * as the source's own words rather than as a translation we made.** What made
 * "half-Spanish" too weak a promise for `/es` was measuring the PAGE. The page
 * is half Spanish; the column is all of it. The column is addressable because
 * the OCR prompt already marks it (`<column-break/>`,
 * `src/lib/types/prompts/defaults.ts`), and the reader already renders on that
 * marker (`NotesRenderer`).
 *
 * This matters beyond one manuscript. Measured 2026-08-21 on live books whose
 * `books.language` names two languages: the Ximénez Popol Vuh carries a
 * `<column-break/>` on 112 of its 132 pages, and the three Florentine Codex
 * volumes on 79–95% of theirs — Sahagún's own Spanish, facing the Nahuatl,
 * across 2,506 pages. Both are currently invisible to every Spanish surface.
 *
 * ## Why the column is identified by its TEXT, never by the tag order
 *
 * The OCR envelope also carries `<language>Spanish, Nahuatl</language>`, which
 * looks like it names the columns in order. It does not reliably: on 400 sampled
 * pages of Florentine Codex vol. 1 the model wrote "Spanish, Nahuatl" 300 times
 * and "Nahuatl, Spanish" 24 times for the same physical layout. An ordering that
 * is right 93% of the time puts the wrong language into the Spanish lane on one
 * page in fourteen, and nothing downstream could detect it.
 *
 * So each segment is scored on its own words, using the closed-class
 * function-word share that `src/lib/english-page-language.ts` and
 * `scripts/lib/english-source-detect.mjs` already use for the English version of
 * this question. Function words carry no subject matter, so the measure tracks
 * the LANGUAGE of the segment and not its topic — and the separation it gives on
 * these books is not marginal (see `scripts/audit/source-column-separation.mjs`,
 * which is the positive control this module must keep passing).
 *
 * ## What it deliberately does not do
 *
 * - It does not guess the OTHER column's language. "Is this Spanish?" is a
 *   decidable question; "is this K'iche' or Nahuatl?" is a different one that
 *   nothing here needs answered.
 * - It returns null rather than a low-confidence answer. A row in the Spanish
 *   lane is a promise that the text IS Spanish (`pageTextForLang`'s rule), and
 *   absence is the honest answer when the page will not say.
 * - It is not a language detector for the corpus. The book-level gate — is this
 *   edition bilingual, and is one of its languages Spanish — is a catalogue
 *   question, answered by `isBilingualEditionLanguage` below, never guessed from
 *   the page.
 */

import { stripEditorialWrappers } from './strip-editorial-wrappers.mjs';
import { parseLanguageField } from './language-normalize.mjs';
import { NATIVE_EDITION_LANGUAGE } from './native-edition-language.mjs';

/**
 * Does `books.language` say this edition's leaves carry `lang` ALONGSIDE another
 * language? — the book-level gate, and the only thing that decides which books
 * this mechanism may touch.
 *
 * Built from the two pieces that already exist rather than a third pattern:
 * `parseLanguageField` (the repo's one language-string parser, which knows that
 * 96 of 229 live values are list-shaped and that `N/A` must never be split into
 * languages called `n` and `a`) and `NATIVE_EDITION_LANGUAGE` (the anchored
 * spellings of "this IS Spanish"). A regex written here would be the fifth
 * language vocabulary `.claude/docs/invariants/language-fields.md` warns
 * against, and it would have to re-learn the same refusals.
 *
 * The refusals matter and are pinned by `tests/unit/source-column.test.ts`:
 * "Spanish in Hebrew characters" parses to ONE token — Judeo-Spanish in Hebrew
 * script, which a Spanish reader cannot read at all — and bare "Spanish" is the
 * NATIVE-edition case, which belongs to `pageTextForLang`'s `nativeEdition` flag
 * and not here. The two sets must not overlap.
 */
export function isBilingualEditionLanguage(bookLanguage, lang) {
  const pattern = NATIVE_EDITION_LANGUAGE[lang];
  if (!pattern || typeof bookLanguage !== 'string') return false;
  const parts = parseLanguageField(bookLanguage);
  return parts.length > 1 && parts.some((p) => pattern.test(p));
}

/**
 * Closed-class Spanish function words — articles, prepositions, conjunctions,
 * pronouns, auxiliaries. Same principle as `ENGLISH_FUNCTION_WORDS`: no content
 * words, so the share measures language rather than subject.
 *
 * THREE COMMON WORDS ARE DELIBERATELY ABSENT, and each has cost a false positive
 * in the languages this list has to be told apart from:
 *
 *  - `la`  — a K'iche' particle in Ximénez's orthography ("vhbal la quibih vi",
 *            "cacah la nabec"), on nearly every line of the left column.
 *  - `no`  — Nahuatl's first-person possessive prefix, written free-standing in
 *            colonial orthography.
 *  - `in`  — the Nahuatl determiner, the single most frequent word in the
 *            Florentine Codex's Nahuatl column.
 *
 * Dropping them costs a few points of share on genuine Spanish and removes the
 * only three tokens that scored on the other side. The remaining list is
 * checked against both columns of both books by
 * `scripts/audit/source-column-separation.mjs`; extend it only with a rerun of
 * that audit, because a word that is Spanish and also Nahuatl narrows the gap
 * this whole mechanism depends on.
 */
const SPANISH_FUNCTION_WORDS = new Set(
  ('que de el los las y en se su por con para es del al un una le lo sus como más pero si ya '
  + 'cuando donde esto esta este esa ese aquel ellos ellas son era fue ser muy todo toda todos '
  + 'todas sin sobre entre hasta desde porque aunque también así aquí allí otro otra mismo '
  + 'tiene tienen había habían han ha hemos dijo dice les nos me te mi cual quien cuyo ni '
  + 'nada nunca siempre luego después antes bien más menos mucho poco cada otros otras '
  + 'fueron estaba estaban hay ese esos esas aquella aquellos señor señores dios').split(' '),
);

/**
 * The subset of the list above that a NEIGHBOURING ROMANCE LANGUAGE does not
 * also use — and the reason this module needs two scores rather than one.
 *
 * Measured on the Landa *Relación de las cosas de Yucatán* (`Spanish / French`,
 * 644 pages of Landa's Spanish faced by Brasseur's French): the broad list above
 * scores French columns at a MEDIAN of 14.3% and a maximum of 18%, because
 * `de que en le un si ni es` are French words too. At the single threshold the
 * Spanish column needs, French pages start crossing it — a Romance-Romance pair
 * is exactly where a function-word test is weakest, and it fails silently,
 * because French prose in the Spanish lane still reads as prose.
 *
 * The list is built against the two languages the corpus actually pairs Spanish
 * with — FRENCH (Landa's *Relación*) and LATIN (the *Informe contra idolorum
 * cultores*) — and every entry is checked against both: French writes `le` for
 * `el`, `et` for `y`, `du` for `del`, `avec` for `con`, `pour` for `para`,
 * `mais` for `pero`, `comme` for `como`, `parce que` for `porque`, `très` for
 * `muy`, `plus` for `más`; Latin writes `et`, `cum`, `sine`, `sed`. None of
 * these tokens is a word in either.
 *
 * It is NOT built against Italian or Portuguese, which share `con`/`del`/`su`
 * and `por`/`para`/`como`/`porque` respectively. Those pairs do not exist in the
 * corpus; if one is imported, re-run
 * `scripts/audit/source-column-separation.mjs` before trusting this on it. The
 * words dropped for that reason (`su`, `al`, `lo`) are the ones Italian shares.
 */
const SPANISH_EXCLUSIVE_WORDS = new Set(
  ('el y los las del con para muy pero como porque sus esta este esa ese más ya una por '
  + 'todo toda todos todas sin era fue ser sino esto nada nunca siempre luego después antes '
  + 'mucho poco otros otras aunque también así cada hasta desde ellos ellas quien '
  + 'señor señores dios dijo dice tiene tienen había habían fueron estaba estaban').split(' '),
);

/** Words of a segment, lower-cased, accents kept (they are a Spanish signal). */
function words(text) {
  return (String(text || '').toLowerCase().match(/[a-zà-ÿñ']+/g) || []);
}

/**
 * How Spanish is `text`? Two shares over the same word count.
 *
 * `share` is the broad function-word measure — the sensitive one, which is what
 * separates Spanish from a non-Romance column. `exclusive` is the narrow one,
 * which is what separates it from a neighbouring Romance language. A segment has
 * to satisfy both; either alone admits something.
 *
 * Reported alongside the word count everywhere it is used: a 60% share over nine
 * words is noise, and a threshold applied without a floor turns catchwords and
 * stray marginalia into "a Spanish column".
 */
export function spanishFunctionWordShare(text) {
  const w = words(text);
  if (!w.length) return { share: 0, exclusive: 0, words: 0 };
  let hits = 0;
  let exclusiveHits = 0;
  for (const x of w) {
    if (SPANISH_FUNCTION_WORDS.has(x)) hits++;
    if (SPANISH_EXCLUSIVE_WORDS.has(x)) exclusiveHits++;
  }
  return { share: hits / w.length, exclusive: exclusiveHits / w.length, words: w.length };
}

/**
 * A page's text, split into its columns.
 *
 * Editorial wrappers go FIRST, for a reason that is easy to get backwards: the
 * envelope's `<warning>` block is prose ABOUT the page, written in English or
 * Spanish ("Handwritten Spanish colonial hand. The page contains a bilingual
 * text…"), and it sits before the first column. Scored unstripped it lends the
 * K'iche' column ~15 points of Spanish share it has not got. `<vocab>` does the
 * same at the tail, inside the LAST column.
 *
 * A page with no marker yields one segment — which is the correct reading, not a
 * degenerate one: 20 of the Ximénez manuscript's 132 pages are single-column,
 * and twelve of those (the Spanish prologue and the appended *Escolios*) are
 * wholly Spanish. The same rule handles both shapes.
 */
export function pageColumns(ocrData) {
  const stripped = stripEditorialWrappers(String(ocrData || ''));
  if (!stripped.trim()) return [];
  return stripped
    .split(/<column-break\s*\/?>/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * A segment must be at least this many words before its share means anything.
 * The Ximénez columns run 150–400 words and the Codex's 100–500, so this floor
 * only ever excludes catchwords, folio numbers and stray marginalia.
 */
export const MIN_WORDS = 40;
/** Minimum broad function-word share to call a segment Spanish. */
export const MIN_SHARE = 0.18;
/**
 * Minimum Spanish-EXCLUSIVE share — the Romance-neighbour guard.
 *
 * Set from the measured distributions rather than picked, because the first
 * value chosen by eye (4.5%) admitted two pages of Brasseur's FRENCH commentary
 * on Landa, which quotes enough Spanish in its footnotes to score 6.4%. Across
 * the five books this mechanism runs on or is controlled against:
 *
 *   columns that are plainly Spanish (broad ≥30%)   exclusive p05 = 12.6–19.6%
 *   columns that are plainly not    (broad <18%)    exclusive p95 =  1.7–6.3%
 *
 * 10% sits in the empty middle: under every book's 5th percentile for Spanish
 * and over every book's 95th for everything else. Moving it is a decision about
 * that table, so re-run `scripts/audit/source-column-separation.mjs` and look at
 * the numbers before you do.
 */
export const MIN_EXCLUSIVE = 0.10;
/**
 * A page is declined outright when a column we did NOT accept still scores above
 * this on the broad measure — the split is then not clean enough to trust, and
 * half a parallel text in the Spanish lane is worse than nothing in it.
 */
export const MAX_REJECTED_SHARE = 0.10;

/** Does one segment clear both bars? */
function isSpanishSegment(c) {
  return c.words >= MIN_WORDS && c.share >= MIN_SHARE && c.exclusive >= MIN_EXCLUSIVE;
}

/**
 * The Spanish text of one page, or null.
 *
 * Returns every segment that tests as Spanish, joined — a page may legitimately
 * have one (the parallel-column case), or be entirely Spanish (the prologue and
 * the *Escolios* of the Ximénez manuscript, and every page of a book merely
 * catalogued as bilingual whose leaves are single-language).
 *
 * `null` covers three situations and does not distinguish them, because no
 * caller needs to act differently: no text at all, no segment clear enough, or a
 * page whose rejected column scored close enough to the bar that the split is
 * not trustworthy.
 *
 * A page whose columns ALL test as Spanish returns all of them. An earlier draft
 * declined that case as "a page we do not understand" — measurement killed it:
 * on a Spanish book printed in two columns (*Declaración de Instrumentos
 * Musicales*, 179 of 200 pages two-column) the rule threw away 91% of a genuinely
 * Spanish book. Both columns being Spanish is not a puzzle; it is a two-column
 * Spanish page.
 */
export function spanishColumnText(ocrData) {
  const cols = pageColumns(ocrData);
  if (!cols.length) return null;

  const scored = cols.map((text) => ({ text, ...spanishFunctionWordShare(text) }));
  const accepted = scored.filter(isSpanishSegment);
  if (!accepted.length) return null;

  // A rejected column that scored just under the bar means the split itself is
  // in doubt, and half of a parallel text reaching the Spanish lane is worse
  // than nothing reaching it. Only the BROAD share is checked here — the
  // exclusive test is the Romance guard and says nothing about how confident the
  // split is. Measured: columns that are plainly not Spanish sit at a broad
  // share of 0–6% (p95), so a rejected column above 10% is genuinely unusual.
  const rejected = scored.filter((c) => !accepted.includes(c));
  if (rejected.some((c) => c.words >= MIN_WORDS && c.share > MAX_REJECTED_SHARE)) return null;

  const words = accepted.reduce((s, c) => s + c.words, 0);
  return {
    text: accepted.map((c) => c.text).join('\n\n'),
    columns: cols.length,
    accepted: accepted.length,
    share: accepted.reduce((s, c) => s + c.share * c.words, 0) / words,
    exclusive: accepted.reduce((s, c) => s + c.exclusive * c.words, 0) / words,
    words,
  };
}

/**
 * Provenance marker written to `pages.translations.<iso>.source` by
 * `scripts/maintenance/extract-source-columns.mjs`.
 *
 * It is NOT `ai-pivot-en`, and the difference is the whole point: these words
 * were written by Ximénez in 1701 and by Sahagún's scribes in 1577. Every
 * surface that tells a reader or an agent where a translation came from branches
 * on this value — see `src/lib/quote-text.ts`. A quote is a claim about who
 * wrote the words.
 */
export const SOURCE_COLUMN_PROVENANCE = 'source-column';
