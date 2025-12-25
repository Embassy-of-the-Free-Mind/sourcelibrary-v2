export type BookStatus = 'draft' | 'in_progress' | 'complete' | 'published';

// Job management for long-running tasks
export type JobType = 'batch_ocr' | 'batch_translate' | 'batch_summary' | 'batch_split' | 'book_import';
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
    [key: string]: unknown;
  };
}

// ============================================
// Pipeline - Automated book processing workflow
// ============================================

export type PipelineStep = 'split_check' | 'ocr' | 'translate' | 'summarize' | 'edition';
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
}

export interface PipelineState {
  status: PipelineStatus;
  currentStep: PipelineStep | null;

  steps: {
    split_check: PipelineStepState;
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
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', description: 'Latest, best quality' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast & capable' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Fastest, lowest cost' },
] as const;

export const DEFAULT_MODEL = 'gemini-2.0-flash';

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

  // Book-level reading summary (whole-book overview)
  reading_summary?: {
    overview: string;
    quotes: Array<{ text: string; page: number }>;
    themes: string[];
    generated_at?: Date;
    model?: string;
    pages_analyzed?: number;
  };

  // Published editions (immutable snapshots for citation)
  editions?: TranslationEdition[];
  current_edition_id?: string;    // Most recent published edition

  // Automated processing pipeline state
  pipeline?: PipelineState;
}

export interface OcrData {
  language: string;
  model: string;
  data: string;
  image_urls?: string[];
  updated_at?: Date;
  prompt_name?: string;
}

export interface TranslationData {
  language: string;
  model: string;
  data: string;
  updated_at?: Date;
  prompt_name?: string;
}

export interface SummaryData {
  data: string;
  model: string;
  updated_at?: Date;
  prompt_name?: string;
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
  quotes?: Array<{ text: string; page: number }>;  // Key quotes with page refs
  concepts?: string[];  // Key concepts/terms introduced
  generated_at?: Date;
  detection_method: 'ai' | 'manual';
}

// Crop coordinates for split pages (0-1000 scale)
export interface CropData {
  xStart: number;
  xEnd: number;
  yStart?: number;
  yEnd?: number;
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

