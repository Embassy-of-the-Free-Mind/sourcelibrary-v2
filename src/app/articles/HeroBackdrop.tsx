'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

// The /articles hero: a marbled paper from a book in the collection, faint
// behind the title, drifting slightly slower than the page on scroll.
// PREVIEW: ?paper=1..3 picks the paper and ?tone=colour shows it in colour,
// so the options can be compared on the page. Keep one, delete the rest.

interface Paper {
  file: string;
  credit: string;
  href: string;
}

const PAPERS: Record<string, Paper> = {
  '1': {
    file: '/articles/hero/marbled-hall-box27.jpg',
    credit: 'Combed marbled paper, Manly P. Hall Collection, Box 27',
    href: '/book/manly-p-hall-collection-box-27-collection',
  },
  '2': {
    file: '/articles/hero/marbled-stone-caprichos.jpg',
    credit: 'Stone marbled endpaper, Los Caprichos (1799)',
    href: '/book/los-caprichos-ldut1824',
  },
  '3': {
    file: '/articles/hero/marbled-curl-piemont.jpg',
    credit: 'French curl marbled endpaper, Morland, History of the Evangelical Churches of Piemont (1658)',
    href: '/book/the-history-of-the-evangelical-churches-of-the-valleys-of-morland',
  },
};

// How much slower than the page the paper moves (0 = fixed to the page).
const PARALLAX = 0.3;
// The paper is drawn this much taller than the hero so the drift never shows an edge.
const OVERSCAN = 160;

export default function HeroBackdrop() {
  const [paper, setPaper] = useState('1');
  const [colour, setColour] = useState(false);
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pick = params.get('paper');
    if (pick && PAPERS[pick]) setPaper(pick);
    setColour(params.get('tone') === 'colour');
  }, []);

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

  const p = PAPERS[paper];

  return (
    <>
      <div
        className="absolute inset-x-0 top-0 h-[520px] overflow-hidden pointer-events-none"
        style={{ maskImage: 'linear-gradient(to bottom, black 45%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black 45%, transparent)' }}
      >
        <div
          ref={layer}
          className={`absolute inset-x-0 bg-cover bg-center mix-blend-multiply will-change-transform ${
            colour ? 'opacity-[0.2]' : 'opacity-[0.14] grayscale sepia'
          }`}
          style={{ top: -OVERSCAN, bottom: -OVERSCAN, backgroundImage: `url(${p.file})` }}
        />
      </div>
      <div className="absolute inset-x-0 top-4 hidden md:block">
        <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 flex justify-end">
          <Link href={p.href} className="relative z-10 text-xs text-muted hover:text-secondary transition-colors">
            {p.credit}
          </Link>
        </div>
      </div>
    </>
  );
}
