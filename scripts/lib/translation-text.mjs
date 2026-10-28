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
 *   page_annotations             { page_id, book_id, source, anchor_kind, data_hash, annotations[], created_at }
 *                                unique on (page_id, source); a doc whose data_hash is not the page's
 *                                current hash describes an older text and is not served.
 */

import { splitAnnotations } from './annotation-layer.mjs';
import { contentHash } from './write-provenance.mjs';

/** Bump when annotation-layer.mjs changes what `text` or the annotations are for the same input. */
export const PARSER_VERSION = 'annotation-layer/1';
export const ANNOTATIONS_COLLECTION = 'page_annotations';

/** The annotation source of an inline (tags-in-the-translation) page: `inline-v<prompt_version>`. */
export function inlineSource(promptVersion) {
  const v = promptVersion == null ? '' : String(promptVersion).trim().replace(/^v/i, ''); // some writers store 'v13'
  return `inline-v${v || 'unknown'}`;
}

/** The fields kept per annotation: the anchor flattened, plus what renderMarkup needs to rebuild it. */
const KEEP = ['kind', 'tag', 'attrs', 'malformed', 'scope', 'attach', 'gap', 'glossary', 'term', 'suspect'];
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
 * @param {{ promptVersion?: string|number|null, source?: string }} [opts]
 * @returns {{ text: string, text_from: object, annotations: object[], source: string, data_hash: string }}
 */
export function translationLayers(data, { promptVersion = null, source } = {}) {
  const raw = String(data ?? '');
  const data_hash = contentHash(raw);
  const src = source || inlineSource(promptVersion);
  const split = splitAnnotations(raw, { source: src });
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

/** The page_annotations document for one parse, or null when there is nothing to store. */
export function annotationsDoc({ page_id, book_id, layers, anchor_kind = 'inferred', created_at = new Date() }) {
  if (!layers?.annotations?.length) return null;
  return { page_id, book_id: book_id ?? null, source: layers.source, anchor_kind, data_hash: layers.data_hash, annotations: layers.annotations, created_at };
}

/** A bulkWrite op that stores (or replaces) one page_annotations doc, keyed by page and source. */
export function annotationsUpsertOp(doc) {
  return { replaceOne: { filter: { page_id: doc.page_id, source: doc.source }, replacement: doc, upsert: true } };
}

/**
 * Store the annotations for pages just written. Never throws: a failed annotations write leaves
 * text_from.annotations > 0 with no current doc, which a reader treats as "re-parse data" — the
 * same fallback as a writer that never stored the layer.
 * @param {import('mongodb').Db} db
 * @param {Array<{ page_id: string, book_id?: string|null, layers: ReturnType<typeof translationLayers> }>} items
 */
export async function writePageAnnotations(db, items) {
  const ops = [];
  for (const it of items) {
    const doc = annotationsDoc(it);
    if (doc) ops.push(annotationsUpsertOp(doc));
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
 * The annotations of a page's CURRENT translation: the doc for `source` whose data_hash matches,
 * or a live parse when there is none. Projection: translation.{data,prompt_version}.
 */
export async function getPageAnnotations(db, page, { source } = {}) {
  const t = page?.translation;
  if (!t || typeof t.data !== 'string' || !t.data) return [];
  const src = source || inlineSource(t.prompt_version);
  if (!source && translationTextIsCurrent(t) && t.text_from.annotations === 0) return [];
  const h = contentHash(t.data);
  const doc = await db.collection(ANNOTATIONS_COLLECTION).findOne({ page_id: page.id, source: src, data_hash: h });
  if (doc) return doc.annotations;
  return translationLayers(t.data, { promptVersion: t.prompt_version, source: src }).annotations;
}
