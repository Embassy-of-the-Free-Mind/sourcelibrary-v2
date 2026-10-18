'use client';

import { useEffect, useRef } from 'react';
import { PAPER } from './HeroBackdrop';

// The /articles marbled paper behind a section further down a page (the
// homepage Articles section). Full strength from the top of the section, fading
// out so it ends halfway down the first card's picture; drifts
// slightly slower than the page while the section is on screen.

const PARALLAX = 0.15;
const OVERSCAN = 160;

export default function MarbledBackdrop() {
  const box = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);

  // Ends halfway down the first card picture in the section.
  useEffect(() => {
    const fit = () => {
      const el = box.current;
      const pic = el?.parentElement?.querySelector<HTMLElement>('[data-card] img');
      if (!el || !pic) return;
      const top = pic.getBoundingClientRect().top - el.getBoundingClientRect().top;
      el.style.height = `${Math.round(top + pic.offsetHeight / 2)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

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
    <div
      ref={box}
      className="absolute inset-x-0 top-0 h-[70%] overflow-hidden pointer-events-none"
      style={{
        maskImage: 'linear-gradient(to bottom, black 55%, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, black 55%, transparent)',
      }}
    >
      <div
        ref={layer}
        className="absolute inset-x-0 bg-cover bg-center opacity-[0.2] mix-blend-multiply will-change-transform"
        style={{ top: -OVERSCAN, bottom: -OVERSCAN, backgroundImage: `url(${PAPER})` }}
      />
    </div>
  );
}
