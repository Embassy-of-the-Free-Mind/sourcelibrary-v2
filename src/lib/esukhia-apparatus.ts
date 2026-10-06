/**
 * Display-only cleanup of the Esukhia e-text apparatus (#5497).
 *
 * PRIOR ART: src/lib/strip-editorial-wrappers.ts — strips AI-written wrapper
 * blocks for the snippet/quote/search surfaces; it knows nothing of Esukhia
 * markup and its callers must keep stored text verbatim, so this lives apart.
 * src/lib/text-provenance.ts reads `ocr.text_edition` for the licence label only.
 *
 * The Derge Tengyur pages carry the Esukhia transcription verbatim, apparatus
 * and all (`ocr.text_edition.conventions` on each page says what each mark means):
 *
 *   {D3790}        a text with that Tohoku number opens here      → removed
 *   (x,y)          (reading of the blocks, suggested correction)  → x
 *   {a,b}          variant pair                                   → a
 *   # / \#         a Peydurma note point (escaped at line start)  → removed
 *   [12a.3]        a folio line marker the import missed          → removed
 *   [x]            doubtful reading                               → KEPT
 *
 * The block reading (x) is kept because it is what the woodblock beside it
 * shows. Stored text is never changed — this is for the reading pane and its
 * copy button only. Every other page passes through untouched: the rules fire
 * only when the page's text edition is an Esukhia one.
 */

/** The separator Esukhia uses inside a pair: ASCII comma, sometimes U+201A. */
const SEP = '[,‚]';

export function isEsukhiaEdition(ocr: { text_edition?: { name?: unknown } } | null | undefined): boolean {
  const name = ocr?.text_edition?.name;
  return typeof name === 'string' && name.startsWith('Esukhia');
}

/** Strip the apparatus from an Esukhia transcription for display. */
export function stripEsukhiaApparatus(text: string): string {
  return text
    .replace(/\{D\d+[a-z]?\}/g, '')
    .replace(new RegExp(`\\(([^()\\n]*?)${SEP}[^()\\n]*\\)`, 'g'), '$1')
    .replace(new RegExp(`\\{([^{}\\n]*?)${SEP}[^{}\\n]*\\}`, 'g'), '$1')
    .replace(/\[\d+[ab]\.\d+\]/g, '')
    .replace(/\\?#/g, '');
}

/** The transcription as the reader shows it: apparatus stripped on Esukhia pages only. */
export function displayTranscription(
  ocr: { data?: string | null; text_edition?: { name?: unknown } } | null | undefined,
): string {
  const text = ocr?.data || '';
  return text && isEsukhiaEdition(ocr) ? stripEsukhiaApparatus(text) : text;
}
