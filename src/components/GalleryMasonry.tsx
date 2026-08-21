'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export interface Plate { src: string; href?: string; label?: string; fallback?: string; w?: number; h?: number }

/**
 * Lightweight masonry. Columns fill round-robin (item i → column i % cols) so the
 * layout is STABLE — images never jump as they decode. Each plate renders at its
 * natural aspect; small thumbnails load fast (full-res is the onError fallback).
 * Clicking a plate goes to its gallery-image page. Columns: 5 desktop / 3 mobile.
 * Extracted from the Mycology gallery so the homepage can reuse it.
 */
export default function GalleryMasonry({ plates }: { plates: Plate[] }) {
  const [cols, setCols] = useState(5);

  useEffect(() => {
    const calc = () => setCols(window.innerWidth >= 1024 ? 5 : 3);
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  const columns: Plate[][] = Array.from({ length: cols }, () => []);
  plates.forEach((p, i) => columns[i % cols].push(p));

  return (
    <div className="flex gap-2 sm:gap-4 items-start">
      {columns.map((col, ci) => (
        <div key={ci} className="flex-1 min-w-0 flex flex-col gap-2 sm:gap-4">
          {col.map((p, k) => {
            const inner = (
              <div className="group block w-full overflow-hidden border border-border-light hover:border-accent-rust/40 transition-colors">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.src}
                  alt={p.label || 'Illustration'}
                  loading="lazy"
                  decoding="async"
                  width={p.w}
                  height={p.h}
                  // Reserve the cell's aspect ratio up front so images fade in
                  // without shifting the masonry layout as they decode.
                  style={p.w && p.h ? { aspectRatio: `${p.w} / ${p.h}` } : undefined}
                  onError={p.fallback ? (e) => {
                    const im = e.currentTarget;
                    if (p.fallback && im.src !== p.fallback) im.src = p.fallback;
                  } : undefined}
                  className="w-full h-auto block bg-warm group-hover:scale-105 transition-transform duration-300"
                />
              </div>
            );
            return p.href
              ? <Link key={k} href={p.href} title={p.label}>{inner}</Link>
              : <div key={k} title={p.label}>{inner}</div>;
          })}
        </div>
      ))}
    </div>
  );
}
