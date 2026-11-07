/**
 * The reader on the notes layer (#7965, step 1 of the PLAIN switch).
 *
 * When a page carries a current `translation.text` (its `text_from.data_hash` is the hash of the stored
 * `translation.data`) AND a `page_annotations` doc for that same hash, the reader renders the layer: the
 * text with the newest such doc's annotations put back inline (`layerMarkup`), drawn by the one renderer
 * the reader already has (NotesRenderer), notes on and off. Otherwise the page is served exactly as
 * before: the stored `data`, parsed at render time. Nothing here writes.
 *
 * Why now: a page translated under the note-free prompt (PLAIN, #7499) stores plain words in `data`, and
 * its notes arrive as a `page_annotations` doc of their own (`source: notes-step/<v>`). Only a reader that
 * reads the layer shows them.
 *
 * The payload: the composed markup goes out IN PLACE of `translation.data` (same size class; `text` and
 * `text_from` never leave the server, #7665), plus `translation.layer = { source, run_id }` so an editor
 * knows to load the stored `data` before editing (`/api/pages/[id]?full=true`, unchanged). Applied last,
 * after the English-original swap and the metered gate: a page whose `data` was swapped or stripped no
 * longer hashes to the layer's text, so it is left as it is.
 *
 * Which doc: the newest (`created_at`) whose `data_hash` is the current text's, of any source — the
 * #7664 rule ("keep the reads"; getPageAnnotations reads the same way within one source).
 *
 * PRIOR ART: scripts/lib/translation-text.mjs `getPageAnnotations` reads one page's doc for one source and,
 * with none, parses `data` live; the reader needs a batch read across sources and today's path (not a live
 * parse) when there is no doc, so it cannot be reused as is. `getTranslationText` (#7652) is the one
 * accessor for the text and is called, not restated. src/lib/reader-page-projection.ts `withoutTextLayer`
 * still strips `text`/`text_from`; this module runs beside it.
 */
import { ANNOTATIONS_COLLECTION, getTranslationText, layerMarkup, translationTextIsCurrent, type TranslationWithText } from './translation-text';
import { contentHash } from './write-provenance';
import { withoutTextLayer } from './reader-page-projection';

export interface ReaderTextLayer {
  data_hash: string;
  markup: string;
  source: string;
  run_id: string;
}

interface LayerPage { id?: unknown; translation?: (TranslationWithText & Record<string, unknown>) | null }

/** Minimal Mongo surface, so the module needs no driver import (and tests can pass a stub). */
interface AnnotationsReader {
  collection(name: string): {
    find(filter: Record<string, unknown>, options?: Record<string, unknown>): {
      sort(s: Record<string, 1 | -1>): { maxTimeMS(ms: number): { toArray(): Promise<unknown[]> } };
    };
  };
}

interface AnnotationsDoc { page_id: string; data_hash: string; source: string; run_id: string; annotations: object[] }

/**
 * The layer of each page that has one, keyed by page id. Fetch the pages WITH `translation.text` and
 * `translation.text_from` (strip them afterwards with withoutTextLayer). One indexed read for the batch,
 * none when no page has a current text. Never throws: on a read failure every page takes today's path.
 */
export async function loadReaderTextLayers(db: AnnotationsReader, fetched: ReadonlyArray<object | null | undefined>): Promise<Map<string, ReaderTextLayer>> {
  const pages = fetched as ReadonlyArray<LayerPage | null | undefined>;
  const out = new Map<string, ReaderTextLayer>();
  const current = new Map<string, { page: LayerPage; hash: string }>();
  for (const p of pages) {
    if (!p || typeof p.id !== 'string' || !translationTextIsCurrent(p.translation)) continue;
    current.set(p.id, { page: p, hash: p.translation!.text_from!.data_hash });
  }
  if (!current.size) return out;
  let docs: AnnotationsDoc[];
  try {
    docs = (await db.collection(ANNOTATIONS_COLLECTION)
      .find(
        { page_id: { $in: [...current.keys()] }, data_hash: { $in: [...new Set([...current.values()].map((c) => c.hash))] } },
        { projection: { _id: 0, page_id: 1, data_hash: 1, source: 1, run_id: 1, annotations: 1 } },
      )
      .sort({ created_at: -1 })
      .maxTimeMS(3000)
      .toArray()) as AnnotationsDoc[];
  } catch (e) {
    console.warn(`[reader-text-layer] page_annotations read failed, serving today's path: ${(e as Error)?.message || e}`);
    return out;
  }
  const decided = new Set<string>(); // newest first: the first doc of the current hash decides, never an older one
  for (const d of docs) {
    const c = current.get(d.page_id);
    if (!c || decided.has(d.page_id) || d.data_hash !== c.hash) continue;
    decided.add(d.page_id);
    const markup = layerMarkup(getTranslationText(c.page), d.annotations);
    if (markup === null) {
      console.warn(`[reader-text-layer] ${d.page_id}: annotations do not resolve in the text, serving today's path`);
      continue;
    }
    out.set(d.page_id, { data_hash: d.data_hash, markup, source: d.source, run_id: String(d.run_id) });
  }
  return out;
}

/**
 * Serve one page from its layer: `translation.data` becomes the composed markup and `translation.layer`
 * names the doc. A page with no layer, or whose `data` no longer hashes to the layer's text (withheld,
 * gated, an English original's transcription), is returned as it is.
 */
export function applyReaderTextLayer<T>(page: T, layers: Map<string, ReaderTextLayer>): T {
  const p = page as unknown as LayerPage | null;
  if (!p || typeof p.id !== 'string') return page;
  const layer = layers.get(p.id);
  const data = p.translation?.data;
  if (!layer || typeof data !== 'string' || !data || contentHash(data) !== layer.data_hash) return page;
  return { ...(page as object), translation: { ...p.translation, data: layer.markup, layer: { source: layer.source, run_id: layer.run_id } } } as T;
}

/**
 * For the `/api/pages/*` doors, which fetch with PAGE_API_LAYER_PROJECTION: read the layers, then strip
 * `translation.text` / `text_from` from every page (withoutTextLayer), so the two fields cannot reach a
 * response through a door that forgot. Apply the layers last with applyReaderTextLayer.
 */
export async function takeReaderTextLayers<T>(db: AnnotationsReader, pages: T[]): Promise<{ pages: T[]; layers: Map<string, ReaderTextLayer> }> {
  const layers = await loadReaderTextLayers(db, pages as unknown as object[]);
  return { pages: pages.map((p) => withoutTextLayer(p)), layers };
}
