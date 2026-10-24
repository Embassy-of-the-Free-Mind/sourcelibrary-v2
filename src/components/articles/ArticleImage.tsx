import FadeInImage from './FadeInImage';
import { optimisable } from './image-hosts';
import pictureSizes from '@/generated/article-image-sizes.json';

export { optimisable };

// Each article picture's pixel size and a tiny blurred copy, keyed by src
// (scripts/maintenance/generate-article-image-sizes.mjs). Read here, on the
// server, so it never ships in a browser bundle.
const SIZES = pictureSizes as Record<string, { w: number; h: number; blur?: string }>;

/**
 * A picture in an article (.claude/docs/article-rules.md, "Pictures"): served
 * through the image optimiser at the width it is shown, as AVIF or WebP,
 * lazy-loaded, at its own proportions. Page scans are often 3,000 to 7,000
 * pixels tall and several megabytes; this is what keeps an article with twenty
 * of them light. `sizes` is the widest it can be on the page; "auto" lets
 * browsers that support it (Chrome, Edge) use the width it is actually drawn at,
 * so a page held to a reading width doesn't download at full column width.
 *
 * The optimiser hands back the untouched original for sources over about 60
 * megapixels: bring those into public/articles/<slug>/ at 2,000 px instead.
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
  const known = SIZES[src];
  // "auto" only with a known size: Chrome draws a lazy sizes=auto image without
  // width and height in a fixed 300x150 box (contain: size), squashing a page scan.
  return (
    <FadeInImage
      src={src}
      alt={alt}
      sizes={priority || !known ? sizes : `auto, ${sizes}`}
      priority={priority}
      width={known?.w}
      height={known?.h}
      blur={known?.blur}
      optimise={optimisable(src)}
    />
  );
}
