/**
 * Languages written in a non-Latin script, where a romanised transliteration
 * is worth offering beside the transcription.
 *
 * One list, imported by every reader that offers the pane. It lived inline in
 * TranslationEditor; a second copy in the v2 reader would drift the moment
 * either gained a language, and the failure would be silent — a book quietly
 * losing its transliteration pane in one reader but not the other.
 *
 * Matching is by NAME within the label, not by exact equality. `books.language`
 * is curator-entered prose, and the corpus is full of compound and qualified
 * labels that an exact-match set silently missed: "Hebrew and Judeo-Arabic"
 * (15 books), "Greek-Latin" (20), "Hebrew and Aramaic" (10), "Classical
 * Chinese / Japanese" (3). Each of those is a book in a non-Latin script whose
 * readers were never offered the pane, and nothing anywhere reported it.
 *
 * The tokens are chosen so that a Latin-script language cannot contain one:
 * none of them is a substring of Latin, Italian, Spanish, German, Dutch,
 * French or English. Add carefully for the same reason.
 */
const NON_LATIN_SCRIPT_NAMES = [
  'greek', 'hebrew', 'arabic', 'persian', 'syriac', 'aramaic',
  'chinese', 'japanese', 'korean', 'sanskrit', 'pali', 'hindi', 'urdu',
  'armenian', 'georgian', 'ethiopic', 'amharic', 'coptic', 'tibetan', 'thai',
  'russian', 'slavonic', 'yiddish', 'akkadian', 'ottoman turkish',
];

/**
 * Labels that contain a script name above but are already romanised in our
 * own text, so a transliteration pane would offer to convert Latin to Latin.
 *
 * Sumerian is the case that matters: the 377 Sumerian works come from ETCSL,
 * whose transcription is itself a romanisation ("men edin-na nam-lugal-la"),
 * so there is nothing left to transliterate. It is listed here rather than
 * simply left out of the names above because "why is this one excluded" is a
 * question someone will ask.
 */
const ALREADY_ROMANISED = ['sumerian'];

export function hasNonLatinScript(language?: string): boolean {
  if (!language) return false;
  const l = language.toLowerCase();
  if (ALREADY_ROMANISED.some(name => l.includes(name))) return false;
  return NON_LATIN_SCRIPT_NAMES.some(name => l.includes(name));
}
