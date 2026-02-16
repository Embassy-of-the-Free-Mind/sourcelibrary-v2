import { ProcessingPrompts } from "./core";
import type { DetectedImage } from "../page";

// Bump this when DEFAULT_PROMPTS change. Stored on every page record for audit trail.
export const PROMPT_VERSION = 'v3.2026-02';

const VALID_PAGE_TYPES = new Set([
  'title-page', 'frontispiece', 'dedication', 'preface', 'toc', 'index',
  'errata', 'colophon', 'appendix', 'blank', 'illustration', 'diagram', 'map', 'text',
]);

/** Extract <page-type> from OCR text. Returns undefined if not found or invalid. */
export function extractPageType(ocrText: string): string | undefined {
  const match = ocrText.match(/<page-type>([\s\S]*?)<\/page-type>/i);
  if (!match) return undefined;
  const type = match[1].trim().toLowerCase();
  return VALID_PAGE_TYPES.has(type) ? type : undefined;
}

/** Extract <columns>N</columns> from OCR text. Returns undefined if not found or 1. */
export function extractColumns(ocrText: string): number | undefined {
  const match = ocrText.match(/<columns>(\d+)<\/columns>/i);
  if (!match) return undefined;
  const n = parseInt(match[1], 10);
  return n > 1 ? n : undefined;
}

const VALID_IMAGE_TYPES = new Set([
  'woodcut', 'diagram', 'chart', 'illustration', 'symbol', 'table', 'map',
  'decorative', 'emblem', 'engraving', 'portrait', 'frontispiece', 'musical_score', 'unknown',
]);

/** Parse <detected-images> JSON from OCR text into typed DetectedImage[]. Returns empty array if none found. */
export function parseDetectedImages(ocrText: string): DetectedImage[] {
  const match = ocrText.match(/<detected-images>([\s\S]*?)<\/detected-images>/i);
  if (!match) return [];

  try {
    const raw = JSON.parse(match[1].trim());
    if (!Array.isArray(raw)) return [];

    const now = new Date();
    return raw
      .filter((img: Record<string, unknown>) => img && typeof img.description === 'string')
      .map((img: Record<string, unknown>) => {
        const result: DetectedImage = {
          description: img.description as string,
          detection_source: 'ocr_tag',
          detected_at: now,
        };

        if (typeof img.type === 'string' && VALID_IMAGE_TYPES.has(img.type)) {
          result.type = img.type as DetectedImage['type'];
        }

        if (img.bbox && typeof img.bbox === 'object') {
          const b = img.bbox as Record<string, unknown>;
          if (typeof b.x === 'number' && typeof b.y === 'number' &&
              typeof b.width === 'number' && typeof b.height === 'number') {
            result.bbox = { x: b.x, y: b.y, width: b.width, height: b.height };
          }
        }

        if (typeof img.gallery_quality === 'number') {
          result.gallery_quality = Math.max(0, Math.min(1, img.gallery_quality));
        }

        if (typeof img.museum_rationale === 'string') {
          result.gallery_rationale = img.museum_rationale;
        }

        if (typeof img.confidence === 'number') {
          result.confidence = img.confidence;
        }

        if (typeof img.museum_description === 'string') {
          result.museum_description = img.museum_description;
        }

        if (img.metadata && typeof img.metadata === 'object') {
          const m = img.metadata as Record<string, unknown>;
          result.metadata = {};
          if (Array.isArray(m.subjects)) result.metadata.subjects = m.subjects.filter((s: unknown) => typeof s === 'string');
          if (Array.isArray(m.figures)) result.metadata.figures = m.figures.filter((s: unknown) => typeof s === 'string');
          if (Array.isArray(m.symbols)) result.metadata.symbols = m.symbols.filter((s: unknown) => typeof s === 'string');
          if (typeof m.style === 'string') result.metadata.style = m.style;
          if (typeof m.technique === 'string') result.metadata.technique = m.technique;
        }

        return result;
      });
  } catch {
    // Malformed JSON — not unusual from AI output
    return [];
  }
}

