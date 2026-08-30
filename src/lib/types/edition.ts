// ============================================
// VERSIONING & DOI SCHEMA
// ============================================

/**
 * A contributor to a translation (translator, editor, reviewer)
 */
export interface Contributor {
  name: string;
  role: 'translator' | 'editor' | 'reviewer' | 'transcriber';
  type: 'ai' | 'human' | 'org'; // 'org' = institutional/partner; maps to a Zenodo organizational creator (no family_name)
  orcid?: string;              // e.g., "0000-0002-1825-0097"
  affiliation?: string;        // e.g., "University of Example"
  model?: string;              // For AI: "gemini-2.0-flash"
}

/**
 * A published, immutable edition of a translation.
 * Once a DOI is minted, this record is frozen.
 */
export interface TranslationEdition {
  id: string;                  // UUID
  book_id: string;
  tenantId?: string;           // Multi-tenant compatibility

  // Version info
  version: string;             // Semantic: "1.0.0", "1.1.0", "2.0.0"
  version_label?: string;      // Human-friendly: "First Edition", "Revised"
  status: 'draft' | 'published' | 'superseded';

  // Identifiers
  doi?: string;                // "10.5281/zenodo.12345678"
  doi_url?: string;            // "https://doi.org/10.5281/zenodo.12345678"
  zenodo_id?: number | string; // Zenodo deposit ID (API may return string or number)
  zenodo_url?: string;         // "https://zenodo.org/record/12345678"

  // Dates
  created_at: Date;
  published_at?: Date;         // When DOI was minted / made public

  // What's included (snapshot of page IDs at time of publication)
  page_ids: string[];          // Ordered list of included pages
  page_count: number;

  // Content hashes for integrity verification
  content_hash: string;        // SHA-256 of concatenated translation text

  // Contributors
  contributors: Contributor[];

  // Metadata for citation
  citation: {
    title: string;             // "English Translation of [Original Title]"
    original_title: string;
    original_author: string;
    /**
     * Language of the leaves THIS translation was made from — not necessarily
     * the language of the work. Verbatim `books.language`; never normalised,
     * because this field is persisted and travels into minted DOI payloads.
     * See `citationLanguageFields()` in src/lib/edition-language.ts (#3959).
     */
    original_language: string;
    /**
     * Language of the WORK, when it differs from `original_language` — i.e. when
     * this edition is itself a translation and ours is a translation of a
     * translation. Absent when the two coincide, and absent on every row minted
     * before #3959 (historic citations are left as minted, not backfilled).
     */
    work_language?: string;
    original_published?: string;
    target_language: string;   // "en"
  };

  // License (SPDX identifier)
  license: string;             // "CC-BY-4.0", "CC-BY-NC-4.0", "CC0-1.0"

  // Optional: link to previous version
  previous_version_id?: string;
  previous_version_doi?: string;

  // Release notes
  changelog?: string;          // What changed from previous version

  // Scholarly front matter
  front_matter?: {
    introduction?: string;     // Historical context, significance, authorship
    methodology?: string;      // Translation approach, AI-assisted process, editorial conventions
    acknowledgments?: string;  // Contributors, institutions, sources
    generated_at?: Date;
    generated_by?: string;     // Model used to generate
  };

  // Archived exports (S3 URLs)
  exports?: {
    pdf_a?: string;            // Archival PDF
    epub?: string;
    txt?: string;
    tei_xml?: string;          // If you add TEI export later
  };
}