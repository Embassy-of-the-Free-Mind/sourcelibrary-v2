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
 * on /articles. Fills its positioned parent; off for reduced motion. Served
 * through the image optimiser at screen width when the host allows it (heroes
 * are often full page scans of several megabytes). `placeholder` is a tiny
 * blurred copy (src/generated/article-hero-placeholders.json) shown at once
 * while a cold optimiser request, about a second, is still encoding.
 *
 * Quality 60: the hero sits under a dark gradient and the title, so the
 * difference from 75 doesn't show, and the file is about a third smaller.
 */
export default function ParallaxImage({ src, alt, placeholder }: { src: string; alt: string; placeholder?: string }) {
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

  const className = 'absolute inset-x-0 w-full object-cover will-change-transform';
  const style = { top: -OVERSCAN, height: `calc(100% + ${OVERSCAN * 2}px)` };

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
        {...(placeholder ? { placeholder: 'blur' as const, blurDataURL: placeholder } : {})}
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
      style={placeholder ? { ...style, backgroundImage: `url(${placeholder})`, backgroundSize: 'cover' } : style}
    />
  );
}
