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
  ocr: `You are transcribing a Renaissance Latin facsimile.

**Input:** The page image and (if available) the previous page's transcription for context.

**Output:** A faithful Latin text in Markdown format.

**Instructions:**
1. Begin with \`[[notes: ...]]\` summarizing any image issues, uncertain readings, layout observations, or alternate expansions.
2. Include \`[[page number: ####]]\` near the top if visible.
3. Preserve original capitalization, punctuation, and spacing when legible.
4. Use Markdown formatting (headings, centered lines, italics) so the transcription resembles the source layout.
5. Mark uncertain characters or alternate readings inline with \`[[notes: ...]]\`.
6. Expand abbreviations only when certain; otherwise note the ambiguity in \`[[notes]]\`.

**Language:** {language}`,

  translation: `You are translating a freshly transcribed Latin text into accessible English.

**Input:** The OCR transcription and (if available) the previous page's translation for continuity.

**Output:** A layperson-friendly English translation in Markdown format.

**Instructions:**
1. Start with \`[[notes: ...]]\` mentioning prior-page context, interpretive choices, tricky phrases, historical references, or multiple possible readings.
2. Use clear Markdown mirroring the source layout (headings, centered text, line breaks).
3. Keep \`[[notes: ...]]\` inline wherever extra explanation or alternate translations help a general reader.
4. Style: warm museum label—explain references rather than leaving jargon unexplained.
5. Always mention continuity with the previous page if relevant.

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
