import { PromptReference } from "./prompt";
import { DeepZoomManifest } from "./book";
import { getPageSource } from "@/lib/page-image-url";

export interface Page {
  id: string;
  tenantId?: string;
  book_id: string;
  page_number: number;
  photo: string;
  thumbnail?: string;
  compressed_photo?: string;
  ocr?: OcrData;
  translation?: TranslationData;  // canonical English translation (pivot base for other languages)
  translation_es?: TranslationData;  // LEGACY Spanish field — superseded by translations.es; kept readable during migration (#2835)
  /**
   * Language-keyed content translations (ISO code → TranslationData), e.g.
   * { es: {...}, zh: {...} }. The general model that replaces per-language
   * fields like translation_es (#2835). English stays on `translation` as the
   * pivot base. Read via availableTranslations()/getTranslation() in
   * src/lib/page-translations.ts, which also folds in the legacy translation_es.
   */
  translations?: Record<string, TranslationData>;
  summary?: SummaryData;
  modernized?: ModernizedData;  // Modernized text for reading dashboard
  transliteration?: TransliterationData;  // Romanized transliteration for non-Latin scripts
  created_at?: Date;
  updated_at?: Date;

  // Analytics
  read_count?: number;
  edit_count?: number;

  // Metadata harvested from translation output (<summary> and <keywords> tags)
  translation_summary?: string;    // 1-2 sentence page summary from translation
  translation_keywords?: string[]; // Key concepts/names/themes from translation

  // Semantic alignment: cosine similarity between OCR and translation embeddings
  semantic_alignment?: {
    score: number;           // 0-1 cosine similarity
    embedding_model: string;
    scored_at: Date;
  };

  // Span-level OCR↔translation alignment for reader trace mode (#3091).
  // Cached lazily; hash-invalidated when either text changes.
  // Canonical type: WordAlignmentData in src/lib/word-alignment.ts.
  word_alignment?: import('@/lib/word-alignment').WordAlignmentData;

  // Metered reader (#4357): set by the server (free-preview.ts stripGatedPage)
  // on pages served to anonymous readers beyond the book's free sample — the
  // text fields are absent and the reader shows a sign-in pane instead of the
  // "not yet transcribed" empty state. Never stored on the pages collection.
  gated?: boolean;
  gate?: { free_pages: number; pages_count: number; sign_in_url: string };

  // SEO: demand-proven pages opened to indexing (#2688); always in the free
  // sample when the metered reader is on.
  seo_indexable?: boolean;

  // Page classification from OCR (title-page, frontispiece, toc, etc.)
  page_type?: string;

  // Script type detected by OCR (printed, handwritten, mixed)
  script_type?: 'printed' | 'handwritten' | 'mixed';

  // Number of text columns detected by OCR (2+ for multi-column pages)
  columns?: number;

  // CSS brightness override (1.0 = normal, <1 darker, >1 brighter)
  display_brightness?: number;

  // Detected illustrations/images on this page
  detected_images?: DetectedImage[];

  // Spread splitting (BPH two-page scans)
  split_from_spread?: boolean;  // true if this page was created by splitting a spread
  split_side?: 'left' | 'right' | 'single'; // which side of the spread this page came from
  split_position?: number;      // 0-1000 gutter position used for cropping
  split_source_page?: string;   // ID of original spread page (for right pages)

  // Image dimensions (populated during archiving)
  image_width?: number;         // Full-res image width in pixels
  image_height?: number;        // Full-res image height in pixels

  // Deep-zoom (issue #2411) — illustrated pages only.
  // `fullres_master`: native-res master harvested to R2, separate from archived_photo
  // (the display copy), so OCR/gallery/splitter stay undisturbed.
  // `deepzoom`: DZI tile-pyramid manifest, written LAST after tiles are verified — the
  // only field the reader branches on. See scripts/workers/deepzoom-{harvest,tile}-page*.mjs.
  fullres_master?: {
    url: string;
    width: number;
    height: number;
    source_url?: string;
    harvested_at?: Date;
  };
  deepzoom?: DeepZoomManifest;

  // Split/crop workflow (legacy — stale on split_from_spread pages)
  photo_original?: string;      // Original S3 URL before cropping
  cropped_photo?: string;       // Local path to cropped image
  archived_photo?: string;      // Full-res archived JPEG in R2
  enhanced_photo?: string;      // Contrast/brightness-enhanced copy of archived_photo in R2
  display_photo?: string;       // 1200px display-size JPEG in R2 (with provenance marks baked in)
  thumbnail_blob?: string;      // @deprecated Use image_thumb. Pre-generated 150px JPEG thumbnail in R2
  image_thumb?: string;          // 150px JPEG thumbnail in R2 (canonical field, replaces thumbnail_blob)
  crop?: CropData;              // Crop coordinates used
  split_from?: string;          // ID of parent page if this was split from another
  split_detection?: {           // Pixel analysis result
    isTwoPageSpread: boolean;
    confidence: 'high' | 'medium' | 'low';
    splitPosition: number;      // 0-1000 scale
    splitPositionPercent: number;
    hasTextAtSplit: boolean;
    textWarning?: string;
    metrics: {
      aspectRatio: number;
      gutterScore: number;
      maxDarkRunAtSplit: number;
      transitionsAtSplit: number;
      windowAvgDarkRun: number;
      windowAvgTransitions: number;
    };
    detected_at?: Date;
  };
}

