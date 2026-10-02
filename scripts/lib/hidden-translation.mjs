// Translation hidden in a <meta>/<note> wrapper — page-error taxonomy class T3 (#5148).
//
// PRIOR ART: scripts/lib/page-integrity.mjs — truncationRatio() flags these pages as TRUNCATED, and
// the repair it implies (re-translate) is wrong; the renderer's NotesRenderer.extractMetadata() moves
// every <meta> body out of the reading text, which is what hides them. Neither can tell a hidden
// translation from a long honest note. Kept in its own module (not appended to page-integrity.mjs)
// because the translation writers import it and page-integrity is the audit's detector library.
import { sourceProse, translationProse } from './block-drift.mjs';
import { readingLength, NON_PROSE_TYPES, TRUNC_MIN_OCR_CHARS, DESCRIBED_PAGE } from './page-integrity.mjs';

const proseOf = sourceProse;
const trProseOf = translationProse;

export const HIDDEN_MIN_CHARS = 200;   // reading length a wrapper must reach to be "the translation"
const HIDDEN_WRAPPERS = /<(meta|note)\b[^>]*>([\s\S]*?)<\/\1>/gi;
/** The model's own label at the head of a continuation it wrapped as metadata. */
export const CONTINUATION_LABEL = /^\s*(?:continues? from (?:the )?previous page|continued from (?:the )?previous page|continuation(?: of (?:the )?previous page)?|continuity(?: note)?|translation(?: continues)?)\s*[:\-–—]\s*/i;

/**
 * Is the translation of this page filed under metadata? The renderer moves every <meta> body into
 * the metadata panel and styles <note> as apparatus; when the model wrapped the translation itself
 * ("<meta>continues from previous page: ...as having power over the things within it…</meta>") the
 * reader meets a near-empty page though the translation exists (#5148, Agrippa p.233: wrapper
 * 3,520 characters, body 8). truncationRatio() flags the same page as truncated, and a
 * re-translation is the wrong repair.
 *
 * `hidden` when the largest single <meta>/<note> block has reading length ≥ HIDDEN_MIN_CHARS and
 * exceeds the remaining body. Judged only where there was something to translate — a prose page
 * whose source body is ≥ TRUNC_MIN_OCR_CHARS — so a plate described in one long <note> (its only
 * honest content) is never touched. A wrapper that opens as a page DESCRIPTION is not a translation.
 */
export function hiddenTranslation({ ocr, tr, type }) {
  if (!tr || !String(tr).trim()) return { judged: false, why: 'no-translation' };
  if (NON_PROSE_TYPES.has(type)) return { judged: false, why: 'non-prose' };
  if (readingLength(proseOf(ocr)) < TRUNC_MIN_OCR_CHARS) return { judged: false, why: 'short-source' };
  const body = readingLength(trProseOf(tr));
  let largest = null;
  for (const m of String(tr).matchAll(HIDDEN_WRAPPERS)) {
    const len = readingLength(m[2]);
    if (!largest || len > largest.len) largest = { wrapper: m[1].toLowerCase(), len, raw: m[0], inner: m[2], index: m.index };
  }
  if (!largest) return { judged: true, body, wrapperLen: 0, hidden: false, buried: false };
  const described = DESCRIBED_PAGE.test(largest.inner.replace(CONTINUATION_LABEL, '').trim());
  const hidden = largest.len >= HIDDEN_MIN_CHARS && largest.len > body && !described;
  // Two tiers. `hidden` is the taxonomy's rule (wrapper longer than the body); the 300-book test
  // walk showed most of those to be a long <note> commentary BESIDE a real body (961 vs 915).
  // `buried` is the repair-grade tier — next to no body at all — and the only one the write-time
  // unwrap acts on: opening a scholarly note into the body would present commentary as text.
  const buried = hidden && body <= Math.max(HIDDEN_BURIED_BODY_MIN, HIDDEN_BURIED_BODY_SHARE * largest.len);
  return { judged: true, body, wrapper: largest.wrapper, wrapperLen: largest.len, hidden, buried, described, labelled: CONTINUATION_LABEL.test(largest.inner), raw: buried ? largest.raw : undefined, inner: buried ? largest.inner : undefined };
}
export const HIDDEN_BURIED_BODY_MIN = 80;     // reading chars of body under which the wrapper IS the page
export const HIDDEN_BURIED_BODY_SHARE = 0.2;  // ... or under this share of the wrapper's length

/**
 * Write-time repair for T3: the wrapper is opened and its text becomes the body; the model's
 * continuation label ("continues from previous page:") is dropped, the text itself is kept
 * byte-for-byte. Returns the input unchanged when hiddenTranslation() does not judge the page
 * hidden — including when no source is given, since without the source the rule cannot tell a
 * hidden translation from a long honest note.
 */