  // Split/crop workflow
  photo_original?: string;      // Original S3 URL before cropping
  cropped_photo?: string;       // Local path to cropped image
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

export interface Prompt {
  _id?: unknown;
  id?: string;
  name: string;
  type: 'ocr' | 'translation' | 'summary';
  content: string;
  is_default?: boolean;
  created_at?: Date;
  updated_at?: Date;
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

// Language-specific prompts
export const LATIN_PROMPTS = {
  ocr: `You are transcribing a Neo-Latin manuscript or early printed book (1450-1700).

**Input:** The page image and (if available) the previous page's transcription for context.

**Output:** A faithful transcription in Markdown format that visually resembles the original.

**First:** Confirm the language with [[language: Latin]] or [[language: Latin with {other} passages]]

**Latin-specific conventions:**

1. **Abbreviations** - Expand common scribal/print abbreviations:
   - ꝙ, ꝗ → quod | ꝯ → con/com | ꝑ → per/par | ꝓ → pro
   - Macrons over vowels usually indicate missing 'm' or 'n' (ū → um/un)
   - Tildes often mark missing letters
   - Mark expansions: [[abbrev: ꝙ → quod]] on first occurrence

2. **Letterforms** - Normalize to modern equivalents:
   - u/v: Transcribe as written (Renaissance texts mix freely)
   - i/j: Transcribe as written
   - Long s (ſ) → s
   - Ligatures: æ, œ → keep as ligatures
   - Note unusual forms: [[notes: uses archaic ę for ae]]

3. **Capitalization** - Preserve original:
   - Renaissance Latin often capitalizes Nouns like German
   - Keep ALL CAPS for emphasis where used
   - Note patterns: [[notes: capitalizes all proper nouns and abstract concepts]]

4. **Technical vocabulary** - Flag uncertain readings:
   - [[term: azoth]] for alchemical/esoteric terms
   - [[term: anima mundi → "world soul"]] for terms needing gloss
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

**Annotations:**
- [[meta: ...]] for page metadata (image quality, script type) — hidden from readers
- [[notes: ...]] for interpretive notes readers should see
- [[margin: ...]] for marginalia
- [[gloss: ...]] for interlinear annotations
- [[insert: ...]] for later additions
- [[unclear: ...]] for illegible readings
- [[page number: N]] or [[folio: 12r]] for visible page/folio numbers
- [[header: ...]] for running headers/page headings
- [[abbrev: X → expansion]] for abbreviation expansions (collected in metadata)
- [[term: word]] or [[term: word → meaning]] for technical vocabulary
- [[image: description]] for illustrations, diagrams, charts, woodcuts, printer's devices

**IMPORTANT - Exclude from main text:**
- Page numbers: Capture ONLY in [[page number: N]] or [[folio:]], do NOT include in the body text
- Running headers/page headings: Capture ONLY in [[header: ...]], do NOT include in the body text
- These elements should appear in metadata annotations only, never in the main transcription

**Do NOT use:**
- Code blocks (\`\`\`) or inline code - this is prose, not code
- If markdown can't capture the layout, add a [[meta: ...]] explaining it

**Instructions:**
1. Begin with [[meta: ...]] describing image quality, script type (humanist/gothic/italic), print quality.
2. Include [[page number: N]] or [[folio: Nv/Nr]] if visible.
3. Preserve original spelling, punctuation, line breaks.
4. Expand abbreviations consistently, marking first occurrence.
5. Flag all technical/esoteric vocabulary with [[term:]].
6. Capture ALL text including margins and annotations.
7. Describe any illustrations, diagrams, or charts with [[image: ...]].
8. END with [[vocabulary: ...]] listing key Latin terms, names, and concepts on this page.

**Important:** This page may have been split from a two-page spread. Focus on the MAIN text block. Ignore partial text at edges from facing pages.

**Final output format:**
[page transcription]

[[vocabulary: term1, term2, Person Name, Concept, ...]]`,

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
- All [[markup:]] annotations - translate content, keep tags
- [[term:]] markers - translate and explain

**Latin translation guidelines:**

1. **Technical vocabulary:**
   - Keep Latin term + English: "the *anima mundi* (world-soul)"
   - For repeated terms, Latin first time, English after
   - Alchemical terms: explain on first use, e.g. "the *azoth* (the universal solvent of the alchemists)"

2. **Syntax:**
   - Break up long periodic sentences for readability
   - But preserve rhetorical structures (tricolons, parallelism)
   - [[notes: restructured for clarity]] when significantly reordering

3. **Names and references:**
   - Keep Latin forms of ancient names: Aristoteles, Plato, Mercurius Trismegistus
   - Add context: "Ficino (the Florentine translator of Plato)"
   - Biblical/classical refs: add book/verse or work in [[notes:]]

4. **Ambiguity:**
   - When Latin is genuinely ambiguous, translate the most likely reading
   - Note alternatives: [[notes: could also mean "spirit" rather than "breath"]]

5. **Untranslatable passages:**
   - Hebrew/Greek quotations: transliterate + translate
   - Magical formulas, barbarous names: preserve with [[notes: explanation]]

**Add notes:**
- [[notes: ...]] for interpretive choices readers should see
- [[notes: cf. Corpus Hermeticum I.4]] for source references
- [[meta: ...]] for translator notes that should be hidden (e.g., continuity with previous page)

**Style:** Warm but precise. Like a knowledgeable guide at a museum of ideas. Explain references without being condescending.

**Do NOT:**
- Use code blocks or backticks
- Over-modernize idioms (keep some Renaissance flavor)
- Skip difficult passages

**Source language:** Latin (Neo-Latin, 1450-1700)
**Target language:** English

**Final output format:**
[translated text]

[[summary: 1-2 sentence summary of this page's main content and significance]]
[[keywords: key concepts, names, themes in English — for indexing]]`
};

export const GERMAN_PROMPTS = {
  ocr: `You are transcribing an early modern German manuscript or printed book (1450-1800).

**Input:** The page image and (if available) the previous page's transcription for context.

**Output:** A faithful transcription in Markdown format that visually resembles the original.

**First:** Confirm with [[language: German]] or [[language: German (Early New High German)]] as appropriate.

**German-specific conventions:**

1. **Script recognition:**
   - Identify script type: [[notes: Fraktur/Kurrent/Sütterlin/Roman]]
   - Fraktur was standard for German texts until 20th century
   - Latin passages often in Roman type within Fraktur texts

2. **Letterforms - Normalize:**
   - Long s (ſ) → s
   - ſs or ſz → ß (or ss if text predates ß)
   - Fraktur r variants → r
   - Note: [[notes: uses round r after o]]

3. **Umlauts - Preserve original forms:**
   - Superscript e (aͤ, oͤ, uͤ) → ä, ö, ü
   - ae, oe, ue → keep as written OR normalize (note your choice)
   - [[notes: normalizing ue → ü throughout]]

4. **Historical spelling - Preserve:**
   - Double consonants: auff, daß, thun
   - y for i: seyn, meynen
   - Capitalization of all Nouns (standard in German)
   - Word division may differ from modern: da von, zu sammen
   - Do NOT modernize spelling

5. **Abbreviations:**
   - Common: tironian et → und, tilde over vowels → nn/mm, superscript letters
   - Expand and mark: [[abbrev: (symbol) → und]] or [[abbrev: ū → um]]
   - Latin abbreviations in German texts: treat as Latin

6. **Mixed language:**
   - German texts often include Latin phrases
   - Mark language switches: [[language: Latin]] ... [[language: German]]
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

**Annotations:**
- [[meta: ...]] for page metadata (script type, print quality) — hidden from readers
- [[notes: ...]] for interpretive notes readers should see
- [[margin: ...]] for marginalia
- [[gloss: ...]] for interlinear text
- [[insert: ...]] for later additions
- [[unclear: ...]] for illegible readings
- [[page number: N]] or [[folio: 12r]] for page/folio numbers
- [[header: ...]] for running headers/page headings
- [[abbrev: X → expansion]] for abbreviations (collected in metadata)
- [[term: word]] for technical/alchemical vocabulary

**IMPORTANT - Exclude from main text:**
- Page numbers: Capture ONLY in [[page number: N]] or [[folio:]], do NOT include in the body text
- Running headers/page headings: Capture ONLY in [[header: ...]], do NOT include in the body text
- These elements should appear in metadata annotations only, never in the main transcription

**Do NOT use:**
- Code blocks (\`\`\`) or inline code - this is prose, not code
- If markdown can't capture the layout, add a [[meta: ...]] explaining it

**Instructions:**
1. Begin with [[meta: ...]] describing script type, print quality, date if visible.
2. Include [[page number: N]] if visible.
3. Preserve historical spelling exactly - do NOT modernize.
4. Expand abbreviations, marking first occurrence.
5. Preserve all Noun Capitalization.
6. Mark language switches in multilingual texts.
7. Flag technical vocabulary with [[term:]].
8. END with [[vocabulary: ...]] listing key German terms, names, and concepts on this page.

**Important:** This page may have been split from a two-page spread. Focus on the MAIN text block.

**Final output format:**
[page transcription]

[[vocabulary: term1, term2, Person Name, Concept, ...]]`,

  translation: `You are translating an early modern German text (1450-1800) into clear, accessible English.

**Input:** The German OCR transcription and (if available) the previous page's translation for continuity.

**Output:** A readable English translation preserving the markdown structure from the OCR.

**Translation philosophy:**
SCHOLARLY ACCESSIBLE: accurate to the German, readable for modern English speakers, with context for historical references.

**Preserve from OCR:**
- Heading levels (# ## ###)
- **Bold** and *italic* formatting
- Tables and centered text
- All [[markup:]] annotations - translate content, keep tags
- [[term:]] markers - translate and explain

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
   - Use [[notes: original: "..."]] to preserve significant original phrases for scholars
   - Example: "per aspera ad astra" → "through hardships to the stars" [[notes: Latin: "per aspera ad astra"]]

5. **Syntax:**
   - German sentence structure differs significantly
   - Verb-final clauses → reorder naturally for English
   - [[notes: reordered for English syntax]] when major restructuring

6. **Titles and names:**
   - Keep German honorifics with explanation: "Herr Doktor (the formal German academic title)"
   - Place names: use English if common (Munich not München), German otherwise

7. **Religious/mystical language:**
   - Jakob Böhme, Paracelsus, Agrippa wrote in distinctive registers
   - Preserve the visionary quality without obscurity
   - Explain Kabbalistic/alchemical references

**Add notes:**
- [[notes: ...]] for interpretive choices readers should see
- [[notes: lit. "..."]] for significant literal meanings lost in translation
- [[meta: ...]] for translator notes that should be hidden (e.g., continuity with previous page)

**Style:** Clear and warm. The goal is to unlock these texts for modern readers while respecting their original power and strangeness.

**Do NOT:**
- Use code blocks or backticks
- Flatten the distinctive voice of the author
- Skip or summarize difficult passages

**Source language:** German (Early Modern, 1450-1800)
**Target language:** English

**Final output format:**
[translated text]

[[summary: 1-2 sentence summary of this page's main content and significance]]
[[keywords: key concepts, names, themes in English — for indexing]]`
};

// Streamlined OCR prompt - same features, fewer tokens (~200 tokens)
export const STREAMLINED_OCR_PROMPT = `Transcribe this {language} manuscript page to Markdown.

**Format:** # headings, **bold**, *italic*, ->centered<-, | tables |, > blockquotes, ---

**Annotations (use inline):**
[[language: X]] [[page number: N]] [[header: X]] [[signature: X]]
[[margin: X]] [[gloss: X]] [[insert: X]] [[unclear: X]]
[[notes: X]] [[meta: X]] [[warning: X]]
[[image: brief description]] — for illustrations, diagrams, charts, printer's marks

**Tables:** Use markdown tables for any columnar data, lists, charts. Preserve structure.

**Rules:**
- Page numbers, headers, signatures → metadata tags ONLY, not in body text
- Preserve original spelling, punctuation, line breaks
- IGNORE partial text at page edges (from facing page)
- End with [[vocabulary: key terms, names, concepts]]

**If quality issues:** Add [[warning: reason]] at start.`;

// Default prompts with [[notes]] support
export const DEFAULT_PROMPTS: ProcessingPrompts = {
  ocr: `Transcribe this {language} manuscript page to Markdown.

**Format:**
- # ## ### for headings (bigger text = bigger heading)
- **bold**, *italic* for emphasis
- ->centered<- for centered lines
- > blockquotes for quotes/prayers
- --- for dividers

**Tables:** Use markdown tables for ANY columnar data, lists, charts, or structured content:
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| data | data | data |

**Annotations (use inline where relevant):**
- [[language: detected]] — confirm the language
- [[page number: N]] — visible page/folio numbers (NOT in body text)
- [[header: X]] — running headers (NOT in body text)
- [[signature: X]] — printer's marks like A2, B1 (NOT in body text)
- [[margin: X]] — marginal notes, citations
- [[gloss: X]] — interlinear annotations
- [[insert: X]] — boxed text, later additions
- [[unclear: X]] — illegible readings
- [[notes: X]] — interpretive notes for readers
- [[meta: X]] — hidden metadata (image quality, catchwords)
- [[warning: X]] — quality issues (faded, damaged, blurry)
- [[image: description]] — brief description of illustrations, diagrams, charts, woodcuts, printer's devices

**Critical rules:**
1. Preserve original spelling, capitalization, punctuation
2. Page numbers/headers/signatures go in tags only, never in body
3. IGNORE partial text at left/right edges (from facing page in spread)
4. Capture ALL text including margins and annotations
5. Describe any images/diagrams with [[image: ...]]
6. End with [[vocabulary: key terms, names, concepts on this page]]

**If image has quality issues**, start with [[warning: describe issue]]`,

  translation: `You are translating a manuscript transcription into accessible English.

**Input:** The OCR transcription and (if available) the previous page's translation for continuity.

**Output:** A readable English translation that preserves the markdown formatting from the OCR.

**Preserve from OCR:**
- Heading levels (# ## ###) - keep the same hierarchy
- **Bold** and *italic* formatting
- Tables - recreate them in the translation
- Centered text (->text<-)
- Line breaks and paragraph structure
- All [[markup: ...]] annotations - translate the content but keep the markup

**Add notes:**
- [[notes: ...]] for interpretive choices readers should see
- [[meta: ...]] for translator notes that should be hidden (e.g., continuity with previous page)
- Explain references a modern reader wouldn't know

**Do NOT use:**
- Code blocks or backticks - this is prose

**IMPORTANT - Translate ALL languages to English:**
The source text may contain phrases in multiple languages (Latin, Greek, Hebrew, etc.). You MUST translate EVERYTHING to English:
- Latin quotes embedded in German → translate to English
- Greek phrases → translate to English
- Hebrew or Aramaic terms → translate to English
- ANY non-English text → translate to English
Use [[notes: original: "..."]] to preserve important original phrases for scholars, but the main text must be fully readable in English without knowing other languages.

**Instructions:**
1. Start with [[meta: ...]] if noting continuity with previous page (hidden from readers).
2. Mirror the source layout - headings, paragraphs, tables, centered text.
3. Translate ALL text including [[margin:]], [[insert:]], [[gloss:]] - keep the markup tags.
4. Translate embedded Latin/Greek/Hebrew phrases to English, noting originals when significant.
5. Add [[notes: ...]] inline to explain historical references or difficult phrases.
6. Style: warm museum label - explain rather than assume knowledge.
7. Preserve the voice and spirit of the original.
8. END with [[summary:]] and [[keywords:]] for indexing.

**Source language:** {source_language}
**Target language:** {target_language}

**Final output format:**
[translated text]

[[summary: 1-2 sentence summary of this page's main content and significance]]
[[keywords: key concepts, names, themes in English — for indexing]]`,

  summary: `Summarize the contents of this page for a general, non-specialist reader.

**Input:** The translated text and (if available) the previous page's summary for context.

**Output:** A 3-5 sentence summary in Markdown format.

**Instructions:**
1. Write 3 to 5 clear sentences, optionally with bullet points.
2. Mention key people, ideas, and why the page matters to modern audiences.
3. Highlight continuity with the previous page in \`[[notes: ...]]\` at the top if relevant.
4. Make it accessible to someone who has never read the original text.`
};

// Parse [[notes: ...]] from text
export function parseNotes(text: string): { content: string; notes: string[] } {
  const notePattern = /\[\[notes?:\s*(.*?)\]\]/gi;
  const notes: string[] = [];

  const content = text.replace(notePattern, (match, noteContent) => {
    notes.push(noteContent.trim());
    return ''; // Remove from main content, or keep if you want inline
  });

  return { content: content.trim(), notes };
}

// Extract page number from [[page number: ####]]
export function extractPageNumber(text: string): number | null {
  const match = text.match(/\[\[page\s*number:\s*(\d+)\]\]/i);
  return match ? parseInt(match[1], 10) : null;
}
