/**
 * Word-form folding for the keyword search lanes.
 *
 * PRIOR ART: src/lib/classical-name-forms.ts — folds personal-name variants
 * (Aristoteles/Aristotle), not common-noun morphology; Postgres `page_text_config`
 * stems page text in the Spanish lane only. Neither reaches the books_catalog
 * ILIKE lane or the collections regex, which match raw substrings.
 *
 * Why: the book and collection lanes match the query as a substring, so
 * "botanical" found nothing while 28 titles contain "Botan…" and 89 books carry
 * the subject keyword "botany" (measured 2026-10-01). A query's related forms
 * (botany / botanical / botanic) share a stem, and because the stem is a PREFIX
 * of the query word, `%stem%` matches everything `%word%` did — it only widens.
 *
 * Deliberately conservative: a handful of English derivational suffixes, a
 * minimum stem length, ASCII words only. Names, Latin titles and non-Latin
 * scripts pass through untouched. A full Porter stemmer was rejected because it
 * over-folds ("general" → "gener", "university" → "univers").
 */

/** Longest first: the first suffix that leaves a long-enough stem wins. */
const DERIVATIONAL_SUFFIXES = ['ically', 'ical', 'isms', 'ism', 'ists', 'ist', 'ics', 'ies', 'ic', 'y'];
const MIN_STEM = 5;
/** Plain plurals may leave a 4-letter stem ("roses" → "rose"). */
const MIN_PLURAL_STEM = 4;

/** Endings re-added to a stem to guess the exact forms a keyword array holds. */
const KEYWORD_ENDINGS = ['', 'y', 'ical', 'ic', 'ics', 'ism', 'ist', 'ists', 'ies', 's', 'al', 'e'];

const FOLDABLE = /^[a-z]+$/;

/**
 * The prefix a word's related forms share, lowercased — or the lowercased word
 * itself when nothing can be safely stripped.
 *   botanical → botan, botany → botan, astrological → astrolog,
 *   mysticism → mystic, roses → rose, magic → magic, corpus → corpus
 */
export function matchStem(word: string): string {
  const w = word.toLowerCase();
  if (!FOLDABLE.test(w)) return w;
  for (const suffix of DERIVATIONAL_SUFFIXES) {
    if (w.endsWith(suffix) && w.length - suffix.length >= MIN_STEM) {
      return w.slice(0, -suffix.length);
    }
  }
  // Plural -s, but not -ss/-us/-is (glass, corpus, genesis).
  if (/[^sui]s$/.test(w) && w.length - 1 >= MIN_PLURAL_STEM) return w.slice(0, -1);
  return w;
}

/**
 * Likely exact surface forms of a word, for matching a keyword ARRAY (where a
 * substring cannot be used). Includes the word itself, lower- and title-cased,
 * because `subject_keywords` mixes "Assyriology" with "astrology".
 * Returns just the word's two casings when it has no foldable stem.
 */
export function keywordVariants(word: string): string[] {
  const w = word.toLowerCase();
  const stem = matchStem(w);
  const forms = new Set<string>([w]);
  if (stem !== w) {
    for (const ending of KEYWORD_ENDINGS) forms.add(stem + ending);
  }
  const out: string[] = [];
  for (const f of forms) {
    out.push(f, f.charAt(0).toUpperCase() + f.slice(1));
  }
  return [...new Set(out)];
}

/**
 * Case-insensitive regex for a free-text query in which each word is replaced
 * by its stem — for lanes that regex-match short text (collection names and
 * descriptions). Words stay in order; a stem may run on to the end of its word before the next one.
 */
export function stemmedQueryRegex(query: string): RegExp {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return new RegExp(escape(query), 'i');
  return new RegExp(words.map(w => escape(matchStem(w))).join('\\w*\\s+'), 'i');
}