export function unwrapHiddenTranslation({ ocr, tr, type }) {
  const h = ocr ? hiddenTranslation({ ocr, tr, type }) : { judged: false, why: 'no-source' };
  if (!h.judged || !h.buried) return { text: tr, unwrapped: false, why: h.judged ? (h.hidden ? 'hidden-not-buried' : 'not-hidden') : h.why };
  const inner = h.inner.replace(CONTINUATION_LABEL, '').trim();
  const text = String(tr).replace(h.raw, () => inner); // function replacer: "$" in the text is text
  return { text, unwrapped: true, wrapper: h.wrapper, wrapperLen: h.wrapperLen, body: h.body };
}

// ── the page inside its continuity <meta>: the write-time refusal (#5363, #5376) ─────────────

/** The reason value stamped on `translation.health_blocked` for a page hidden in its meta. */
export const HIDDEN_META_REASON = 'hidden-meta';
export const HIDDEN_META_WHOLE_PAGE_SHARE = 0.8;
/**
 * Words after the continuity marker below which the refusal does not fire. Sized on the full
 * mirror (2026-09-30, 4.94M translated pages, scripts/audit/hidden-meta-scan.mjs): 3,218 pages
 * have a continuity meta holding ≥ 80% of the page, and 728 of those hold under 40 words — nearly
 * all a sentence of commentary ("The previous page was a blank endpaper…") on a leaf whose source
 * is a heading or a stamp, where the two-word body IS the whole translation. Refusing those would
 * trade a correct page for an untranslated one. At 40 words and up: 2,490 pages, 2,186 of them
 * the page's own text and 206 the previous page's text handed back in place of this page's.
 */
export const HIDDEN_META_MIN_WORDS = 40;

const CONT_MARKER = /^[\s.…]*continue[sd]?\s+from\s+(?:the\s+)?previous\s+page\b/i;
// "continues from previous page's discussion of …", "…, where the author …": a sentence ABOUT
// the previous page, not text standing in for it.
const DESCRIPTIVE_LEAD = /^(?:['’]s\b|\s*,|\s+(?:and|where|which|in which|with|discussing|detailing|describing|regarding|concerning|about)\b)/i;

/**
 * The continuity <meta> of a translation — `<meta>continues from previous page…</meta>`, the
 * marker the translation prompt asks for when a page opens mid-sentence — or null when there is
 * none. `form` is 'bare' (the marker alone), 'descriptive' (a sentence about the previous page)
 * or 'text' (the marker, then `payload`: words standing where page text would). `raw` is the
 * whole element and `inner` the payload with its inline tags, for a repair that moves it.
 */
export function continuityMeta(tr) {
  for (const m of String(tr || '').matchAll(/<meta>([\s\S]*?)<\/meta>/gi)) {
    const mk = m[1].match(CONT_MARKER);
    if (!mk) continue;
    const rest = m[1].slice(mk[0].length);
    if (DESCRIPTIVE_LEAD.test(rest)) return { form: 'descriptive', payload: '', words: 0, raw: m[0], index: m.index };
    const inner = rest.replace(/^[\s:.…,;—–-]+/, '').trim();
    const payload = inner.replace(/<\/?[a-zA-Z][^>]*>/g, ' ').replace(/^[\s:.…,;—–-]+/, '').replace(/\s+/g, ' ').trim();
    const words = payload.split(/\s+/).filter(w => /\p{L}/u.test(w)).length;
    return { form: words ? 'text' : 'bare', payload, words, inner, raw: m[0], index: m.index };
  }
  return null;
}

/**
 * Did the translator put the page inside its continuity <meta>?
 *
 * The prompt asks for `<meta>continues from previous page: …</meta>` on a page that opens
 * mid-sentence. On about 1 translated page in 2,000 the model writes the page itself after that
 * colon, and every reader surface strips <meta>, content and all — the reader is shown a blank
 * or near-blank page while the text they need sits in the stored translation. True when the
 * words after the marker are at least HIDDEN_META_WHOLE_PAGE_SHARE of everything the translation
 * says and number at least HIDDEN_META_MIN_WORDS.
 *
 * It reads only the translation, so every writer can ask it — a batch collector has no source
 * text in hand, which `unwrapHiddenTranslation` needs. Where that repair runs first (the door,
 * the realtime worker) this is what is left for the pages it declines: a short source, a
 * non-prose page type. TS twin: `hidesPageInMeta` in src/lib/translate-write.ts.
 */
export function hidesPageInMeta(tr) {
  const cm = continuityMeta(tr);
  if (!cm || cm.form !== 'text' || cm.words < HIDDEN_META_MIN_WORDS) return false;
  const hidden = readingLength(cm.payload), shown = readingLength(trProseOf(tr));
  return hidden / Math.max(1, hidden + shown) >= HIDDEN_META_WHOLE_PAGE_SHARE;
}
