'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import { optimisable } from '@/components/articles/image-hosts';

// How much slower than the page the picture moves (0 = moves with the page).
const PARALLAX = 0.3;
// Drawn this much taller than its frame so the drift never shows an edge.
const OVERSCAN = 120;

/**
 * A hero picture that drifts slightly slower than the page as you scroll, as
 * on /articles. Fills its positioned parent; off for reduced motion.
 *
 * `srcset` is the hero made ahead of time as static AVIF files
 * (scripts/maintenance/generate-article-hero-files.mjs), served straight from
 * the CDN: the optimiser converts on first request, which kept the hero blank
 * for 0.5 to 2 s on a cold article. Without it, the picture goes through the
 * optimiser at screen width when the host allows it (heroes are often full
 * page scans of several megabytes). Quality 60 there: the hero sits under a
 * dark gradient and the title, so the difference from 75 doesn't show.
 *
 * The picture's own background is the hero's dark colour, so the frame is dark
 * rather than pale for the moment before it paints.
 */
export default function ParallaxImage({ src, alt, srcset }: { src: string; alt: string; srcset?: { src: string; w: number }[] }) {
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

  const className = 'absolute inset-x-0 w-full object-cover will-change-transform bg-[#2a1f17]';
  const style = { top: -OVERSCAN, height: `calc(100% + ${OVERSCAN * 2}px)` };

  if (srcset?.length) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        ref={img}
        src={srcset[0].src}
        srcSet={srcset.map((f) => `${f.src} ${f.w}w`).join(', ')}
        sizes="100vw"
        alt={alt}
        fetchPriority="high"
        decoding="async"
        className={className}
        style={style}
      />
    );
  }
  if (optimisable(src)) {
    return (
      <Image
        ref={img}
        src={src}
        alt={alt}
        width={0}
        height={0}
        sizes="100vw"
        quality={60}
        priority
        className={className}
        style={{ ...style, width: '100%' }}
      />
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      ref={img}
      src={src}
      alt={alt}
      fetchPriority="high"
      className={className}
      style={style}
    />
  );
}
