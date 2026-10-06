Transcribe this historical page to Markdown.

**Context:** This is a scholarly digitization project transcribing public domain books and manuscripts from institutional archives. All materials are out of copyright and provided by partner libraries for open access.

{language_instruction}

**Output contract (CRITICAL):**
- Your ENTIRE response must consist of the transcription plus the tags defined below. Never address the reader or the requester.
- NEVER add untagged commentary: no introductions ("Here is the transcription…"), no remarks about the language or the request ("Note: The text in the image is in French, not Latin…"), no apologies, no explanations. Your response must begin either with a tag or with the first transcribed words of the page.
- If you need to remark on anything — the language differing from what was expected, legibility, uncertainty about the request — put the remark INSIDE <warning>…</warning>. Any text outside tags is treated as verbatim page text and corrupts the edition.
- If the page cannot be transcribed at all, output ONLY the metadata tags plus a <warning> explaining why — never a conversational refusal.


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
- <scan-quality>poor|fair|good</scan-quality> — overall legibility of this scan (REQUIRED). poor = significant fading/damage/blur making >20% of text hard to read; fair = mostly legible with some degraded areas; good = clean and fully legible
- <language>X</language> — the primary language of this page's text, by its standard English name (REQUIRED). Examples: Latin, German, Ancient Greek, Hebrew, Arabic, Persian, Ottoman Turkish, Punjabi, Sanskrit, Classical Chinese, Japanese. Name the LANGUAGE, never the script or writing system (Punjabi, not Gurmukhi; Persian, not Arabic script; Japanese, not Kanji). Give ONE language: the one most of the text is in.
- <script>printed|handwritten|mixed</script> — how the text was made (REQUIRED). printed = set in type, cut on a woodblock (xylograph), engraved or lithographed; handwritten = written by hand, including text brush-written on pre-printed ruled paper or forms; mixed = both on this page
- <page-type>X</page-type> — classify this page (REQUIRED). One of: title-page, frontispiece, dedication, preface, toc, index, errata, colophon, appendix, blank, illustration, diagram, map, text
  - `blank` means NO INK ON THIS SIDE OF THE LEAF — an empty leaf, a verso that was never printed. Show-through from the other side of the leaf (mirror-reversed text or image) does not count as ink on this side. A page that is faint, stained, damaged, or only partly legible is NOT blank: give it its real type and use <unclear> / <warning> for the parts you cannot read. Both mistakes are costly, in opposite directions.
- <columns>N</columns> — number of text columns on this page (omit for single-column pages, include for 2+ columns)
- <page-num>N</page-num> — the page or folio number printed or written on THIS page, exactly as it appears: arabic (123), roman (xiv), or a folio with its side (12r, 12v). Omit the tag if no number is visible. Never work it out from a neighbouring page, the scan order or the book's structure, and never use a chapter, section, plate or signature number (NOT in body text)
- <header>X</header> — running headers/chapter titles at top of page (NEVER duplicate as heading in body)
- <sig>X</sig> — printer's signature marks, transcribed exactly as printed on THIS page (NOT in body text)
- <meta>X</meta> — hidden metadata (image quality, catchwords)
- <warning>X</warning> — quality issues (faded, damaged, blurry)
- <vocab>X</vocab> — key terms for indexing

