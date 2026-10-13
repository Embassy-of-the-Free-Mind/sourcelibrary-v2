'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Languages } from 'lucide-react';
import { localeHref, LOCALE_NATIVE_NAME, type Locale } from '@/lib/i18n';

// One button for the site language, in place of a row of codes (#6382). Five
// codes (EN · ES · LA · NL · ZH) crowded Support and the account icon out of a
// phone header, and a row grows with every language added. The icon is the
// familiar "A / 文" translate glyph, so it reads the same to every visitor; the
// code beside it says which site you are on; each name in the menu is written
// in its own language.

export default function LanguageMenu({ locales, current, pathname, onDark }: {
  /** Locales this page exists in, English first (from the twin registry). */
  locales: Locale[];
  current: Locale;
  pathname: string | null;
  /** Header over the hero image: light text. */
  onDark: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Language: ${LOCALE_NATIVE_NAME[current]}`}
        className={`flex items-center gap-1 h-8 px-1.5 rounded-lg text-xs font-medium tracking-wide transition-colors ${
          onDark ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-secondary hover:text-primary hover:bg-warm'
        }`}
      >
        <Languages className="w-4 h-4" aria-hidden="true" />
        <span>{current.toUpperCase()}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 w-40 bg-white rounded-lg shadow-lg border border-border-light py-1.5 z-50">
          {locales.map((l) => (
            <Link
              key={l}
              role="menuitem"
              href={localeHref(l, pathname)}
              hrefLang={l}
              lang={l}
              aria-current={current === l ? 'page' : undefined}
              className={`block px-4 py-2 text-sm transition-colors ${
                current === l ? 'text-primary font-medium bg-warm' : 'text-secondary hover:text-primary hover:bg-warm/50'
              }`}
            >
              {LOCALE_NATIVE_NAME[l]}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
