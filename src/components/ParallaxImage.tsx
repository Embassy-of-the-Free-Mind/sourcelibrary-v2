'use client';

import { useRef, useEffect } from 'react';

export interface Framing { x: number; y: number; scale: number }

/**
 * Absolute background image with a subtle scroll parallax. Drop it inside a
 * `relative overflow-hidden` parent; the image is oversized so the transform
 * never reveals an edge. Animates only while on screen, rAF-throttled, disabled
 * under prefers-reduced-motion.
 *
 * The parallax translate lives on the WRAPPER; framing (object-position + zoom)
 * lives on the inner <img>. That separation lets the admin ImageFramingEditor
 * live-adjust the framing without fighting the parallax rAF. Pass `frameSlot`
 * to make the <img> targetable by the editor.
 */
export default function ParallaxImage({
  src, alt = '', className = '', strength = 0.12, loading = 'lazy',
  oversize = 0.15, objectPosition = 'center', framing, frameSlot,
}: {
  src: string;
  alt?: string;
  className?: string;
  strength?: number;
  loading?: 'lazy' | 'eager';
  /** Fraction the image is grown beyond the box (margin for the parallax shift).
   *  Keep strength <= oversize so the edge is never revealed. */
  oversize?: number;
  objectPosition?: string;
  /** Saved framing (object-position x/y in %, zoom scale). Overrides objectPosition. */
  framing?: Framing;
  /** Identifier so the admin editor can target this image's framing. */
  frameSlot?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    let visible = false;
    const update = () => {
      raf = 0;
      const rect = parent.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const prog = (rect.top + rect.height / 2 - vh / 2) / (vh / 2 + rect.height / 2);
      const shift = -Math.max(-1, Math.min(1, prog)) * strength * rect.height;
      el.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0)`;
    };
    const onScroll = () => { if (!raf && visible) raf = requestAnimationFrame(update); };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) { update(); window.addEventListener('scroll', onScroll, { passive: true }); }
      else { window.removeEventListener('scroll', onScroll); }
    }, { threshold: 0 });
    io.observe(parent);
    window.addEventListener('resize', onScroll, { passive: true });
    update();
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [strength]);

  const op = framing ? `${framing.x}% ${framing.y}%` : objectPosition;
  const scale = framing?.scale ?? 1;

  return (
    <div ref={wrapRef} className="absolute inset-x-0" style={{ willChange: 'transform', top: `${-oversize * 100}%`, height: `${100 + oversize * 200}%` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        data-frame-slot={frameSlot}
        src={src}
        alt={alt}
        loading={loading}
        className={`w-full h-full object-cover ${className}`}
        style={{ objectPosition: op, transformOrigin: op, transform: `scale(${scale})` }}
      />
    </div>
  );
}
