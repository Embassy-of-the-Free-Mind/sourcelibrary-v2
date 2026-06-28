'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { X, ArrowRight } from 'lucide-react';

export interface Plate { src: string; href?: string; label?: string; fallback?: string }

/**
 * Lightweight masonry + lightbox. Columns fill round-robin (item i → column i %
 * cols) so the layout is STABLE — images never jump as they decode. Each plate
 * renders at its natural aspect; small thumbnails load fast (full-res is the
 * onError fallback). Clicking a plate opens a lightbox (existing tokens) from
 * which the visitor can open the source page or close and stay on the collection.
 * Columns: 5 desktop / 3 tablet-mobile.
 */
export default function MycoMasonry({ plates }: { plates: Plate[] }) {
  const [cols, setCols] = useState(5);
  const [active, setActive] = useState<Plate | null>(null);

  useEffect(() => {
    const calc = () => setCols(window.innerWidth >= 1024 ? 5 : 3);
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  // Esc to close + lock body scroll while the lightbox is open.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActive(null); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [active]);

  const columns: Plate[][] = Array.from({ length: cols }, () => []);
  plates.forEach((p, i) => columns[i % cols].push(p));

  return (
    <>
      <div className="flex gap-2 sm:gap-4 items-start">
        {columns.map((col, ci) => (
          <div key={ci} className="flex-1 min-w-0 flex flex-col gap-2 sm:gap-4">
            {col.map((p, k) => (
              <button
                key={k}
                type="button"
                onClick={() => setActive(p)}
                title={p.label}
                aria-label={p.label || 'View illustration'}
                className="group block w-full overflow-hidden border border-border-light hover:border-accent-rust/40 transition-colors cursor-zoom-in"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.src}
                  alt={p.label || 'Illustration'}
                  loading="lazy"
                  decoding="async"
                  onError={p.fallback ? (e) => {
                    const im = e.currentTarget;
                    if (p.fallback && im.src !== p.fallback) im.src = p.fallback;
                  } : undefined}
                  className="w-full h-auto block group-hover:scale-105 transition-transform duration-300"
                />
              </button>
            ))}
          </div>
        ))}
      </div>

      {active && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8 bg-dark/90 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
          onClick={() => setActive(null)}
        >
          <button
            type="button"
            onClick={() => setActive(null)}
            aria-label="Close"
            className="absolute top-4 right-4 w-10 h-10 inline-flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex flex-col items-center gap-5 max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active.fallback || active.src}
              alt={active.label || 'Illustration'}
              className="max-w-full max-h-[76vh] object-contain shadow-2xl"
            />
            <div className="flex items-center gap-3">
              {active.href && (
                <Link href={active.href} className="inline-flex items-center gap-2 bg-white text-black text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-white/90 transition-colors">
                  View page <ArrowRight className="w-4 h-4" />
                </Link>
              )}
              <button
                type="button"
                onClick={() => setActive(null)}
                className="inline-flex items-center gap-2 border border-white/30 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                Close
              </button>
            </div>
            {active.label && <p className="text-xs text-white/60 text-center max-w-prose px-4">{active.label}</p>}
          </div>
        </div>
      )}
    </>
  );
}
