import { DublinCoreMetadata } from "./dublin-core";
import { ImageSource } from "./image-source";
import { TranslationEdition } from "./edition";
import { PipelineState } from "./pipeline";
import type { FacetedTags } from "../taxonomy/faceted-vocabulary";

export interface CdliWitness {
  p_number: string;        // e.g. "P271955"
  designation: string;     // e.g. "CBS 13895"
  q_number?: string;       // e.g. "Q000332"
  museum?: string;         // e.g. "Penn Museum"
  period?: string;         // e.g. "Old Babylonian"
  provenience?: string;    // e.g. "Nippur"
  photo_url?: string;      // https://cdli.earth/dl/photo/P271955.jpg
  thumbnail_url?: string;  // https://cdli.earth/dl/tn_photo/P271955.jpg
  has_photo: boolean;
  cdli_url: string;        // https://cdli.earth/artifacts/271955
}

export interface Book {
  id: string;
  slug?: string;              // SEO-friendly URL slug (e.g., "atalanta-fugiens-maier")
  tenantId?: string;

  // Resource type — visual art, manuscripts, etc. Absent = printed_book (default)
  resource_type?: 'printed_book' | 'manuscript' | 'painting' | 'drawing' | 'print' | 'fresco' | 'emblem' | 'map' | 'tablet' | 'object';

  // Editor-chosen "About" side plate/page. Overrides the auto-picked
  // representative visual on the book page's About section. Stores the
  // resolved image + link + caption (re-pickable if a URL ever goes stale).
  about_visual?: { src: string; href: string; caption?: string } | null;

  // Title fields
  title: string;              // Original language title (USTC-aligned, fixed)
  display_title?: string;     // English title for display (editable)

  // Author and publication
  author: string;
  /**
   * Editor / compiler — populated for edited volumes, magazines, anthologies,
   * festschrifts where the BPH catalogue (or other sources) credits an editor
   * rather than a single author. When `author` is "Unknown"/missing, the
   * editor is used as the byline (see `getEffectiveByline` in `src/lib/byline.ts`).
   */
  editor?: string;
  attribution_note?: string;  // "after" for prints after a designer, "circle of", "workshop of", etc.
  author_entity_id?: string;  // FK to entities collection (entity._id as string) — canonical author identity (VIAF/Wikidata linked)
  /** Display name for the canonical author (denormalised so the book page can render without a join). */
  author_canonical_name?: string;
  /** Wikidata Q-id for the canonical author, when VIAF aggregates the link. */
  author_wikidata_qid?: string;
  /** VIAF cluster id for the canonical author (denormalised — links to viaf.org/viaf/<id>). */
  author_viaf_id?: string;
  language: string;           // Original language of the text
  published: string;          // Publication year

  // WEMI work-level grouping — links different editions/manuscripts of the same work
  work_id?: string;           // Canonical work slug (e.g., "zohar", "cicero-ad-atticum", "corpus-hermeticum")

  // USTC catalog fields
  ustc_id?: string;           // USTC catalog number (e.g., "2029384")
  place_published?: string;   // City of publication (e.g., "Hamburg") — import tier
  /** Same fact, other writers (#4043). Read via resolveImprintPlace() in
   *  src/lib/imprint.ts — never pick one of these by hand. */
  place_of_publication?: string;  // ocr/mixed tier
  publication_place?: string;     // catalogue tier (BPH + USTC)
  place?: string;                 // stray (1 document)
  publisher?: string;         // Printer/Publisher name
  format?: string;            // Book format (folio, quarto, octavo, etc.)

  // Display and categorization
  thumbnail?: string;          // @deprecated Use image_display. Cover/display image (~1200px for books, full-res for artworks)
  thumbnail_blob?: string;     // @deprecated Use image_thumb. Small preview (150px)

  // Canonical image fields (migration in progress — prefer these over thumbnail/thumbnail_blob)
  image_display?: string;      // Primary display image (1200px) — R2 URL
  image_thumb?: string;        // Small preview (150px) — R2 URL
  image_full?: string;         // Highest resolution available (artworks only) — R2 URL
  image_source_url?: string;   // Original source URL (Wikimedia, IA, etc.) — provenance only, never displayed
  categories?: string[];
  faceted_tags?: FacetedTags;
  pages_count?: number;
  pages_translated?: number;  // CACHED — synced from pages collection by cron every 6h + inline by workers
  pages_ocr?: number;         // CACHED — synced from pages collection by cron every 6h + inline by workers
  pages_archived?: number;     // CACHED — pages with archived_photo on R2 (excludes failed archives)
  translation_percent?: number; // Computed at read time from pages_translated/pages_ocr (never stored). Uses pages_ocr as denominator so blank pages don't penalize the percentage.
  created_at?: Date;
  updated_at?: Date;
  last_processed?: Date;  // Last OCR or translation update

