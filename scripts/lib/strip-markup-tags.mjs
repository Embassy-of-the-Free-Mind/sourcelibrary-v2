// PRIOR ART: src/lib/strip-markup-tags.ts — this is its scripts-side twin
// (.mjs scripts cannot import TS), same arrangement as strip-editorial-wrappers.mjs.
// Keep the two identical; tests/unit/strip-markup-tags.test.ts pins parity.
//
// Strip markup tags from OCR / translation page text WITHOUT eating body text after
// a centred line (#5564). OCR marks centred lines `->text<-`; a bare tag-strip regex
// reads the `<-` as a tag opener and deletes everything up to the next `>` — often the
// closing tag at the end of the page. Markers first (content kept), then tags.
// Full rationale on the TS twin.

/** `->` / `<-` centring markers. An arrow in prose (`a -> b`) loses only its arrow. */
const CENTRE_MARKERS = /->|<-/g;
const TAG = /<[^>]+>/g;

export function stripMarkupTags(text, replacement = ' ') {
  if (!text) return '';
  return String(text).replace(CENTRE_MARKERS, replacement).replace(TAG, replacement);
}
