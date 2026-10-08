/**
 * PRIOR ART: src/lib/strip-editorial-wrappers.ts — it drops ->centred<- markers
 * (content kept), but only as one step of a full snippet-flattening pipeline
 * (tables, headings, emphasis, AI preambles), which would change what every
 * counter and scorer below measures; src/lib/translate-write.ts
 * `translatableBodyLen` already removes `->|<-` first (#5105 / PR #5161) but
 * inline, for one function.
 *
 * Strip markup tags from OCR / translation page text WITHOUT eating body text
 * after a centred line (#5564).
 *
 * Production OCR marks a centred line as `->text<-`. The bare pattern
 * `/<[^>]+>/g` reads the `<-` as a tag opener and deletes everything up to the
 * next `>` — after the last centred line on a page that is usually a closing tag
 * at the END of the page, so the whole body between is silently deleted:
 *
 *   "->**Servant.**<-\nThose Roomes doe smell…\n<vocab>Fulvia</vocab>"
 *   .replace(/<[^>]+>/g, ' ')  →  "->**Servant.** Fulvia"
 *
 * So the centring markers go first (content kept), then the tags. Run any
 * content-and-all wrapper removal (`<header>…</header>` etc.) BEFORE this, as
 * the call sites already do — this only removes the tags themselves.
 *
 * Scripts-side twin: scripts/lib/strip-markup-tags.mjs (.mjs scripts cannot
 * import TS). Keep the two identical; tests/unit/strip-markup-tags.test.ts pins
 * parity, and tests/unit/bare-tag-strip-guard.test.ts fails on a new bare
 * tag-strip regex in src/lib, scripts/eval/lib or the twinned scripts/lib files.
 */

/** `->` / `<-` centring markers. An arrow in prose (`a -> b`) loses only its arrow. */
const CENTRE_MARKERS = /->|<-/g;
const TAG = /<[^>]+>/g;

export function stripMarkupTags(text: string | null | undefined, replacement = ' '): string {
  if (!text) return '';
  return String(text).replace(CENTRE_MARKERS, replacement).replace(TAG, replacement);
}
