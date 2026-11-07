'use client';

import { useEffect } from 'react';

/** The prototype has no database, so links outside /revamp open on the live site. */
export default function LinkOut() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.('a');
      const href = a?.getAttribute('href');
      if (!a || !href || !href.startsWith('/') || href.startsWith('/revamp')) return;
      e.preventDefault();
      e.stopPropagation();
      window.open(`https://sourcelibrary.org${href}`, '_blank', 'noopener');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  return null;
}