export const DEFAULT_PROMPTS: ProcessingPrompts = {
  ocr: `Transcribe this historical manuscript page to Markdown.

**Context:** This is a scholarly digitization project transcribing public domain manuscripts (16th-18th century) from institutional archives. All materials are out of copyright and provided by partner libraries for open access.

{language_instruction}

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

**Metadata tags (hidden from readers):**
- <lang>X</lang> — the detected language of this page (REQUIRED — always identify the language)
- <page-type>X</page-type> — classify this page (REQUIRED). One of: title-page, frontispiece, dedication, preface, toc, index, errata, colophon, appendix, blank, illustration, diagram, map, text
- <columns>N</columns> — number of text columns on this page (omit for single-column pages, include for 2+ columns)
- <page-num>N</page-num> — visible page/folio numbers (NOT in body text)
- <header>X</header> — running headers/chapter titles at top of page (NEVER duplicate as heading in body)
- <sig>X</sig> — printer's marks like A2, B1 (NOT in body text)
- <meta>X</meta> — hidden metadata (image quality, catchwords)
- <warning>X</warning> — quality issues (faded, damaged, blurry)
- <vocab>X</vocab> — key terms for indexing

**Inline annotations (visible to readers):**
- <margin>X</margin> — marginal notes, citations (place BEFORE the paragraph they annotate)
- <gloss>X</gloss> — interlinear annotations
- <insert>X</insert> — boxed text, later additions (inline only, not around tables)
- <unclear>X</unclear> — illegible readings
- <note>X</note> — interpretive notes for readers
- <term>X</term> — technical vocabulary

**Column layout:** If the page has two (or more) text columns, transcribe the left column first, then insert <column-break/> on its own line, then transcribe the right column. Do NOT use <column-break/> for single-column pages.

**Critical rules:**
1. Preserve original spelling, capitalization, punctuation
2. Page numbers/headers/signatures go in metadata tags ONLY — NEVER duplicate as ## headings or body text. Example: "DISCURSUS IV." at top of page → <header>DISCURSUS IV.</header> and nothing else
3. Decorative initials (drop caps): merge large ornamental first letters with the word they begin. A large "L" followed by "EX" → "Lex", not "L Ex"
4. IGNORE partial text at left/right edges (from facing page in spread)
5. Capture ALL text including margins and annotations
6. End with <vocab>key terms, names, concepts</vocab>

**If image has quality issues**, start with <warning>describe issue</warning>

**IMAGE DETECTION:** If the page contains ANY illustrations, diagrams, emblems, woodcuts, engravings, or decorative elements, add at the END:

<detected-images>
[{"description": "Brief description", "type": "emblem|woodcut|engraving|diagram|portrait|frontispiece|decorative|map", "bbox": {"x": 0.1, "y": 0.2, "width": 0.7, "height": 0.5}, "gallery_quality": 0.85, "museum_rationale": "Why museum-worthy or not"}]
</detected-images>

**Bounding box (0.0-1.0):** x=left edge, y=top edge. Measure PRECISELY to tightly enclose each illustration.

**Gallery quality:**
- 0.9-1.0: Museum-worthy — striking emblems, allegorical scenes, beautiful engravings
- 0.7-0.9: High — well-executed illustrations, interesting diagrams
- 0.4-0.7: Moderate — standard frontispieces, simple diagrams
- 0.0-0.4: Low — page ornaments, generic borders, printer's marks

If text-only page, omit the <detected-images> block.`,

  translation: `You are translating a manuscript transcription into accessible English.

**Input:** The OCR transcription and (if available) the previous page's translation for continuity.

**Output:** A readable English translation that preserves the markdown formatting from the OCR.

**Preserve from OCR:**
- Heading levels (# ## ###) - keep the same hierarchy
- **Bold** and *italic* formatting
- Tables - recreate them in the translation
- Centered text (->text<-)
- <column-break/> markers — preserve exactly as-is between translated columns
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

/**
 * Prompt for modernizing Early Modern English OCR into accessible Modern English.
 * Used in place of the translation prompt when book.language === 'English'.
 * Output goes into translation.data — same field, different purpose.
 */
export const ENGLISH_MODERNIZATION_PROMPT = `You are modernizing Early Modern English text into clear, accessible Modern English.

**Context:** This is a historical text (1500s-1700s) written in Early Modern English. The OCR transcription preserves the original spelling, vocabulary, and syntax. Your job is to make it readable for a modern audience while preserving the author's meaning and the document's formatting.

**Input:** The OCR transcription with markdown formatting and XML tags, plus (if available) the previous page's modernization for continuity.

**Output:** Modern English text that preserves the markdown formatting and XML tags from the OCR.

**Preserve from OCR:**
- Heading levels (# ## ###) - keep the same hierarchy
- **Bold** and *italic* formatting
- Tables - recreate them with modern text
- Centered text (->text<-)
- Line breaks and paragraph structure

**Inline annotations (visible to readers):**
- <note>X</note> — keep or add interpretive notes for readers
- <margin>X</margin> — modernize and keep marginal notes
- <gloss>X</gloss> — modernize interlinear annotations
- <insert>X</insert> — modernize later additions (inline only)
- <unclear>X</unclear> — illegible readings
- <term>X</term> — explain archaic or technical vocabulary

**Metadata tags (hidden from readers):**
- <meta>X</meta> for notes about continuity with previous page

**What to modernize:**
1. **Spelling** — normalize archaic spelling ("hee" → "he", "doe" → "do", "betweene" → "between", "shew" → "show", "vnto" → "unto")
2. **Vocabulary** — replace obsolete words with modern equivalents. Use <note>original: "..."</note> for significant archaic terms
3. **Sentence structure** — break up very long periodic sentences while preserving meaning
4. **Punctuation** — modernize capitalization, punctuation, and emphasis
5. **Grammar** — update archaic forms ("hath" → "has", "doth" → "does", "thou art" → "you are", "wherefore" → "why/therefore")

**What to keep:**
- All substantive content (don't summarize or skip anything)
- Key names, titles, and proper nouns (with modern spelling where applicable)
- The author's arguments, reasoning, and rhetorical structure
- Quoted passages (modernize but note the original when important)
- Latin, Greek, or other foreign phrases — translate to English with <note>original: "..."</note>

**IMPORTANT - Translate ALL embedded foreign languages to English:**
Early Modern English texts frequently contain Latin, Greek, Hebrew, and other languages inline. You MUST translate EVERYTHING to English:
- Latin quotes and phrases → translate to English
- Greek phrases → translate to English
- Hebrew or Aramaic terms → translate to English
- ANY non-English text → translate to English
Use <note>original: "..."</note> to preserve important original phrases for scholars, but the main text must be fully readable in English without knowing other languages.

**Do NOT use:**
- Code blocks or backticks — this is prose

**Instructions:**
1. Start with <meta>...</meta> if noting continuity with previous page (hidden from readers).
2. Mirror the source layout — headings, paragraphs, tables, centered text.
3. Modernize ALL text including <margin>, <insert>, <gloss> — keep the XML tags.
4. Translate any Latin/Greek/Hebrew phrases to English, noting originals when significant.
5. Add <note>...</note> inline to explain historical references or difficult phrases.
6. Style: warm museum label — explain rather than assume knowledge.
7. Preserve the voice and spirit of the original.
8. END with <summary>...</summary> and <keywords>...</keywords> for indexing.

**Final output format:**
[modernized text]

<summary>1-2 sentence summary of this page's main content and significance</summary>
<keywords>key concepts, names, themes — for indexing</keywords>`;