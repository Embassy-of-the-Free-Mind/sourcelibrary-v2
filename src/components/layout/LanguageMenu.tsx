'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Check } from 'lucide-react';
import { localeHref, LOCALE_NATIVE_NAME, type Locale } from '@/lib/i18n';

// One button for the site language, in place of a row of codes (#6382). Five
// codes (EN · ES · LA · NL · ZH) crowded Support and the account icon out of a
// phone header, and a row grows with every language added.
//
// The button shows the language's full name, not its code: nobody reads "LA"
// as Latin. Each name is written in its own language, except Latin, which is
// "Latin" rather than "Latine" so a visitor who doesn't read it can still find it.
export const HEADER_LANGUAGE_NAME: Record<Locale, string> = { ...LOCALE_NATIVE_NAME, la: 'Latin' };

export default function LanguageMenu({ locales, current, pathname, onDark, englishOnly = false }: {
  /** Every site language, English first; each links to its twin of this page or its homepage. */
  locales: Locale[];
  current: Locale;
  pathname: string | null;
  /** On the dark bar or over the hero image: light text, dark dropdown. */
  onDark: boolean;
  /** This page has no translation: the other languages change the menus, not the page, so say so. */
  englishOnly?: boolean;
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
        aria-label={`Language: ${HEADER_LANGUAGE_NAME[current]}`}
        className={`flex items-center gap-1 h-9 px-2.5 text-[13.5px] whitespace-nowrap transition-colors ${
          onDark ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-secondary hover:text-primary hover:bg-warm'
        }`}
      >
        <span lang={current}>{HEADER_LANGUAGE_NAME[current]}</span>
        <ChevronDown className={`w-3 h-3 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      <div
        role="menu"
        className={`absolute right-0 top-full mt-2 min-w-[15rem] py-1.5 z-50 border transition-[opacity,transform] duration-200 ${
          onDark ? 'bg-dark border-white/15' : 'bg-white border-border-light shadow-lg'
        } ${open ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1.5 pointer-events-none'}`}
      >
        {englishOnly && (
          <p className={`px-4 pt-1.5 pb-2 mb-1 text-xs border-b ${onDark ? 'text-white/55 border-white/10' : 'text-muted border-border-light'}`}>
            This page is only in English. Another language keeps the menus in it, and every page that has it.
          </p>
        )}
        {locales.map((l) => (
          <Link
            key={l}
            role="menuitem"
            tabIndex={open ? 0 : -1}
            href={localeHref(l, pathname)}
            hrefLang={l}
            // A `?lang=` link is this same English page with other chrome: not
            // a page for a crawler to follow and index (#6938).
            rel={localeHref(l, pathname).includes('?') ? 'nofollow' : undefined}
            lang={l}
            aria-current={current === l ? 'page' : undefined}
            className={`flex items-center justify-between px-4 py-2 text-sm transition-colors ${
              onDark
                ? current === l ? 'text-white font-medium' : 'text-white/70 hover:text-white hover:bg-white/10'
                : current === l ? 'text-primary font-medium bg-warm' : 'text-secondary hover:text-primary hover:bg-warm/50'
            }`}
          >
            {HEADER_LANGUAGE_NAME[l]}
            {current === l && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
          </Link>
        ))}
      </div>
    </div>
  );
}
