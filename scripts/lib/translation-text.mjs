/**
 * The notes layer's storage (#5942, roadmap step 2): a page's translation as the book's words
 * (`translation.text`) beside the raw model output (`translation.data`, never rewritten), and the
 * model's notes and the page's marks as a `page_annotations` document, one per page and source.
 *
 * PRIOR ART: scripts/lib/annotation-layer.mjs (PR #7319) is the parser and is called, not restated;
 * this module only stores and reads what it returns. src/lib/translation-layers.ts (#5958) splits
 * translations for the reader at render time and stores nothing. scripts/lib/write-provenance.mjs
 * `contentHash` is the hash `translation.content_hash` already carries, so `text_from.data_hash` is
 * the same 16-hex value and can be compared with it. TS twin: src/lib/translation-text.ts.
 *
 * The one rule (decided 2026-10-10, #5942): `translation.text` is served ONLY when
 * `translation.text_from.data_hash` is the hash of the `translation.data` beside it. Anything else —
 * no text, no text_from, a writer that set `translation.data` and forgot the new fields, a human edit,
 * a correction lane — falls back to parsing `data` live. A writer that forgets can cost a parse; it
 * can never serve stale words. Read through `getTranslationText`, never `page.translation.text`.
 *
 * Stored shape:
 *   pages.translation.text       string, the parser's `text` (no tag of the closed vocabulary)
 *   pages.translation.text_from  { source: 'parser' | 'model', parser_version, data_hash, annotations }
 *                                annotations = how many the page_annotations doc holds (0: no doc written)
 *   page_annotations             { page_id, book_id, source, run_id, anchor_kind, data_hash, annotations[], created_at }
 *                                unique on (page_id, source, run_id, data_hash). A doc whose data_hash is
 *                                not the page's current hash describes an older text and is not served.
 *
 * KEEP THE READS (Derek, 2026-10-28, #5942): a page_annotations doc is never overwritten or deleted by a
 * writer, a backfill or a re-run. Each write INSERTS a doc keyed by its own run id; a key that already
 * exists is left exactly as it is (`$setOnInsert`). The reader picks the current doc by data_hash. Only an
 * undo removes docs, and only the ones carrying its own run id. `translation.data` is never rewritten.
 */

import { splitAnnotations, renderMarkup, resolveAnchor, spanAnchor } from './annotation-layer.mjs';
import { contentHash } from './write-provenance.mjs';

/** Bump when annotation-layer.mjs changes what `text` or the annotations are for the same input. */
// /2 (2026-10-28): a <gloss> closing a <term> from inside is a definition; a bare leading number is not list numbering.
// /3 (2026-10-29): the legacy syntaxes the reader hides — every [[label: …]], bracketed image paragraphs, plain
//    "Summary:" lines, preambles, fences, label headings, free-text vocabulary sections — leave `text`; single-bracket
//    interpolations stay in `text` under an 'interp' mark span.
export const PARSER_VERSION = 'annotation-layer/3';
export const ANNOTATIONS_COLLECTION = 'page_annotations';

/** The annotation source of an inline (tags-in-the-translation) page: `inline-v<prompt_version>`. */
export function inlineSource(promptVersion) {
  const v = promptVersion == null ? '' : String(promptVersion).trim().replace(/^v/i, ''); // some writers store 'v13'
  return `inline-v${v || 'unknown'}`;
}

/** The fields kept per annotation: the anchor flattened, plus what renderMarkup needs to rebuild it. */
const KEEP = ['kind', 'tag', 'attrs', 'malformed', 'scope', 'attach', 'gap', 'glossary', 'term', 'suspect', 'printed'];
function storedAnnotation(a) {
  const out = { type: a.type };
  if (a.anchor) {
    out.exact = a.anchor.exact;
    out.prefix = a.anchor.prefix;
    out.suffix = a.anchor.suffix;
    out.start = a.anchor.start;
    out.end = a.anchor.end;
  }
  out.body = a.body ?? null;
  for (const k of KEEP) if (a[k] !== undefined && a[k] !== null && a[k] !== false) out[k] = a[k];
  return out;
}

/** Back to the parser's shape (anchor nested), so renderMarkup / resolveAnchor take a stored doc. */
export function parserAnnotation(s) {
  const { exact, prefix, suffix, start, end, ...rest } = s;
  return { ...rest, anchor: exact === undefined ? null : { exact, prefix, suffix, start, end } };
}

/**
 * Parse one stored translation into what is written beside it.
 * @param {string} data translation.data as it will be (or is) stored
 * @param {{ promptVersion?: string|number|null, source?: string, ocr?: string|null }} [opts]
 *   ocr: the page's transcription, when the caller has it: flags interpolations whose brackets the source prints.
 * @returns {{ text: string, text_from: object, annotations: object[], source: string, data_hash: string }}
 */
