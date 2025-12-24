export type BookStatus = 'draft' | 'in_progress' | 'complete' | 'published';

// Job management for long-running tasks
export type JobType = 'batch_ocr' | 'batch_translate' | 'batch_split' | 'book_import';
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

export interface Job {
  _id?: unknown;
  id: string;
  type: JobType;
  status: JobStatus;
  progress: JobProgress;
  book_id?: string;
  book_title?: string;
  created_at: Date;
  updated_at: Date;
  started_at?: Date;
  completed_at?: Date;
  error?: string;
  results: JobResult[];
  config: {
    model?: string;
    prompt_name?: string;
    language?: string;
    page_ids?: string[];
    [key: string]: unknown;
  };
}

// Available Gemini models for processing
export const GEMINI_MODELS = [
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)' },
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
- | tables | for columnar data, parallel text
- > blockquotes for quotations, prayers
- --- for decorative dividers

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
7. END with [[vocabulary: ...]] listing key Latin terms, names, and concepts on this page.

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

4. **Mixed Latin/German:**
   - Common in learned texts
   - Translate both, noting the switch
   - Latin quotes: translate with [[notes: Latin original: "..."]]

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

// Default prompts with [[notes]] support
export const DEFAULT_PROMPTS: ProcessingPrompts = {
  ocr: `You are transcribing a historical manuscript page.

**Input:** The page image and (if available) the previous page's transcription for context.

**Output:** A faithful transcription in Markdown format that visually resembles the original.

**First:** Detect and note the language with [[language: detected language]]

**Representing text styles:**
- # Large title → use # heading (biggest)
- ## Section heading → use ## heading
- ### Subsection → use ### heading
- **Bold text** → use **bold**
- *Italic text* → use *italic*
- LARGER TEXT should use BIGGER HEADINGS - match the visual hierarchy
- Preserve line breaks and paragraph structure

**Layout markup:**
- ->centered text<- for centered lines (titles, headers)
- | tables | for columnar data, parallel text, lists in columns
- > blockquotes for prayers, quotes, set-apart passages
- --- for decorative dividers or section breaks

**Annotations:**
- [[meta: ...]] for page metadata (image quality, layout) — hidden from readers
- [[notes: ...]] for interpretive notes readers should see
- [[margin: ...]] for text in the margins
- [[gloss: ...]] for interlinear annotations above/below words
- [[insert: ...]] for text in boxes, cartouches, or later additions
- [[unclear: ...]] for illegible or uncertain readings
- [[page number: N]] for visible page numbers
- [[header: ...]] for running headers/page headings

**IMPORTANT - Exclude from main text:**
- Page numbers: Capture ONLY in [[page number: N]], do NOT include in the body text
- Running headers/page headings: Capture ONLY in [[header: ...]], do NOT include in the body text
- These elements should appear in metadata annotations only, never in the main transcription

**Do NOT use:**
- Code blocks (\`\`\`) or inline code - this is prose, not code
- If markdown can't capture the layout, add a [[meta: ...]] explaining it

**Instructions:**
1. Begin with [[meta: ...]] summarizing image quality, layout, and any special features.
2. Include [[page number: N]] if visible.
3. Preserve original spelling, capitalization, punctuation, line breaks, and paragraphs.
4. Bold text → **bold**. Italic → *italic*. Larger text → bigger heading.
5. Recreate tables in markdown when you see columnar layouts.
6. Capture ALL text including margins, boxes, and annotations.
7. END with [[vocabulary: ...]] listing key terms, names, and concepts on this page.

**Important:** This page may have been split from a two-page spread. You may see partial text from the adjacent page at the left or right edge. Focus on transcribing the MAIN text block of this page. Ignore any partial/cut-off text at the edges that clearly belongs to the facing page.

**Language:** {language}

**Final output format:**
[page transcription]

[[vocabulary: term1, term2, Person Name, Concept, ...]]`,

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

**Instructions:**
1. Start with [[meta: ...]] if noting continuity with previous page (hidden from readers).
2. Mirror the source layout - headings, paragraphs, tables, centered text.
3. Translate ALL text including [[margin:]], [[insert:]], [[gloss:]] - keep the markup tags.
4. Add [[notes: ...]] inline to explain historical references or difficult phrases.
5. Style: warm museum label - explain rather than assume knowledge.
6. Preserve the voice and spirit of the original.
7. END with [[summary:]] and [[keywords:]] for indexing.

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
