'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

// PREVIEW: four hero backdrops for /articles, each cut from a book in the
// collection, picked with ?hero=1..4 so they can be compared on the page.
// Keep the chosen one, delete the rest (and its file in public/articles/hero).

interface Backdrop {
  credit: string;
  href: string;
  render: () => React.ReactNode;
}

const FADE_LEFT = 'linear-gradient(to left, black 35%, transparent 85%)';

const BACKDROPS: Record<string, Backdrop> = {
  // A combed marbled paper, toned down to a quiet texture.
  '1': {
    credit: 'Marbled paper, Manly P. Hall Collection, Box 27',
    href: '/book/manly-p-hall-collection-box-27-collection',
    render: () => (
      <div
        className="absolute inset-0 bg-cover bg-center opacity-[0.13] grayscale sepia mix-blend-multiply"
        style={{ backgroundImage: 'url(/articles/hero/marbled-hall-box27.jpg)' }}
      />
    ),
  },
  // A row of printers' flowers (London, 1709), repeated as a headpiece band.
  '2': {
    credit: 'Printers’ flowers, London 1709, from Bayley, A New Light on the Renaissance (1909)',
    href: '/book/a-new-light-on-the-renaissance-displayed-in-contemporary-bayley',
    render: () => (
      <div
        className="absolute inset-x-0 top-0 h-[44px] opacity-[0.3] grayscale contrast-[1.6] brightness-[1.2] mix-blend-multiply"
        style={{ backgroundImage: 'url(/articles/hero/bayley-printers-flowers-1709.jpg)', backgroundSize: 'auto 44px', backgroundRepeat: 'repeat-x' }}
      />
    ),
  },
  // A woodcut page border from Alciato's Emblems, faint on the right.
  '3': {
    credit: 'Woodcut border, Alciato, Emblems',
    href: '/book/alciato-emblemata-1548-lyon-alciato',
    render: () => (
      <div
        className="absolute inset-y-0 right-0 w-[70%] bg-no-repeat opacity-[0.22] grayscale contrast-[1.8] brightness-[1.25] mix-blend-multiply"
        style={{
          backgroundImage: 'url(/articles/hero/alciato-border.jpg)',
          backgroundSize: 'auto 135%',
          backgroundPosition: 'right 6% top 30%',
          maskImage: FADE_LEFT,
          WebkitMaskImage: FADE_LEFT,
        }}
      />
    ),
  },
  // Leonardo's hollow dodecahedron for Pacioli, faint on the right.
  '4': {
    credit: 'Dodecahedron, Pacioli, De Divina Proportione (1509)',
    href: '/book/de-divina-proportione-illust',
    render: () => (
      <div
        className="absolute inset-y-0 right-0 w-[60%] bg-no-repeat opacity-[0.25] grayscale contrast-[1.8] brightness-[1.25] mix-blend-multiply"
        style={{
          backgroundImage: 'url(https://images.sourcelibrary.org/archived/69de988c1b234a773e438b33/248.jpg)',
          backgroundSize: 'auto 120%',
          backgroundPosition: 'right 4% center',
          maskImage: FADE_LEFT,
          WebkitMaskImage: FADE_LEFT,
        }}
      />
    ),
  },
};

export default function HeroBackdrop() {
  const [hero, setHero] = useState('1');
  useEffect(() => {
    const pick = new URLSearchParams(window.location.search).get('hero');
    if (pick && BACKDROPS[pick]) setHero(pick);
  }, []);
  const backdrop = BACKDROPS[hero];

  return (
    <>
      <div
        className="absolute inset-x-0 top-0 h-[520px] overflow-hidden pointer-events-none"
        style={{ maskImage: 'linear-gradient(to bottom, black 45%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black 45%, transparent)' }}
      >
        {backdrop.render()}
      </div>
      <div className="absolute inset-x-0 top-[52px] hidden md:block">
        <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 flex justify-end">
          <Link href={backdrop.href} className="relative z-10 text-xs text-muted hover:text-secondary transition-colors">
            {backdrop.credit}
          </Link>
        </div>
      </div>
    </>
  );
}
