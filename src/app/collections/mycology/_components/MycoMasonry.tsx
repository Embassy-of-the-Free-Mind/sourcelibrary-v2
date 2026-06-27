'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

export interface Plate { src: string; href?: string; label?: string }

/**
 * Balanced flex masonry. Each plate renders at its NATURAL aspect ratio
 * (width:100%; height:auto — never cropped). Plates are assigned to whichever
 * column is currently shortest, using each image's true ratio captured on load,
 * recomputed on resize. Columns: 5 desktop / 3 tablet-mobile. Existing tokens.
 * The capped height + bottom fade live on the parent (server-rendered).
 */
export default function MycoMasonry({ plates }: { plates: Plate[] }) {
  const [cols, setCols] = useState(5);
  const aspects = useRef<number[]>(plates.map(() => 0.7)); // width/height; ~0.7 until loaded
  const [, bump] = useState(0);

  useEffect(() => {
    const calc = () => setCols(window.innerWidth >= 1024 ? 5 : 3);
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  // Greedy distribution: each plate to the currently-shortest column. Column
  // "height" accumulates 1/aspect (taller images add more), so it balances.
  const columns: number[][] = Array.from({ length: cols }, () => []);
  const heights = new Array(cols).fill(0);
  plates.forEach((_, idx) => {
    let c = 0;
    for (let j = 1; j < cols; j++) if (heights[j] < heights[c]) c = j;
    columns[c].push(idx);
    heights[c] += 1 / (aspects.current[idx] || 0.7);
  });

  return (
    <div className="flex gap-4 items-start">
      {columns.map((col, ci) => (
        <div key={ci} className="flex-1 min-w-0 flex flex-col gap-4">
          {col.map((idx) => {
            const p = plates[idx];
            const inner = (
              <div className="border border-border-light hover:border-accent-rust/40 transition-colors">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.src}
                  alt={p.label || 'Illustration'}
                  loading="lazy"
                  onLoad={(e) => {
                    const im = e.currentTarget;
                    if (im.naturalWidth && im.naturalHeight) {
                      const a = im.naturalWidth / im.naturalHeight;
                      if (Math.abs(a - aspects.current[idx]) > 0.01) { aspects.current[idx] = a; bump((v) => v + 1); }
                    }
                  }}
                  className="w-full h-auto block"
                />
              </div>
            );
            return p.href
              ? <Link key={idx} href={p.href} title={p.label}>{inner}</Link>
              : <div key={idx} title={p.label}>{inner}</div>;
          })}
        </div>
      ))}
    </div>
  );
}
