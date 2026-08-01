/**
 * source-language-match.mjs — do two records name the SAME source language? (#3459)
 *
 * The reference set is built from two catalogues that identify a language in
 * incompatible ways, and nothing reconciled them:
 *
 *   LoC (MARC 041$h)  → three-letter bibliographic codes:  "grc", "per", "lat"
 *   Wikidata (P407)   → Q-numbers plus an English label:   "Q35497" / "Ancient Greek"
 *
 * The screen compared our book's language against `row.original_languages`
 * through a MARC-code table, so every Wikidata row failed it by construction:
 * `['gre','grc'].includes('Q35497')` is false, and the candidate was rejected as
 * WRONG_LANGUAGE. Measured on the 2026-07-31 run that discarded 228 candidates,
 * including Xenophon's *Symposium* (Greek→English) and every one of the six
 * *Rubáiyát of Omar Khayyám* records (Persian→English) — precisely the priors the
 * search exists to surface.
 *
 * Same family as every other defect in this area: it failed silently, on one
 * source only, and always toward a confident `none_found`.
 *
 * THE RULE THIS MODULE ENFORCES
 * -----------------------------
 * Reject on language ONLY when both sides resolve to a known language and those
 * languages disagree. An unresolvable code, an absent field, or a language not in
 * the table means UNKNOWN — and unknown must never read as mismatch, because a
 * rejection here silently preserves a possibly-false badge.
 *
 * WHY THERE IS NO Q-NUMBER TABLE
 * ------------------------------
 * Deliberate. Every Wikidata row carries an English `original_language_label`
 * (14,924 of 14,924), so the label is the readable, checkable key and the QID is
 * redundant. A hand-written QID table would be a list of assertions nobody can
 * verify at a glance, and a single wrong entry produces exactly the failure this
 * module exists to remove — a real prior rejected as the wrong language. An
 * unrecognised Q-number therefore resolves to null and the screen is skipped,
 * which keeps the candidate open rather than closing the question.
 */

/**
 * Canonical language name → every spelling that denotes it: MARC-21 bibliographic
 * codes and the English labels catalogues return.
 *
 * Historical registers collapse into their parent: "Homeric Greek" and "Ancient
 * Greek" are both `greek`, because a translation from either defeats a
 * first-English-translation claim on a Greek text. The distinction matters to a
 * philologist and not to this question.
 */
const LANGUAGE_ALIASES = {
  greek: ['gre', 'grc', 'ancient greek', 'classical greek', 'homeric greek',
    'koine greek', 'medieval greek', 'byzantine greek', 'modern greek'],
  latin: ['lat', 'classical latin', 'medieval latin', 'late latin', 'new latin',
    'vulgar latin', 'ecclesiastical latin', 'neo-latin'],
  hebrew: ['heb', 'biblical hebrew', 'ancient hebrew', 'mishnaic hebrew'],
  aramaic: ['arc', 'imperial aramaic', 'jewish palestinian aramaic'],
  syriac: ['syr', 'classical syriac'],
  arabic: ['ara', 'classical arabic', 'quranic arabic'],
  persian: ['per', 'fas', 'farsi', 'classical persian', 'middle persian'],
  sanskrit: ['san', 'vedic sanskrit'],
  pali: ['pli'],
  tamil: ['tam'],
  tibetan: ['tib', 'bod', 'classical tibetan', 'standard tibetan'],
  chinese: ['chi', 'zho', 'classical chinese', 'literary chinese', 'middle chinese',
    'old chinese', 'mandarin'],
  japanese: ['jpn', 'classical japanese', 'old japanese'],
  korean: ['kor'],
  german: ['ger', 'deu', 'high german', 'middle high german', 'old high german',
    'early new high german'],
  french: ['fre', 'fra', 'old french', 'middle french'],
  italian: ['ita'],
  spanish: ['spa', 'castilian', 'old spanish'],
  portuguese: ['por'],
  catalan: ['cat'],
  dutch: ['dut', 'nld', 'middle dutch'],
  english: ['eng', 'enm', 'ang', 'american english', 'british english',
    'early modern english', 'middle english', 'old english'],
  russian: ['rus'],
  'church slavonic': ['chu', 'old church slavonic'],
  polish: ['pol'],
  czech: ['cze', 'ces'],
  danish: ['dan'],
  swedish: ['swe'],
  norwegian: ['nor'],
  icelandic: ['ice', 'isl', 'non', 'old norse'],
  welsh: ['wel', 'cym', 'middle welsh'],
  irish: ['gle', 'old irish'],
  hungarian: ['hun'],
  turkish: ['tur', 'ota', 'ottoman turkish'],
  armenian: ['arm', 'hye', 'classical armenian'],
  georgian: ['geo', 'kat'],
  coptic: ['cop'],
  egyptian: ['egy', 'ancient egyptian', 'middle egyptian'],
  akkadian: ['akk', 'babylonian', 'assyrian'],
  sumerian: ['sux'],
  ethiopic: ['gez', 'geez', "ge'ez"],
  hindi: ['hin'],
  bengali: ['ben', 'bangla'],
  urdu: ['urd'],
  mongolian: ['mon'],
  hawaiian: ['haw'],
};

/** every alias, lower-cased → canonical name. */
const ALIAS_TO_CANONICAL = new Map();
for (const [canonical, aliases] of Object.entries(LANGUAGE_ALIASES)) {
  ALIAS_TO_CANONICAL.set(canonical, canonical);
  for (const a of aliases) ALIAS_TO_CANONICAL.set(String(a).toLowerCase().trim(), canonical);
}

/**
 * Resolve any spelling of a language to its canonical name, or null.
 *
 * Null means "we do not know what this is", and every caller must treat it as
 * unknown rather than as a mismatch. An unmapped Q-number is the case worth being
 * careful about: guessing there is how a real prior gets discarded.
 */
export function canonicalLanguage(value) {
  if (!value) return null;
  const key = String(value)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return key ? (ALIAS_TO_CANONICAL.get(key) ?? null) : null;
}

/**
 * The source languages a reference-set row claims, as canonical names.
 *
 * The English label is preferred over a Q-number for the reason given at the top
 * of this file. Returns [] when nothing resolves — which the caller must read as
 * "unknown", never as "no match".
 */
export function rowSourceLanguages(row) {
  const raw = row?.original_language_label
    ? [row.original_language_label]
    : (row?.original_languages ?? []);
  return [...new Set(raw.map(canonicalLanguage).filter(Boolean))];
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
export function languageMismatch(bookOriginalLanguage, row) {
  const ours = canonicalLanguage(bookOriginalLanguage);
  if (!ours) return null;
  const theirs = rowSourceLanguages(row);
  if (!theirs.length) return null;
  if (theirs.includes(ours)) return null;
  const shown = row?.original_language_label || (row?.original_languages ?? []).join('/');
  return `record translates from ${shown} (${theirs.join('/')}), our source is ${bookOriginalLanguage} (${ours})`;
}
