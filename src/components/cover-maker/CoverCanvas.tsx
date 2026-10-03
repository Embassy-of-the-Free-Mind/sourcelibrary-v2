'use client';

import { useEffect, useRef } from 'react';
import { renderCover, type ImageMap } from './render';
import { H, W, type Cover } from './types';

/**
 * A rendered cover at a given CSS width. Used for the main board (with an
 * overlay on top, supplied by the parent) and for the small starter and
 * design thumbnails.
 */
export function CoverCanvas({
  cover, width, images, tick, fontsReady, className,
}: {
  cover: Cover;
  width: number;
  images: ImageMap;
  tick: number;
  fontsReady: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || width <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = (width * dpr) / W;
    c.width = Math.round(W * s);
    c.height = Math.round(H * s);
    const id = requestAnimationFrame(() => renderCover(c.getContext('2d')!, cover, s, images));
    return () => cancelAnimationFrame(id);
  }, [cover, width, images, tick, fontsReady]);
  return <canvas ref={ref} className={className} style={{ width, height: (width * H) / W, display: 'block' }} />;
}
