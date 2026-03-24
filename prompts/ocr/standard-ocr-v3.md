---
name: "Standard OCR"
type: ocr
version: 3
is_default: false
content_hash: aa056cc243fe2ade3fc8a23d999f7892
db_id: 698f115939b2da94f0204ecc
created_at: 2026-02-13T11:56:09.593Z
description: "v3: Add <page-type> classification tag (title-page, frontispiece, toc, etc.)"
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
- <image-desc>description</image-desc> — describe illustrations, diagrams, circular charts, woodcuts

**Critical rules:**
1. Preserve original spelling, capitalization, punctuation
2. Page numbers/headers/signatures go in metadata tags ONLY — NEVER duplicate as ## headings or body text. Example: "DISCURSUS IV." at top of page → <header>DISCURSUS IV.</header> and nothing else
3. Decorative initials (drop caps): merge large ornamental first letters with the word they begin. A large "L" followed by "EX" → "Lex", not "L Ex"
4. IGNORE partial text at left/right edges (from facing page in spread)
5. Capture ALL text including margins and annotations
6. Describe any images/diagrams with <image-desc>...</image-desc> using prose, never tables
7. End with <vocab>key terms, names, concepts on this page</vocab>

**If image has quality issues**, start with <warning>describe issue</warning>