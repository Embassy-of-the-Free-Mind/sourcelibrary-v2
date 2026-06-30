/**
 * Shared helpers for building `translation_catalogs` documents.
 *
 * The Tier-0 first-translation matcher (`scripts/eval/ft-catalog-match.mjs`)
 * indexes catalog rows by `author_surname` and gates matches on
 * `source_language` (an ISO bucket compared against the book's source
 * language). For a non-Latin catalog row to ever produce a candidate it MUST:
 *   - carry a real `author_surname` (anonymous rows are never indexed),
 *   - carry the correct `source_language` ISO (mismatch = guard rejects),
 *   - and to defeat a "first complete English" claim, `completeness: 'complete'`.
 *
 * These builders mirror the normalization in
 * `scripts/enrichment/import-translation-catalogs.mjs` exactly so the Latin and
 * non-Latin halves of the collection are scored identically. Issue #2899.
 */

// ── Normalization (identical to import-translation-catalogs.mjs) ─────────────
export function normalize(s) {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

export function extractSurname(author) {
  if (!author) return '';
  // Remove parentheticals and dates
  let clean = author.replace(/\([^)]*\)/g, '').replace(/\d{3,4}/g, '').trim();
  // Handle "Last, First" format
  if (clean.includes(',')) {
    clean = clean.split(',')[0].trim();
  }
  // Remove common prefixes/suffixes
  clean = clean.replace(/\b(saint|st|bishop|pope|emperor|king)\b/gi, '').trim();
  const words = clean.split(/\s+/).filter((w) => w.length > 1);
  return normalize(words[words.length - 1] || clean);
}

// ── Completeness classification (identical to importer) ──────────────────────
const PARTIAL_RE = [
  /\bselect(ed|ions)\b/i, /\bexcerpt/i, /\bextract/i, /\babridg/i,
  /\bbook [ivxlc0-9]+\b/i, /\bvol(\.|ume)?\s/i,
  /\bpart [ivxlc0-9]+\b/i, /\bchapter/i, /\bpassages\b/i,
  /\bantho/i, /\breader\b/i, /\bsampler\b/i,
];
const COMPLETE_RE = [
  /\bcomplete\b/i, /\bentire\b/i, /\bwhole\b/i, /\bfull\b/i,
  /\bcollected works\b/i, /\bopera omnia\b/i,
];

export function classifyCompleteness(title) {
  if (!title) return 'unknown';
  if (PARTIAL_RE.some((re) => re.test(title))) return 'partial';
  if (COMPLETE_RE.some((re) => re.test(title))) return 'complete';
  return 'unknown';
}

// ── Source-language ISO whitelist ────────────────────────────────────────────
// Keep aligned with LANG_TO_ISO in scripts/eval/ft-catalog-match.mjs. A row
// whose source_language is not in this set is rejected at ingest — a mistyped
// or empty source_language would silently disable the guard, the exact failure
// class that produced false demotes in #2892/#2893.
export const KNOWN_SOURCE_LANGUAGES = new Set([
  'la',  // Latin
  'grc', // Ancient/Classical Greek
  'he',  // Hebrew (incl. Biblical/Mishnaic)
  'arc', // Aramaic (Targum, Talmudic, Imperial)
  'ar',  // Arabic
  'sa',  // Sanskrit
  'pli', // Pali
  'bo',  // Tibetan
  'zh',  // Chinese (modern/general)
  'lzh', // Literary/Classical Chinese
  'syc', // Syriac
  'hy',  // Armenian
  'akk', // Akkadian
  'sux', // Sumerian
  'ja',  // Japanese
  'ko',  // Korean
  'fa',  // Persian
  'ave', // Avestan
  'egy', // Egyptian
  'ta',  // Tamil
  'de', 'nl', 'fr', 'it', 'es', // modern European (parity with existing rows)
]);

/**
 * Build a single `translation_catalogs` document from a raw record.
 * Throws on a missing/invalid source_language so a bad ingest fails loud.
 *
 * @param {object} rec - raw record
 * @param {string} rec.source             - provenance tag, e.g. 'sefaria', 'sacred_books_east'
 * @param {string} rec.source_language    - ISO code, must be in KNOWN_SOURCE_LANGUAGES
 * @param {string} [rec.author]
 * @param {string} [rec.canonical_author]
 * @param {string} [rec.english_title]
 * @param {string} [rec.canonical_work]
 * @param {string} [rec.original_title]
 * @param {string} [rec.translator]
 * @param {string|number} [rec.pub_year]
 * @param {string} [rec.publisher]
 * @param {string} [rec.series]
 * @param {string} [rec.completeness]     - 'complete' | 'partial' | 'unknown'; if omitted, classified from english_title
 * @param {string} [rec.source_url]
 * @returns {object} catalog document (no _id)
 */
export function buildCatalogDoc(rec) {
  const source = (rec.source || '').trim();
  if (!source) throw new Error('buildCatalogDoc: missing source');
  const sourceLanguage = (rec.source_language || '').trim();
  if (!KNOWN_SOURCE_LANGUAGES.has(sourceLanguage)) {
    throw new Error(
      `buildCatalogDoc: invalid source_language "${sourceLanguage}" for "${rec.english_title || rec.author}" `
      + `(must be one of ${[...KNOWN_SOURCE_LANGUAGES].join(',')})`,
    );
  }

  const author = (rec.author || '').trim();
  const canonicalAuthor = (rec.canonical_author || '').trim();
  const englishTitle = (rec.english_title || '').trim();
  const canonicalWork = (rec.canonical_work || '').trim();
  const originalTitle = (rec.original_title || '').trim();
  const translator = (rec.translator || '').trim();
  const publisher = (rec.publisher || '').trim();
  const series = (rec.series || '').trim();
  const pubYearRaw = rec.pub_year != null ? String(rec.pub_year).trim() : '';

  // completeness: explicit wins; else classify from the title.
  const completeness = (rec.completeness || '').trim() || classifyCompleteness(englishTitle);

  const doc = {
    source,
    author,
    author_normalized: normalize(author),
    author_surname: extractSurname(canonicalAuthor || author),
    canonical_author: canonicalAuthor || undefined,
    canonical_author_normalized: canonicalAuthor ? normalize(canonicalAuthor) : undefined,
    english_title: englishTitle,
    english_title_normalized: normalize(englishTitle),
    original_title: originalTitle || undefined,
    original_title_normalized: originalTitle ? normalize(originalTitle) : undefined,
    canonical_work: canonicalWork || undefined,
    canonical_work_normalized: canonicalWork ? normalize(canonicalWork) : undefined,
    translator,
    pub_year: pubYearRaw,
    pub_year_int: parseInt(pubYearRaw, 10) || null,
    publisher,
    series: series || undefined,
    completeness,
    source_language: sourceLanguage,
    source_language_provenance: 'ingest_explicit',
    source_url: rec.source_url || undefined,
  };

  for (const key of Object.keys(doc)) {
    if (doc[key] === undefined) delete doc[key];
  }
  return doc;
}

/**
 * Deterministic natural key for idempotent upsert. Two ingests of the same
 * record (same source / author / title / translator / year) collapse to one row.
 */
export function catalogKey(doc) {
  return [
    doc.source,
    doc.author_surname || '',
    doc.english_title_normalized || '',
    normalize(doc.translator || ''),
    doc.pub_year_int ?? '',
  ].join('|');
}
