// PRIOR ART: scripts/lib/page-embedding-text.mjs cleanPageText strips the same production markup but joins lines and drops
// headers (it feeds embeddings); an OCR training label needs the lines and the running head. Used by build-train.mjs.
/** Text a reader sees on the leaf; every other production tag (scan-quality, script, page-num, meta, image-desc …) is metadata. */
const KEEP = new Set(['header', 'footer', 'note', 'notes', 'marginalia', 'margin', 'sidenote', 'footnote', 'catchword', 'signature']);
/** Production markup → plain lines: metadata blocks dropped, kept blocks unwrapped, ->centring<- and markdown marks dropped. */
export function cleanTeacher(t) {
  return String(t || '')
    .replace(/<([a-z][\w-]*)(\s[^>]*)?>([\s\S]*?)<\/\1>\n?/g, (m, tag, attrs, inner) => (KEEP.has(tag) ? `${inner}\n` : ''))
    .replace(/<\/?[a-z][\w-]*(\s[^>\n]*)?\/?>/g, '')
    .replace(/->|<-/g, '')
    .replace(/^\s*-{3,}\s*$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*|__|(?<![\w*])\*(?!\s)|(?<!\s)\*(?![\w*])/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}
