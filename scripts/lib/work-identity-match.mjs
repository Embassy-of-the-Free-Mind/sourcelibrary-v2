/**
 * work-identity-match.mjs — is this catalogue record the same WORK as this book?
 *
 * Pure functions, no I/O, so the gold set in
 * tests/unit/reference-set-work-identity.test.ts can exercise them directly.
 * That separation is the point: this logic was tuned five times against
 * whichever sample happened to be on screen, and step 4 of that tuning silently
 * lost verified true positives (Cicero's *De Officiis* → Grimald 1556) while
 * making the corpus look cleaner. It is now pinned to hand-verified pairs.
 *
 * THE KEY INSIGHT, after five failed rounds of ratio tuning
 * --------------------------------------------------------
 * MARC 240 exists precisely to name a work independently of how any edition
 * titles itself. It IS the join key. So the test is set CONTAINMENT of the
 * uniform title in our title — not a coverage ratio on the 245 display title,
 * which is the edition's marketing line and carries apparatus our title never has.
 *
 * Every ratio-based rule failed on the same two rocks. "De officiis." reduces to
 * ONE usable token, so any count- or fraction-based rule either discards it (a
 * false negative on a work that has been in English since 1556) or, once
 * loosened, lets "The cup to the dregs" match a Tibetan ritual text because
 * "dregs" is simultaneously an English word and a romanized Tibetan syllable.
 * Containment gets both right for a reason rather than by tuning.
 */

/** Bibliographic filler and container words that carry no work identity. */
export const TITLE_STOP = new Set([
  // English / Latin
  'the', 'and', 'with', 'from', 'that', 'this', 'for', 'des', 'der', 'die', 'und',
  'liber', 'libri', 'opus', 'opera', 'book', 'books', 'volume', 'tractatus',
  'english', 'translation', 'translated', 'works', 'text', 'new', 'notes',
  'introduction', 'edition', 'edited', 'selected', 'sive', 'seu', 'cum',

  // Romanized Tibetan container vocabulary — the exact equivalents of "opera
  // omnia" or "tractatus". `thor bu` = miscellanea, `bstan bcos` = treatise,
  // `rnam thar` = hagiography, `lo rgyus` = history, `sogs` = et cetera.
  // ⚠️ Assembled from context, not by a Tibetanist. Worth review by someone who
  // reads Tibetan before this list is trusted to exclude a real match.
  'thor', 'sogs', 'skor', 'bstan', 'bcos', 'rnam', 'thar', 'rgyus', 'chos',

  // Romanized Sanskrit / Indic container vocabulary.
  'grantha', 'sastra', 'shastra', 'sutra', 'sutras', 'tantra', 'purana',
  'samhita', 'bhasya', 'tika', 'vritti',
]);

export const normaliseTitle = (s) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ').trim();

export function titleTokens(s) {
  return normaliseTitle(s).split(/\s+/).filter((t) => t.length >= 4 && !TITLE_STOP.has(t));
}

export const bookTitleTokens = (...titles) => [...new Set(titles.flatMap(titleTokens))];

/**
 * Crude inflectional stem, so a uniform title and our title of the same work
 * agree across case endings: "magiae" ⇔ "magia", "officiis" ⇔ "officii".
 * Deliberately shallow — it only has to bridge declension, not lemmatise.
 */
export function stem(t) {
  return t.replace(/(?:ibus|arum|orum|is|ae|am|um|us|os|as|es|em|i|o|a|e)$/, '');
}

/**
 * PRIMARY TEST — is every token of the MARC 240 uniform title present in our
 * title? Word order is ignored: a uniform title is a set, not a phrase
 * ("Formula vitae honestae" ⇔ our "De formula honestae vitae").
 *
 * Returns null when there is no uniform title, no book tokens, or any uniform
 * token is absent. Null means "not established", never "no prior exists".
 *
 * Verified behaviour (real LoC rows, see the gold set):
 *   "De officiis."            ⊆ "De officiis. Add: Paradoxa Stoicorum"      ✓
 *   "Formula vitae honestae." ⊆ "De formula honestae vitae"                 ✓
 *   "Moralia."                ⊆ "Plutarchi Chaeronensis Moralia"            ✓
 *   "Elements."               ⊆ "Στοιχεῖα (Elements)"                       ✓
 *   "Iliad."                  ⊆ "Homer, Iliad with Scholia"                 ✓
 *   "Magiae naturalis."       ⊆ "Magia Naturalis"              (stemmed)    ✓
 *   "Legs bshad gser phreng." ⊆ "Neyphug Thor bu Legs bshad gser phreng"    ✓
 *   "Calice jusqu'à la lie."  ⊄ Tibetan ritual text                        ✗
 *   "ʼDod paʼi bstan bcos."   ⊄ "she bya rab tu gsal ba'I bstan bcos"      ✗
 */
export function uniformTitleContainment(bookToks, uniformTitle) {
  const ut = titleTokens(uniformTitle);
  if (!ut.length || !bookToks?.length) return null;
  const bookStems = new Set(bookToks.map(stem));
  if (ut.some((t) => !bookStems.has(stem(t)))) return null;
  return {
    score: 1,
    hits: ut.length,
    basis: 'uniform_title_containment',
    uniform_tokens: ut.length,
    book_tokens: bookToks.length,
  };
}

/**
 * FALLBACK — bag-of-tokens overlap against the 245 display title, for the ~32%
 * of rows with no 240. Capped below the strong threshold so it can surface a
 * hint for screening but never assert a work match by itself.
 */
export function displayTitleOverlap(bookToks, displayTitle) {
  const rt = new Set(titleTokens(displayTitle));
  if (!rt.size || !bookToks?.length) return null;
  const hits = bookToks.filter((t) => rt.has(t)).length;
  if (!hits) return null;
  const bookCoverage = hits / bookToks.length;
  const recordCoverage = hits / rt.size;
  return {
    score: Math.min(0.55, Math.min(bookCoverage, recordCoverage)),
    hits,
    basis: 'display_title_overlap',
    book_coverage: bookCoverage,
    record_coverage: recordCoverage,
    book_tokens: bookToks.length,
    record_tokens: rt.size,
  };
}

/** Best available work-identity signal for a book/row pair, or null. */
export function matchWorkIdentity(bookToks, row) {
  return uniformTitleContainment(bookToks, row.uniform_title)
    ?? displayTitleOverlap(bookToks, row.title);
}

/** Threshold at which a match is strong enough to require screening. */
export const STRONG_WORK_IDENTITY = 0.6;
