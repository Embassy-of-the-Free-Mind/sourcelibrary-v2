/**
 * Languages written in a non-Latin script, where a romanised transliteration
 * is worth offering beside the transcription.
 *
 * One list, imported by every reader that offers the pane. It lived inline in
 * TranslationEditor; a second copy in the v2 reader would drift the moment
 * either gained a language, and the failure would be silent — a book quietly
 * losing its transliteration pane in one reader but not the other.
 */
const NON_LATIN_LANGUAGES = new Set([
  'greek', 'hebrew', 'arabic', 'persian', 'ottoman turkish',
  'syriac', 'chinese', 'japanese', 'korean', 'sanskrit',
  'armenian', 'georgian', 'ethiopic', 'coptic', 'tibetan',
  'russian', 'church slavonic',
]);

export function hasNonLatinScript(language?: string): boolean {
  if (!language) return false;
  return NON_LATIN_LANGUAGES.has(language.toLowerCase());
}
