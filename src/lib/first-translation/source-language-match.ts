/**
 * Source-language matching — TS twin of `scripts/lib/source-language-match.mjs`.
 *
 * Keep in lockstep with the .mjs twin (same rule as scripts/lib/r2-key.mjs +
 * src/lib/r2-key.ts): node scripts can't import .ts, Next/src can't import the
 * scripts tree, so the logic lives twice and MUST stay identical. Edit both or
 * neither.
 *
 * THE RULE THIS MODULE ENFORCES (#3459/#3460)
 * -------------------------------------------
 * Reject on language ONLY when both sides resolve to a known language and those
 * languages disagree. An unresolvable code, an absent field, or a language not
 * in the table means UNKNOWN — and unknown must never read as mismatch, because
 * a rejection here silently preserves a possibly-false badge (and the converse,
 * comparing a normalized value against an unnormalized one, silently never
 * matches — the #3460 "a guard must normalize BOTH sides" bug class).
 *
 * The table covers MARC-21 bibliographic codes, the ISO-639 buckets
 * `translation_catalogs` stores (KNOWN_SOURCE_LANGUAGES in
 * scripts/lib/translation-catalog-record.mjs), and the English labels
 * catalogues return. Historical registers collapse into their parent:
 * "Homeric Greek" and "Ancient Greek" are both `greek`, because a translation
 * from either defeats a first-English-translation claim on a Greek text.
 */

/** Canonical language name → every spelling that denotes it. */
const LANGUAGE_ALIASES: Record<string, string[]> = {
  greek: ['el', 'gre', 'grc', 'ancient greek', 'classical greek', 'homeric greek',
    'koine greek', 'medieval greek', 'byzantine greek', 'modern greek'],
  latin: ['la', 'lat', 'classical latin', 'medieval latin', 'late latin', 'new latin',
    'vulgar latin', 'ecclesiastical latin', 'neo-latin'],
  hebrew: ['he', 'heb', 'biblical hebrew', 'ancient hebrew', 'mishnaic hebrew'],
  aramaic: ['arc', 'imperial aramaic', 'jewish palestinian aramaic'],
  syriac: ['syc', 'syr', 'classical syriac'],
  arabic: ['ar', 'ara', 'classical arabic', 'quranic arabic'],
  persian: ['fa', 'per', 'fas', 'farsi', 'classical persian', 'middle persian'],
  sanskrit: ['sa', 'san', 'vedic sanskrit'],
  pali: ['pli'],
  tamil: ['ta', 'tam'],
  tibetan: ['bo', 'tib', 'bod', 'classical tibetan', 'standard tibetan'],
  chinese: ['zh', 'lzh', 'chi', 'zho', 'classical chinese', 'literary chinese', 'middle chinese',
    'old chinese', 'mandarin'],
  japanese: ['ja', 'jpn', 'classical japanese', 'old japanese'],
  korean: ['ko', 'kor'],
  german: ['de', 'ger', 'deu', 'high german', 'middle high german', 'old high german',
    'early new high german'],
  french: ['fr', 'fre', 'fra', 'old french', 'middle french'],
  italian: ['it', 'ita'],
  spanish: ['es', 'spa', 'castilian', 'old spanish'],
  portuguese: ['por'],
  catalan: ['ca', 'cat', 'valencian'],
  dutch: ['nl', 'dut', 'nld', 'middle dutch'],
  english: ['en', 'eng', 'enm', 'ang', 'american english', 'british english',
    'early modern english', 'middle english', 'old english'],
  russian: ['rus'],
  'church slavonic': ['chu', 'old church slavonic'],
  polish: ['pol'],
  czech: ['cze', 'ces'],
  danish: ['dan'],
  swedish: ['swe'],
  norwegian: ['nor'],
  icelandic: ['ice', 'isl', 'non', 'old norse'],
  welsh: ['cy', 'wel', 'cym', 'middle welsh'],
  irish: ['gle', 'old irish'],
  hungarian: ['hun'],
  turkish: ['tur', 'ota', 'ottoman turkish'],
  armenian: ['hy', 'arm', 'hye', 'classical armenian'],
  georgian: ['geo', 'kat'],
  coptic: ['cop'],
  egyptian: ['egy', 'ancient egyptian', 'middle egyptian', 'demotic'],
  akkadian: ['akk', 'babylonian', 'assyrian'],
  sumerian: ['sux'],
  ethiopic: ['gez', 'geez', "ge'ez"],
  hindi: ['hin'],
  bengali: ['ben', 'bangla'],
  urdu: ['urd'],
  mongolian: ['mon'],
  hawaiian: ['haw'],
  avestan: ['ave'],
  nahuatl: ['nah'],
  mandaic: ['myz'],
  haida: ['hai'],
};

/** every alias, lower-cased → canonical name. */
const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(LANGUAGE_ALIASES)) {
  ALIAS_TO_CANONICAL.set(canonical, canonical);
  for (const a of aliases) ALIAS_TO_CANONICAL.set(String(a).toLowerCase().trim(), canonical);
}

/**
 * Resolve any spelling of a language to its canonical name, or null.
 *
 * Null means "we do not know what this is", and every caller must treat it as
 * unknown rather than as a mismatch. An unmapped identifier (a Q-number, a
 * mistyped code) is the case worth being careful about: guessing there is how a
 * real prior gets discarded.
 */
export function canonicalLanguage(value?: string | null): string | null {
  if (!value) return null;
  const key = String(value)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return key ? (ALIAS_TO_CANONICAL.get(key) ?? null) : null;
}

/** A reference-set / catalogue row that names one or more source languages. */
export interface SourceLanguageRow {
  original_language_label?: string | null;
  original_languages?: string[] | null;
}

/**
 * The source languages a reference-set row claims, as canonical names.
 *
 * The English label is preferred over a Q-number (every Wikidata row carries
 * one, and the label is the readable, checkable key). Returns [] when nothing
 * resolves — which the caller must read as "unknown", never as "no match".
 */
export function rowSourceLanguages(row?: SourceLanguageRow | null): string[] {
  const raw = row?.original_language_label
    ? [row.original_language_label]
    : (row?.original_languages ?? []);
  return [...new Set(raw.map(canonicalLanguage).filter((v): v is string => !!v))];
}

/**
 * Should this candidate be rejected because it translates from a different
 * language than our source?
 *
 * Returns a reason string to reject with, or null to keep the candidate. Null is
 * returned whenever either side is unknown — `books.language` is the EDITION
 * language, so an absent `original_language` genuinely means we do not know, and
 * rejecting on a guess discards real priors.
 */
export function languageMismatch(
  bookOriginalLanguage: string | null | undefined,
  row?: SourceLanguageRow | null,
): string | null {
  const ours = canonicalLanguage(bookOriginalLanguage);
  if (!ours) return null;
  const theirs = rowSourceLanguages(row);
  if (!theirs.length) return null;
  if (theirs.includes(ours)) return null;
  const shown = row?.original_language_label || (row?.original_languages ?? []).join('/');
  return `record translates from ${shown} (${theirs.join('/')}), our source is ${bookOriginalLanguage} (${ours})`;
}
