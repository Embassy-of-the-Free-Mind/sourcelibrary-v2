export type BookStatus = 'draft' | 'in_progress' | 'complete' | 'published';

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

export interface Book {
  id: string;
  _id?: string;
  tenant_id: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  thumbnail?: string;
  categories?: string[];
  pages_count?: number;
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
}

export interface OcrData {
  language: string;
  model: string;
  data: string;
  image_urls?: string[];
  updated_at?: Date;
}

export interface TranslationData {
  language: string;
  model: string;
  data: string;
  updated_at?: Date;
}

export interface SummaryData {
  data: string;
  model: string;
  updated_at?: Date;
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
  created_at?: Date;
  updated_at?: Date;

  // Split/crop workflow
  photo_original?: string;      // Original S3 URL before cropping
  cropped_photo?: string;       // Local path to cropped image
  crop?: CropData;              // Crop coordinates used
  split_from?: string;          // ID of parent page if this was split from another
  split_detection?: {           // AI detection result
    isTwoPageSpread: boolean;
    confidence: string;
    reasoning?: string;
    leftPage?: CropData;
    rightPage?: CropData;
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

// Default prompts with [[notes]] support
export const DEFAULT_PROMPTS: ProcessingPrompts = {
  ocr: `You are transcribing a historical manuscript page.

**Input:** The page image and (if available) the previous page's transcription for context.

**Output:** A faithful transcription in Markdown format.

**Markdown to use:**
- **bold** for emphasized or decorated text in the original
- *italic* for foreign words or titles
- > blockquotes for prayers, quotes, or set-apart passages
- ## headings for chapter/section titles
- --- for decorative dividers or section breaks
- ->centered text<- for centered lines (titles, headers)
- [[notes: ...]] for your observations about the text
- [[margin: ...]] for marginalia written in the margins
- [[unclear: ...]] for illegible or uncertain readings
- [[page number: N]] for visible page numbers

**Do NOT use:**
- Code blocks (\`\`\`) or inline code (\`backticks\`) - this is prose, not code
- HTML tags - use markdown equivalents
- Tables unless the original has actual tabular data

**Instructions:**
1. Begin with [[notes: ...]] summarizing image quality, layout, or issues.
2. Preserve original spelling, capitalization, and punctuation.
3. Mark uncertain readings with [[unclear: possible reading]].
4. Note marginalia with [[margin: text from margin]].

**Language:** {language}`,

  translation: `You are translating a manuscript transcription into accessible English.

**Input:** The OCR transcription and (if available) the previous page's translation for continuity.

**Output:** A readable English translation in Markdown format.

**Markdown to use:**
- **bold** for emphasis
- *italic* for foreign terms kept in original
- > blockquotes for prayers, quotes, or set-apart passages
- ## headings mirroring the original structure
- --- for section breaks
- ->centered text<- for centered lines
- [[notes: ...]] for translation notes, context, or alternate readings

**Do NOT use:**
- Code blocks or backticks - this is prose, not code
- Over-formatting - keep it readable

**Instructions:**
1. Start with [[notes: ...]] for context about this passage.
2. Mirror the source layout (headings, paragraphs, centered text).
3. Add [[notes: ...]] inline to explain historical references or difficult phrases.
4. Style: warm and accessible, like a museum label - explain rather than assume knowledge.
5. Preserve the voice and spirit of the original.

**Source language:** {source_language}
**Target language:** {target_language}`,

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
