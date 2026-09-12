/**
 * Canonical language-token normalisation.
 *
 * Source Library had FOUR uncontrolled language vocabularies when this was
 * written (2026-08-21, #4117): `language-utils.ts` on the read path,
 * `scripts/maintenance/normalize-language-tags.mjs` on the write path, the
 * per-source maps under `scripts/iiif-discovery/sources/`, and the free-text
 * `<language>` tag the OCR model writes into `pages.ocr.data`, which had none
 * at all. This file is the merge of the first two, extended to survive the
 * fourth. See `.claude/docs/invariants/language-fields.md`.
 *
 * Twin convention: `scripts/lib/language-normalize.mjs` is a pinned copy for
 * plain-node workers, held identical by
 * `tests/unit/language-normalize-parity.test.ts`. Change both sides or neither.
 *
 * DELIBERATE DIFFERENCE from `displayLanguage()` in `language-utils.ts`: that
 * function strips every period prefix, so "Old English" becomes "English" and
 * "Middle High German" becomes "High German" — distinct languages merged into
 * their modern descendants. Here, variant prefixes collapse ("Ancient Greek" →
 * "Greek", which is what the OCR tag needs) EXCEPT for the forms in
 * DISTINCT_VARIANTS, which are real separate languages and survive intact.
 * The read path is NOT rewired to use this yet — that belongs to #4089/#3893,
 * because changing `expandLanguages()` changes what search returns.
 */

/** ISO-639-1 -> canonical English name. */
const CODE2: Record<string, string> = {
  ar: 'Arabic', bn: 'Bengali', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek',
  en: 'English', es: 'Spanish', fa: 'Persian', fr: 'French', gu: 'Gujarati',
  he: 'Hebrew', hi: 'Hindi', hu: 'Hungarian', it: 'Italian', ja: 'Japanese',
  kn: 'Kannada', ko: 'Korean', la: 'Latin', ml: 'Malayalam', mr: 'Marathi',
  nl: 'Dutch', no: 'Norwegian', pa: 'Punjabi', pl: 'Polish', pt: 'Portuguese',
  ru: 'Russian', sa: 'Sanskrit', sv: 'Swedish', ta: 'Tamil', te: 'Telugu',
  tr: 'Turkish', ur: 'Urdu', vi: 'Vietnamese', zh: 'Chinese',
};

/** ISO-639-2/3 and MARC -> canonical English name. */
const CODE3: Record<string, string> = {
  ara: 'Arabic', arm: 'Armenian', ben: 'Bengali', ces: 'Czech', chi: 'Chinese',
  chu: 'Church Slavonic', cze: 'Czech', dan: 'Danish', deu: 'German', dut: 'Dutch',
  egy: 'Egyptian', ell: 'Greek', eng: 'English', enm: 'Middle English',
  fas: 'Persian', fra: 'French', fre: 'French', frm: 'Middle French',
  fro: 'Old French', geo: 'Georgian', ger: 'German', gmh: 'Middle High German',
  grc: 'Greek', gre: 'Greek', heb: 'Hebrew', hin: 'Hindi', hun: 'Hungarian',
  ice: 'Icelandic', ita: 'Italian', jpn: 'Japanese', kor: 'Korean', lat: 'Latin',
  mar: 'Marathi', nah: 'Nahuatl', nld: 'Dutch', nor: 'Norwegian', ota: 'Ottoman Turkish',
  per: 'Persian', pol: 'Polish', por: 'Portuguese', rus: 'Russian', san: 'Sanskrit',
  spa: 'Spanish', swe: 'Swedish', syr: 'Syriac', tam: 'Tamil', tel: 'Telugu',
  tur: 'Turkish', urd: 'Urdu', zho: 'Chinese',
};

