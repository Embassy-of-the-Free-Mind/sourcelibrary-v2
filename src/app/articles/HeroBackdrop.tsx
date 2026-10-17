'use client';

import { useEffect, useState } from 'react';
import { aldineAetna } from '@/lib/fonts/aldine';
import type { BlogPost } from './posts';

// PREVIEW: four pattern backdrops for the /articles hero, picked with
// ?hero=1..4 so they can be compared on the page. Keep the chosen one, delete
// the rest.

// 1. Contour lines: drawn here, a slow field of waves like marbled endpapers.
function Contours() {
  const lines = Array.from({ length: 34 }, (_, i) => {
    const y = 20 + i * 14;
    const a = 18 + (i % 5) * 4;
    const phase = i * 0.35;
    let d = `M -20 ${y}`;
    for (let x = 0; x <= 1640; x += 40) {
      const dy = Math.sin(x / 210 + phase) * a + Math.sin(x / 90 + phase * 2) * (a / 4);
      d += ` L ${x} ${(y + dy).toFixed(1)}`;
    }
    return d;
  });
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1600 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {lines.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="#1a1612" strokeOpacity={0.07} strokeWidth={1} />
      ))}
    </svg>
  );
}

// 2. The page: ruling and margin prickings of a manuscript leaf, at hero size.
function Ruling() {
  return (
    <svg className="absolute inset-0 w-full h-full" aria-hidden="true">
      <defs>
        <pattern id="ruling" width="24" height="24" patternUnits="userSpaceOnUse">
          <line x1="0" y1="23.5" x2="24" y2="23.5" stroke="#9e7c3c" strokeOpacity="0.16" />
        </pattern>
        <pattern id="pricks" width="40" height="24" patternUnits="userSpaceOnUse">
          <circle cx="20" cy="23.5" r="1.2" fill="#9e7c3c" fillOpacity="0.35" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#ruling)" />
      <line x1="6%" y1="0" x2="6%" y2="100%" stroke="#9e7c3c" strokeOpacity="0.22" />
      <line x1="94%" y1="0" x2="94%" y2="100%" stroke="#9e7c3c" strokeOpacity="0.22" />
      <rect x="calc(6% - 40px)" width="40" height="100%" fill="url(#pricks)" />
    </svg>
  );
}

// 3. Mosaic: every article's own picture, small, toned and faded.
function Mosaic({ posts }: { posts: BlogPost[] }) {
  const tiles = [...posts, ...posts].slice(0, 120);
  return (
    <div className="absolute inset-0 grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] auto-rows-[72px] gap-1 opacity-[0.11] grayscale sepia overflow-hidden">
      {tiles.map((p, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={p.image} alt="" loading="lazy" className="w-full h-full object-cover" />
      ))}
    </div>
  );
}

// 4. Type: the article titles themselves, set in our Aldine Aetna facsimile.
function Type({ posts }: { posts: BlogPost[] }) {
  const text = posts.map((p) => p.title).join(' · ');
  return (
    <div
      className={`${aldineAetna.variable} absolute inset-0 overflow-hidden text-[44px] leading-[1.15] text-primary/[0.045] select-none`}
      style={{ fontFamily: 'var(--font-aldine-aetna), Georgia, serif' }}
      aria-hidden="true"
    >
      <p className="-ml-24 w-[140%]">{text}</p>
    </div>
  );
}

export default function HeroBackdrop({ posts }: { posts: BlogPost[] }) {
  const [hero, setHero] = useState('1');
  useEffect(() => {
    setHero(new URLSearchParams(window.location.search).get('hero') || '1');
  }, []);

  return (
    <div
      className="absolute inset-x-0 top-0 h-[520px] overflow-hidden pointer-events-none"
      style={{ maskImage: 'linear-gradient(to bottom, black 45%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black 45%, transparent)' }}
    >
      {hero === '1' && <Contours />}
      {hero === '2' && <Ruling />}
      {hero === '3' && <Mosaic posts={posts} />}
      {hero === '4' && <Type posts={posts} />}
    </div>
  );
}
