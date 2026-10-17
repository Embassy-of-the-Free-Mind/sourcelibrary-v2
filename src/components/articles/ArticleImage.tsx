import Image from 'next/image';

// Hosts next.config.ts lets the image optimiser fetch from (images.remotePatterns),
// for the ones articles use. Anything else falls back to a plain <img>.
const OPTIMISABLE = [
  'images.sourcelibrary.org',
  'upload.wikimedia.org',
  'iiif.wellcomecollection.org',
  'iiif.archive.org',
  'archive.org',
  'gallica.bnf.fr',
  'iiif.bodleian.ox.ac.uk',
  'www.e-codices.unifr.ch',
];

export function optimisable(src: string): boolean {
  if (src.startsWith('/')) return true;
  try {
    return OPTIMISABLE.includes(new URL(src).hostname);
  } catch {
    return false;
  }
}

/**
 * A picture in an article (.claude/docs/article-rules.md, "Pictures"): served
 * through the image optimiser at the width it is shown, as AVIF or WebP,
 * lazy-loaded, at its own proportions. Page scans are often 3,000 to 7,000
 * pixels tall and several megabytes; this is what keeps an article with twenty
 * of them light. `sizes` is the width it takes on the page.
 */
export default function ArticleImage({
  src,
  alt,
  sizes = '(max-width: 768px) 100vw, 920px',
  priority = false,
}: {
  src: string;
  alt: string;
  sizes?: string;
  priority?: boolean;
}) {
  if (!optimisable(src)) {
    /* eslint-disable-next-line @next/next/no-img-element */
    return <img src={src} alt={alt} loading={priority ? 'eager' : 'lazy'} className="w-full h-auto" />;
  }
  return (
    <Image
      src={src}
      alt={alt}
      width={0}
      height={0}
      sizes={sizes}
      quality={75}
      priority={priority}
      className="w-full h-auto"
      style={{ width: '100%', height: 'auto' }}
    />
  );
}
