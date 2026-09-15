import { normalizeLanguageToken, sameLanguageFamily } from '@/lib/language-normalize';

/** ISO-639-1 code → canonical English name */
const CODE_TO_NAME: Record<string, string> = {
  ar: 'Arabic', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek',
  en: 'English', es: 'Spanish', fa: 'Persian', fr: 'French', he: 'Hebrew',
  hu: 'Hungarian', it: 'Italian', ja: 'Japanese', la: 'Latin', nl: 'Dutch',
  no: 'Norwegian', pl: 'Polish', pt: 'Portuguese', ru: 'Russian', sa: 'Sanskrit',
  sv: 'Swedish', tr: 'Turkish', zh: 'Chinese',
  // Indic / East-Asian 2-letter codes — Gemini emits these in <lang> tags for
  // South-Asian corpora; without them e.g. "hi" fell through to a bare "Hi".
  hi: 'Hindi', te: 'Telugu', ta: 'Tamil', mr: 'Marathi', ml: 'Malayalam',
  kn: 'Kannada', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu',
  ko: 'Korean', vi: 'Vietnamese',
};

/** Canonical English name → ISO-639-1 code */
const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(CODE_TO_NAME).map(([code, name]) => [name.toLowerCase(), code])
);

/**
 * ISO-639-2/3 (and other 3-letter) code → canonical English name.
 * Internet Archive and IIIF manifests emit 3-letter codes (`rus`, `lat`, `grc`).
 * This was the silent gap behind #2184 — IA's `metadata.language: "rus"` never
 * matched the catalogued "Russian" because nothing normalised the code.
 */
const CODE3_TO_NAME: Record<string, string> = {
  ara: 'Arabic', ces: 'Czech', cze: 'Czech', dan: 'Danish', deu: 'German', ger: 'German',
  ell: 'Greek', gre: 'Greek', grc: 'Greek', eng: 'English', spa: 'Spanish',
  fas: 'Persian', per: 'Persian', fra: 'French', fre: 'French', heb: 'Hebrew',
  hun: 'Hungarian', ita: 'Italian', jpn: 'Japanese', lat: 'Latin', nld: 'Dutch', dut: 'Dutch',
  nor: 'Norwegian', pol: 'Polish', por: 'Portuguese', rus: 'Russian', san: 'Sanskrit',
  swe: 'Swedish', tur: 'Turkish', zho: 'Chinese', chi: 'Chinese',
  hin: 'Hindi', tel: 'Telugu', tam: 'Tamil', mar: 'Marathi', syr: 'Syriac', urd: 'Urdu',
};

/**
 * Normalise a raw language token (ISO-639-1/2/3 code OR free-text name) to a
 * canonical display name, e.g. "rus" → "Russian", "la" → "Latin",
 * "Modern Greek" → "Greek". Returns null for empty / placeholder tokens so
 * callers can treat "no signal" distinctly from a real value.
 */
export function displayLanguage(raw: string | null | undefined): string | null {
  // ONE normaliser (2026-09-10). This used to strip any leading
  // modern|ancient|old|classical|medieval|middle|early and title-case only the first character,
  // which was wrong in two ways at once, measured over the vocabulary in
  // tests/unit/language-normalize-parity.test.ts:
  //   · it COLLAPSED DISTINCT LANGUAGES into their parent — "Old English" -> "English",
  //     "Old French" -> "French", "Middle English" -> "English", "Classical Chinese" -> "Chinese",
  //     and "Old Norse" -> "Norse", which is not a language at all;
  //   · it MANGLED CASE on anything it did not recognise — "Koine greek", "New latin",
  //     "Church slavonic", "Ottoman turkish", "Judeo-arabic", "High german".
  // 13 of 27 probe tokens disagreed with normalizeLanguageToken, which carries the considered
  // policy: collapse period variants that are the same language (Ancient/Modern Greek, Classical
  // Latin, Koine Greek, New Latin), preserve the ones that are distinct languages.
  //
  // Nothing had reached `books.language` yet (0 mangled values in production on 2026-09-10) — this
  // was a latent trap on the IMPORT path, since resolve-language.ts normalises every incoming
  // language through here. Comparison semantics are preserved by sameLanguage() below, which now
  // compares by FAMILY, so "Old French" still counts as the same language as "French" even though
  // the stored value keeps its register.
  return normalizeLanguageToken(raw);
}

/** Tokens that mean "no usable language signal". */
const PLACEHOLDER_LANGS = new Set([
  'none', 'n/a', 'na', 'unknown', 'und', 'null', '', 'multiple', 'mul',
  'mixed', 'various', 'zxx', 'undetermined',
]);

/**
 * True when two language tokens refer to the same language after normalisation.
 * Either argument may be a code or a display name.
 */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  // Compares by FAMILY, which is what every caller actually wants and what the old
  // displayLanguage-equality gave them by accident: it collapsed "Old French" to "French" before
  // comparing, so an Old French edition of a French work was correctly NOT flagged a translation.
  // Now that displayLanguage preserves the register, the collapse has to live here instead —
  // otherwise resolve-language.ts would start reporting spurious conflicts and edition-language.ts
  // would show a work language beside an identical edition language.
  // It also fixes a false DIFFERENCE the old version had: "Koine Greek" normalised to the
  // unrecognised "Koine greek" and so never matched "Greek".
  //
  // Normalise FIRST, then compare families — the two steps do different halves of the job and
  // neither alone is enough. languageFamily() strips a register prefix ("Old French" -> French) but
  // does not touch codes, does not collapse "Ancient Greek", and does not reject placeholders, so
  // sameLanguageFamily() on raw input answers false for Ancient Greek vs Greek and TRUE for
  // "Unknown" vs "Unknown". normalizeLanguageToken() handles codes, collapses the same-language
  // registers and maps placeholders to null; the family step then absorbs the registers that
  // legitimately survive normalisation.
  return sameLanguageFamily(normalizeLanguageToken(a), normalizeLanguageToken(b));
}

/**
 * Expand a language list to include both ISO codes and English names.
 * e.g. ["French", "la"] → ["French", "fr", "Latin", "la"]
 *
 * Source Library books use either form depending on import source.
 * This lets filters like exclude_languages=["French"] also catch books
 * stored as "fr", and vice-versa.
 */
export function expandLanguages(langs: string[]): string[] {
  const result = new Set<string>();
  for (const lang of langs) {
    result.add(lang);
    const lower = lang.toLowerCase();
    const code = NAME_TO_CODE[lower];
    if (code) result.add(code);
    const name = CODE_TO_NAME[lower];
    if (name) result.add(name);
  }
  return [...result];
}