  // Workflow status
  status?: BookStatus;
  /** Libraries/institutions that hold a copy of this work (e.g. ['bph', 'mdz']) */
  held_by?: string[];
  summary?: string | BookSummary;
  job?: {  // Active processing job (set during processing, cleared on completion)
    type: 'realtime' | 'batch';
    job_id: string;
  };

  // Standard identifiers
  doi?: string;                 // Digital Object Identifier (e.g., "10.5281/zenodo.12345")
  is_first_translation?: boolean; // AI-detected: first known English translation of this text
  license?: string;             // SPDX identifier (e.g., "CC0-1.0", "CC-BY-4.0")

  // Translation verification (catalog search + LLM knowledge check)
  translation_verification?: TranslationVerification;

  // Prior human English translation credit (issue #3026). Present ONLY on books
  // that are NOT the first English translation AND whose prior edition has been
  // independently confirmed to exist in a real bibliographic record (WorldCat /
  // publisher / library catalog) with a resolvable link. This is the verified,
  // publishable half of the first-translation search — never render an
  // unverified `translation_verification.translations_found` row as this credit.
  prior_translation?: PriorTranslationCredit;

  // Dublin Core metadata for library interoperability
  dublin_core?: DublinCoreMetadata;

  // Image source and licensing (for scans/digitizations)
  image_source?: ImageSource;

  // Digitization sponsor — an individual/donor who funded the digitization of THIS book
  // through the "adopt a book" programme. Distinct from image_source.sponsor (institutional
  // digitization funders such as Google/Sloan). Rendered on the book page as a gracious
  // "Digitized thanks to ___" credit. Set via scripts/maintenance/set-digitization-sponsor.mjs.
  digitization_sponsor?: string;       // Public credit name (e.g., "Jane Smith", "In memory of …"). Absent = adopted anonymously.
  digitization_sponsor_url?: string;   // Optional link (donor page / tribute), shown only when external links are allowed
  digitization_adopted_at?: string;    // Set when the book is adopted (even anonymously) — hides the "Adopt this book" CTA
  // Adopt-a-book pricing tier. Defaults by resource_type (manuscripts → 'rare'); set explicitly to override.
  adopt_tier?: 'standard' | 'rare';

  // Internet Archive identifier (for reimport)
  ia_identifier?: string;

  // Visual art fields (only used when resource_type is a visual type)
  medium?: string;              // "Oil on canvas", "Engraving", "Fresco"
  dimensions_display?: string;  // "172.5 × 278.9 cm"
  current_location?: string;    // "Galleria degli Uffizi, Florence"
  commons_title?: string;       // Wikimedia Commons file title
  commons_url?: string;         // Link to Commons page
  commons_full_url?: string;    // Direct link to full-res image
  commons_width?: number;       // Original image width
  commons_height?: number;      // Original image height
  commons_license?: string;     // License from Commons
  commons_description?: string; // Description from Commons metadata
  commons_categories?: string[]; // Categories from Commons

  // Deep-zoom tile pyramid (issue #2411). Written LAST by the tile worker after
  // the tiles are verified in R2 — this is the only field the viewer branches on,
  // so its presence guarantees the tiles exist. See scripts/workers/deepzoom-tile-worker.mjs.
  deepzoom?: DeepZoomManifest;
  deepzoom_gate?: {              // Set when a master is below the tiling MP gate (so sweeps skip it)
    mp: number;
    below_gate: boolean;
    gate_mp: number;
    checked_at: Date;
  };

  // Wikidata alignment (for Wikipedia/Wikidata outreach)
  wikidata_id?: string;           // Q item for the work (e.g., "Q457894")
  wikidata_label?: string;        // Wikidata label for verification
  wikidata_match?: {
    confidence: 'high' | 'medium' | 'suggested';
    method: 'author_works' | 'title_search' | 'manual';
    matched_at: Date;
  };

  // Reading dashboard sections
  reading_sections?: Section[];

  // Table of contents extracted from OCR headings
  chapters?: Chapter[];

  // Book-level reading summary (whole-book overview)
  reading_summary?: {
    overview: string;
    quotes: Array<{ text: string; page: number }>;
    themes: string[];
    generated_at?: Date;
    model?: string;
    pages_analyzed?: number;
  };

