/**
 * Recover a IIIF Image API service from a stored page-image URL.
 *
 * PRIOR ART: src/app/api/iiif/[id]/manifest/route.ts — `extractImageService` lived
 * inline there; moved here unchanged so the Allmaps link (src/lib/allmaps.ts) and the
 * manifest share one definition instead of two regexes drifting apart.
 *
 * A canonical Image API request is `{service}/{region}/{size}/{rotation}/{quality}.{format}`,
 * so stripping those four trailing segments recovers the service base. Known hosts get
 * their exact API version/profile; an unrecognized but IIIF-shaped URL gets the most
 * widely supported default (viewers read info.json for the truth). Plain re-hosted
 * JPEGs (our R2 derivatives) don't match and correctly return null — we don't run an
 * Image API server over those.
 *
 * Internet Archive BookReader URLs (`archive.org/download/{id}/page/n{N}/…`) are
 * IIIF-shaped but are NOT an Image API service: `{base}/info.json` answers 404, or a
 * 302 to BookReaderImages.php that serves a JPEG (checked 2026-10-11). Declaring a
 * service there breaks Mirador/UV/Allmaps, so they return null and the image is
 * painted without one (#5079). IA's real service lives on iiif.archive.org and needs
 * the jp2 path, which the BookReader URL doesn't carry.
 */

export interface IiifImageService {
  id: string;
  type: string;
  profile: string;
}

// Known IIIF image hosts whose API version/profile we can state precisely.
// Anything else that is still IIIF-shaped falls through to a conservative default.
export const KNOWN_IIIF_HOSTS: Array<{ test: RegExp; type: string; profile: string }> = [
  { test: /iiif\.archive\.org\/image\/iiif\/3\//, type: 'ImageService3', profile: 'level2' },
  { test: /gallica\.bnf\.fr\/iiif\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' },
  { test: /api\.digitale-sammlungen\.de\/iiif\/image\/v2\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' },
  { test: /e-rara\.ch\/i3f\/v20\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level1.json' },
  { test: /iiif\.wellcomecollection\.org\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' },
  { test: /iiif\.bodleian\.ox\.ac\.uk\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' },
  { test: /tile\.loc\.gov\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' },
  { test: /digi\.vatlib\.it\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level1.json' },
  { test: /ids\.lib\.harvard\.edu\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' },
  { test: /images\.lib\.cam\.ac\.uk\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' },
];

// Hosts whose URLs look like Image API requests but have no info.json behind them.
export const NOT_AN_IMAGE_SERVICE = /^https?:\/\/(?:[\w-]+\.)*archive\.org\/download\//i;

export function extractImageService(url: string): IiifImageService | null {
  if (NOT_AN_IMAGE_SERVICE.test(url)) return null;
  const m = url.match(
    /^(https?:\/\/.+?)\/(full|square|\d+,\d+,\d+,\d+|pct:[\d.,]+)\/(max|full|\^?!?\d*,\d*|pct:[\d.]+)\/(!?-?\d+(?:\.\d+)?)\/(default|color|gray|bitonal)\.(jpg|jpeg|png|tif|tiff|gif|jp2|webp)$/i
  );
  if (!m) return null;
  const base = m[1];
  for (const host of KNOWN_IIIF_HOSTS) {
    if (host.test.test(base)) {
      return { id: base, type: host.type, profile: host.profile };
    }
  }
  // IIIF-shaped URL from an unrecognized host: declare the broadly compatible
  // v2/level1 and let the viewer confirm via info.json.
  return { id: base, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level1.json' };
}

/**
 * True when a IIIF Image service is API 3.0 — by its PATH (`/iiif/3/`, or the
 * DLCS `/iiif-img/v3/`) or by what the service object declares (`type:
 * ImageService3`, or an image/3 `@context`). dl.ndl.go.jp serves a v3-shaped
 * path but 500s on `max`, so it is never v3 here.
 * Twin: scripts/lib/iiif-utils.mjs `isIiifImageV3Service`.
 */
export function isIiifImageV3Service(serviceId: string, service?: unknown): boolean {
  if (!serviceId) return false;
  if (serviceId.includes('dl.ndl.go.jp')) return false;
  if (/\/iiif\/3\/|\/iiif-img\/v3\//.test(`${serviceId}/`)) return true;
  const s = Array.isArray(service) ? service[0] : service;
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  if (/ImageService3/.test(String(o.type || o['@type'] || ''))) return true;
  const ctx = ([] as unknown[]).concat(o['@context'] || []).join(' ');
  return /iiif\.io\/api\/image\/3/.test(ctx);
}

/**
 * The full-size image URL for a IIIF Image service id: `max` for a v3 service,
 * `full` otherwise. Manifest→page builders must use this instead of appending
 * `/full/full/0/default.jpg` — a v3 service (every Internet Archive manifest)
 * answers that with `400 Invalid size`, and 91,695 stored pages were minted
 * that way (#4655). Twin: scripts/lib/iiif-utils.mjs `iiifFullSizeUrl`.
 */
export function iiifFullSizeUrl(serviceId: string, service?: unknown): string {
  const size = isIiifImageV3Service(serviceId, service) ? 'max' : 'full';
  return `${serviceId}/full/${size}/0/default.jpg`;
}
