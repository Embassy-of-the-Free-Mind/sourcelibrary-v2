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
  tenant_id: string;

  // Title fields
  title: string;              // Original language title (USTC-aligned, fixed)
  display_title?: string;     // English title for display (editable)

  // Author and publication
  author: string;
  language: string;           // Original language of the text
  published: string;          // Publication year

  // USTC catalog fields
  ustc_id?: string;           // USTC catalog number (e.g., "2029384")
  place_published?: string;   // City of publication (e.g., "Hamburg")
  publisher?: string;         // Printer/Publisher name
  format?: string;            // Book format (folio, quarto, octavo, etc.)

  // Display and categorization
  thumbnail?: string;          // Original IIIF URL (from import)
  thumbnail_blob?: string;     // Vercel Blob CDN URL (fast, pre-generated)
  categories?: string[];
  faceted_tags?: FacetedTags;
  pages_count?: number;
  pages_translated?: number;  // CACHED — synced from pages collection by cron every 6h + inline by workers
  pages_ocr?: number;         // CACHED — synced from pages collection by cron every 6h + inline by workers
  translation_percent?: number; // Computed at read time from pages_translated/pages_ocr (never stored). Uses pages_ocr as denominator so blank pages don't penalize the percentage.
  created_at?: Date;
  updated_at?: Date;
  last_processed?: Date;  // Last OCR or translation update

  // Workflow status
  status?: BookStatus;
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

  // Dublin Core metadata for library interoperability
  dublin_core?: DublinCoreMetadata;

  // Image source and licensing (for scans/digitizations)
  image_source?: ImageSource;

  // Internet Archive identifier (for reimport)
  ia_identifier?: string;

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
  hidden_reason?: string;  // 'efm_duplicate' | 'launch_curation' | 'quality'

  // Beta launch: featured books bypass the email gate
  featured?: boolean;

  // Free tier: most-read books accessible without registration
  free_tier?: boolean;

  // Read analytics (maintained by analytics/track)
  read_count?: number;

  // Pre-computed related books (backfilled from entity graph)
  related_books?: {
    direct: RelatedBook[];   // Books whose authors are mentioned as entities in this book
    shared: RelatedBook[];   // Books sharing 5+ entity mentions
    computed_at: Date;
  };

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
    efm_relevance: number;
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
  level: number;  // 1 = top-level division, 2 = major chapter, 3 = sub-chapter
  confidence?: 'high' | 'medium' | 'low'; // AI's confidence in this chapter boundary
}

// Translation verification from catalog search + LLM knowledge check
export type TranslationDisposition = 'confirmed_first' | 'first_complete_translation' | 'first_modern_translation' | 'translation_found' | 'needs_review';

export interface TranslationVerification {
  source: 'catalog_search';
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