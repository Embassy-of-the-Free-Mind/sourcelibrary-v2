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
 *
 * Second pass (#5517, measured 2026-10-07 on 38 queries): the first rules
 * needed five letters left after the suffix, so every four-letter root still
 * failed. "magical" found 35 books where "magic" finds 176, "optical" 1 where
 * "optics" finds 51, "witches" 27 of 52, "astronomer" 2 of 295. Added: -ical
 * over a short root keeps the -ic ("magical" → "magic"), -es after a sibilant,
 * -istic, -ician, the -nomer/-loger/-sopher/-grapher agent nouns, and a short
 * table of families no suffix rule can join (medical/medicine, herbal/herbs,
 * poetic/poetry/poems, surgical/surgery, chemical/chymical, witchcraft).
 * A general -al, -er or -ian rule was NOT added: "general" → "gener",
 * "silver" → "silv", "Herodian" → "herod".
 */

/** Longest first: the first suffix that leaves a long-enough stem wins. */
const DERIVATIONAL_SUFFIXES = ['ically', 'istic', 'ical', 'isms', 'ism', 'ists', 'ist', 'ics', 'ies', 'ic', 'y'];
const MIN_STEM = 5;
/** Plain plurals may leave a 4-letter stem ("roses" → "rose"). */
const MIN_PLURAL_STEM = 4;

/** Endings re-added to a stem to guess the exact forms a keyword array holds. */
const KEYWORD_ENDINGS = ['', 'y', 'ical', 'ic', 'ics', 'ism', 'ist', 'ists', 'ies', 's', 'al', 'e', 'er', 'ian'];

const FOLDABLE = /^[a-z]+$/;

/**
 * Families no suffix rule joins. `stems` are what a title is searched for,
 * `words` are the forms that belong (and the exact forms tried against a
 * keyword array). Kept to the library's own subjects; each stem was read
 * against the catalogue before it went in.
 */
const FAMILIES: Array<{ stems: string[]; words: string[] }> = [
  // "medic" also reaches the Latin (materia medica, medicus) and, as noise, "Medici".
  { stems: ['medic'], words: ['medical', 'medicine', 'medicines', 'medicinal'] },
  // Not a bare "herb": it starts Herborn (an academy in hundreds of imprints), Herbert, Herbrand.
  { stems: ['herba', 'herbs', 'herbes'], words: ['herbs', 'herbal', 'herbals', 'herbalism', 'herbalist', 'herbalists'] },
  { stems: ['poet', 'poem'], words: ['poet', 'poets', 'poetic', 'poetical', 'poetry', 'poem', 'poems'] },
  // "chirurgery" / "chirurgical" are the period English spellings.
  { stems: ['surg', 'chirurg'], words: ['surgical', 'surgery', 'surgeon', 'surgeons', 'chirurgery', 'chirurgical'] },
  { stems: ['chemi', 'chymi'], words: ['chemical', 'chemistry', 'chemist', 'chemists', 'chymical', 'chymistry', 'chymist', 'chymists'] },
  { stems: ['witch'], words: ['witch', 'witches', 'witchcraft'] },
];
const FAMILY_OF = new Map<string, { stems: string[]; words: string[] }>(
  FAMILIES.flatMap(f => f.words.map(w => [w, f] as const)),
);

/**
 * The prefix a word's related forms share, lowercased — or the lowercased word
 * itself when nothing can be safely stripped. Always a prefix of the word.
 *   botanical → botan, botany → botan, astrological → astrolog,
 *   mysticism → mystic, roses → rose, magic → magic, corpus → corpus,
 *   magical → magic, witches → witch, astronomers → astronom, magician → magic
 */
export function matchStem(word: string): string {
  const w = word.toLowerCase();
  if (!FOLDABLE.test(w)) return w;
  // Plural first, so "botanists" and "astronomers" reach the rules below.
  // -es after a sibilant ("witches"); else -s, but not -ss/-us/-is (glass, corpus, genesis).
  let base = w;
  if (/(ch|sh|x|ss|zz)es$/.test(w) && w.length - 2 >= MIN_PLURAL_STEM) base = w.slice(0, -2);
  else if (/[^sui]s$/.test(w) && w.length - 1 >= MIN_PLURAL_STEM) base = w.slice(0, -1);

  for (const candidate of base === w ? [w] : [w, base]) {
    for (const suffix of DERIVATIONAL_SUFFIXES) {
      if (candidate.endsWith(suffix) && candidate.length - suffix.length >= MIN_STEM) {
        return candidate.slice(0, -suffix.length);
      }
    }
  }
  // -ical over a four-letter root: keep the -ic ("magical" → "magic", "optical" → "optic").
  if (base.endsWith('ical') && base.length - 2 >= MIN_STEM) return base.slice(0, -2);
  // Agent nouns, two shapes only. -ician ("magician" → "magic", "physician" → "physic"): a
  // general -ian rule folds names ("Herodian" → "herod", "Christian" → "christ").
  if (base.endsWith('ician') && base.length - 3 >= MIN_STEM) return base.slice(0, -3);
  // And those of the -nomy / -logy / -sophy / -graphy words.
  if (/(nom|log|soph|graph)er$/.test(base) && base.length - 2 >= MIN_STEM) return base.slice(0, -2);
  return base;
}

/**
 * Every word-start a title is searched for: the stems of the word's family
 * when it has one, else its one stem.
 *   medicine → [medic], poetry → [poet, poem], herbal → [herba, herbs, herbes],
 *   botanical → [botan]
 */
export function matchStems(word: string): string[] {
  const w = word.toLowerCase();
  return FAMILY_OF.get(w)?.stems ?? [matchStem(w)];
}

/** True when folding searches for anything beyond the word as typed. */
export function hasWordForms(word: string): boolean {
  const w = word.toLowerCase();
  const stems = matchStems(w);
  return stems.length !== 1 || stems[0] !== w;
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
  const forms = new Set<string>([w, ...(FAMILY_OF.get(w)?.words ?? [])]);
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
 * Case-insensitive regex for a free-text query that also matches each word's
 * related forms — for lanes that regex-match short text (collection names and
 * descriptions). Words stay in order; a stem may run on to the end of its word
 * before the next one.
 *
 * A stem must START a word: unanchored, "optic" matched "Coptic" and "herb"
 * matched "Sherborne". The word as typed still matches anywhere, as it did
 * before folding, so this never finds less than the plain regex. Words with no
 * related forms (names, Latin, every non-Latin script) are matched as typed and
 * get no `\b`, which is ASCII-only in JavaScript and would never match 本草.
 */
export function stemmedQueryRegex(query: string): RegExp {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return new RegExp(escape(query), 'i');
  const alternatives = (w: string) => {
    if (!hasWordForms(w)) return escape(w);
    return `(?:\\b(?:${matchStems(w).map(escape).join('|')})|${escape(w)})`;
  };
  return new RegExp(words.map(alternatives).join('\\w*\\s+'), 'i');
}
