---
name: "Standard OCR"
type: ocr
version: 9
is_default: false
content_hash: c97ae04fce29b07e3f390105360df51d
db_id: 69c25dc452c6cdeca5f9c1f2
created_at: 2026-03-24T09:47:48.934Z
---
Transcribe this historical manuscript page to Markdown.

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
- <language>X</language> — the detected language of this page (REQUIRED — always identify the language)
- <script>printed|handwritten|mixed</script> — whether the text is typeset, handwritten, or mixed (REQUIRED)
- <page-type>X</page-type>
- <columns>N</columns> — number of text columns on this page (omit for single-column pages, include for 2+ columns) — classify this page (REQUIRED). One of: title-page, frontispiece, dedication, preface, toc, index, errata, colophon, appendix, blank, illustration, diagram, map, text
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
- <image-desc size="large|medium|small" type="woodcut|engraving|diagram|emblem|portrait|map|decorative|symbol" significance="high|low">description</image-desc> — for EVERY illustration, diagram, chart, or decorative element. Size: large (>quarter page), medium (prominent but partial), small (minor initials, ornaments). Significance: high (illustrations, diagrams, emblems, figures, maps), low (decorative initials, borders, printer's marks, ornaments)

**Column layout:** If the page has two (or more) text columns, transcribe the left column first, then insert <column-break/> on its own line, then transcribe the right column. Do NOT use <column-break/> for single-column pages.

**Handwritten manuscript rules:**
If the page contains handwritten text (cursive, semi-cursive, or any non-typeset script):
1. Set <script>handwritten</script> (or mixed if both printed and handwritten)
2. Use <unclear>X</unclear> LIBERALLY — it is far better to mark a word as uncertain than to guess. If you cannot confidently read a word, wrap it in <unclear>
3. Add <warning>Handwritten [script type, e.g. "Sephardic cursive Hebrew", "Italian humanist hand"]. Transcription contains uncertain readings.</warning>
4. Do NOT fill gaps with plausible text from memory. If a line is illegible, write <unclear>[illegible line]</unclear>
5. Do NOT produce fluent text when the source is difficult to read. Hesitation and gaps are honest; fluency is suspicious
6. For partially legible words, transcribe what you can see and mark the rest: <unclear>מל[...]ים</unclear>

**Critical rules:**
1. Preserve original spelling, capitalization, punctuation
2. Page numbers/headers/signatures go in metadata tags ONLY — NEVER duplicate as ## headings or body text. Example: "DISCURSUS IV." at top of page → <header>DISCURSUS IV.</header> and nothing else
3. Decorative initials (drop caps): merge large ornamental first letters with the word they begin. A large "L" followed by "EX" → "Lex", not "L Ex"
4. IGNORE partial text at left/right edges (from facing page in spread)
5. Capture ALL text including margins and annotations
6. Describe any images/diagrams with <image-desc>...</image-desc> using prose, never tables
7. End with <vocab>key terms, names, concepts on this page</vocab>

**If image has quality issues**, start with <warning>describe issue</warning>