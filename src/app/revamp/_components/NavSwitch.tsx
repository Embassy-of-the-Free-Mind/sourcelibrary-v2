'use client';

import { useEffect, useState } from 'react';
import { readNavVariant, setNavVariant, type NavVariant } from './RevampHeader';

const OPTIONS: [NavVariant, string, string][] = [
  ['browse', 'A. One Browse menu (recommended)', 'Collections in the bar becomes Browse. One big menu holds every way in (subjects, centuries, languages, places, types), the subject list and the collections. Same number of links as today.'],
  ['menus', 'B. Library and Gallery menus', 'Library opens the ways into texts, Gallery the ways into images, Collections its own picture cards. Three menus to learn; Subjects and Centuries appear twice.'],
  ['dropdown', 'C. Small list', 'Collections opens one plain list of everything. The least to build, but nothing visual and a long list.'],
];

export default function NavSwitch() {
  const [v, setV] = useState<NavVariant>('browse');
  useEffect(() => { const read = () => setV(readNavVariant()); read(); window.addEventListener('revamp-nav', read); return () => window.removeEventListener('revamp-nav', read); }, []);
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
