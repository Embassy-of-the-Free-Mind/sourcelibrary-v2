import { DublinCoreMetadata } from "./dublin-core";
import { ImageSource } from "./image-source";
import { TranslationEdition } from "./edition";
import { PipelineState } from "./pipeline";

export interface Book {
  id: string;
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
  thumbnail?: string;
  categories?: string[];
  pages_count?: number;
  pages_translated?: number;  // Number of pages with translations
  pages_ocr?: number;         // Number of pages with OCR
  translation_percent?: number; // Percentage of pages translated (0-100)
  created_at?: Date;
  updated_at?: Date;
  last_processed?: Date;  // Last OCR or translation update

  // Workflow status
  status?: BookStatus;
  summary?: string | BookSummary;

  // Standard identifiers
  doi?: string;                 // Digital Object Identifier (e.g., "10.5281/zenodo.12345")
  license?: string;             // SPDX identifier (e.g., "CC0-1.0", "CC-BY-4.0")

  // Dublin Core metadata for library interoperability
  dublin_core?: DublinCoreMetadata;

  // Image source and licensing (for scans/digitizations)
  image_source?: ImageSource;

  // Internet Archive identifier (for reimport)
  ia_identifier?: string;

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

// Chapter/heading extracted from OCR for table of contents
export interface Chapter {
  title: string;
  pageId: string;
  pageNumber: number;
  level: number;  // 1 = #, 2 = ##, 3 = ###
}