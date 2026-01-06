export type BookStatus = 'draft' | 'in_progress' | 'complete' | 'published';

// Job management for long-running tasks
export type JobType = 'ocr' | 'translate' | 'batch_ocr' | 'batch_translate' | 'batch_summary' | 'batch_split' | 'book_import' | 'generate_cropped_images' | 'pipeline_stream' | 'batch_extract_images';
export type JobStatus = 'pending' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface JobProgress {
  total: number;
  completed: number;
  failed: number;
  currentItem?: string;
}

export interface JobResult {
  pageId: string;
  success: boolean;
  error?: string;
  duration?: number;
}

export interface WorkflowState {
  currentStep: 'ocr' | 'translation' | null;
  ocrMode: 'missing' | 'all';
  translationMode: 'missing' | 'all';
  ocrProcessedIds: string[];
  translationProcessedIds: string[];
  ocrFailedIds: string[];
  translationFailedIds: string[];
  selectedModel: string;
  ocrPromptId?: string;
  translationPromptId?: string;
  stepsEnabled: { ocr: boolean; translation: boolean };
}

export interface Job {
  _id?: unknown;
  id: string;
  type: JobType;
  status: JobStatus;
  progress: JobProgress;
  book_id?: string;
  book_title?: string;
  initiated_by?: string;  // Name/email of user who started the job
  created_at: Date;
  updated_at: Date;
  started_at?: Date;
  completed_at?: Date;
  error?: string;
  results: JobResult[];
  workflow_state?: WorkflowState;  // For resumable processing
  config: {
    model?: string;
    prompt_name?: string;
    language?: string;
    page_ids?: string[];
    use_batch_api?: boolean;
    [key: string]: unknown;
  };
  // Gemini Batch API job name (for async processing)
  gemini_batch_job?: string;
  // Multiple batch jobs (for large jobs split into batches)
  gemini_batch_jobs?: Array<{
    name: string;
    page_ids?: string[];
    results_collected?: boolean;
    success_count?: number;
    fail_count?: number;
    error?: string;
  }>;
  // Batch processing phase
  batch_phase?: 'preparing' | 'submitted' | 'completed';
}

// ============================================
// Pipeline - Automated book processing workflow
// ============================================

export type PipelineStep = 'crop' | 'ocr' | 'translate' | 'summarize' | 'edition';
export type PipelineStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export interface PipelineStepState {
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  progress?: { completed: number; total: number };
  started_at?: Date;
  completed_at?: Date;
  error?: string;
  result?: Record<string, unknown>;
}

export interface PipelineConfig {
  model: string;
  language: string;
  license: string;
  useBatchApi?: boolean;
}

export interface PipelineState {
  status: PipelineStatus;
  currentStep: PipelineStep | null;

  steps: {
    crop: PipelineStepState;
    ocr: PipelineStepState;
    translate: PipelineStepState;
    summarize: PipelineStepState;
    edition: PipelineStepState;
  };

  started_at?: Date;
  completed_at?: Date;
  error?: string;

  config: PipelineConfig;
}

// Available Gemini models for processing
export const GEMINI_MODELS = [
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', description: 'Latest model - best quality (recommended)' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Previous generation - lower cost' },
] as const;

// Default model for single-page realtime operations (best quality)
export const DEFAULT_MODEL = 'gemini-3-flash-preview';

// Default model for batch operations (50% cheaper via Batch API)
export const DEFAULT_BATCH_MODEL = 'gemini-3-flash-preview';

// ============================================
// PROMPT VERSIONING
// ============================================

export type PromptType = 'ocr' | 'translation' | 'summary';

/**
 * Reference to a prompt stored in page metadata.
 * Allows retrieving the exact prompt used for processing.
 */
export interface PromptReference {
  id: string;                   // Prompt document ID
  name: string;                 // Prompt name for quick reference
  version: number;              // Version number
}

// Legacy: GitHub URL for prompt versioning (deprecated in favor of prompt_id)
export const PROMPTS_SOURCE_URL = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/src/lib/types.ts';

export interface BookSummary {
  data: string;
  generated_at: Date;
  page_coverage: number; // Percentage of pages included in summary (0-100)
  model?: string;
}

// Dublin Core metadata for library interoperability
// See: https://www.dublincore.org/specifications/dublin-core/dcmi-terms/
export interface DublinCoreMetadata {
  // dc:title - handled by Book.title / Book.display_title
  // dc:creator - handled by Book.author
  // dc:date - handled by Book.published
  // dc:language - handled by Book.language

  dc_subject?: string[];        // Topics, keywords, classification codes
  dc_description?: string;      // Abstract or table of contents
  dc_publisher?: string;        // Original publisher
  dc_contributor?: string[];    // Other contributors (translators, editors)
  dc_type?: string;             // e.g., "Text", "Manuscript", "Book"
  dc_format?: string;           // Physical format, e.g., "24 cm, 120 pages"
  dc_identifier?: string[];     // ISBN, OCLC number, catalog IDs
  dc_source?: string;           // Physical location (library, archive, collection)
  dc_relation?: string[];       // Related works, other editions
  dc_coverage?: string;         // Geographic or temporal scope
  dc_rights?: string;           // Rights statement (use license for standard licenses)
}

// Image source providers
export type ImageSourceProvider =
  | 'efm'  // Embassy of the Free Mind (Bibliotheca Philosophica Hermetica)
  | 'internet_archive'
  | 'google_books'
  | 'hathi_trust'
  | 'biodiversity_heritage_library'
  | 'gallica'
  | 'e_rara'
  | 'mdz'  // Münchener DigitalisierungsZentrum
  | 'library'
  | 'user_upload'
  | 'other';

// Common image licenses
export const IMAGE_LICENSES = [
  { id: 'publicdomain', name: 'Public Domain', description: 'No known copyright restrictions' },
  { id: 'CC0-1.0', name: 'CC0 1.0', description: 'Public Domain Dedication' },
  { id: 'CC-BY-4.0', name: 'CC BY 4.0', description: 'Attribution required' },
  { id: 'CC-BY-SA-4.0', name: 'CC BY-SA 4.0', description: 'Attribution, ShareAlike' },
  { id: 'CC-BY-NC-4.0', name: 'CC BY-NC 4.0', description: 'Attribution, NonCommercial' },
  { id: 'in-copyright', name: 'In Copyright', description: 'Permission obtained from rights holder' },
  { id: 'unknown', name: 'Unknown', description: 'License status not determined' },
] as const;