// Processing metadata for reproducibility and cost tracking
export interface ProcessingMetadata {
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  processing_ms?: number;
  prompt_url?: string;   // GitHub URL to exact prompt version used (deprecated)
  prompt?: PromptReference;  // Reference to versioned prompt
}

/**
 * Where a stored `data` field came from — WHO produced the words.
 *
 * This was `'ai' | 'manual'` long after the writers had outgrown it: the batch
 * routes have written `'batch_api'` since early 2026 and `es-translate-worker`
 * `'ai-pivot-en'` since #2835. The union was not wrong about intent, it was
 * simply out of date with the data, which is the worse failure — a `.mjs` writer
 * is not type-checked, so nothing complained, and every reader that switched on
 * this type was reasoning about a field it did not fully know.
 *
 * Widened rather than narrowed on purpose. Readers must treat an unrecognised
 * value as "provenance we do not understand" and decline to characterise the
 * text, never as "AI" by default.
 */
export type ContentSource =
  /** Generated by a model, in the ordinary pipeline. */
  | 'ai'
  /** Written or corrected by a person. Never overwrite without asking. */
  | 'manual'
  /** Generated by a model through the Gemini batch API. */
  | 'batch_api'
  /**
   * Imported verbatim from a scholarly text corpus (ETCSL, ORAEC, …). The
   * transliteration — and, for ETCSL, the English translation too — is human
   * scholarly work, not machine output, and there is no page scan behind it.
   * See `src/lib/text-provenance.ts` for the corpus registry.
   */
  | 'corpus'
  /** A non-English edition pivoted by a model FROM our English translation. */
  | 'ai-pivot-en'
  /**
   * Not a translation of ours at all: the column of a bilingual leaf that is
   * already in this language, transcribed from the scan. The words belong to the
   * historical translator or scribe. See `SOURCE_COLUMN_NOTE` in
   * `src/lib/quote-text.ts` and `scripts/lib/source-column.mjs`.
   */
  | 'source-column';

export interface OcrData extends ProcessingMetadata {
  language: string;
  model: string;
  data: string;
  content_hash?: string;      // SHA-256 of data field for provenance verification
  image_urls?: string[];
  updated_at?: Date;
  prompt_name?: string;
  prompt_version?: string;
  batch_job_id?: string;      // Which batch job produced this OCR (for traceability)
  // Source tracking
  source?: ContentSource;     // 'ai' = generated by AI, 'manual' = edited by user
  edited_by?: string;         // User name who made the edit
  edited_at?: Date;           // When the manual edit was made
  // Honest-unavailable state (#4523/#4534). Set when a transcription was
  // ATTEMPTED but the result is not reliably legible (e.g. a Tibetan page where
  // two independent specialist recognizers disagree — see the re-OCR
  // adjudication). The reader shows the scan as authoritative and an honest
  // "not reliably legible" notice INSTEAD of serving the untrustworthy text;
  // `data` is retained for provenance but never rendered. Distinct from an
  // empty `data` ("never transcribed") and from `recitation_blocked`.
  unreadable?: boolean;
  unreadable_reason?: string; // e.g. 'reocr_low_agreement', 'reocr_4523'
}

export interface TranslationData extends ProcessingMetadata {
  language: string;
  model: string;
  data: string;
  content_hash?: string;      // SHA-256 of data field for provenance verification
  updated_at?: Date;
  prompt_name?: string;
  prompt_version?: string;
  batch_job_id?: string;      // Which batch job produced this translation (for traceability)
  source_language?: string;   // ISO language of the source text (e.g. 'de' for German ORAEC)
  german_source?: string;     // Original German scholarly translation (ORAEC Egyptian texts)
  // Source tracking
  source?: ContentSource;     // 'ai' = generated by AI, 'manual' = edited by user
  edited_by?: string;         // User name who made the edit
  edited_at?: Date;           // When the manual edit was made
}

export interface SummaryData extends ProcessingMetadata {
  data: string;
  model: string;
  updated_at?: Date;
  prompt_name?: string;
  // Source tracking
  source?: ContentSource;
  edited_by?: string;
  edited_at?: Date;
}

