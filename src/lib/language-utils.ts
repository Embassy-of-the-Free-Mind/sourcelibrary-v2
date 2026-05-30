/** ISO-639-1 code → canonical English name */
const CODE_TO_NAME: Record<string, string> = {
  ar: 'Arabic', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek',
  en: 'English', es: 'Spanish', fa: 'Persian', fr: 'French', he: 'Hebrew',
  hu: 'Hungarian', it: 'Italian', ja: 'Japanese', la: 'Latin', nl: 'Dutch',
  no: 'Norwegian', pl: 'Polish', pt: 'Portuguese', ru: 'Russian', sa: 'Sanskrit',
  sv: 'Swedish', tr: 'Turkish', zh: 'Chinese',
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
  if (!raw) return null;
  const cleaned = String(raw)
    .toLowerCase()
    .trim()
    .replace(/^(modern|ancient|old|classical|medieval|middle|early)\s+/, '');
  if (!cleaned) return null;
  if (PLACEHOLDER_LANGS.has(cleaned)) return null;
  if (CODE_TO_NAME[cleaned]) return CODE_TO_NAME[cleaned];
  if (CODE3_TO_NAME[cleaned]) return CODE3_TO_NAME[cleaned];
  // Already a display name: title-case it for storage consistency.
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
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
  const na = displayLanguage(a);
  const nb = displayLanguage(b);
  return !!na && !!nb && na.toLowerCase() === nb.toLowerCase();
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
