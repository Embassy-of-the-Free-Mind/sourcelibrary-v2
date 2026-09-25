/**
 * Language NAME → BCP-47 tag, for the HTML `lang` attribute.
 *
 * PRIOR ART: src/components/reader/NotesRenderer.tsx `getLanguageCode` — a
 * font/RTL helper that knew six Perso-Arabic-script languages and returned
 * `undefined` for everything else, so the transcription pane of a Latin book
 * inherited `lang="en"` from <html> and a screen reader spoke the Latin with
 * English pronunciation rules (#5115). src/lib/language-normalize.ts holds the
 * canonical NAME vocabulary but no codes; scripts/lib/language-normalize.mjs
 * maps MARC three-letter codes → names, the opposite direction.
 *
 * Why it matters: assistive technology picks its speech voice, its
 * pronunciation rules and its braille table from `lang`. Latin read as
 * English is unintelligible; Greek read as English is worse. The map is
 * keyed by the names `books.language` actually holds (live counts 2026-09-25),
 * with historical stages folded into the modern tag where no separate code
 * exists, and compound labels ("Latin-German", "Greek/Latin") resolved to
 * their FIRST language — the reader can only carry one attribute per pane.
 *
 * Returns `undefined` for unknown, mixed-unknown ("Multiple") or placeholder
 * values ("auto-detect", "e") so the element inherits from its ancestor rather
 * than asserting a wrong language.
 */

const BY_NAME: Record<string, string> = {
  // ── the bulk of the corpus ──
  latin: 'la',
  chinese: 'zh',
  'classical chinese': 'lzh',
  'literary chinese': 'lzh',
  'traditional chinese': 'zh-Hant',
  'simplified chinese': 'zh-Hans',
  mandarin: 'zh',
  kanbun: 'lzh',
  english: 'en',
  'middle english': 'enm',
  'old english': 'ang',
  'anglo-saxon': 'ang',
  german: 'de',
  'early new high german': 'de',
  'middle high german': 'gmh',
  'old high german': 'goh',
  tibetan: 'bo',
  greek: 'el',
  'ancient greek': 'grc',
  'classical greek': 'grc',
  'koine greek': 'grc',
  'byzantine greek': 'grc',
  french: 'fr',
  'middle french': 'frm',
  'old french': 'fro',
  italian: 'it',
  dutch: 'nl',
  'middle dutch': 'dum',
  'old dutch': 'odt',
  sanskrit: 'sa',
  sumerian: 'sux',
  arabic: 'ar',
  'judeo-arabic': 'jrb',
  korean: 'ko',
  russian: 'ru',
  hebrew: 'he',
  'biblical hebrew': 'hbo',
  'samaritan hebrew': 'smp',
  japanese: 'ja',
  'egyptian hieroglyphs': 'egy',
  egyptian: 'egy',
  demotic: 'egy',
  coptic: 'cop',
  syriac: 'syc',
  spanish: 'es',
  armenian: 'hy',
  persian: 'fa',
  farsi: 'fa',
  javanese: 'jv',
  malay: 'ms',
  pali: 'pi',
  "ge'ez": 'gez',
  geez: 'gez',
  tamil: 'ta',
  hindi: 'hi',
  'ottoman turkish': 'ota',
  turkish: 'tr',
  portuguese: 'pt',
  danish: 'da',
  nahuatl: 'nah',
  aramaic: 'arc',
  'yucatec maya': 'yua',
  'old norse': 'non',
  akkadian: 'akk',
  bengali: 'bn',
  polish: 'pl',
  maori: 'mi',
  hawaiian: 'haw',
  hausa: 'ha',
  vietnamese: 'vi',
  swahili: 'sw',
  burmese: 'my',
  irish: 'ga',
  avestan: 'ae',
  zulu: 'zu',
  marathi: 'mr',
  georgian: 'ka',
  'church slavonic': 'cu',
  'old church slavonic': 'cu',
  czech: 'cs',
  hungarian: 'hu',
  icelandic: 'is',
  norwegian: 'no',
  swedish: 'sv',
  urdu: 'ur',
  gujarati: 'gu',
  kannada: 'kn',
  malayalam: 'ml',
  punjabi: 'pa',
  telugu: 'te',
  // ── MARC / ISO three-letter codes that leaked into `language` ──
  lat: 'la',
  ger: 'de',
  deu: 'de',
  fre: 'fr',
  fra: 'fr',
  ita: 'it',
  dut: 'nl',
  nld: 'nl',
  eng: 'en',
  grc: 'grc',
  gre: 'el',
  heb: 'he',
  ara: 'ar',
  chi: 'zh',
  zho: 'zh',
  tib: 'bo',
  san: 'sa',
  spa: 'es',
  por: 'pt',
  rus: 'ru',
  per: 'fa',
};

/** Values that mean "we don't know" — never assert a tag for these. */
const NOT_A_LANGUAGE = new Set(['', 'unknown', 'auto-detect', 'multiple', 'mixed', 'various', 'e', 'ne', 'n/a', 'none', 'transliteration']);

/**
 * The BCP-47 tag for a `books.language` / `pages.ocr.language` value, or
 * `undefined` when none can be asserted honestly.
 *
 *   languageToBcp47('Latin')          → 'la'
 *   languageToBcp47('Latin-German')   → 'la'   (first language of a compound)
 *   languageToBcp47('Hebrew and Aramaic') → 'he'
 *   languageToBcp47('Multiple')       → undefined
 */
export function languageToBcp47(language: string | null | undefined): string | undefined {
  if (!language) return undefined;
  const lower = language.trim().toLowerCase();
  if (NOT_A_LANGUAGE.has(lower)) return undefined;
  if (BY_NAME[lower]) return BY_NAME[lower];
  // Compound labels: "Latin-German", "Greek/Latin", "Hebrew, Aramaic, and
  // Judeo-Arabic", "Latin (with Greek)". Take the first named language.
  const first = lower.split(/\s*(?:[-/,;]|\band\b|\bwith\b|\()\s*/)[0]?.trim();
  if (first && first !== lower && BY_NAME[first]) return BY_NAME[first];
  // Qualified names: "Latin (Renaissance)", "Medieval Latin", "Modern Greek".
  for (const [name, tag] of Object.entries(BY_NAME)) {
    if (name.length >= 4 && new RegExp(`\\b${name}\\b`).test(lower)) return tag;
  }
  return undefined;
}

/**
 * The `lang` attribute a TITLE should carry. Only the ORIGINAL title is in
 * the book's language; `display_title` is usually an English rendering, so
 * tagging it with the book's language would be as wrong as the inherited
 * `en` is for the original. Returns undefined for English books and for
 * anything shown that is not the original title.
 */
export function titleLang(
  shown: string | null | undefined,
  book: { title?: string | null; language?: string | null },
): string | undefined {
  if (!shown || !book.title || shown !== book.title) return undefined;
  const tag = languageToBcp47(book.language);
  return tag && tag !== 'en' ? tag : undefined;
}
