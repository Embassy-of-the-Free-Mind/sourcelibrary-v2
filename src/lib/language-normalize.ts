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
  // Found by the #4781 free-lane run: 7 Books of Hours catalogued Dutch, tagged
  // Middle Dutch on every leaf, reported as `contradict` — the instrument, not the data.
  'Middle Dutch': 'Dutch', 'Old Dutch': 'Dutch',
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

// ─────────────────────────────────────────────────────────────────────────────
// THE VOCABULARY — ISO 639-3 codes, one row per language (#5330, step 1 of
// `.claude/docs/language-fields-design.md`).
//
// Everything above this line is the NAME API and keeps its behaviour exactly,
// including the title-case fallthrough that invents a language out of any
// unrecognised fragment. Everything below is the CODE API, and its vocabulary
// is CLOSED: a fragment the table does not know goes to `unresolved`, never into
// `codes`. Measured 2026-09-30 over the 230 live `books.language` labels, the
// fallthrough invents ~22 languages on ≤46 live books ("E", "Ne", "And Judeo",
// "Anglo" + "Saxon", "Some Hebrew", "Latin. French. English"…).
//
// A language the table lacks is fixed by a PR that adds a row, never by a free
// text value. `tests/unit/language-normalize-parity.test.ts` holds every other
// language list in the repo against this table.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One row. `family` is the comparison policy (historical stages share a family
 * with their descendant; stored codes stay distinct). `script` is the DEFAULT
 * ISO 15924 script. `iso1` is the ISO 639-1 code and `bcp47` the tag emitted
 * for `lang=` / IIIF / DTS. `marc` holds MARC / ISO 639-2/B codes accepted as
 * input. `lite_ocr` mirrors the OCR lite allowlist (`LATIN_SCRIPT_LANGUAGES`,
 * which still decides routing until step 3). `ambiguous_script` marks languages
 * whose holdings regularly come in more than one script; the router cannot
 * know the script from the code, so these can never be lite.
 */
export interface LanguageRow {
  code: string;
  name: string;
  family: string;
  script: string;
  bcp47: string;
  iso1: string | null;
  marc: string[];
  aliases: string[];
  lite_ocr: boolean;
  ambiguous_script: boolean;
}

interface RowOpts {
  family?: string;
  bcp47?: string;
  iso1?: string;
  marc?: string[];
  aliases?: string[];
  lite?: boolean;
  ambiguous?: boolean;
}

const row = (code: string, name: string, script: string, o: RowOpts = {}): LanguageRow => ({
  code,
  name,
  family: o.family || code,
  script,
  bcp47: o.bcp47 || o.iso1 || code,
  iso1: o.iso1 || null,
  marc: o.marc || [],
  aliases: o.aliases || [],
  lite_ocr: !!o.lite,
  ambiguous_script: !!o.ambiguous,
});