export function translationLayers(data, { promptVersion = null, source, ocr = null } = {}) {
  const raw = String(data ?? '');
  const data_hash = contentHash(raw);
  const src = source || inlineSource(promptVersion);
  const split = splitAnnotations(raw, { source: src, ocr });
  const annotations = split.annotations.map(({ source: _s, ...a }) => storedAnnotation(a));
  return {
    text: split.text,
    text_from: { source: 'parser', parser_version: PARSER_VERSION, data_hash, annotations: annotations.length },
    annotations,
    source: src,
    data_hash,
  };
}

/** True when the stored `translation.text` was made from the `translation.data` beside it. */
export function translationTextIsCurrent(translation) {
  if (!translation || typeof translation.text !== 'string' || typeof translation.data !== 'string') return false;
  const h = translation.text_from?.data_hash;
  return typeof h === 'string' && h === contentHash(translation.data);
}

/**
 * The book's words of a page's translation. `translation.text` when its `text_from.data_hash`
 * matches the current `translation.data`; otherwise `data` parsed live. '' when there is none.
 * Projection a caller needs: `translation.data`, `translation.text`, `translation.text_from`.
 */
export function getTranslationText(page) {
  const t = page?.translation;
  if (!t || typeof t.data !== 'string' || !t.data) return '';
  if (translationTextIsCurrent(t)) return t.text;
  return splitAnnotations(t.data).text;
}

/**
 * The markup the reader renders from the layer (#7965): `text` with the stored annotations put back
 * inline by renderMarkup, so the reader's one renderer (NotesRenderer) draws every annotation type the
 * parser emits, notes on and off, with the treatment it already has.
 *
 * Rules the reader needs that renderMarkup (a faithful rebuild) does not apply, each found on the #7965 gate:
 *   - a MALFORMED annotation (an unclosed tag, a stray close tag) is not put back. In `text` the words after
 *     an unclosed tag are book words already; re-emitting the lone open tag makes the renderer read the rest
 *     of the page as inside it, and a note there then shows as the book's words with notes off.
 *   - a note never lands INSIDE a mark. The renderer flattens a `<note>` nested in a `<margin>`/`<insert>` into
 *     plain words (notes on and off), so a mark that spans a note's place is split around it:
 *     `<insert>a</insert> <note>…</note><insert> b</insert>`.
 *   - a definition of a term (no stored `gap`) whose term is followed by one space and then a space or a
 *     markdown closer (`*`, `_`) goes after that space, as the model wrote it: `**<term>Iyatē</term> <gloss>he
 *     goes</gloss>**`, not `… </gloss> **`, which breaks the bold. A note placed after a space and straight before
 *     a word gets a space after it (`trail`): the parser folds one of the two spaces around a note into its cut.
 *   - an EMPTY mark (`<margin></margin>`, or a margin that only held a note) is left out: rebuilt, its close
 *     sorts before its open and the renderer reads the rest of the page as inside it.
 *   - a note with nothing but space after it in `text` (footnotes, an apparatus at the foot of the page) gets its
 *     own paragraph again (`para`), as it stood; inline, the renderer reads "LA, <note>1) See pp. …" differently.
 *   - any ORPHAN (an anchor that does not resolve in `text`) returns null: the caller serves today's path.
 *     A doc carrying the current hash should never orphan; if it does, the layer disagrees with itself.
 *     So does a result whose inline tags do not nest (inlineTagsNest).
 * @param {string} text translation.text (current: its text_from.data_hash is the hash of data)
 * @param {object[]} stored the page_annotations doc's `annotations` (flat anchors)
 * @returns {string|null}
 */
export function layerMarkup(text, stored) {
  if (typeof text !== 'string' || !Array.isArray(stored)) return null;
  const anns = stored.filter((a) => a && !a.malformed).map(parserAnnotation);
  // Where each anchored note goes (renderMarkup's rule), after the term-gap rule above.
  const cuts = [];
  for (const a of anns) {
    if (a.kind === 'mark' || a.scope === 'page' || a.glossary || a.type === 'interp' || !a.anchor) continue;
    const r = resolveAnchor(text, a.anchor);
    if (!r) return null;
    if (!a.gap && r.end > r.start && text[r.end] === ' ' && /^(?: |[*_]+(?:[\s.,;:!?)\]]|$))/.test(text.slice(r.end + 1))) a.gap = ' ';
    const at = a.gap && text.startsWith(a.gap, r.end) ? r.end + a.gap.length : r.end;
    // Placed after a space and straight before a word: the space the parser folded into the cut comes back after it.
    if (at > 0 && /[ \t]/.test(text[at - 1]) && /[\p{L}\p{N}]/u.test(text[at] ?? '')) a.trail = true;
    // Nothing but space after it: a note the page ends on (footnotes, an apparatus) stood in its own paragraph.
    if (!text.slice(at).trim()) a.para = true;
    cuts.push(at);
  }
  const out = [];
  for (const a of anns) {
    if (a.kind !== 'mark' || !a.anchor) { out.push(a); continue; }
    const r = resolveAnchor(text, a.anchor);
    if (!r) return null;
    if (r.end <= r.start) continue; // an empty mark has no words; put back, its close sorts before its open
    const inner = [...new Set(cuts.filter((c) => c > r.start && c < r.end))].sort((x, y) => x - y);
    if (!inner.length) { out.push(a); continue; }
    // Each piece keeps its words only: the spaces at a cut stay outside the tags, where the renderer keeps them.
    let s = r.start;
    for (const e of [...inner, r.end]) {
      let ps = s, pe = e;
      while (ps < pe && /\s/.test(text[ps])) ps++;
      while (pe > ps && /\s/.test(text[pe - 1])) pe--;
      if (pe > ps) out.push({ ...a, anchor: spanAnchor(text, ps, pe) });
      s = e;
    }
  }
  const { markup, orphans } = renderMarkup(text, out);
  return orphans.length || !inlineTagsNest(markup) ? null : markup;
}

