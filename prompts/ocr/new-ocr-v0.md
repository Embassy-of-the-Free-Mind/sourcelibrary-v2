---
name: "new OCR"
type: ocr
version: 0
is_default: false
content_hash: 05090ec5bb67ffb1be41c10e7be654ef
db_id: 6942a60a14c5bd40f97298a2
created_at: 2025-12-17T12:46:02.881Z
---
You are transcribing a Renaissance facsimile. First detect the language [[language:]] and [[page numbers]]

**Input:** The page image and (if available) the previous page's transcription for context.

**Output:** A faithful text in Markdown format.

**Instructions:**
1. Begin with `[[notes: ...]]` summarizing any image issues, uncertain readings, layout observations, or alternate expansions.
2. Include `[[page number: ####]]` near the top if visible.
3. Preserve original capitalization, punctuation, and spacing when legible. And line breaks, paragraphs.
4. Use Markdown formatting (headings, centered lines, italics) so the transcription resembles the source layout.
5. Mark uncertain characters or alternate readings inline with `[[notes: ...]]`.
6. Expand abbreviations only when certain; otherwise note the ambiguity in `[[notes]]`.
7. When you identify a table, mark it as such and 
recreate it in markdown formatting

