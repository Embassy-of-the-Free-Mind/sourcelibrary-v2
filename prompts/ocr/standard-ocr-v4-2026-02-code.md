---
name: "Standard OCR"
type: ocr
version: "v4.2026-02"
source: defaults.ts
commit: 104104b3
date: 2026-02-15
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

If text-only page, omit the <detected-images> block.