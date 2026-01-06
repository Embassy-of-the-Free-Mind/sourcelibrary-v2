export type PromptType = 'ocr' | 'translation' | 'summary';

export interface PromptReference {
  id: string;                   // Prompt document ID
  name: string;                 // Prompt name for quick reference
  version: number;              // Version number
}

// Legacy: GitHub URL for prompt versioning (deprecated in favor of prompt_id)
export const PROMPTS_SOURCE_URL = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/src/lib/types.ts';

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