// Image source and licensing info
export interface ImageSource {
  provider: ImageSourceProvider;
  provider_name?: string;       // Human-readable: "Internet Archive", "Bayerische Staatsbibliothek"
  source_url?: string;          // Link to original (e.g., archive.org/details/...)
  identifier?: string;          // IA identifier, Google Books ID, etc.
  license: string;              // SPDX or custom: "publicdomain", "CC-BY-4.0", "in-copyright"
  license_url?: string;         // Link to license terms
  attribution?: string;         // Required credit text (if any)
  access_date?: Date;           // When images were retrieved
  notes?: string;               // Additional context (e.g., "Scans provided by X library")
}

export interface Book {
  id: string;
  _id?: string;
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

// Processing metadata for reproducibility and cost tracking
export interface ProcessingMetadata {
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  processing_ms?: number;
  prompt_url?: string;   // GitHub URL to exact prompt version used (deprecated)
  prompt?: PromptReference;  // Reference to versioned prompt
}

// Source tracking for edits
export type ContentSource = 'ai' | 'manual';

export interface OcrData extends ProcessingMetadata {
  language: string;
  model: string;
  data: string;
  image_urls?: string[];
  updated_at?: Date;
  prompt_name?: string;
  // Source tracking
  source?: ContentSource;     // 'ai' = generated by AI, 'manual' = edited by user
  edited_by?: string;         // User name who made the edit
  edited_at?: Date;           // When the manual edit was made
}

export interface TranslationData extends ProcessingMetadata {
  language: string;
  model: string;
  data: string;
  updated_at?: Date;
  prompt_name?: string;
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
}

export interface DetectedImage {
  id?: string;                  // Unique ID for this detection
  description: string;          // What the image depicts (brief)
  type?: 'woodcut' | 'diagram' | 'chart' | 'illustration' | 'symbol' | 'table' | 'map' | 'decorative' | 'emblem' | 'engraving' | 'portrait' | 'frontispiece' | 'musical_score' | 'unknown';
  // Bounding box (0-1 normalized coordinates, for future extraction)
  bbox?: {
    x: number;      // Left edge (0-1)
    y: number;      // Top edge (0-1)
    width: number;  // Width (0-1)
    height: number; // Height (0-1)
  };
  extracted_url?: string;       // URL to extracted/cropped image (future)
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
}

export interface Page {
  id: string;
  _id?: string;
  tenant_id: string;
  book_id: string;
  page_number: number;
  photo: string;
  thumbnail?: string;
  compressed_photo?: string;
  ocr: OcrData;
  translation: TranslationData;
  summary?: SummaryData;
  modernized?: ModernizedData;  // Modernized text for reading dashboard
  created_at?: Date;
  updated_at?: Date;

  // Analytics
  read_count?: number;
  edit_count?: number;

  // Detected illustrations/images on this page
  detected_images?: DetectedImage[];

  // Split/crop workflow
  photo_original?: string;      // Original S3 URL before cropping
  cropped_photo?: string;       // Local path to cropped image
  archived_photo?: string;      // Vercel Blob URL for archived IA images
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

export interface ProcessingPrompts {
  ocr: string;
  translation: string;
  summary: string;
}

/**
 * A versioned prompt stored in the database.
 * Each prompt has a name and version number.
 * When prompts are updated, a new version is created (immutable history).
 */
export interface Prompt {
  _id?: unknown;
  id?: string;
  name: string;                           // e.g., "Standard OCR", "Latin Translation"
  type: PromptType;                       // 'ocr' | 'translation' | 'summary'
  version?: number;                       // Auto-increment per name (1, 2, 3...)
  content: string;                        // The actual prompt template (legacy name, same as 'text')
  text?: string;                          // Alias for content
  variables?: string[];                   // Variables used, e.g., ["language"]
  description?: string;                   // Human-readable description
  is_default?: boolean;                   // Is this the default prompt for this type?
  created_at?: Date;
  updated_at?: Date;                      // Legacy field
  created_by?: string;                    // User who created this version
}

// ============================================
// VERSIONING & DOI SCHEMA
// ============================================

/**
 * A contributor to a translation (translator, editor, reviewer)
 */
export interface Contributor {
  name: string;
  role: 'translator' | 'editor' | 'reviewer' | 'transcriber';
  type: 'ai' | 'human';
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

  // Version info
  version: string;             // Semantic: "1.0.0", "1.1.0", "2.0.0"
  version_label?: string;      // Human-friendly: "First Edition", "Revised"
  status: 'draft' | 'published' | 'superseded';

  // Identifiers
  doi?: string;                // "10.5281/zenodo.12345678"
  doi_url?: string;            // "https://doi.org/10.5281/zenodo.12345678"
  zenodo_id?: number;          // Zenodo deposit ID
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
    original_language: string;
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

// ============================================
// COMMUNITY ANNOTATIONS & ENCYCLOPEDIA
// ============================================

/**
 * Annotation types for categorizing community contributions
 */
export type AnnotationType = 'comment' | 'context' | 'correction' | 'reference' | 'question' | 'etymology';

/**
 * Moderation status for annotations
 */
export type AnnotationStatus = 'pending' | 'approved' | 'hidden';

/**
 * Community contribution on a specific text passage
 * Inspired by Pepys Diary annotation model
 */
export interface Annotation {
  id: string;
  _id?: string;
  book_id: string;
  page_id: string;
  page_number: number;

  // Text anchor (what's being annotated)
  anchor: {
    text: string;             // The selected text
    start_offset?: number;    // Character offset in page translation
    end_offset?: number;
  };

  // Content
  content: string;            // Markdown annotation text
  type: AnnotationType;

  // Attribution (will be linked to auth later)
  user_id?: string;           // NextAuth user (optional until auth)
  user_name: string;          // Display name (denormalized)

  // Community curation
  upvotes: number;
  upvoted_by: string[];       // User IDs or IP hashes

  // Moderation
  status: AnnotationStatus;

  // Threading
  parent_id?: string;         // For replies to other annotations
  reply_count: number;

  // Encyclopedia links (annotations can reference entries)
  encyclopedia_refs?: string[]; // Encyclopedia entry IDs mentioned

  created_at: Date;
  updated_at?: Date;
}

/**
 * Encyclopedia entry types
 */
export type EncyclopediaEntryType = 'term' | 'person' | 'place' | 'work' | 'concept';

/**
 * Shared encyclopedia entry for terms, people, places, etc.
 * Grows organically from annotations and term extraction
 */
export interface EncyclopediaEntry {
  id: string;
  _id?: string;
  slug: string;               // URL-friendly: "quinta-essentia"

  // Core content
  title: string;              // "Quinta Essentia"
  aliases: string[];          // ["Fifth Essence", "Quintessence"]
  type: EncyclopediaEntryType;

  // Definition
  summary: string;            // Short definition (1-2 sentences)
  content: string;            // Full markdown article

  // Categorization
  categories: string[];       // ["Alchemy", "Paracelsian"]
  related_entries: string[];  // IDs of related encyclopedia entries