/** Variant spellings -> canonical. Curly-apostrophe forms included on purpose. */
const SYNONYM: Record<string, string> = {
  geez: "Ge'ez", "ge'ez": "Ge'ez", 'ge’ez': "Ge'ez", ethiopic: "Ge'ez",
  'quiche maya': "K'iche' Maya", 'quiché maya': "K'iche' Maya",
  // The OCR model writes the language of the Popol Vuh with the MODIFIER LETTER
  // APOSTROPHE (U+02BC, "Kʼicheʼ") — the linguistically correct saltillo — while
  // the catalogue writes ASCII. Without both spellings a tally over page tags
  // counts one language twice and reports a bilingual book as trilingual, which
  // is the non-latin-text-operations trap in miniature: the fold has to happen on
  // BOTH sides or the comparison is meaningless.
  "k'iche'": "K'iche' Maya", 'kʼicheʼ': "K'iche' Maya",
  "k'iche": "K'iche' Maya", 'kʼiche': "K'iche' Maya",
  "k'iche' maya": "K'iche' Maya", 'kʼicheʼ maya': "K'iche' Maya",
  quiche: "K'iche' Maya", 'quiché': "K'iche' Maya",
  castilian: 'Spanish', flemish: 'Dutch',
  hellenistic: 'Greek', attic: 'Greek', koine: 'Greek',
  'high german': 'German', 'low german': 'German',
};

/**
 * Tokens meaning "no usable signal". Checked BEFORE any delimiter split, which
 * is what keeps "N/A" from being read as two languages named "n" and "a" — a
 * real bug in a throwaway probe that briefly reported 1-2% "n" across the corpus.
 */
const PLACEHOLDER = new Set([
  '', '-', '--', 'n/a', 'na', 'none', 'null', 'nil', 'unknown', 'und',
  'undetermined', 'unidentified', 'illegible', 'blank', 'multiple', 'mul',
  'mixed', 'various', 'zxx', 'auto-detect', 'auto', 'visual', 'no text',
  'not applicable', 'unclear', 'indeterminate',
]);

/** Real languages whose canonical name contains a hyphen or a period word. */
const DISTINCT_VARIANTS = new Set([
  'old english', 'middle english', 'old french', 'middle french',
  'middle high german', 'old high german', 'early new high german',
  'old church slavonic', 'church slavonic', 'old norse', 'old irish',
  'classical chinese', 'literary chinese', 'ottoman turkish', 'biblical hebrew',
  'samaritan hebrew', 'judeo-arabic', 'judeo-italian', 'judeo-greek',
  'judeo-persian', 'judeo-occitan', 'anglo-norman', 'scottish gaelic',
  'egyptian hieroglyphs',
]);

/** Prefixes that are period markers, not separate languages. */
const VARIANT_PREFIX = /^(ancient|modern|classical|koine|medieval|mediaeval|late|early|vulgar|new)\s+/;

/**
 * Historical stages that are distinct languages for CATALOGUING but the same
 * language for "is this book bilingual?".
 *
 * This exists because of a measured artifact: on the first full corpus run,
 * "Chinese + Classical Chinese" was 2,387 of 6,230 apparently-bilingual books —
 * 38% of the finding — and every one was the OCR model emitting two labels for
 * one text, not a facing-page edition. Same trap for the Korean hanmun corpus,
 * where pages alternate between "Chinese" and "Classical Chinese" tags.
 *
 * Keep the names distinct (a reader looking for Old English does not want
 * modern English) but compare by family before claiming a second language.
 */
const FAMILY: Record<string, string> = {
  // Script and register variants of Chinese. "Traditional Chinese" was missing
  // until a Japanese go manual came back tagged Chinese 44% / Japanese 36% /
  // Classical Chinese 12% / Traditional Chinese 8% — four labels, one text.
  'Classical Chinese': 'Chinese', 'Literary Chinese': 'Chinese',
  'Traditional Chinese': 'Chinese', 'Simplified Chinese': 'Chinese',
  'Mandarin': 'Chinese', 'Kanbun': 'Chinese',
  'Old English': 'English', 'Middle English': 'English',
  'Old French': 'French', 'Middle French': 'French',
  'Middle High German': 'German', 'Old High German': 'German',
  'Early New High German': 'German',
  'Biblical Hebrew': 'Hebrew', 'Samaritan Hebrew': 'Hebrew',
  'Old Church Slavonic': 'Church Slavonic',
};

