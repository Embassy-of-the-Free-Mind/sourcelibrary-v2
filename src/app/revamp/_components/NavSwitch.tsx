'use client';

import { useEffect, useState } from 'react';
import { setNavVariant, type NavVariant } from './RevampHeader';

const OPTIONS: [NavVariant, string, string][] = [
  ['panel', 'A. Mega panel', 'Collections opens a full-width panel. Hover a subject to see what\'s inside it, with the featured collection on the right.'],
  ['dropdown', 'B. Small dropdown', 'Collections opens five plain rows. The least to build and the least to learn.'],
  ['split', 'C. Two links', 'Subjects and Collections each get a place in the bar, making eight links. Subjects opens the whole map, Collections opens picture cards.'],
];

export default function NavSwitch() {
  const [v, setV] = useState<NavVariant>('plain');
  useEffect(() => { setV((localStorage.getItem('revamp-nav-2') as NavVariant) || 'plain'); }, []);
  return (
    <div className="grid gap-3 md:grid-cols-3 mt-6">
      {OPTIONS.map(([k, t, note]) => (
        <button key={k} type="button" aria-pressed={v === k} onClick={() => { setV(k); setNavVariant(k); }}
          className={`text-left border p-4 ${v === k ? 'border-primary bg-white' : 'border-border-light'}`}>
          <span className="block text-base text-primary font-medium">{t}</span>
          <span className="block text-sm text-muted mt-1">{note}</span>
        </button>
      ))}
    </div>
  );
}
