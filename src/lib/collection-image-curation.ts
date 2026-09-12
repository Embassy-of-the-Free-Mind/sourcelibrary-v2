/**
 * Per-surface image curation for a collection.
 *
 * The hero collage and the gallery preview both pick images by quality score,
 * which is a decent default and a poor final answer: the top-scoring plate in a
 * general work is often a decorative frontispiece, and on a subject collection
 * the automatic pick can be off-topic entirely. This lets an editor pin an
 * order and hide individual images, per surface, without touching the books.
 *
 * Stored on the collection as:
 *   image_curation: { hero: { order: string[], hidden: string[] },
 *                     gallery: { order: string[], hidden: string[] } }
 *
 * Both lists hold gallery-image ids (`${page_id}-${detection_index}`), the same
 * identity the gallery routes already use. Anything not named in `order` keeps
 * its scored position behind everything that is, so curation is additive: pin
 * the few that matter and leave the rest alone.
 */
export type Surface = 'hero' | 'gallery';

export interface SurfaceCuration { order: string[]; hidden: string[] }
export interface ImageCuration { hero?: SurfaceCuration; gallery?: SurfaceCuration }

export const EMPTY_CURATION: SurfaceCuration = { order: [], hidden: [] };

/** The id an image is curated under. Mirrors the gallery route's convention. */
export function curationId(img: { page_id?: string; pageId?: string; detection_index?: number; detectionIndex?: number }): string {
  const page = img.page_id ?? img.pageId ?? '';
  const idx = img.detection_index ?? img.detectionIndex ?? 0;
  return `${page}-${idx}`;
}

export function surfaceCuration(collection: unknown, surface: Surface): SurfaceCuration {
  const c = (collection as { image_curation?: ImageCuration } | null)?.image_curation?.[surface];
  return { order: Array.isArray(c?.order) ? c!.order : [], hidden: Array.isArray(c?.hidden) ? c!.hidden : [] };
}

/**
 * Apply a curation to a scored list: drop hidden, lift pinned into their stored
 * order, keep everything else in the order it arrived.
 */
export function applyCuration<T>(items: T[], idOf: (item: T) => string, c: SurfaceCuration): T[] {
  const hidden = new Set(c.hidden);
  const kept = items.filter((i) => !hidden.has(idOf(i)));
  if (!c.order.length) return kept;
  const rank = new Map(c.order.map((id, i) => [id, i]));
  const pinned = kept.filter((i) => rank.has(idOf(i))).sort((a, b) => rank.get(idOf(a))! - rank.get(idOf(b))!);
  const rest = kept.filter((i) => !rank.has(idOf(i)));
  return [...pinned, ...rest];
}
