'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { BOOK, CREDIT, PAPER } from './HeroBackdrop';

// The /articles marbled paper behind a section further down a page (the
// homepage Articles section). Faded at the top and bottom, and drifting
// slightly slower than the page while the section is on screen.

const PARALLAX = 0.15;
const OVERSCAN = 160;

export default function MarbledBackdrop() {
  const box = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = box.current?.getBoundingClientRect();
        if (!rect || !layer.current) return;
        // 0 when the section's centre is mid-screen, clamped so the edge never shows.
        const offset = (window.innerHeight / 2 - (rect.top + rect.height / 2)) * PARALLAX;
        const y = Math.max(-OVERSCAN, Math.min(OVERSCAN, offset));
        layer.current.style.transform = `translate3d(0, ${y}px, 0)`;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <div
        ref={box}
        className="absolute inset-0 overflow-hidden pointer-events-none"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent, black 25%, black 70%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 25%, black 70%, transparent)',
        }}
      >
        <div
          ref={layer}
          className="absolute inset-x-0 bg-cover bg-center opacity-[0.2] mix-blend-multiply will-change-transform"
          style={{ top: -OVERSCAN, bottom: -OVERSCAN, backgroundImage: `url(${PAPER})` }}
        />
      </div>
      <div className="absolute inset-x-0 bottom-4 hidden md:block">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 flex justify-end">
          <Link href={BOOK} className="relative z-10 text-xs text-muted hover:text-secondary transition-colors">
            {CREDIT}
          </Link>
        </div>
      </div>
    </>
  );
}