  // Generated book index with summaries
  index?: {
    bookSummary?: {
      brief?: string;
      abstract?: string;
      detailed?: string;
    };
    sectionSummaries?: Array<{
      title: string;
      startPage: number;
      endPage: number;
      summary: string;
      quotes?: Array<{ text: string; page: number; significance?: string }>;
      concepts?: string[];
    }>;
    // Tag-extracted index entries with page references
    entries?: Array<{
      term: string;
      pages: number[];
      type: 'vocab' | 'term' | 'keyword';
    }>;
    // Legacy flat lists (from old AI extraction)
    people?: Array<{ term: string; pages: number[] }>;
    places?: Array<{ term: string; pages: number[] }>;
    concepts?: Array<{ term: string; pages: number[] }>;
    keyTerms?: Array<{ term: string; pages: number[] }>;
    method?: 'tag-extraction' | 'ai-extraction';
    pagesCovered?: number;
    generatedAt?: Date;
  };

  // Published editions (immutable snapshots for citation)
  editions?: TranslationEdition[];
  current_edition_id?: string;    // Most recent published edition

  // Automated processing pipeline state
  pipeline?: PipelineState;

  // Curation: hide from library, search, gallery, sitemap (still accessible via direct URL)
  hidden?: boolean;
  hidden_reason?: string;  // 'bph_duplicate' | 'launch_curation' | 'quality'

  // Beta launch: featured books bypass the email gate
  featured?: boolean;

  // Free tier: most-read books accessible without registration
  free_tier?: boolean;

  // Read analytics (maintained by analytics/track)
  read_count?: number;

  // Source work compositional timeline
  source_work_dates?: SourceWorkDateLayer[];
  source_work_dates_meta?: {
    enriched_at: Date;
    model: string;
    confidence: 'high' | 'medium' | 'low';
    source: 'ai_enrichment' | 'manual';
    reasoning?: string;
  };

  // KDP publishing score
  kdp_score?: number;
  kdp_score_breakdown?: {
    quality: number;
    translation: number;
    bph_relevance: number;
    engagement: number;
    apparatus: number;
    first_translation_bonus: number;
    scored_at: Date;
  };

  // Data provenance — tracks who set each metadata field
  field_provenance?: Record<string, FieldProvenanceEntry>;
  ai_metadata?: Record<string, unknown>;

  // ETCSL / CDLI integration (Sumerian texts with tablet witnesses)
  etcsl_id?: string;              // e.g. "1.1.1" (ETCSL composition number)
  cdli_witnesses?: CdliWitness[]; // Physical tablet witnesses from CDLI

  // Pre-computed related books (backfilled by scripts/backfill-related-books.mjs)
  related_books?: RelatedBooks;

  // Split detection for two-page spreads
  needs_splitting?: boolean | null;  // true = has spreads, false = single pages, null = ambiguous
  split_check?: {
    checked_at: Date;
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
    sample_results?: Array<{
      pageNumber: number;
      aspectRatio: number;
      classification: 'single' | 'spread' | 'ambiguous';
      error?: string;
    }>;
  };
}

export type BookStatus = 'draft' | 'in_progress' | 'complete' | 'published';

export interface BookSummary {
  data: string;
  generated_at: Date;
  page_coverage: number; // Percentage of pages included in summary (0-100)
  model?: string;
}

// Section/chapter grouping for reading view
export interface Section {
  id: string;
  title: string;
  startPage: number;
  endPage: number;
  summary?: string;
  quotes?: Array<{
    text: string;
    page: number;
    significance?: string;  // Why this quote matters
  }>;
  concepts?: string[];  // Key concepts/terms introduced
  source_chapter?: string;  // Original chapter heading from OCR (if hybrid detection)
  generated_at?: Date;
  detection_method: 'ai' | 'manual' | 'hybrid';
}

// Compositional timeline layer for source work provenance
export type SourceWorkDateType = 'composition' | 'translation' | 'compilation' | 'commentary' | 'redaction' | 'edition' | 'abridgement' | 'adaptation';

export interface SourceWorkDateLayer {
  type: SourceWorkDateType;
  date: string;              // ISO-ish: negative = BCE (e.g. '-360', '1484')
  date_display: string;      // Human-readable (e.g. 'c. 360 BCE', '1484')
  date_precision: 'exact' | 'decade' | 'century' | 'millennium';
  author?: string;
  work_title?: string;
  language?: string;
  notes?: string;
}

// Provenance entry for a single metadata field
export interface FieldProvenanceEntry {
  source: string;  // 'ai_enrichment' | 'import' | 'metadata_verification' | 'admin_edit' | 'manual' | 'ustc_catalog' | 'bph_catalogue' | 'cross_reference' | 'ai_generation' | 'ustc_enrichments'
  model?: string;
  date?: string | Date;
  confidence?: 'high' | 'medium' | 'low';
  pages_checked?: number;
  previous_value?: unknown;
  note?: string;
  provider?: string;
  provider_name?: string;
  script?: string;
  [key: string]: unknown;  // Allow additional fields from various enrichment scripts
}

