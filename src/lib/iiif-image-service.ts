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

export function extractImageService(url: string): IiifImageService | null {
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
