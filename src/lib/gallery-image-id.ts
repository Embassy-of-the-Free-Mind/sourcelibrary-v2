/**
 * Viewer ids for `/gallery/image/<id>`: `<pageId>-<n>`, a 24-hex page id and a
 * detection index.
 *
 * PRIOR ART: getTrimmedPageId in src/app/book/[id]/page/[pageId]/page-data.ts
 * does the same for a reader page id. It is bound to a book id and a Mongo
 * lookup, and this id has a second part (the index) that decides where the
 * junk starts, so the rule is separate and pure.
 */

/**
 * The viewer id inside an id with pasted text stuck to its end, or null when
 * the id is clean or is not a viewer id at all.
 *
 * Chat assistants and social apps append to the link they hand out:
 * `…861e-0[reference:4]`, `…c8c6-0q` (Facebook, 2026-11-01), the same
 * percent-encoded (#102). The junk must start with a non-digit: a digit would
 * change which image the index names. The caller redirects only when the
 * trimmed id resolves.
 */
export function trimmedGalleryImageId(rawId: string): string | null {
  let id = rawId;
  try { id = decodeURIComponent(rawId); } catch { /* keep raw */ }
  const m = /^([0-9a-f]{24})[:-](\d{1,3})[^0-9]/i.exec(id);
  return m ? `${m[1].toLowerCase()}-${m[2]}` : null;
}