/**
 * True when every inline tag of the closed vocabulary in `markup` closes in order. A body that itself holds tag
 * text (a garbled page: `<gloss>a paste</term>`) can make a rebuilt page cross; the reader then takes today's path.
 * 1 page in 4,983 on the #7965 scan.
 */
function inlineTagsNest(markup) {
  const stack = [];
  for (const m of markup.matchAll(/<(\/?)(note|image-desc|margin|gloss|insert|unclear|term)(?:\s[^<>]*)?>/gi)) {
    const name = m[2].toLowerCase();
    if (!m[1]) stack.push(name);
    else if (stack.pop() !== name) return false;
  }
  return stack.length === 0;
}

/** The run id a translation writer stamps when its caller has no job id: one doc per text. */
export const WRITE_RUN_ID = 'write';

/** The page_annotations document for one parse, or null when there is nothing to store. */
export function annotationsDoc({ page_id, book_id, layers, run_id = WRITE_RUN_ID, anchor_kind = 'inferred', created_at = new Date() }) {
  if (!layers?.annotations?.length) return null;
  return { page_id, book_id: book_id ?? null, source: layers.source, run_id: String(run_id || WRITE_RUN_ID), anchor_kind, data_hash: layers.data_hash, annotations: layers.annotations, created_at };
}

/** The unique key of a page_annotations doc. */
export const annotationsKey = (doc) => ({ page_id: doc.page_id, source: doc.source, run_id: doc.run_id, data_hash: doc.data_hash });

/**
 * A bulkWrite op that INSERTS one page_annotations doc and never touches an existing one: an upsert
 * whose only operator is $setOnInsert, so a doc already under this key is left byte for byte.
 */
export function annotationsInsertOp(doc) {
  return { updateOne: { filter: annotationsKey(doc), update: { $setOnInsert: doc }, upsert: true } };
}

/**
 * Store the annotations for pages just written. Never throws: a failed annotations write leaves
 * text_from.annotations > 0 with no current doc, which a reader treats as "re-parse data" — the
 * same fallback as a writer that never stored the layer.
 * @param {import('mongodb').Db} db
 * @param {Array<{ page_id: string, book_id?: string|null, run_id?: string|null, layers: ReturnType<typeof translationLayers> }>} items
 */
export async function writePageAnnotations(db, items) {
  const ops = [];
  for (const it of items) {
    const doc = annotationsDoc(it);
    if (doc) ops.push(annotationsInsertOp(doc));
  }
  if (!ops.length) return { written: 0 };
  try {
    await db.collection(ANNOTATIONS_COLLECTION).bulkWrite(ops, { ordered: false });
    return { written: ops.length };
  } catch (e) {
    console.warn(`[translation-text] page_annotations write failed (${ops.length} docs): ${e?.message || e}`);
    return { written: 0, error: String(e?.message || e) };
  }
}

/**
 * The annotations of a page's CURRENT translation: the newest doc for `source` whose data_hash
 * matches, or a live parse when there is none. Projection: translation.{data,prompt_version}.
 */
export async function getPageAnnotations(db, page, { source } = {}) {
  const t = page?.translation;
  if (!t || typeof t.data !== 'string' || !t.data) return [];
  const src = source || inlineSource(t.prompt_version);
  if (!source && translationTextIsCurrent(t) && t.text_from.annotations === 0) return [];
  const h = contentHash(t.data);
  const doc = await db.collection(ANNOTATIONS_COLLECTION).findOne({ page_id: page.id, source: src, data_hash: h }, { sort: { created_at: -1 } });
  if (doc) return doc.annotations;
  return translationLayers(t.data, { promptVersion: t.prompt_version, source: src }).annotations;
}
