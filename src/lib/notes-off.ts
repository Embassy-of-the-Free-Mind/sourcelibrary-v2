/**
 * "Notes off" — the one definition of what disappears when a reader turns
 * annotations off, shared by the reader and every export.
 *
 * The editorial markup splits into two families, and the whole rule turns on
 * the distinction:
 *
 *   - **Page marks** (`<margin>`, `<gloss>`, `<insert>`, `<unclear>`) mark text
 *     that is physically present on the page — a marginal note in the original,
 *     a scribal insertion, an uncertain reading. That is transcription. Notes
 *     off must never delete their content; it unwraps them, so the words stay
 *     and only the highlight chip goes. On pages whose text is mostly labels
 *     (maps, diagrams, plates) deleting them empties the page.
 *   - **AI annotations** (`<note>`, `<image-desc>`) are our own commentary, and
 *     are the only thing the toggle should actually hide.
 *
 * `<term>` sits across the line and needs the glossary-line rule below.
 *
 * This module exists because the rule was implemented independently on five
 * surfaces (reader, EPUB download ×2, PDF, Typst — census in #3825) and drifted:
 * #3811 fixed the reader deleting translated words, and #3870 found the EPUB/HTML
 * download still doing the same thing plus deleting page-mark content outright.
 * Every surface that honours a notes-off flag must call `applyNotesOff` rather
 * than hand-rolling the regexes again.
 */

/** Tags marking text physically on the page, as opposed to AI commentary. */
export const PAGE_MARK_TAGS = 'margin|gloss|insert|unclear';

/**
 * Handle `<term>` vocabulary chips when notes are hidden.
 *
 * A trailing glossary entry is a line of nothing but `<term>`+`<note>` pairs
 * (e.g. `<term>bite</term> <note>original: "morsus."</note>`). With notes off the
 * `<note>` disappears, leaving the term chip dangling with no definition — remove
 * those lines whole. But the same pair also occurs INLINE mid-sentence
 * (`a <term>scheme of roundness</term> <note>original: "schema rotundationis"</note>
 * is produced`), where the term IS the translation of the word: deleting the pair
 * there deletes sentence content (#3811). So only whole glossary lines are dropped;
 * every other `<term>` is unwrapped to plain text (its `<note>`, if any, is removed
 * by `stripAiAnnotations`). A `<term>` followed by a `<gloss>` keeps the term and
 * drops only the AI's rendering of it, otherwise the unwrapped gloss reads as a
 * duplicate.
 */
export function preprocessTerms(text: string): string {
  const pair = '<term>[^\\n]*?<\\/term>\\s*<note>[^\\n]*?<\\/note>';
  const glossaryLine = new RegExp(`^[\\s*\\->#\\d.]*(?:${pair}[\\s.,;:]*)+[\\s*]*$`, 'i');
  return text
    .split('\n')
    .filter(line => !glossaryLine.test(line))
    .join('\n')
    .replace(/(<term>[\s\S]*?<\/term>)\s*<gloss>[\s\S]*?<\/gloss>/gi, '$1')
    .replace(/<term>([\s\S]*?)<\/term>/gi, '$1');
}

/** Unwrap page marks: keep the transcribed words, drop the chip. */
export function unwrapPageMarks(text: string): string {
  return text.replace(
    new RegExp(`<(${PAGE_MARK_TAGS})(?:\\s[^>]*)?>([\\s\\S]*?)<\\/\\1>`, 'gi'),
    '$2'
  );
}

/**
 * Remove the AI's own commentary — the only thing the notes toggle hides.
 * Runs after `unwrapPageMarks`, so a note nested inside a page mark has already
 * been flattened into it.
 */
export function stripAiAnnotations(text: string): string {
  return text
    .replace(/<(note|image-desc)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, '')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * The full notes-off transform, in the order the reader applies it. Whatever
 * survives is page text.
 */
export function applyNotesOff(text: string): string {
  return stripAiAnnotations(unwrapPageMarks(preprocessTerms(text)));
}