/**
 * The family a canonical language name belongs to, for equivalence tests.
 * Returns the name itself when it heads its own family.
 */
export function languageFamily(name: string | null | undefined): string | null {
  if (!name) return null;
  return FAMILY[name] || name;
}

/** True when two canonical names are the same language for bilingual purposes. */
export function sameLanguageFamily(a: string | null | undefined, b: string | null | undefined): boolean {
  const fa = languageFamily(a);
  const fb = languageFamily(b);
  return !!fa && !!fb && fa === fb;
}

/** Title-case a word, including across hyphens: "judeo-arabic" -> "Judeo-Arabic". */
const TITLE = (s: string) =>
  s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-');

/**
 * Normalise ONE token (a code or a free-text name) to a canonical language
 * name, or null when the token carries no language signal.
 */
export function normalizeLanguageToken(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw).toLowerCase().trim();
  // "Sanskrit (transliterated)", "undetermined (Voynich script)"
  s = s.replace(/\([^)]*\)/g, ' ');
  // "Italian in Italian script"
  s = s.replace(/\s+in\s+[\w'’-]+\s+script\b/g, ' ');
  s = s.replace(/[.\s]+$/, '').replace(/^[.\s]+/, '').replace(/\s+/g, ' ').trim();
  if (PLACEHOLDER.has(s)) return null;
  if (!s) return null;
  if (SYNONYM[s]) return SYNONYM[s];
  if (CODE2[s]) return CODE2[s];
  if (CODE3[s]) return CODE3[s];
  if (DISTINCT_VARIANTS.has(s)) return s.split(' ').map(TITLE).join(' ');
  const stripped = s.replace(VARIANT_PREFIX, '').trim();
  if (stripped && stripped !== s) {
    if (PLACEHOLDER.has(stripped)) return null;
    if (SYNONYM[stripped]) return SYNONYM[stripped];
    if (CODE2[stripped]) return CODE2[stripped];
    if (CODE3[stripped]) return CODE3[stripped];
    return stripped.split(' ').map(TITLE).join(' ');
  }
  return s.split(' ').map(TITLE).join(' ');
}

/**
 * Parse a possibly-compound language string into an ordered, de-duplicated list
 * of canonical names. Handles "Greek-Latin", "Hebrew and Aramaic",
 * "Cakchiquel / English", "Arabic, Ottoman Turkish, Persian".
 *
 * Order is preserved from the source string; callers that want order by
 * measured page share must sort it themselves.
 */
export function parseLanguageField(raw: string | null | undefined): string[] {
  if (raw == null) return [];
  const cleaned = String(raw).toLowerCase().trim();
  if (PLACEHOLDER.has(cleaned)) return [];
  const whole = normalizeLanguageToken(raw);
  // A whole-string match wins: "Judeo-Arabic" must not split on its hyphen.
  if (whole && (DISTINCT_VARIANTS.has(cleaned) || !/[,;/]|\sand\s|\s&\s|-/.test(cleaned))) {
    return [whole];
  }
  const out: string[] = [];
  const push = (v: string | null) => { if (v && !out.includes(v)) out.push(v); };
  for (const frag of String(raw).split(/\s*[,;/]\s*|\s+and\s+|\s+&\s+/i)) {
    const f = frag.trim();
    if (!f) continue;
    const bare = f.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    const direct = normalizeLanguageToken(f);
    if (direct && DISTINCT_VARIANTS.has(bare)) { push(direct); continue; }
    if (f.includes('-')) {
      const halves = f.split(/\s*-\s*/);
      const parts = halves.map(normalizeLanguageToken).filter(Boolean) as string[];
      // Only treat the hyphen as a delimiter when EVERY side is a real language.
      if (parts.length > 1 && parts.length === halves.length) { parts.forEach(push); continue; }
    }
    push(direct);
  }
  return out;
}
