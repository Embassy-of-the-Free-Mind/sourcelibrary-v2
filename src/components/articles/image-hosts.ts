// Hosts next.config.ts lets the image optimiser fetch from (images.remotePatterns),
// for the ones articles use. Anything else falls back to a plain <img>. Kept apart
// from ArticleImage so client components (ParallaxImage) can import it without
// pulling in the generated picture sizes.
const OPTIMISABLE = [
  'images.sourcelibrary.org',
  'upload.wikimedia.org',
  'iiif.wellcomecollection.org',
  'iiif.archive.org',
  'archive.org',
  'gallica.bnf.fr',
  'iiif.bodleian.ox.ac.uk',
  'www.e-codices.unifr.ch',
  'images.eap.bl.uk',
];

export function optimisable(src: string): boolean {
  // A local file, yes; a local address with a query (/api/crop-image?...) no:
  // next/image refuses those without an images.localPatterns entry.
  if (src.startsWith('/')) return !src.includes('?');
  try {
    return OPTIMISABLE.includes(new URL(src).hostname);
  } catch {
    return false;
  }
}

/**
 * The optimiser's address for a picture shown with a plain <img> (thumbnail
 * grids and fixed-height crops, where next/image would change the layout):
 * the same picture as AVIF or WebP, `width` pixels wide, instead of the
 * original scan. `width` must be one of next.config.ts deviceSizes/imageSizes.
 * Sources the optimiser can't fetch are returned unchanged.
 */
export function optimisedSrc(src: string, width: 640 | 828 | 1200 = 828): string {
  return optimisable(src) ? `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=75` : src;
}
