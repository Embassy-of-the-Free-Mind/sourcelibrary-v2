/**
 * The IIIF identifiers a client needs to get from a gallery record to its canvas.
 *
 * PRIOR ART: src/app/api/iiif/[id]/manifest/route.ts — the canvas id was built
 * inline there and again in the canvas and search routes; nothing outside them
 * could name a canvas, which is why no gallery record carried one (#4289). This
 * is the one definition all four now share, so a record cannot point at a canvas
 * id the manifest does not mint.
 */

export const IIIF_BASE = 'https://sourcelibrary.org';

export function iiifManifestUri(bookId: string): string {
  return `${IIIF_BASE}/api/iiif/${bookId}/manifest`;
}

export function iiifCanvasId(bookId: string, pageNumber: number | string): string {
  return `${IIIF_BASE}/api/iiif/${bookId}/canvas/p${pageNumber}`;
}

export interface IiifRefs {
  iiifManifest?: string;
  iiifCanvas?: string;
}

/**
 * Manifest + canvas for one gallery item.
 *
 * A plate sits on the canvas of its page. A standalone artwork has no `pages`
 * documents, and the manifest synthesises a single canvas numbered 1 for it, so
 * an artwork item (pageNumber 0) resolves there. Anything else without a page
 * (a book cover from the CLIP lane) gets the manifest alone: naming a canvas we
 * cannot place would be a guess.
 */
export function iiifRefsForGalleryItem(item: {
  bookId?: unknown;
  pageNumber?: unknown;
  source?: unknown;
}): IiifRefs {
  if (typeof item.bookId !== 'string' || !item.bookId) return {};
  const refs: IiifRefs = { iiifManifest: iiifManifestUri(item.bookId) };
  const page = Number(item.pageNumber);
  if (Number.isInteger(page) && page > 0) {
    refs.iiifCanvas = iiifCanvasId(item.bookId, page);
  } else if (item.source === 'artwork') {
    refs.iiifCanvas = iiifCanvasId(item.bookId, 1);
  }
  return refs;
}

/**
 * Add the refs to every item of a gallery response body. `enabled` is false on a
 * tenant-scoped request: these are apex URLs, and a partner subdomain does not
 * hand out links that leave it (tenant-lockdown.md, invariant 4).
 */
export function withIiifRefs<T extends { items?: unknown }>(body: T, enabled: boolean): T {
  if (!enabled || !Array.isArray(body.items)) return body;
  return {
    ...body,
    items: body.items.map((item) =>
      item && typeof item === 'object' ? { ...item, ...iiifRefsForGalleryItem(item) } : item,
    ),
  };
}