  // Sources from the library
  primary_sources: Array<{
    book_id: string;
    book_title?: string;      // Denormalized for display
    page_numbers: number[];
    quote?: string;           // Representative quote
  }>;

  // External references
  external_references: Array<{
    title: string;
    url?: string;
    citation?: string;        // Formatted citation
  }>;

  // Attribution
  created_by?: string;        // User ID who created
  created_by_name?: string;   // Denormalized display name
  contributors: string[];     // User IDs who edited

  // Community metrics
  view_count: number;
  annotation_count: number;   // How many annotations link here

  created_at: Date;
  updated_at?: Date;
}

/**
 * Auto-extracted link from book text to encyclopedia entry
 * Created by scanning translations for known terms
 */
export interface TermLink {
  id: string;
  _id?: string;
  book_id: string;
  page_id: string;
  page_number: number;

  term: string;               // The text that matches
  encyclopedia_id: string;    // What it links to
  encyclopedia_slug: string;  // Denormalized for URL building

  // Confidence tracking
  confidence: 'auto' | 'confirmed' | 'rejected';
  confirmed_by?: string;      // User who confirmed/rejected

  // Position in text (for highlighting)
  start_offset?: number;
  end_offset?: number;

  created_at: Date;
  updated_at?: Date;
}

// RTL (right-to-left) languages that need special display handling
export const RTL_LANGUAGES = ['Arabic', 'Hebrew', 'Aramaic', 'Syriac', 'Persian', 'Urdu'];

/**
 * Check if a language is RTL
 */
export function isRTLLanguage(language: string | null | undefined): boolean {
  if (!language) return false;
  return RTL_LANGUAGES.some(rtl =>
    language.toLowerCase().includes(rtl.toLowerCase())
  );
}

// Language-specific prompts
export const ARABIC_PROMPTS = {
  ocr: `You are transcribing an Arabic manuscript or early printed book.

**Input:** The page image and (if available) the previous page's transcription for context.

**Output:** A faithful transcription in Markdown format, preserving the original text direction (RTL).

**First:** Confirm the language with <lang>Arabic</lang> or <lang>Arabic with Persian/Turkish passages</lang>

**Arabic-specific conventions:**

1. **Script identification:**
   - Identify script style: <meta>Naskh/Maghrebi/Nastaliq/Thuluth</meta>
   - Note if Ottoman Turkish or Persian in Arabic script
   - Mark language switches: <lang>Persian</lang> ... <lang>Arabic</lang>

2. **Vocalization (harakat):**
   - Transcribe all vowel marks (fatha, kasra, damma, sukun, shadda) when present
   - Note: <meta>fully vocalized</meta> or <meta>unvocalized</meta>
   - Preserve hamza positioning (أ إ ؤ ئ ء)

3. **Special characters:**
   - Preserve all ligatures and letter forms
   - Preserve ta marbuta (ة) vs ha (ه) distinction
   - Preserve alif maqsura (ى) vs ya (ي) distinction
   - Note calligraphic elements: <note>decorative basmala</note>

4. **Numbers:**
   - Preserve Arabic-Indic numerals (٠١٢٣٤٥٦٧٨٩) as written
   - Or Eastern Arabic numerals if used

5. **Technical vocabulary:**
   - <term>الكيمياء → alchemy</term> for technical terms needing gloss
   - Mark Quranic quotations: <note>Quran X:Y</note>
   - Flag magical/talismanic terms with <term>...</term>

6. **Abbreviations:**
   - صلى الله عليه وسلم → keep as written or use ﷺ
   - رضي الله عنه → keep as written
   - Mark expansions: <abbrev>etc.</abbrev>

**Layout markup:**
- # Large title → use # heading
- ## Section heading → use ## heading
- **Bold text** → use **bold**
- ->centered text<- for centered lines (common in Arabic manuscripts)
- > blockquotes for Quranic quotations, hadith
- --- for decorative dividers

**Tables:** Use markdown tables for ANY columnar data, magical squares, charts:
| العمود ١ | العمود ٢ |
|----------|----------|
| data | data |

**Metadata tags (hidden from readers):**
- <meta>X</meta> for page metadata (script style, vocalization level)
- <page-num>N</page-num> for page numbers
- <header>X</header> for running headers
- <vocab>X</vocab> for key terms for indexing

**Inline annotations (visible to readers):**
- <note>X</note> for interpretive notes
- <margin>X</margin> for marginalia (common in Islamic manuscripts)
- <gloss>X</gloss> for interlinear annotations
- <term>word → meaning</term> for technical vocabulary
- <unclear>X</unclear> for illegible readings
- <image-desc>description</image-desc> for diagrams, talismans, magical squares

**Instructions:**
1. Begin with <meta>...</meta> describing script style, vocalization, condition.
2. Preserve original spelling and vocalization exactly.
3. Capture ALL text including margins (which often contain important commentary).
4. Flag all technical/magical vocabulary with <term>...</term>.
5. Note Quranic quotations and hadith references.
6. END with <vocab>...</vocab> listing key Arabic terms on this page.

**Important:** This page may have been split from a two-page spread. Focus on the MAIN text block.

**Final output format:**
[page transcription in Arabic]

<vocab>term1, term2, مصطلح, ...</vocab>`,

  translation: `You are translating an Arabic manuscript into clear, accessible English.

**Input:** The Arabic OCR transcription and (if available) the previous page's translation for continuity.

**Output:** A readable English translation preserving the markdown structure from the OCR.

**Translation philosophy:**
SCHOLARLY ACCESSIBLE: accurate to the Arabic, readable for English speakers, with context for Islamic/esoteric references.

**Preserve from OCR:**
- Heading levels (# ## ###)
- **Bold** and *italic* formatting
- Tables and centered text
- All <xml> annotations - translate content, keep tags
- <term> markers - translate and explain

**Arabic translation guidelines:**

1. **Technical vocabulary:**
   - Keep Arabic term + English: "the *rūḥāniyyāt* (spiritual entities)"
   - Use standard academic transliteration (IJMES style) for key terms
   - Explain on first use: "the *ʿilm al-ḥurūf* (science of letters)"

2. **Divine names and honorifics:**
   - Allah → "God" or "Allah" (be consistent)
   - Keep honorifics in transliteration: "the Prophet ﷺ" or "the Prophet (peace be upon him)"
   - 99 Names: translate with Arabic in parentheses

3. **Quranic quotations:**
   - Use standard English translation (Arberry, Pickthall, or your own)
   - Always note: <note>Quran 2:255 (Throne Verse)</note>
   - Keep Arabic for very short phrases with translation

4. **Magical/esoteric terms:**
   - *Wafq* → "magic square (*wafq*)"
   - *Ṭilasm* → "talisman (*ṭilasm*)"
   - *Dawāʾir* → "circles (*dawāʾir*)" (for magical diagrams)
   - Explain purpose and significance

5. **Names:**
   - Use standard English forms for well-known figures: Solomon (not Sulaymān)
   - Keep Arabic for less known: "Aḥmad al-Būnī"
   - Add context: "al-Būnī (d. 1225), the famous North African occultist"

6. **Syntax:**
   - Arabic has different sentence structures
   - Reorder naturally for English readability
   - <note>reordered for English syntax</note> when significantly restructuring

**Add notes:**
- <note>...</note> for interpretive choices readers should see
- <note>lit. "..."</note> for significant literal meanings
- <meta>...</meta> for translator notes that should be hidden

**Style:** Clear and respectful of the Islamic scholarly tradition. Explain esoteric concepts without sensationalizing.

**Do NOT:**
- Use code blocks or backticks
- Skip or summarize magical formulas (they're important primary source material)
- Over-translate divine names (keep some Arabic resonance)

**Source language:** Arabic
**Target language:** English

**Final output format:**
[translated text]

<summary>1-2 sentence summary of this page's main content and significance</summary>
<keywords>key concepts, names, themes in English — for indexing</keywords>`
};

export const HEBREW_PROMPTS = {
  ocr: `You are transcribing a Hebrew manuscript or early printed book.

**Input:** The page image and (if available) the previous page's transcription for context.

**Output:** A faithful transcription in Markdown format, preserving the original text direction (RTL).

**First:** Confirm the language with <lang>Hebrew</lang> or <lang>Hebrew with Aramaic passages</lang>

**Hebrew-specific conventions:**

1. **Script identification:**
   - Identify script type: <meta>Square Hebrew/Rashi script/Cursive</meta>
   - Note if Ashkenazi or Sephardi orthography
   - Rashi script common for commentaries
   - Mark language switches: <lang>Aramaic</lang> ... <lang>Hebrew</lang>

2. **Vocalization (nikud):**
   - Transcribe ALL vowel points when present
   - Note: <meta>fully vocalized</meta>, <meta>partial nikud</meta>, or <meta>unvocalized</meta>
   - Preserve dagesh (ּ), mappiq, and other diacritics

3. **Cantillation (teamim):**
   - If present, transcribe cantillation marks
   - Note: <meta>with cantillation</meta>

4. **Special characters:**
   - Preserve final letters (ך ם ן ף ץ)
   - Preserve geresh (׳) and gershayim (״) for abbreviations
   - Divine Name: יהוה or י״י or ה׳ - preserve as written, note convention

5. **Abbreviations (common in Hebrew texts):**
   - ר׳ → רבי (Rabbi)
   - ז״ל → זכרונו לברכה (of blessed memory)
   - ע״ה → עליו השלום (peace be upon him)
   - Mark: <abbrev>ר׳ → רבי</abbrev> on first occurrence

6. **Technical vocabulary:**
   - <term>ספירות → sefirot (divine emanations)</term>
   - <term>אין סוף → Ein Sof (the Infinite)</term>
   - Mark Kabbalistic, magical, and philosophical terms

7. **Biblical quotations:**
   - Note source: <note>Genesis 1:1</note>
   - Preserve exact orthography (may differ from Masoretic standard)

**Layout markup:**
- # Large title → use # heading
- ## Section heading → use ## heading
- **Bold text** → use **bold**
- ->centered text<- for centered lines
- > blockquotes for Biblical quotations
- --- for decorative dividers

**Tables:** Use markdown tables for Kabbalistic diagrams, gematria, charts:
| עמודה א | עמודה ב |
|---------|---------|
| data | data |

**Metadata tags (hidden from readers):**
- <meta>X</meta> for page metadata (script type, vocalization)
- <page-num>N</page-num> for page numbers
- <header>X</header> for running headers
- <vocab>X</vocab> for key terms

**Inline annotations (visible to readers):**
- <note>X</note> for interpretive notes
- <margin>X</margin> for marginalia and commentaries
- <gloss>X</gloss> for interlinear annotations
- <term>word → meaning</term> for technical vocabulary
- <unclear>X</unclear> for illegible readings
- <image-desc>description</image-desc> for diagrams, sefirotic trees

**Instructions:**
1. Begin with <meta>...</meta> describing script type, vocalization level, condition.
2. Preserve original spelling, vocalization, and cantillation exactly.
3. Capture ALL text including marginalia (often contains crucial Kabbalistic commentary).
4. Flag all technical/mystical vocabulary with <term>...</term>.
5. Note Biblical quotations with chapter:verse.
6. END with <vocab>...</vocab> listing key Hebrew/Aramaic terms on this page.

**Important:** This page may have been split from a two-page spread. Focus on the MAIN text block.

**Final output format:**
[page transcription in Hebrew]

<vocab>term1, term2, מונח, ...</vocab>`,

  translation: `You are translating a Hebrew/Aramaic manuscript into clear, accessible English.

**Input:** The Hebrew OCR transcription and (if available) the previous page's translation for continuity.

**Output:** A readable English translation preserving the markdown structure from the OCR.

**Translation philosophy:**
SCHOLARLY ACCESSIBLE: accurate to the Hebrew/Aramaic, readable for English speakers, with context for Jewish mystical/magical references.

**Preserve from OCR:**
- Heading levels (# ## ###)
- **Bold** and *italic* formatting
- Tables and centered text
- All <xml> annotations - translate content, keep tags
- <term> markers - translate and explain

**Hebrew translation guidelines:**

1. **Technical vocabulary:**
   - Keep Hebrew term + English: "the *sefirot* (divine emanations)"
   - Use standard academic transliteration for key terms
   - Explain on first use: "*gematria* (Hebrew numerology)"

2. **Divine names:**
   - יהוה → "YHWH" or "the LORD" or "the Name" (be consistent, note your convention)
   - אלהים → "God" or "Elohim" (depending on context)
   - Kabbalistic names: translate with Hebrew in parentheses

3. **Kabbalistic terminology:**
   - *Sefirot*: Keter (Crown), Ḥokhmah (Wisdom), Binah (Understanding), etc.
   - *Ein Sof* → "the Infinite (*Ein Sof*)"
   - Keep Hebrew for well-known terms, explain on first use

4. **Biblical quotations:**
   - Use standard English translation (JPS, NRSV, or your own)
   - Always note: <note>Genesis 1:1</note>
   - For Aramaic (Zohar, Targum): translate to English, note source

5. **Aramaic passages:**
   - Zoharic Aramaic is distinct from Biblical Aramaic
   - Translate fully to English
   - Note: <note>Zohar I:15a</note> for references

6. **Magical texts:**
   - *Shemot* → "divine names (*shemot*)"
   - Angel names: translate meaning + keep Hebrew (e.g., "Michael (*Mikhaʾel*, 'Who is like God')")
   - Preserve magical formulas but explain their purpose

7. **Names:**
   - Biblical figures: use English (Moses, Abraham, Solomon)
   - Rabbis: "Rabbi Shimon bar Yoḥai" (keep Hebrew form)
   - Add context: "the Ari (Rabbi Isaac Luria, d. 1572)"

**Add notes:**
- <note>...</note> for interpretive choices readers should see
- <note>lit. "..."</note> for significant literal meanings
- <meta>...</meta> for translator notes that should be hidden

**Style:** Clear and respectful of the Jewish mystical tradition. Make Kabbalistic concepts accessible without oversimplifying.

**Do NOT:**
- Use code blocks or backticks
- Skip or summarize magical names/formulas
- Flatten the poetic quality of mystical texts

**Source language:** Hebrew/Aramaic
**Target language:** English

**Final output format:**
[translated text]

<summary>1-2 sentence summary of this page's main content and significance</summary>
<keywords>key concepts, names, themes in English — for indexing</keywords>`
};

// Language-specific prompts
export const LATIN_PROMPTS = {
  ocr: `You are transcribing a Neo-Latin manuscript or early printed book (1450-1700).

**Input:** The page image and (if available) the previous page's transcription for context.

**Output:** A faithful transcription in Markdown format that visually resembles the original.

**First:** Confirm the language with <lang>Latin</lang> or <lang>Latin with {other} passages</lang>

**Latin-specific conventions:**

1. **Abbreviations** - Expand common scribal/print abbreviations:
   - ꝙ, ꝗ → quod | ꝯ → con/com | ꝑ → per/par | ꝓ → pro
   - Macrons over vowels usually indicate missing 'm' or 'n' (ū → um/un)
   - Tildes often mark missing letters
   - Mark expansions: <abbrev>ꝙ → quod</abbrev> on first occurrence

2. **Letterforms** - Normalize to modern equivalents:
   - u/v: Transcribe as written (Renaissance texts mix freely)
   - i/j: Transcribe as written
   - Long s (ſ) → s
   - Ligatures: æ, œ → keep as ligatures
   - Note unusual forms: <note>uses archaic ę for ae</note>

3. **Capitalization** - Preserve original:
   - Renaissance Latin often capitalizes Nouns like German
   - Keep ALL CAPS for emphasis where used
   - Note patterns: <note>capitalizes all proper nouns and abstract concepts</note>

4. **Technical vocabulary** - Flag uncertain readings:
   - <term>azoth</term> for alchemical/esoteric terms
   - <term>anima mundi → "world soul"</term> for terms needing gloss
   - Paracelsian neologisms, Hermetic terminology, Kabbalistic transliterations

**Representing text styles:**
- # Large title → use # heading
- ## Section heading → use ## heading
- **Bold text** → use **bold**
- *Italic text* → use *italic*
- Preserve line breaks and paragraph structure

**Layout markup:**
- ->centered text<- for centered lines
- > blockquotes for quotations, prayers
- --- for decorative dividers

**Tables:** Use markdown tables for ANY columnar data, charts, lists:
| Column 1 | Column 2 |
|----------|----------|
| data | data |

**Metadata tags (hidden from readers):**
- <meta>X</meta> for page metadata (image quality, script type)
- <page-num>N</page-num> or <folio>12r</folio> for visible page/folio numbers
- <header>X</header> for running headers/page headings
- <abbrev>X → expansion</abbrev> for abbreviation expansions (collected in metadata)
- <vocab>X</vocab> for key terms for indexing

**Inline annotations (visible to readers):**
- <note>X</note> for interpretive notes readers should see
- <margin>X</margin> for marginalia
- <gloss>X</gloss> for interlinear annotations
- <insert>X</insert> for later additions (inline only)
- <unclear>X</unclear> for illegible readings
- <term>word</term> or <term>word → meaning</term> for technical vocabulary
- <image-desc>description</image-desc> for illustrations, diagrams, charts, woodcuts, printer's devices

**IMPORTANT - Exclude from main text:**
- Page numbers: Capture ONLY in <page-num>N</page-num> or <folio>X</folio>, do NOT include in the body text
- Running headers/page headings: Capture ONLY in <header>...</header>, do NOT include in the body text
- These elements should appear in metadata annotations only, never in the main transcription

**Do NOT use:**
- Code blocks (\`\`\`) or inline code - this is prose, not code
- If markdown can't capture the layout, add a <meta>...</meta> explaining it

**Instructions:**
1. Begin with <meta>...</meta> describing image quality, script type (humanist/gothic/italic), print quality.
2. Include <page-num>N</page-num> or <folio>Nv/Nr</folio> if visible.
3. Preserve original spelling, punctuation, line breaks.
4. Expand abbreviations consistently, marking first occurrence.
5. Flag all technical/esoteric vocabulary with <term>...</term>.
6. Capture ALL text including margins and annotations.
7. Describe any illustrations, diagrams, or charts with <image-desc>...</image-desc>.
8. END with <vocab>...</vocab> listing key Latin terms, names, and concepts on this page.

**Important:** This page may have been split from a two-page spread. Focus on the MAIN text block. Ignore partial text at edges from facing pages.

**Final output format:**
[page transcription]

<vocab>term1, term2, Person Name, Concept, ...</vocab>`,

  translation: `You are translating a Neo-Latin text (1450-1700) into clear, accessible English.

**Input:** The Latin OCR transcription and (if available) the previous page's translation for continuity.

**Output:** A readable English translation preserving the markdown structure from the OCR.

**Translation philosophy:**
This is a SCHOLARLY ACCESSIBLE translation:
- Accurate to the Latin (scholars should be able to check against the source)
- But readable for educated non-Latinists
- Explain rather than assume Renaissance context

**Preserve from OCR:**
- Heading levels (# ## ###)
- **Bold** and *italic* formatting
- Tables and centered text
- All <xml> annotations - translate content, keep tags
- <term> markers - translate and explain

**Latin translation guidelines:**

1. **Technical vocabulary:**
   - Keep Latin term + English: "the *anima mundi* (world-soul)"
   - For repeated terms, Latin first time, English after
   - Alchemical terms: explain on first use, e.g. "the *azoth* (the universal solvent of the alchemists)"

2. **Syntax:**
   - Break up long periodic sentences for readability
   - But preserve rhetorical structures (tricolons, parallelism)
   - <note>restructured for clarity</note> when significantly reordering

3. **Names and references:**
   - Keep Latin forms of ancient names: Aristoteles, Plato, Mercurius Trismegistus
   - Add context: "Ficino (the Florentine translator of Plato)"
   - Biblical/classical refs: add book/verse or work in <note>...</note>

4. **Ambiguity:**
   - When Latin is genuinely ambiguous, translate the most likely reading
   - Note alternatives: <note>could also mean "spirit" rather than "breath"</note>

5. **Untranslatable passages:**
   - Hebrew/Greek quotations: transliterate + translate
   - Magical formulas, barbarous names: preserve with <note>explanation</note>

**Add notes:**
- <note>...</note> for interpretive choices readers should see
- <note>cf. Corpus Hermeticum I.4</note> for source references
- <meta>...</meta> for translator notes that should be hidden (e.g., continuity with previous page)

**Style:** Warm but precise. Like a knowledgeable guide at a museum of ideas. Explain references without being condescending.

**Do NOT:**
- Use code blocks or backticks
- Over-modernize idioms (keep some Renaissance flavor)
- Skip difficult passages

**Source language:** Latin (Neo-Latin, 1450-1700)
**Target language:** English

**Final output format:**
[translated text]

<summary>1-2 sentence summary of this page's main content and significance</summary>
<keywords>key concepts, names, themes in English — for indexing</keywords>`
};

export const GERMAN_PROMPTS = {
  ocr: `You are transcribing an early modern German manuscript or printed book (1450-1800).

**Input:** The page image and (if available) the previous page's transcription for context.

**Output:** A faithful transcription in Markdown format that visually resembles the original.

**First:** Confirm with <lang>German</lang> or <lang>German (Early New High German)</lang> as appropriate.

**German-specific conventions:**

1. **Script recognition:**
   - Identify script type: <meta>Fraktur/Kurrent/Sütterlin/Roman</meta>
   - Fraktur was standard for German texts until 20th century
   - Latin passages often in Roman type within Fraktur texts

2. **Letterforms - Normalize:**
   - Long s (ſ) → s
   - ſs or ſz → ß (or ss if text predates ß)
   - Fraktur r variants → r
   - Note: <note>uses round r after o</note>

3. **Umlauts - Preserve original forms:**
   - Superscript e (aͤ, oͤ, uͤ) → ä, ö, ü
   - ae, oe, ue → keep as written OR normalize (note your choice)
   - <note>normalizing ue → ü throughout</note>

4. **Historical spelling - Preserve:**
   - Double consonants: auff, daß, thun
   - y for i: seyn, meynen
   - Capitalization of all Nouns (standard in German)
   - Word division may differ from modern: da von, zu sammen
   - Do NOT modernize spelling

5. **Abbreviations:**
   - Common: tironian et → und, tilde over vowels → nn/mm, superscript letters
   - Expand and mark: <abbrev>(symbol) → und</abbrev> or <abbrev>ū → um</abbrev>
   - Latin abbreviations in German texts: treat as Latin

6. **Mixed language:**
   - German texts often include Latin phrases
   - Mark language switches: <lang>Latin</lang> ... <lang>German</lang>
   - Keep Latin passages in their original form

**Representing text styles:**
- # Large title → use # heading
- ## Section heading → use ## heading
- **Bold/Schwabacher emphasis** → use **bold**
- *Italic/Roman in Fraktur* → use *italic*
- Preserve line breaks and paragraph structure

**Layout markup:**
- ->centered text<- for centered lines
- | tables | for columnar data
- > blockquotes for quotations, prayers
- --- for decorative dividers

**Metadata tags (hidden from readers):**
- <meta>...</meta> for page metadata (script type, print quality)
- <page-num>N</page-num> or <folio>12r</folio> for page/folio numbers
- <header>...</header> for running headers/page headings
- <abbrev>X → expansion</abbrev> for abbreviations (collected in metadata)
- <vocab>...</vocab> for key terms for indexing

**Inline annotations (visible to readers, use <xml> tags):**
- <note>X</note> for interpretive notes readers should see
- <margin>X</margin> for marginalia
- <gloss>X</gloss> for interlinear text
- <insert>X</insert> for later additions
- <unclear>X</unclear> for illegible readings
- <term>word</term> for technical/alchemical vocabulary

**IMPORTANT - Exclude from main text:**
- Page numbers: Capture ONLY in <page-num>N</page-num> or <folio>X</folio>, do NOT include in the body text
- Running headers/page headings: Capture ONLY in <header>...</header>, do NOT include in the body text
- These elements should appear in metadata annotations only, never in the main transcription

**Do NOT use:**
- Code blocks (\`\`\`) or inline code - this is prose, not code
- If markdown can't capture the layout, add a <meta>...</meta> explaining it

**Instructions:**
1. Begin with <meta>...</meta> describing script type, print quality, date if visible.
2. Include <page-num>N</page-num> if visible.
3. Preserve historical spelling exactly - do NOT modernize.
4. Expand abbreviations, marking first occurrence.
5. Preserve all Noun Capitalization.
6. Mark language switches in multilingual texts.
7. Flag technical vocabulary with <term>...</term>.
8. END with <vocab>...</vocab> listing key German terms, names, and concepts on this page.

**Important:** This page may have been split from a two-page spread. Focus on the MAIN text block.

**Final output format:**
[page transcription]

<vocab>term1, term2, Person Name, Concept, ...</vocab>`,

  translation: `You are translating an early modern German text (1450-1800) into clear, accessible English.

**Input:** The German OCR transcription and (if available) the previous page's translation for continuity.

**Output:** A readable English translation preserving the markdown structure from the OCR.

**Translation philosophy:**
SCHOLARLY ACCESSIBLE: accurate to the German, readable for modern English speakers, with context for historical references.

**Preserve from OCR:**
- Heading levels (# ## ###)
- **Bold** and *italic* formatting
- Tables and centered text
- All <xml> annotations - translate content, keep tags
- <term> markers - translate and explain

**German translation guidelines:**

1. **Historical German → Modern English:**
   - Early New High German differs from modern German
   - "seyn" = sein = to be; "auff" = auf; "thun" = tun
   - Translate meaning, not spelling

2. **Compound words:**
   - German compounds often have no English equivalent
   - Break down: "Weltanschauung" → "worldview" or "world-view (Weltanschauung)"
   - Keep particularly evocative terms in German with translation

3. **Technical vocabulary:**
   - Alchemical: Stein der Weisen → "Philosophers' Stone (*Stein der Weisen*)"
   - Mystical: Gelassenheit → "releasement/letting-be (*Gelassenheit*)"
   - Keep German + English on first use, English thereafter

4. **TRANSLATE ALL LANGUAGES TO ENGLISH:**
   - Latin phrases embedded in German → MUST be translated to English
   - Greek phrases → translate to English
   - Hebrew/Aramaic terms → translate to English
   - The reader should understand EVERYTHING without knowing Latin, Greek, or Hebrew
   - Use <note>original: "..."</note> to preserve significant original phrases for scholars
   - Example: "per aspera ad astra" → "through hardships to the stars" <note>Latin: "per aspera ad astra"</note>

5. **Syntax:**
   - German sentence structure differs significantly
   - Verb-final clauses → reorder naturally for English
   - <note>reordered for English syntax</note> when major restructuring

6. **Titles and names:**
   - Keep German honorifics with explanation: "Herr Doktor (the formal German academic title)"
   - Place names: use English if common (Munich not München), German otherwise

7. **Religious/mystical language:**
   - Jakob Böhme, Paracelsus, Agrippa wrote in distinctive registers
   - Preserve the visionary quality without obscurity
   - Explain Kabbalistic/alchemical references

**Add notes:**
- <note>...</note> for interpretive choices readers should see
- <note>lit. "..."</note> for significant literal meanings lost in translation
- <meta>...</meta> for translator notes that should be hidden (e.g., continuity with previous page)

**Style:** Clear and warm. The goal is to unlock these texts for modern readers while respecting their original power and strangeness.

**Do NOT:**
- Use code blocks or backticks
- Flatten the distinctive voice of the author
- Skip or summarize difficult passages

**Source language:** German (Early Modern, 1450-1800)
**Target language:** English

**Final output format:**
[translated text]

<summary>1-2 sentence summary of this page's main content and significance</summary>
<keywords>key concepts, names, themes in English — for indexing</keywords>`
};

// Streamlined OCR prompt - same features, fewer tokens (~200 tokens)
export const STREAMLINED_OCR_PROMPT = `Transcribe this {language} manuscript page to Markdown.

**Format:** # headings, **bold**, *italic*, ->centered<-, | tables |, > blockquotes, ---

**Metadata (hidden from readers):**
<lang>X</lang> <page-num>N</page-num> <header>X</header> <sig>X</sig> <meta>X</meta> <warning>X</warning> <vocab>X</vocab>

**Inline annotations (visible to readers):**
<margin>X</margin> <gloss>X</gloss> <insert>X</insert> <unclear>X</unclear>
<note>X</note> <term>X</term> <image-desc>description</image-desc>

**Tables:** Use markdown tables for any columnar data, lists, charts. Preserve structure.

**Rules:**
- Page numbers, headers, signatures → metadata tags ONLY, not in body text
- Preserve original spelling, punctuation, line breaks
- IGNORE partial text at page edges (from facing page)
- End with <vocab>key terms, names, concepts</vocab>

**If quality issues:** Add <warning>reason</warning> at start.`;

// Default prompts with XML annotation support
// OCR Prompt v2025-01-06
export const DEFAULT_PROMPTS: ProcessingPrompts = {
  ocr: `Transcribe this {language} page to Markdown.

**Format:**
- # ## ### for headings (bigger text = bigger heading) — NEVER combine with centering syntax
- **bold**, *italic* for emphasis
- ->centered text<- for centered lines (NOT for headings)
- > blockquotes for quotes/prayers
- --- for dividers

**Tables:** Use markdown tables ONLY for actual tabular data with clear rows/columns:
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| data | data | data |

**DO NOT use tables for:**
- Circular diagrams
- Charts or graphs
- Any visual layout that isn't truly tabular

**Page Layout Detection (add at START):**
- <layout>single-column</layout> — standard single-column page
- <layout>multi-column:N</layout> — N columns (dictionaries, commentaries, glosses)
- <layout>split-spread:N%</layout> — page split from two-page spread at N% from left edge

For multi-column layouts, transcribe left-to-right, top-to-bottom. Use --- between columns if text doesn't flow continuously.

**Blank/Empty Pages:**
If page is blank or contains only non-text elements:
- <meta>blank</meta> — truly empty page
- <meta>blank: marbled endpaper</meta> — decorative endpaper
- <meta>blank: library stamp only</meta> — institutional marks only
For blank pages, output ONLY the meta tag. No transcription needed.

**Metadata tags (hidden from readers):**
- <lang>detected</lang> — actual language if different from expected
- <page-num>1r</page-num> — original numbering (folio/page as printed)
- <header>X</header> — running headers (NOT in body text)
- <sig>X</sig> — printer's signatures like A2, B1v (NOT in body text)
- <catchword>X</catchword> — word at page bottom linking to next page
- <meta>X</meta> — hidden metadata (image quality, binding notes)
- <warning>X</warning> — quality issues (faded, damaged, blurry)
- <vocab>X</vocab> — key terms for indexing

**Inline annotations (visible to readers):**
- <margin>X</margin> — marginal notes, citations (place BEFORE the paragraph they annotate)
- <gloss>X</gloss> — interlinear annotations
- <insert>X</insert> — boxed text, later additions (inline only, not around tables)
- <unclear>X</unclear> — illegible readings
- <note>X</note> — interpretive notes for readers
- <term>X</term> — technical vocabulary

**Normalization:**
- Long s (ſ) → normalize to 's'
- Preserve ligatures (æ, œ, �765)
- Preserve original abbreviations; use <note>i.e., X</note> if expansion helpful

**Critical rules:**
1. Preserve original spelling, capitalization, punctuation
2. Page numbers/headers/signatures/catchwords go in metadata tags only, never in body
3. IGNORE partial text at left/right edges (from facing page in spread)
4. Capture ALL text including margins and annotations
5. End with <vocab>key terms, names, concepts</vocab>

**If image has quality issues**, start with <warning>describe issue</warning>

**IMAGE DETECTION:** If the page contains ANY illustrations, diagrams, emblems, woodcuts, engravings, or decorative elements, add at the END:

<detected-images>
[{"description": "Brief description", "type": "emblem|woodcut|engraving|diagram|portrait|frontispiece|musical_score|symbol|decorative|map", "bbox": {"x": 0.1, "y": 0.2, "width": 0.7, "height": 0.5}, "gallery_quality": 0.85, "museum_rationale": "Why museum-worthy or not"}]
</detected-images>

**Bounding box (0.0-1.0):** x=left edge, y=top edge. Measure PRECISELY to tightly enclose each illustration.

**Gallery quality scoring:**
- 0.9-1.0: Museum-worthy — striking emblems, allegorical scenes with figures, beautiful engravings
- 0.8-0.9: High — images with people/figures (humans interest humans), well-executed illustrations
- 0.6-0.8: Good — interesting diagrams, scientific illustrations, emblems without figures
- 0.4-0.6: Moderate — musical scores, simple diagrams, standard frontispieces
- 0.2-0.4: Low — page ornaments, generic borders
- 0.0-0.2: Minimal — marbled papers, blank frames, printer's marks

If text-only page, omit the <detected-images> block.`,

  translation: `You are translating a manuscript transcription into accessible English.

**Input:** The OCR transcription and (if available) the previous page's translation for continuity.

**Output:** A readable English translation that preserves the markdown formatting from the OCR.

**Preserve from OCR:**
- Heading levels (# ## ###) - keep the same hierarchy
- **Bold** and *italic* formatting
- Tables - recreate them in the translation
- Centered text (->text<-)
- Line breaks and paragraph structure

**Inline annotations (visible to readers):**
- <note>X</note> — interpretive notes for readers
- <margin>X</margin> — translate and keep marginal notes
- <gloss>X</gloss> — translate interlinear annotations
- <insert>X</insert> — translate later additions (inline only)
- <unclear>X</unclear> — illegible readings
- <term>X</term> — technical vocabulary with explanation

**Metadata tags (hidden from readers):**
- <meta>X</meta> for translator notes that should be hidden (e.g., continuity with previous page)

**Do NOT use:**
- Code blocks or backticks - this is prose

**IMPORTANT - Translate ALL languages to English:**
The source text may contain phrases in multiple languages (Latin, Greek, Hebrew, etc.). You MUST translate EVERYTHING to English:
- Latin quotes embedded in German → translate to English
- Greek phrases → translate to English
- Hebrew or Aramaic terms → translate to English
- ANY non-English text → translate to English
Use <note>original: "..."</note> to preserve important original phrases for scholars, but the main text must be fully readable in English without knowing other languages.

**Instructions:**
1. Start with <meta>...</meta> if noting continuity with previous page (hidden from readers).
2. Mirror the source layout - headings, paragraphs, tables, centered text.
3. Translate ALL text including <margin>, <insert>, <gloss> - keep the XML tags.
4. Translate embedded Latin/Greek/Hebrew phrases to English, noting originals when significant.
5. Add <note>...</note> inline to explain historical references or difficult phrases.
6. Style: warm museum label - explain rather than assume knowledge.
7. Preserve the voice and spirit of the original.
8. END with <summary>...</summary> and <keywords>...</keywords> for indexing.

**Source language:** {source_language}
**Target language:** {target_language}

**Final output format:**
[translated text]

<summary>1-2 sentence summary of this page's main content and significance</summary>
<keywords>key concepts, names, themes in English — for indexing</keywords>`,

  summary: `Summarize the contents of this page for a general, non-specialist reader.

**Input:** The translated text and (if available) the previous page's summary for context.

**Output:** A 3-5 sentence summary in Markdown format.

**Instructions:**
1. Write 3 to 5 clear sentences, optionally with bullet points.
2. Mention key people, ideas, and why the page matters to modern audiences.
3. Highlight continuity with the previous page in <meta>...</meta> at the top if relevant.
4. Make it accessible to someone who has never read the original text.`
};

// Parse <note>...</note> from text (for extraction, not for hiding)
export function parseNotes(text: string): { content: string; notes: string[] } {
  // Support both old [[notes:...]] and new <note>...</note> syntax
  const bracketPattern = /\[\[notes?:\s*(.*?)\]\]/gi;
  const xmlPattern = /<note>([\s\S]*?)<\/note>/gi;
  const notes: string[] = [];

  let content = text.replace(bracketPattern, (match, noteContent) => {
    notes.push(noteContent.trim());
    return ''; // Remove from main content
  });

  content = content.replace(xmlPattern, (match, noteContent) => {
    notes.push(noteContent.trim());
    return ''; // Remove from main content
  });

  return { content: content.trim(), notes };
}

// Extract page number from <page-num>N</page-num> or [[page number: ####]]
export function extractPageNumber(text: string): number | null {
  // Try new XML syntax first
  const xmlMatch = text.match(/<page-num>(\d+)<\/page-num>/i);
  if (xmlMatch) return parseInt(xmlMatch[1], 10);

  // Fall back to old bracket syntax for backward compatibility
  const bracketMatch = text.match(/\[\[page\s*number:\s*(\d+)\]\]/i);
  return bracketMatch ? parseInt(bracketMatch[1], 10) : null;
}

// ============================================
// SOCIAL MEDIA MARKETING
// ============================================

export type SocialPostStatus = 'draft' | 'queued' | 'posted' | 'failed';

/**
 * A social media post (tweet) generated for a gallery image
 */
export interface SocialPost {
  _id?: unknown;
  id: string;                    // nanoid
  tweet_text: string;            // max 280 chars
  hashtags: string[];

