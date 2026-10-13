'use client';

import { useCallback, useState, type ComponentPropsWithoutRef, type CSSProperties, type ElementType, type SyntheticEvent } from 'react';
import { frameForImage, type PageFrame } from '@/lib/page-frame';
import { frameSourceScale, framedAspect, framedImageStyle, scaleSizes } from '@/lib/framed-image';

type FramedImgProps<C extends ElementType> = {
  /** A frame already matched to this image (`coverFrame` / `pageImageFrame`), or null. */
  frame: PageFrame | null;
  /**
   * How the framed page sits in its slot.
   *  - `page` (default): fills the slot when that trims no more than the page's
   *    own margin (PAGE_OVERFILL), otherwise the page is shown whole on the
   *    slot's background. A title page is taller than a 3:4 card; with the
   *    scanner bed gone it is narrower still, and filling the card would cut
   *    its first and last lines.
   *  - `cover`: always fills the slot. For slots already shaped like the page.
   *  - `contain`: always whole.
   */
  fit?: 'page' | 'cover' | 'contain';
  /** `'img'` (default) or `next/image`. */
  as?: C;
  /** Positions the clipping box; it must give it a definite size. Default fills a positioned parent. */
  wrapperClassName?: string;
  /** The size shown once loaded: the framed page's, or the image's when no frame applies. */
  onShownSize?: (width: number, height: number) => void;
} & Omit<ComponentPropsWithoutRef<C>, 'as'>;

/** `page` fit may overfill the slot by this much: 1.5% of the page at each of two edges, less than any margin. */
export const PAGE_OVERFILL = 1.03;

/**
 * An image shown cropped to its page frame (#5876, #6010): the scan's dark
 * scanner bed is clipped away with CSS, and the file is never rewritten.
 *
 * With no frame this renders the image element alone, with the props it was
 * given — nothing about an unframed image changes. With a frame, the image sits
 * inside a clipping box and is scaled and offset in percentages, so it works at
 * any slot size without measuring. When the pixels arrive and the image is not
 * the shape the frame was measured on (a different copy of the page), the frame
 * is dropped and the image is shown whole.
 */
export default function FramedImg<C extends ElementType = 'img'>({
  frame, fit = 'page', as, wrapperClassName = 'absolute inset-0', onShownSize, ...rest
}: FramedImgProps<C>) {
  const Img: ElementType = as ?? 'img';
  const props = rest as { src?: unknown; sizes?: unknown; fill?: unknown; style?: CSSProperties; onLoad?: (e: SyntheticEvent<HTMLImageElement>) => void };
  // Remembered per src: a fallback URL is another file and is judged afresh.
  const [refused, setRefused] = useState<unknown>(null);
  const applied = frame && refused !== props.src ? frame : null;

  const { onLoad, src } = props;
  const handleLoad = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: nw, naturalHeight: nh } = e.currentTarget;
    const ok = applied ? frameForImage(applied, nw, nh) : null;
    if (applied && !ok && nw && nh) setRefused(src);
    if (nw && nh) onShownSize?.(ok ? nw * ok.w : nw, ok ? nh * ok.h : nh);
    onLoad?.(e);
  }, [applied, onLoad, onShownSize, src]);

  if (!applied) return <Img {...rest} onLoad={handleLoad} />;

  return (
    <span
      className={wrapperClassName}
      style={{ display: 'block', overflow: 'hidden', containerType: 'size' }}
      data-framed=""
    >
      {/* Sized in globals.css (.framed-box): container units, with a plain
          full-width fallback for browsers that lack them. */}
      <span
        className={`framed-box framed-box-${fit}`}
        style={{ '--framed-a': framedAspect(applied), '--framed-over': PAGE_OVERFILL } as CSSProperties}
      >
        {/* The whole scan, placed so only the page shows. The image fills this
            span, so next/image's fill prop (which forbids style width/height)
            works unchanged. */}
        <span style={{ position: 'absolute', display: 'block', ...framedImageStyle(applied) }}>
          <Img
            {...rest}
            // A cropped page is drawn larger than its slot; ask next/image for a
            // source big enough to keep today's sharpness (#6010).
            {...(typeof props.sizes === 'string' ? { sizes: scaleSizes(props.sizes, frameSourceScale(applied)) } : {})}
            onLoad={handleLoad}
            style={props.fill
              ? { ...props.style, objectFit: 'fill' }
              : {
                ...props.style,
                position: 'absolute', left: 0, top: 0, right: 'auto', bottom: 'auto',
                width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', objectFit: 'fill',
              }}
          />
        </span>
      </span>
    </span>
  );
}