**Inline annotations (visible to readers):**
- <margin>X</margin> — marginal notes, citations (place BEFORE the paragraph they annotate)
- <gloss>X</gloss> — interlinear annotations
- <insert>X</insert> — text set apart from the running body: labels printed inside a map, diagram, chart or illustration (cartouches, callouts, keys); boxed or framed text; material added after printing such as a pasted slip or stamped correction. This is TRANSCRIPTION of words on the page, not your description of them (inline only, not around tables)
- <unclear>X</unclear> — illegible readings
- <note>X</note> — interpretive notes for readers
- <term>X</term> — technical vocabulary
- <image-desc size="large|medium|small" type="woodcut|engraving|diagram|emblem|portrait|map|decorative|symbol" significance="high|low">description</image-desc> — for EVERY illustration, diagram, chart, or decorative element. Size: large (>quarter page), medium (prominent but partial), small (minor initials, ornaments). Significance: high (illustrations, diagrams, emblems, figures, maps), low (decorative initials, borders, printer's marks, ornaments)

**Column layout:** If the page has two (or more) text columns, transcribe the left column first, then insert <column-break/> on its own line, then transcribe the right column. Do NOT use <column-break/> for single-column pages.

**Handwritten manuscript rules:**
If the page contains handwritten text (cursive, semi-cursive, or any non-typeset script):
1. Set <script>handwritten</script> (or mixed if both printed and handwritten)
2. Add <warning>Handwritten [script type, e.g. "Sephardic cursive Hebrew", "Italian humanist hand"]</warning>
3. STILL TRANSCRIBE THE TEXT TO THE BEST OF YOUR ABILITY. Handwritten does not mean illegible. Most historical manuscripts are readable with care.
4. Reserve <unclear>X</unclear> for words you genuinely cannot decipher — typically 5-15% of words on a difficult page, not the majority. If you are marking more than ~20% of words as unclear, you are being too cautious.
5. Do NOT invent text that is not on the page. But DO read carefully and transcribe what IS there, even if the hand is unfamiliar.
6. For partially legible words, give your best reading with <unclear>: <unclear>מלכים</unclear>
7. For truly illegible passages (damaged, faded beyond reading), write: <unclear>[illegible — 2-3 words]</unclear> estimating the gap size


**Medieval abbreviation handling:**
When transcribing manuscripts with scribal abbreviations (tildes, macrons, special glyphs), follow these rules consistently:
1. **ALWAYS expand abbreviations into their full Latin form.** Do NOT preserve abbreviated glyphs.
   - q̃, q̄ → "que" (e.g., "itaq̃" → "itaque")
   - ꝑ, ꝓ → "per" or "pro" (by context)
   - ꝯ, ɔ → "con" or "com" (by context)
   - ā, ã → expand the nasal (e.g., "tā" → "tam", "ãte" → "ante")
   - ē, ẽ → expand (e.g., "ē" → "est" or "em" by context)
   - ō → expand (e.g., "ōnis" → "omnis")
   - ū → expand (e.g., "currūt" → "currunt")
   - ñ → expand (e.g., "dñs" → "dominus")
   - ⁊ → "et"
   - ꝫ → "us" (e.g., "oībꝫ" → "oibus" → "omnibus")
   - Superscript letters → expand (e.g., "qᵈ" → "quod")
2. **Normalize v/u:** Preserve the original form as printed. Do NOT modernize (keep "uirtus" if printed, keep "virtus" if printed).
3. **Preserve original punctuation marks** but normalize to standard Unicode: use · for middle dots, . for periods, : for colons.

**Untranscribable regions (CRITICAL):**
Some pages carry text in a script or notation you cannot reliably transcribe — hieroglyphs, cuneiform, an unfamiliar shorthand, a block damaged past reading. For any such region:
1. Do NOT transcribe it, do NOT approximate it, and do NOT reconstruct what it probably said.
2. Do NOT describe it in square brackets or in bare prose. An untagged description like "[Hieroglyphic text lines x+1 through 20]" is read downstream as page text and gets rendered into invented content.
3. Emit ONE <unclear> tag naming what is there and roughly how much: <unclear>20 lines of hieroglyphic text, not transcribed</unclear>
4. NEVER fill an unread region by repeating a character, glyph or word. A long run of one repeated sign is always an artifact, never a reading.
5. A page that is mostly untranscribable is mostly <unclear> tags. That is CORRECT output, not a failure. Transcribe the surrounding apparatus normally — headings, editorial notes, bibliographic citations, page numbers are usually in a script you CAN read, and they are the most valuable part of such a page.

**Lacunae & runaway repetition (CRITICAL):**
- Critical and papyrological editions mark missing or illegible text with runs of dots, dashes, or underscores (e.g. "[. . . .]", "____", "ΑΒ[......]Γ"). Transcribe SHORT gaps using the edition's own bracket notation, but NEVER emit more than ~10 repeated characters in a row. If a gap, rule, or dotted line is longer than that, collapse it to a single [...] marker — do NOT reproduce it dot-for-dot.
- NEVER output the same character (".", "-", "_", or any letter) more than ~10 times consecutively. A long run of one repeated character is always an error, not real text.
- A lacuna or gap NEVER ends the page. After a [...] marker, CONTINUE transcribing everything else on the page — the surrounding text, commentary, footnotes, and the critical apparatus. Transcribe the whole page, top to bottom.

**Blank pages (CRITICAL):**
- A blank page emits the metadata tags and NOTHING ELSE: no body text, and no <header>, <sig> or <page-num>. Those tags are exactly what past fabrications invented to make an empty leaf look like a printed one.
- "The page cannot be transcribed" (illegible) and "there is nothing on the page" (blank) are different findings. Do not reach for a blank classification because a page is hard to read.
- SELF-CHECK: if anywhere in your output you describe a mark, letter, stamp, stain of ink, printer's ornament or annotation on this side of the leaf, then the page is NOT blank. Give it its real <page-type> and transcribe or mark what you saw.
- Any remark ABOUT a blank page ("the leaf is empty; show-through from the recto") goes inside <meta> or <warning>. Never write it as untagged prose — untagged text is treated as the words printed on the page.

**Show-through (CRITICAL):**
- Thin paper lets the text or picture printed on the OTHER side of the leaf show through, and a facing page can leave an offset image. You can recognise both: the letters are MIRROR-REVERSED (they read backwards), the marks are faint or grey, and they do not sit on this side's own lines.
- Show-through is not on this page. Never transcribe it, never turn it back into normal reading order, and never take a header, title or page number from it.
- If the only marks on this side are show-through, the page IS blank: emit <page-type>blank</page-type> and <warning>show-through from the other side only</warning>, and nothing else.
- Real ink on this side (a library stamp, a shelfmark, a pencil note, an accession number, a signature) is not show-through: it reads the right way round. Such a mark is TEXT: transcribe its words in the body (a stamp's legend, the shelfmark, the note), not only in <meta> or <image-desc>. A leaf that carries such a mark is NOT blank, even when everything else on it is show-through. Leave the show-through itself untranscribed.

**Document context is not a source:**
- The title, author and date you are given say which book this is. They are NEVER text to transcribe. Do not write a header, a heading or prose because the book is likely to contain it. Every word you transcribe must be visible in THIS image. If you can see no ink on this side, the page is blank, whatever the book is.

**Critical rules:**
1. Preserve original spelling, capitalization, punctuation. ALWAYS expand abbreviations (see rules above).
2. Page numbers/headers/signatures go in metadata tags ONLY — NEVER duplicate as ## headings or body text. Example: a running header at the top of a page → <header>[the exact words printed there]</header> and nothing else. Transcribe what is on THIS page; never carry over an example, a header from a previous page, or a plausible heading
3. Decorative initials (drop caps): merge large ornamental first letters with the word they begin — a large initial followed by the rest of the word is one word, not two. Read the actual letter on the page; do not assume a particular initial or opening word
4. IGNORE partial text at left/right edges (from facing page in spread)
5. Capture ALL text including margins and annotations
5. **Check the physical margins carefully.** Early printed books often have small printed glosses or summaries in the left or right margins. Manuscripts may have handwritten reader annotations, ownership marks, or corrections in the margins. Transcribe ALL marginal text using <margin> tags, placed BEFORE the paragraph they annotate. Do not skip margin text because it is small, faint, or in a different hand.
6. Describe any images/diagrams with <image-desc>...</image-desc> using prose, never tables
7. End with <vocab>key terms, names, concepts on this page</vocab>

**If image has quality issues**, start with <warning>describe issue</warning>