'use client';

import { useRef, useEffect, useState } from 'react';

export interface Framing { x: number; y: number; scale: number }

/** Live framing updates from the admin editor, by slot — avoids a server refresh. */
export const framingEvent = (slot: string) => `framing:${slot}`;

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
  src, srcMobile, mobileBreakpoint = 768,
  alt = '', className = '', strength = 0.12, loading = 'lazy',
  oversize = 0.15, objectPosition = 'center', framing, frameSlot,
}: {
  src: string;
  /** Narrow-viewport variant, served below `mobileBreakpoint` via <picture>.
   *  A phone hero is a portrait box, so a landscape source is cover-cropped to a
   *  sliver of its width; pass a portrait sheet here instead. */
  srcMobile?: string;
  /** Width (px) below which `srcMobile` is used. */
  mobileBreakpoint?: number;
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

  // Framing lives in state so admin edits (dispatched as events) survive parent
  // re-renders (e.g. the quote band re-rendering every cycle) without a server refresh.
  const [frame, setFrame] = useState<Framing | undefined>(framing ?? undefined);
  useEffect(() => { setFrame(framing ?? undefined); }, [framing]);
  useEffect(() => {
    if (!frameSlot) return;
    const h = (e: Event) => setFrame((e as CustomEvent<Framing>).detail);
    window.addEventListener(framingEvent(frameSlot), h as EventListener);
    return () => window.removeEventListener(framingEvent(frameSlot), h as EventListener);
  }, [frameSlot]);

  useEffect(() => {
    const el = wrapRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    // No parallax on phones: a ~470px hero shifts by a few pixels, which nobody
    // sees, while the oversized box and the rAF cost are paid in full.
    if (typeof window !== 'undefined' && window.matchMedia?.(`(max-width: ${mobileBreakpoint - 1}px)`).matches) {
      el.style.transform = 'none';
      return;
    }

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
  }, [strength, mobileBreakpoint]);

  const op = frame ? `${frame.x}% ${frame.y}%` : objectPosition;
  const scale = frame?.scale ?? 1;

  return (
    <div ref={wrapRef} className="absolute inset-x-0" style={{ willChange: 'transform', top: `${-oversize * 100}%`, height: `${100 + oversize * 200}%` }}>
      <picture className="block w-full h-full">
        {srcMobile && <source media={`(max-width: ${mobileBreakpoint - 1}px)`} srcSet={srcMobile} />}
        <img
          data-frame-slot={frameSlot}
          src={src}
          alt={alt}
          loading={loading}
          className={`w-full h-full object-cover ${className}`}
          style={{ objectPosition: op, transformOrigin: op, transform: `scale(${scale})` }}
        />
      </picture>
    </div>
  );
}
