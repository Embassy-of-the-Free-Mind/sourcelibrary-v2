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