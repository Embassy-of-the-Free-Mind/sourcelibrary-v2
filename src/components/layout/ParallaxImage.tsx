'use client';

import { useEffect, useRef } from 'react';

// How much slower than the page the picture moves (0 = moves with the page).
const PARALLAX = 0.3;
// Drawn this much taller than its frame so the drift never shows an edge.
const OVERSCAN = 120;

/**
 * A hero picture that drifts slightly slower than the page as you scroll, as
 * on /articles. Fills its positioned parent; off for reduced motion.
 */
export default function ParallaxImage({ src, alt }: { src: string; alt: string }) {
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = Math.min(window.scrollY, window.innerHeight) * PARALLAX;
        if (img.current) img.current.style.transform = `translate3d(0, ${y}px, 0)`;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      ref={img}
      src={src}
      alt={alt}
      fetchPriority="high"
      className="absolute inset-x-0 w-full object-cover will-change-transform"
      style={{ top: -OVERSCAN, height: `calc(100% + ${OVERSCAN * 2}px)` }}
    />
  );
}
