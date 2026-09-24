/**
 * Allmaps editor link for a map image (issue: "Allmaps integration", 2026-09-25).
 *
 * PRIOR ART: none — `git grep -i allmaps` over src/, scripts/, .claude/ and the issue
 * tracker returned nothing before this file.
 *
 * Allmaps (https://allmaps.org) georeferences IIIF maps and needs a IIIF **Image API
 * service** to pull tiles from. Our own manifest paints the provenance-marked R2
 * derivative, which has no image service (deliberate, #2651), so the editor is pointed
 * at the HOLDING INSTITUTION's IIIF resource instead:
 *
 *   1. the page's source image, when its URL is IIIF-shaped (Allard Pierson, Gallica,
 *      MDZ, e-rara, Wellcome, Bodleian, LOC…) → `{service}/info.json`;
 *   2. otherwise the book's source manifest — Internet Archive books get
 *      `https://iiif.archive.org/iiif/3/{ia}/manifest.json` (IA's per-page image ids
 *      embed the jp2 path, so the manifest is the reliable entry point), IIIF imports
 *      get the manifest they were imported from;
 *   3. otherwise null — nothing Allmaps can tile, so no button.
 *
 * Editor entry point and its query parameters (`url`, `manifest`, `image`, `path`) are
 * defined in apps/editor/src/lib/shared/params.ts of github.com/allmaps/allmaps.
 */

import { extractImageService } from '@/lib/iiif-image-service';

export const ALLMAPS_EDITOR = 'https://editor.allmaps.org/images';

export interface AllmapsSource {
  /** Candidate source image URLs for the page, best first (photo_original, photo…). */
  pageImageUrls: Array<string | null | undefined>;
  /** `books.ia_identifier` when the book came from the Internet Archive. */
  iaIdentifier?: string | null;
  /** `books.image_source.iiif_manifest` when the book was imported from a IIIF manifest. */
  iiifManifest?: string | null;
}

/** The IIIF resource Allmaps should open, or null when the page has none it can tile. */
export function allmapsTargetUrl(src: AllmapsSource): string | null {
  for (const url of src.pageImageUrls) {
    if (!url) continue;
    // archive.org/download/{id}/page/nN/… is IIIF-shaped but is the BookReader image
    // endpoint, not an Image API service: its info.json answers 404 (checked 2026-09-25).
    // The IA manifest below is the working entry for those books.
    if (/archive\.org\/download\//.test(url)) continue;
    const service = extractImageService(url);
    if (service) return `${service.id}/info.json`;
  }
  if (src.iaIdentifier) {
    return `https://iiif.archive.org/iiif/3/${encodeURIComponent(src.iaIdentifier)}/manifest.json`;
  }
  if (src.iiifManifest && /^https?:\/\//.test(src.iiifManifest)) return src.iiifManifest;
  return null;
}

/** Full Allmaps Editor URL for the page, or null. */
export function allmapsEditorUrl(src: AllmapsSource): string | null {
  const target = allmapsTargetUrl(src);
  return target ? `${ALLMAPS_EDITOR}?url=${encodeURIComponent(target)}` : null;
}
