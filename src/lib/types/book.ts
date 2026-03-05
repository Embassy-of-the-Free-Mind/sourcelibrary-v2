import { DublinCoreMetadata } from "./dublin-core";
import { ImageSource } from "./image-source";
import { TranslationEdition } from "./edition";
import { PipelineState } from "./pipeline";

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
  pages_count?: number;
  pages_translated?: number;  // CACHED — synced from pages collection by cron every 6h + inline by workers
  pages_ocr?: number;         // CACHED — synced from pages collection by cron every 6h + inline by workers
  translation_percent?: number; // Computed at read time from pages_translated/pages_count (never stored)
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
export type TranslationDisposition = 'confirmed_first' | 'translation_found' | 'needs_review';

export interface TranslationVerification {
  source: 'catalog_search';
  searched_at: Date;
  has_english_translation: boolean;
  translations?: TranslationEvidence[];
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
}