// Chapter/heading extracted from OCR for table of contents
export interface Chapter {
  title: string;       // Original language title
  titleEn?: string;    // English translation of title
  pageId: string;
  pageNumber: number;
  endPage?: number;    // Last page of this chapter (computed from next chapter's start)
  level: number;  // 1 = top-level division, 2 = major chapter, 3 = sub-chapter
  confidence?: 'high' | 'medium' | 'low'; // AI's confidence in this chapter boundary
}

// Pre-computed related books stored on each book document
export interface RelatedBookEntry {
  id: string;
  title: string;
  author: string;
  cited_as?: string;         // entity name that triggered the direct citation
  shared_count?: number;     // number of shared entity mentions
  shared_names?: string[];   // top shared entity names
}

export interface RelatedBooks {
  direct: RelatedBookEntry[];   // books whose authors are mentioned as entities in this book
  shared: RelatedBookEntry[];   // books sharing 5+ entity mentions
  computed_at: Date;
}

// Translation verification from catalog search + LLM knowledge check
export type TranslationDisposition = 'confirmed_first' | 'first_complete_translation' | 'first_modern_translation' | 'translation_found' | 'needs_review';

export interface TranslationVerification {
  source: 'catalog_search' | 'catalog_and_llm' | string;
  searched_at: Date;
  has_english_translation: boolean;
  translations?: TranslationEvidence[];
  translations_found?: TranslationEvidence[];
  confidence?: 'high' | 'medium' | 'low';
  reasoning?: string;
  search_evidence?: {
    apis_queried: string[];
    total_results: number;
    evidence_strength: 'none' | 'weak' | 'moderate' | 'strong';
  };
  // Stage 2 validation
  disposition?: TranslationDisposition;
  disposition_reasoning?: string;
  disposition_at?: Date;
  validated_translations?: TranslationEvidence[];  // Path A: catalog-verified
  llm_knowledge_translations?: TranslationEvidence[];  // Path B: LLM claims (may hallucinate)
  // Verification metadata
  tools_called?: string[];
  verified_at?: Date;
  model?: string;
}

/**
 * A verified prior human English translation (issue #3026).
 *
 * Written ONLY after the named edition resolves to a real bibliographic record
 * with a live, resolvable URL. The whole point of the credit is that a reader
 * can act on it — so `url` is required and no record publishes without one.
 * Populated by scripts/maintenance/ingest-prior-translations.mjs from the
 * adversarially-verified sweep output; the reader gate is
 * `hasPublishablePriorTranslation()` in src/lib/prior-translation.ts.
 */
export interface PriorTranslationCredit {
  /** Title of the prior English edition. */
  work_title: string;
  /** Named translator(s). May be empty for anonymous/committee editions. */
  translators: string[];
  year?: number;
  publisher?: string;
  /** Scholarly series, e.g. "I Tatti Renaissance Library". */
  series?: string;
  /** Whether the prior edition is a complete or partial rendering. */
  scope: 'complete' | 'partial' | 'unclear';
  /** Live URL a reader follows to reach the edition (publisher / WorldCat / catalog). */
  url: string;
  /** How the edition was confirmed — drives outbound-link framing/priority. */
  verification_method: 'worldcat' | 'publisher' | 'google_books' | 'library_catalog' | 'other';
  oclc?: string;
  isbn?: string;
  /** One-sentence record of what confirmed the edition, for auditability. */
  evidence?: string;
  /** attempt_id in first_translation_attempts this credit was parsed from. */
  source_attempt_id?: string;
  /** ISO timestamp the credit was verified/ingested. */
  verified_at?: string;
}

export interface TranslationEvidence {
  english_title?: string;
  translator?: string;
  pub_year?: string;
  publisher?: string;
  completeness?: 'complete' | 'partial' | 'excerpts' | 'unknown';
  evidence_source?: string;  // 'open_library' | 'google_books' | 'internet_archive' | 'llm_knowledge'
  catalog_id?: string;
  validated?: boolean;
  notes?: string;
  url?: string;
}

// Deep-zoom tile-pyramid manifest (issue #2411). Stored on the book doc by the
// tile worker; the public viewer reads it to mount OpenSeadragon over R2 tiles.
export interface DeepZoomManifest {
  width: number;        // master pixel dimensions
  height: number;
  tile_size: number;    // px, 256
  overlap: number;      // px, 1
  format: string;       // tile extension, e.g. 'jpeg'
  prefix: string;       // R2 key prefix, e.g. 'deepzoom/<book_id>'
  tile_count: number;
  source_url?: string;  // master the pyramid was generated from
  generated_at?: Date;
}

// Pre-computed related book entry
export interface RelatedBook {
  id: string;
  slug?: string;
  title: string;
  author: string;
  published?: string;
  cited_as?: string;          // Entity name that triggered the direct citation
  shared_entities?: number;   // Count of shared entities (for shared type)
  shared_names?: string[];    // Top shared entity names
}