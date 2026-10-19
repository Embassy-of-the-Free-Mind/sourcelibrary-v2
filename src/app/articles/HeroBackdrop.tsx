'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';

// The /articles hero: a French curl marbled endpaper from Morland's History of
// the Evangelical Churches of the Valleys of Piemont (1658), faint behind the
// title and drifting slightly slower than the page on scroll.

const PAPER = '/articles/hero/marbled-curl-piemont.webp';
const CREDIT = 'French curl marbled endpaper, Morland, History of the Evangelical Churches of Piemont (1658)';
const BOOK = '/book/the-history-of-the-evangelical-churches-of-the-valleys-of-morland';

// How much slower than the page the paper moves (0 = fixed to the page).
const PARALLAX = 0.3;
// The paper is drawn this much taller than the hero so the drift never shows an edge.
const OVERSCAN = 160;

export default function HeroBackdrop() {
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = Math.min(window.scrollY, 700) * PARALLAX;
        if (layer.current) layer.current.style.transform = `translate3d(0, ${y}px, 0)`;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <div
        className="absolute inset-x-0 top-0 h-[520px] overflow-hidden pointer-events-none animate-fade-in-slow"
        style={{ maskImage: 'linear-gradient(to bottom, black 45%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black 45%, transparent)' }}
      >
        <div
          ref={layer}
          className="absolute inset-x-0 bg-cover bg-center opacity-[0.2] mix-blend-multiply will-change-transform"
          style={{ top: -OVERSCAN, bottom: -OVERSCAN, backgroundImage: `url(${PAPER})` }}
        />
      </div>
      <div className="absolute inset-x-0 top-4 hidden md:block">
        <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 flex justify-end">
          <Link href={BOOK} className="relative z-10 text-xs text-muted hover:text-secondary transition-colors">
            {CREDIT}
          </Link>
        </div>
      </div>
    </>
  );
}