  // Reference to source image
  image_ref: {
    page_id: string;
    detection_index: number;
    gallery_image_id: string;    // "pageId:index" format
  };

  // Denormalized image data for display
  image_data: {
    cropped_url: string;
    description: string;
    book_title: string;
    book_author?: string;
    book_year?: number;
  };

  status: SocialPostStatus;
  scheduled_for?: Date;          // When to post (null = manual/immediate)

  // AI generation metadata
  generated_by: {
    model: string;
    generated_at: Date;
    alternatives: string[];      // Other tweet options generated
  };

  // After posting to Twitter
  posted_at?: Date;
  twitter_id?: string;
  twitter_url?: string;
  error?: string;                // If failed

  created_at: Date;
  updated_at: Date;
}

/**
 * Social media configuration (singleton per platform)
 */
export interface SocialConfig {
  _id?: unknown;
  platform: 'twitter';

  settings: {
    posts_per_day: number;       // Rate limit (default: 2)
    posting_hours: number[];     // UTC hours to post (e.g., [14, 20])
    auto_post_enabled: boolean;  // Enable cron posting
    min_gallery_quality: number; // Minimum quality (default: 0.75)
  };

  usage: {
    tweets_today: number;
    tweets_this_month: number;
    last_tweet_at?: Date;
  };

  updated_at: Date;
}

/**
 * Twitter/X accounts to tag per audience category
 */
export interface SocialTag {
  _id?: unknown;
  handle: string;              // Twitter handle without @ (e.g., "QuoteJung")
  name: string;                // Display name (e.g., "Carl Jung Archive")
  audience: string;            // Audience category (jungian, esoteric, etc.)
  description?: string;        // Brief description of who they are
  followers?: number;          // Approximate follower count
  relevance: string;           // Why they're relevant for Source Library
  active: boolean;             // Whether to include in suggestions
  priority: number;            // 1-10, higher = more likely to suggest
  last_tagged?: Date;          // Track when we last tagged them
  created_at: Date;
  updated_at: Date;
}

// =============================================================================
// Likes System
// =============================================================================

export type LikeTargetType = 'image' | 'page' | 'book';

/**
 * A like from an anonymous visitor
 */
export interface Like {
  _id?: unknown;
  target_type: LikeTargetType;
  target_id: string;              // gallery image ID, page ID, or book ID
  visitor_id: string;             // anonymous ID from localStorage
  created_at: Date;
}

/**
 * Aggregated like count for a target
 */
export interface LikeCount {
  target_type: LikeTargetType;
  target_id: string;
  count: number;
}