export const LANGUAGES: readonly LanguageRow[] = Object.freeze([
  // ── lite-OCR allowlist (Latin script) — must equal LATIN_SCRIPT_LANGUAGES ──
  row('eng', 'English', 'Latn', { iso1: 'en', lite: true, aliases: ['early modern english', 'american english', 'british english'] }),
  row('lat', 'Latin', 'Latn', { iso1: 'la', lite: true, aliases: ['neo-latin', 'ecclesiastical latin'] }),
  row('fra', 'French', 'Latn', { iso1: 'fr', marc: ['fre'], lite: true, aliases: ['français', 'francais'] }),
  row('ita', 'Italian', 'Latn', { iso1: 'it', lite: true, aliases: ['italiano'] }),
  row('spa', 'Spanish', 'Latn', { iso1: 'es', lite: true, aliases: ['castilian', 'español', 'espanol', 'castellano'] }),
  row('por', 'Portuguese', 'Latn', { iso1: 'pt', lite: true, aliases: ['português', 'portugues'] }),
  row('ron', 'Romanian', 'Latn', { iso1: 'ro', marc: ['rum'], lite: true }),
  row('cat', 'Catalan', 'Latn', { iso1: 'ca', lite: true, aliases: ['valencian'] }),
  row('deu', 'German', 'Latn', { iso1: 'de', marc: ['ger'], lite: true, aliases: ['deutsch', 'high german', 'low german', 'early new high german'] }),
  row('nld', 'Dutch', 'Latn', { iso1: 'nl', marc: ['dut'], lite: true, aliases: ['flemish', 'nederlands'] }),
  row('swe', 'Swedish', 'Latn', { iso1: 'sv', lite: true }),
  row('nor', 'Norwegian', 'Latn', { iso1: 'no', lite: true }),
  row('dan', 'Danish', 'Latn', { iso1: 'da', lite: true }),
  row('fin', 'Finnish', 'Latn', { iso1: 'fi', lite: true }),
  row('isl', 'Icelandic', 'Latn', { iso1: 'is', marc: ['ice'], lite: true }),
  row('cym', 'Welsh', 'Latn', { iso1: 'cy', marc: ['wel'], lite: true, aliases: ['middle welsh'] }),
  row('gle', 'Irish', 'Latn', { iso1: 'ga', lite: true }),
  row('pol', 'Polish', 'Latn', { iso1: 'pl', lite: true }),
  row('ces', 'Czech', 'Latn', { iso1: 'cs', marc: ['cze'], lite: true }),
  row('slk', 'Slovak', 'Latn', { iso1: 'sk', marc: ['slo'], lite: true }),
  row('slv', 'Slovenian', 'Latn', { iso1: 'sl', lite: true }),
  row('hrv', 'Croatian', 'Latn', { iso1: 'hr', lite: true }),
  row('hun', 'Hungarian', 'Latn', { iso1: 'hu', lite: true }),
  row('est', 'Estonian', 'Latn', { iso1: 'et', lite: true }),
  row('lav', 'Latvian', 'Latn', { iso1: 'lv', lite: true }),
  row('lit', 'Lithuanian', 'Latn', { iso1: 'lt', lite: true }),
  row('sqi', 'Albanian', 'Latn', { iso1: 'sq', marc: ['alb'], lite: true }),
  row('tur', 'Turkish', 'Latn', { iso1: 'tr', lite: true }),
  row('ind', 'Indonesian', 'Latn', { iso1: 'id', lite: true }),
  row('vie', 'Vietnamese', 'Latn', { iso1: 'vi', lite: true }),
  row('tgl', 'Tagalog', 'Latn', { iso1: 'tl', lite: true, aliases: ['filipino'] }),
  row('swa', 'Swahili', 'Latn', { iso1: 'sw', lite: true }),

  // ── European historical stages and other Latin-script languages (not lite) ──
  row('ang', 'Old English', 'Latn', { family: 'eng', aliases: ['anglo-saxon'] }),
  row('enm', 'Middle English', 'Latn', { family: 'eng' }),
  row('fro', 'Old French', 'Latn', { family: 'fra' }),
  row('frm', 'Middle French', 'Latn', { family: 'fra' }),
  row('xno', 'Anglo-Norman', 'Latn', { aliases: ['law french'] }),
  row('oci', 'Occitan', 'Latn', { iso1: 'oc', aliases: ['provençal', 'provencal'] }),
  row('pro', 'Old Provençal', 'Latn', { family: 'oci', aliases: ['old occitan'] }),
  row('osp', 'Old Spanish', 'Latn', { family: 'spa' }),
  row('gmh', 'Middle High German', 'Latn', { family: 'deu' }),
  row('goh', 'Old High German', 'Latn', { family: 'deu' }),
  row('dum', 'Middle Dutch', 'Latn', { family: 'nld' }),
  row('odt', 'Old Dutch', 'Latn', { family: 'nld' }),
  row('non', 'Old Norse', 'Latn'),
  row('got', 'Gothic', 'Goth'),
  row('sga', 'Old Irish', 'Latn', { family: 'gle' }),
  row('gla', 'Scottish Gaelic', 'Latn', { iso1: 'gd' }),
  row('rup', 'Aromanian', 'Latn', { ambiguous: true }),
  row('epo', 'Esperanto', 'Latn', { iso1: 'eo' }),

  // ── Greek, Cyrillic, Caucasus ──
  // "Greek" is stored as the historical form this corpus is made of (design doc).
  row('grc', 'Greek', 'Grek', { marc: ['gre'], aliases: ['griechisch', 'ancient greek', 'classical greek', 'attic', 'koine', 'koine greek', 'hellenistic', 'homeric greek', 'byzantine greek', 'medieval greek'] }),
  row('ell', 'Modern Greek', 'Grek', { iso1: 'el', family: 'grc' }),
  row('rus', 'Russian', 'Cyrl', { iso1: 'ru' }),
  row('ukr', 'Ukrainian', 'Cyrl', { iso1: 'uk' }),
  row('bul', 'Bulgarian', 'Cyrl', { iso1: 'bg' }),
  row('srp', 'Serbian', 'Cyrl', { iso1: 'sr', ambiguous: true }),
  row('chu', 'Church Slavonic', 'Cyrs', { iso1: 'cu', aliases: ['old church slavonic', 'slavonic'] }),
  row('hye', 'Armenian', 'Armn', { iso1: 'hy', marc: ['arm'], aliases: ['classical armenian'] }),
  row('kat', 'Georgian', 'Geor', { iso1: 'ka', marc: ['geo'] }),

  // ── Semitic, Egyptian, Ethiopic, cuneiform ──
  row('heb', 'Hebrew', 'Hebr', { iso1: 'he' }),
  row('hbo', 'Biblical Hebrew', 'Hebr', { family: 'heb', aliases: ['ancient hebrew', 'mishnaic hebrew'] }),
  row('smp', 'Samaritan Hebrew', 'Samr', { family: 'heb' }),
  row('arc', 'Aramaic', 'Hebr', { ambiguous: true, aliases: ['imperial aramaic', 'jewish aramaic', 'jewish palestinian aramaic'] }),
  row('syc', 'Syriac', 'Syrc', { marc: ['syr'], aliases: ['classical syriac'] }),
  row('myz', 'Mandaic', 'Mand'),
  row('ara', 'Arabic', 'Arab', { iso1: 'ar', aliases: ['classical arabic', 'quranic arabic'] }),
  row('jrb', 'Judeo-Arabic', 'Hebr', { ambiguous: true }),
  row('yid', 'Yiddish', 'Hebr', { iso1: 'yi', ambiguous: true }),
  row('lad', 'Ladino', 'Hebr', { ambiguous: true, aliases: ['judeo-spanish'] }),
  row('itk', 'Judeo-Italian', 'Hebr'),
  row('yej', 'Judeo-Greek', 'Hebr'),
  row('jpr', 'Judeo-Persian', 'Hebr'),
  row('sdt', 'Judeo-Occitan', 'Hebr'),
  row('kdr', 'Karaim', 'Hebr', { ambiguous: true }),
  row('gez', "Ge'ez", 'Ethi', { marc: ['eth'], aliases: ['geez', 'ethiopic'] }),
  row('amh', 'Amharic', 'Ethi', { iso1: 'am' }),
  row('cop', 'Coptic', 'Copt'),
  // Hieroglyphic, hieratic and demotic are stages and scripts of one code.
  row('egy', 'Egyptian', 'Egyp', { ambiguous: true, aliases: ['ancient egyptian', 'middle egyptian', 'egyptian hieroglyphs', 'demotic'] }),
  row('sux', 'Sumerian', 'Xsux', { ambiguous: true }),
  row('akk', 'Akkadian', 'Xsux', { ambiguous: true, aliases: ['babylonian', 'assyrian'] }),

  // ── Iranian, Turkic, Central Asia ──
  row('fas', 'Persian', 'Arab', { iso1: 'fa', marc: ['per'], aliases: ['farsi', 'classical persian'] }),
  row('pal', 'Middle Persian', 'Phlv', { ambiguous: true, aliases: ['pahlavi'] }),
  row('xpr', 'Parthian', 'Prti', { ambiguous: true }),
  row('sog', 'Sogdian', 'Sogd', { ambiguous: true }),
  row('xbc', 'Bactrian', 'Grek'),
  row('kho', 'Khotanese', 'Brah'),
  row('ave', 'Avestan', 'Avst', { iso1: 'ae' }),
  row('ota', 'Ottoman Turkish', 'Arab', { ambiguous: true, aliases: ['ottoman'] }),
  row('chg', 'Chagatai', 'Arab', { aliases: ['chagatai turkish'] }),
  row('otk', 'Old Turkic', 'Orkh', { ambiguous: true, aliases: ['kok turkic'] }),
  row('uig', 'Uyghur', 'Arab', { iso1: 'ug', ambiguous: true }),
  row('uzb', 'Uzbek', 'Latn', { iso1: 'uz', ambiguous: true }),
  row('mon', 'Mongolian', 'Mong', { iso1: 'mn', ambiguous: true }),
  row('txg', 'Tangut', 'Tang'),

  // ── South Asia ──
  row('san', 'Sanskrit', 'Deva', { iso1: 'sa', ambiguous: true, aliases: ['vedic sanskrit'] }),
  row('pli', 'Pali', 'Latn', { iso1: 'pi', ambiguous: true }),
  row('pra', 'Prakrit', 'Deva', { ambiguous: true, aliases: ['prakrit languages'] }),
  row('pka', 'Ardhamagadhi Prakrit', 'Deva', { family: 'pra' }),
  row('hin', 'Hindi', 'Deva', { iso1: 'hi' }),
  row('mar', 'Marathi', 'Deva', { iso1: 'mr' }),
  row('nep', 'Nepali', 'Deva', { iso1: 'ne' }),
  row('mai', 'Maithili', 'Deva'),
  row('new', 'Newari', 'Newa', { ambiguous: true }),
  row('ben', 'Bengali', 'Beng', { iso1: 'bn', aliases: ['bangla'] }),
  row('guj', 'Gujarati', 'Gujr', { iso1: 'gu' }),
  row('pan', 'Punjabi', 'Guru', { iso1: 'pa' }),
  row('urd', 'Urdu', 'Arab', { iso1: 'ur' }),
  row('tam', 'Tamil', 'Taml', { iso1: 'ta' }),
  row('tel', 'Telugu', 'Telu', { iso1: 'te' }),
  row('kan', 'Kannada', 'Knda', { iso1: 'kn' }),
  row('mal', 'Malayalam', 'Mlym', { iso1: 'ml' }),
  row('sin', 'Sinhala', 'Sinh', { iso1: 'si', aliases: ['sinhalese'] }),
  row('bod', 'Tibetan', 'Tibt', { iso1: 'bo', marc: ['tib'], aliases: ['classical tibetan', 'standard tibetan'] }),
  row('dzo', 'Dzongkha', 'Tibt', { iso1: 'dz' }),

  // ── East and Southeast Asia ──
  row('zho', 'Chinese', 'Hani', { iso1: 'zh', marc: ['chi'], aliases: ['mandarin', 'cmn', 'traditional chinese', 'simplified chinese'] }),
  row('lzh', 'Classical Chinese', 'Hani', { family: 'zho', aliases: ['literary chinese', 'kanbun', 'old chinese', 'middle chinese'] }),
  row('jpn', 'Japanese', 'Jpan', { iso1: 'ja', aliases: ['classical japanese', 'old japanese'] }),
  row('kor', 'Korean', 'Kore', { iso1: 'ko' }),
  row('mya', 'Burmese', 'Mymr', { iso1: 'my', marc: ['bur'] }),
  row('tha', 'Thai', 'Thai', { iso1: 'th' }),
  row('khm', 'Khmer', 'Khmr', { iso1: 'km' }),
  row('msa', 'Malay', 'Latn', { iso1: 'ms', marc: ['may'], ambiguous: true }),
  row('jav', 'Javanese', 'Java', { iso1: 'jv', ambiguous: true }),
  row('kaw', 'Old Javanese', 'Kawi', { family: 'jav', ambiguous: true, aliases: ['kawi'] }),
  row('ban', 'Balinese', 'Bali', { ambiguous: true }),
  row('sun', 'Sundanese', 'Sund', { iso1: 'su', ambiguous: true }),
  row('bug', 'Bugis', 'Bugi', { ambiguous: true, aliases: ['buginese'] }),
  row('tft', 'Ternate', 'Latn', { ambiguous: true }),
  row('mlg', 'Malagasy', 'Latn', { iso1: 'mg' }),

  // ── Africa ──
  row('hau', 'Hausa', 'Latn', { iso1: 'ha', ambiguous: true }),
  row('yor', 'Yoruba', 'Latn', { iso1: 'yo' }),
  row('ibo', 'Igbo', 'Latn', { iso1: 'ig' }),
  row('zul', 'Zulu', 'Latn', { iso1: 'zu' }),
  row('xho', 'Xhosa', 'Latn', { iso1: 'xh' }),
  row('sot', 'Sotho', 'Latn', { iso1: 'st' }),
  row('kau', 'Kanuri', 'Latn', { iso1: 'kr', ambiguous: true }),
  row('mnk', 'Mandinka', 'Latn', { ambiguous: true }),

  // ── Americas and Pacific ──
  row('nah', 'Nahuatl', 'Latn'),
  row('yua', 'Yucatec Maya', 'Latn'),
  row('quc', "K'iche' Maya", 'Latn', { aliases: ["k'iche'", "k'iche", 'quiche', 'quiché', 'quiche maya', 'quiché maya'] }),
  row('cak', 'Kaqchikel', 'Latn', { aliases: ['cakchiquel'] }),
  // Classic Maya inscriptions; the catalogue names the script.
  row('emy', 'Epigraphic Mayan', 'Maya', { aliases: ['maya hieroglyphs', 'maya hieroglyphic script'] }),
  row('hai', 'Haida', 'Latn'),
  row('nav', 'Navajo', 'Latn', { iso1: 'nv' }),
  row('haw', 'Hawaiian', 'Latn'),
  row('mri', 'Maori', 'Latn', { iso1: 'mi' }),
  row('smo', 'Samoan', 'Latn', { iso1: 'sm' }),
]);