// ============================================
// PAGE SNAPSHOTS (backup before re-processing)
// ============================================

/**
 * Snapshot of page content before AI re-processing.
 * Created automatically when re-processing a page that has manual edits.
 * Allows restoring manually-edited content if AI output is worse.
 */
export interface PageSnapshot {
  id: string;
  _id?: string;
  page_id: string;
  book_id: string;

  // What triggered the snapshot
  snapshot_type: 'pre_ocr' | 'pre_translate' | 'pre_summary' | 'manual_backup';

  // The content that was saved
  ocr_data?: string;
  translation_data?: string;
  summary_data?: string;

  // Who had edited this content
  ocr_edited_by?: string;
  translation_edited_by?: string;

  // When the snapshot was created
  created_at: Date;

  // What job triggered this (if any)
  triggered_by_job_id?: string;

  // Whether this snapshot has been restored
  restored_at?: Date;
  restored_by?: string;
}

// Modernized text for reading dashboard
export interface ModernizedData {
  data: string;
  model: string;
  updated_at?: Date;
  prompt_name?: string;
  source_translation_hash?: string;  // Hash of translation.data to detect changes
}

// Romanized transliteration for non-Latin scripts
export interface TransliterationData {
  data: string;
  model: string;
  updated_at?: Date;
  source_ocr_hash?: string;    // Hash of ocr.data to detect changes
  script?: string;             // Source script: 'greek', 'hebrew', 'arabic', 'cyrillic', etc.
}

// Crop coordinates for split pages (0-1000 scale)
export interface CropData {
  xStart: number;
  xEnd: number;
  yStart?: number;
  yEnd?: number;
}

// Detected illustration/image on a page (from OCR or vision model)
export type DetectionStatus = 'pending' | 'approved' | 'rejected';

// Structured metadata for indexing/search
export interface ImageMetadata {
  subjects?: string[];          // Topics: "alchemy", "transformation", "nature"
  figures?: string[];           // People/beings: "old man", "serpent", "Mercury"
  symbols?: string[];           // Symbols: "ouroboros", "philosophical egg", "athanor"
  style?: string;               // Art style: "Northern European Renaissance"
  technique?: string;           // Production: "woodcut", "engraving with crosshatching"
  condition?: string;           // Physical state: "good", "fair", "poor"
  iconclass?: string[];         // Iconclass codes: ["49E39", "25F23(LION)"] — Western art iconography
  cit?: string[];               // Chinese Iconography Thesaurus codes: ["4.3", "1.7.2"]
}

export interface DetectedImage {
  id?: string;                  // Unique ID for this detection
  description: string;          // What the image depicts (brief)
  type?: 'woodcut' | 'diagram' | 'chart' | 'illustration' | 'symbol' | 'table' | 'map' | 'decorative' | 'emblem' | 'engraving' | 'portrait' | 'frontispiece' | 'musical_score' | 'exlibris' | 'bookplate' | 'unknown';
  // Bounding box (0-1 normalized coordinates, for future extraction)
  bbox?: {
    x: number;      // Left edge (0-1)
    y: number;      // Top edge (0-1)
    width: number;  // Width (0-1)
    height: number; // Height (0-1)
  };
  rotation?: 0 | 90 | 180 | 270;  // Rotation in degrees (clockwise)
  extracted_url?: string;       // Full-size cropped+rotated JPEG in R2
  thumbnail_url?: string;       // 300px gallery grid thumbnail in R2
  detected_at?: Date;
  detection_source: 'ocr_tag' | 'vision_model' | 'manual';
  model?: 'gemini' | 'mistral' | 'grounding-dino';
  confidence?: number;
  status?: DetectionStatus;     // Review status: pending (default), approved, rejected
  reviewed_at?: Date;
  reviewed_by?: string;
  // Gallery curation
  gallery_quality?: number;     // 0-1 score: how gallery-worthy is this image?
  gallery_rationale?: string;   // Why it scored high/low (visual appeal, historical significance, etc.)
  featured?: boolean;           // Manually marked as gallery-worthy
  // Rich metadata for indexing and display
  metadata?: ImageMetadata;     // Structured tags for search/filtering
  museum_description?: string;  // 2-3 sentence museum-style label
  job_id?: string;              // Processing job that produced this detection
  dhash?: string;               // 64-bit perceptual hash for duplicate detection
}

/**
 * Get the best available source image URL for a page.
 *
 * Delegates to the canonical {@link getPageSource} (`@/lib/page-image-url`,
 * issue #1727), which prefers the cropped half for split pages (old-era
 * `cropped_photo` or new-era `sp…` `photo`) and drops the dead `enhanced_photo`
 * field. Returns '' on a miss to preserve this helper's string contract.
 */
export function pageImageUrl(page: Partial<Page>): string {
  return getPageSource(page) ?? '';
}