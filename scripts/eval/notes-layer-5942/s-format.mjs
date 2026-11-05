// PRIOR ART: scripts/eval/plain-6728/prompts.mjs — edits the v13 prompt in place to REMOVE the notes; this keeps every
// instruction of v13 and only changes the form the answer takes, so the block is appended, not edited in.
/**
 * #5942 Part B, arm S: the output-format block appended to today's translation prompt (before the sentinel
 * instruction). Everything v13 asks for — notes, definitions, "original:" notes, image descriptions, page marks,
 * summary, keywords, meta — is still asked for; it is returned as annotations beside a plain text instead of as tags
 * inside it. The anchor fields are the W3C Web Annotation TextQuoteSelector (exact, prefix, suffix).
 */
export const S_FORMAT = `

**OUTPUT FORMAT — this overrides every instruction above about tags and where to write them.**
Return ONE JSON object and nothing else (no code fence):
{"text": "...", "annotations": [{"type": "...", "exact": "...", "prefix": "...", "suffix": "...", "body": "..."}]}

- "text": the English translation of the page and nothing else: the book's words only, as a reader would read them. NO markup of any kind: no <note>, <term>, <gloss>, <margin>, <insert>, <unclear>, <summary>, <keywords>, <meta>, no [brackets] or (parentheses) of your own. Keep paragraph breaks as \\n\\n and the page's layout markers <column-break/> and <leaf-break/> where they belong; Markdown emphasis and headings as usual.
- "annotations": everything the instructions above would have put in a tag, one object each, in page order:
  - "type": one of "note" (an interpretive note or clarification), "definition" (what a kept term means), "original" (an original-language phrase worth keeping; body is the original words), "image" (an image description), "margin" | "insert" | "unclear" | "gloss" (page marks: a marginal note printed on the page, a scribal insertion, an uncertain reading, an interlinear gloss printed in the source), "summary", "keywords", "meta".
  - "exact": the words of "text" the annotation attaches to, copied character for character from "text" — for a note, the words it comments on (3–12 words, chosen so they occur only once in "text" if possible); for a definition, the term; for a page mark, the marked words themselves (they stay in "text"). For "summary", "keywords" and "meta", "exact" is "".
  - "prefix": the up to 32 characters of "text" immediately before "exact"; "suffix": the up to 32 characters immediately after it. Copy them exactly ("" at the start or end of the text).
  - "body": the note, definition, original words, description, summary, comma-separated keywords, or meta remark. For a page mark, "".
- Escape the JSON correctly (\\" for quotes inside strings, \\n for line breaks).`;