/**
 * ISO 639-1 codes the table knows but does NOT accept as bare input, because
 * production carries them as truncated labels, not codes. Titles read
 * 2026-09-30: "Ga" is on a Hebrew grammar (Institutionum Hebraicarum), "Ne" on
 * six Sanskrit and Prakrit books, "Am" on a Chinese commentary; "Dz" is flagged
 * not-a-language by `language-vs-ocr.mjs`. `toBcp47` still emits them. ("An"
 * and "Lb", on Latin and Greek books, are safe only because Aragonese and
 * Luxembourgish have no row; add one and they belong here too.)
 */
const ISO1_NOT_INPUT = new Set<string>(['ga', 'ne', 'am', 'dz']);

/**
 * Placeholders for the CODE API: the name API's set plus labels that are
 * placeholders in practice but that the name API has always passed through
 * (kept out of PLACEHOLDER so the name API does not change).
 */
const CODE_PLACEHOLDER = new Set<string>([...PLACEHOLDER, 'no linguistic content']);

const BY_CODE = new Map(LANGUAGES.map((r) => [r.code, r]));

/** Fold the apostrophe variants the catalogue and the OCR tag both use (Kʼicheʼ, Geʾez). */
const foldApostrophes = (s: string): string => s.replace(/[’ʼʾ`]/g, "'");

const INDEX = (() => {
  const idx = new Map<string, string>();
  const add = (key: string, code: string) => {
    const k = foldApostrophes(String(key).normalize('NFC').toLowerCase());
    const prev = idx.get(k);
    if (prev && prev !== code) throw new Error(`language table: "${k}" maps to both ${prev} and ${code}`);
    idx.set(k, code);
  };
  for (const r of LANGUAGES) {
    add(r.code, r.code);
    add(r.name, r.code);
    if (r.iso1 && !ISO1_NOT_INPUT.has(r.iso1)) add(r.iso1, r.code);
    r.marc.forEach((m) => add(m, r.code));
    r.aliases.forEach((a) => add(a, r.code));
  }
  return idx;
})();

/** Clean one fragment the way the name API does, plus the apostrophe fold. */
function cleanToken(raw: unknown): string {
  let s = foldApostrophes(String(raw).normalize('NFC').toLowerCase().trim());
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/\s+in\s+[\w'-]+\s+(?:script|characters|alphabet)\b/g, ' ');
  return s.replace(/[.\s]+$/, '').replace(/^[.\s]+/, '').replace(/\s+/g, ' ').trim();
}

/** True for a table code (`'lat'`), false for anything else, including names. */
export function isLanguageCode(code: unknown): boolean {
  return typeof code === 'string' && BY_CODE.has(code);
}

/** The table row for a code, or null. */
export function languageRow(code: string | null | undefined): LanguageRow | null {
  return (code && BY_CODE.get(code)) || null;
}

/**
 * ONE token (a code, MARC code or free-text name) → one ISO 639-3 code, or
 * null when it is a placeholder OR not in the vocabulary. Never guesses.
 */
export function languageCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = cleanToken(raw);
  if (!s || CODE_PLACEHOLDER.has(s)) return null;
  const hit = INDEX.get(s);
  if (hit) return hit;
  const stripped = s.replace(VARIANT_PREFIX, '').trim();
  if (stripped && stripped !== s && !CODE_PLACEHOLDER.has(stripped)) return INDEX.get(stripped) || null;
  return null;
}

/**
 * A possibly-compound label → `{ codes, unresolved }`. `codes` is ordered and
 * de-duplicated; every fragment the vocabulary does not know is reported in
 * `unresolved` (original spelling, trimmed) and never becomes a code.
 * Placeholders (`Unknown`, `und`, `zxx`, `Multiple`…) yield neither.
 *
 * Split rules are `parseLanguageField`'s (`,` `;` `/` ` and ` ` & `, a hyphen
 * only when every half resolves, never `N/A`) plus the two cases measured on
 * the live labels: `. ` between capitalised names ("Latin. French. English")
 * and a leading `and ` fragment ("Hebrew, Aramaic, and Judeo-Arabic"). A
 * placeholder wrapping a list ("Multiple (Hebrew, Greek, …)") reads the list.
 */
export function toLanguageCodes(raw: string | null | undefined): { codes: string[]; unresolved: string[] } {
  const codes: string[] = [];
  const unresolved: string[] = [];
  if (raw == null) return { codes, unresolved };
  const text = String(raw).trim();
  // Before the placeholder test, which strips parentheticals: "Multiple (…)" lists its languages.
  const wrapped = text.match(/^([^()]*)\(([^)]*)\)\s*\.?$/);
  const body = wrapped && CODE_PLACEHOLDER.has(cleanToken(wrapped[1])) ? wrapped[2] : text;
  if (!body.trim() || CODE_PLACEHOLDER.has(cleanToken(body))) return { codes, unresolved };
  const whole = languageCode(body);
  if (whole) return { codes: [whole], unresolved };

  const push = (c: string) => { if (!codes.includes(c)) codes.push(c); };
  const fragments = body
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s*[,;/]\s*|\s+(?:and|And|AND)\s+|\s+&\s+|\.\s+(?=\p{Lu})/u);
  for (const frag of fragments) {
    const f = frag.replace(/^(?:and|&)\s+/i, '').trim();
    const cleaned = cleanToken(f);
    if (!cleaned || CODE_PLACEHOLDER.has(cleaned)) continue;
    const direct = languageCode(f);
    if (direct) { push(direct); continue; }
    if (f.includes('-')) {
      const halves = f.split(/\s*-\s*/).map(languageCode);
      if (halves.length > 1 && halves.every(Boolean)) { (halves as string[]).forEach(push); continue; }
    }
    unresolved.push(f.replace(/[.\s]+$/, ''));
  }
  return { codes, unresolved };
}

/**
 * Display name for a code. English comes from the table (historical stages
 * have no CLDR name); other locales from `Intl.DisplayNames` on `bcp47`,
 * falling back to the English name when CLDR has none. Unknown code → null.
 */
export function languageName(code: string | null | undefined, locale = 'en'): string | null {
  const r = languageRow(code);
  if (!r) return null;
  if (!locale || locale === 'en' || locale.startsWith('en-')) return r.name;
  try {
    const n = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(r.bcp47);
    return n && n.toLowerCase() !== r.bcp47.toLowerCase() ? n : r.name;
  } catch {
    return r.name;
  }
}

/** Family CODE of a code (`lzh` → `zho`), or null. The name form is `languageFamily`. */
export function codeFamily(code: string | null | undefined): string | null {
  const r = languageRow(code);
  return r ? r.family : null;
}

/**
 * Same language for comparison purposes? Normalises each side first (codes,
 * MARC codes and names all accepted), then compares families. False when
 * either side is not in the vocabulary.
 */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  const fa = codeFamily(languageCode(a));
  const fb = codeFamily(languageCode(b));
  return !!fa && fa === fb;
}

/** BCP-47 tag for a code (`lat` → `la`, `grc` → `grc`), or null. */
export function toBcp47(code: string | null | undefined): string | null {
  const r = languageRow(code);
  return r ? r.bcp47 : null;
}

/** Edition-language code for a UI locale (`es`, `es-ES` → `spa`), or null. */
export function fromLocale(locale: string | null | undefined): string | null {
  if (!locale) return null;
  const primary = String(locale).toLowerCase().split(/[-_]/)[0];
  const r = LANGUAGES.find((x) => x.bcp47 === primary || x.iso1 === primary || x.code === primary);
  return r ? r.code : null;
}

/** Display label for an ordered code list: `['grc', 'lat']` → "Greek and Latin". */
export function displayLabel(codes: readonly string[] | null | undefined, locale = 'en'): string | null {
  const names = (codes || []).map((c) => languageName(c, locale)).filter((n): n is string => !!n);
  if (names.length === 0) return null;
  return new Intl.ListFormat([locale || 'en'], { style: 'long', type: 'conjunction' }).format(names);
}
