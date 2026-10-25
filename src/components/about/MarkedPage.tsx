'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * A page from a book in the library with words marked on it. When the figure
 * comes into view the marks sweep across one after another, like a
 * highlighter, and anything beside the page that is keyed to a mark lights up
 * with it; leaving the view resets them. Mark boxes are percentages of the
 * image, measured off the scans in public/about/.
 */

export type Mark = { x: number; y: number; w: number; h: number };

const HI = 'rgba(250, 204, 21, .42)';
const STEP_MS = 420;
const START_MS = 500;

export default function MarkedPage({
  src,
  w,
  h,
  alt,
  href,
  marks,
  aside,
  caption,
}: {
  src: string;
  w: number;
  h: number;
  alt: string;
  href: string;
  marks: Mark[];
  /** Rendered beside the page; gets how many marks are lit so far. */
  aside: (lit: number) => ReactNode;
  caption: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  const [lit, setLit] = useState(0);
  const still = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.45 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || still) return;
    const timers = marks.map((_, k) => setTimeout(() => setLit(k + 1), START_MS + k * STEP_MS));
    return () => {
      timers.forEach(clearTimeout);
      setLit(0);
    };
  }, [inView, still, marks]);

  const shown = still ? marks.length : lit;

  return (
    <figure ref={ref} className="mp grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-8 md:gap-14 items-center">
      <Link href={href} className="relative block max-w-[460px] w-full mx-auto md:mx-0 hover:opacity-95 transition-opacity">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} width={w} height={h} className="block w-full h-auto" loading="lazy" />
        {marks.map((m, k) => (
          <span
            key={k}
            aria-hidden="true"
            className="mp-mark absolute"
            style={{
              left: `${m.x}%`,
              top: `${m.y}%`,
              width: `${m.w}%`,
              height: `${m.h}%`,
              background: HI,
              transform: `scaleX(${k < shown ? 1 : 0})`,
            }}
          />
        ))}
      </Link>
      <figcaption>
        {aside(shown)}
        <p className="mt-6 text-sm text-muted leading-relaxed">{caption}</p>
      </figcaption>
      <style>{`
        .mp .mp-mark { mix-blend-mode: multiply; transform-origin: left center; transition: transform .5s cubic-bezier(.2,.7,.2,1); }
        @media (prefers-reduced-motion: reduce) { .mp .mp-mark { transition: none; } }
      `}</style>
    </figure>
  );
}
