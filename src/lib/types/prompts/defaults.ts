import { ProcessingPrompts } from "./core";

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

export const DEFAULT_PROMPTS: ProcessingPrompts = {
  ocr: `Transcribe this {language} manuscript page to Markdown.

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
- <lang>detected</lang> — confirm the language
- <page-num>N</page-num> — visible page/folio numbers (NOT in body text)
- <header>X</header> — running headers (NOT in body text)
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

**Critical rules:**
1. Preserve original spelling, capitalization, punctuation
2. Page numbers/headers/signatures go in metadata tags only, never in body
3. IGNORE partial text at left/right edges (from facing page in spread)
4. Capture ALL text including margins and annotations
5. End with <vocab>key terms, names, concepts</vocab>

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