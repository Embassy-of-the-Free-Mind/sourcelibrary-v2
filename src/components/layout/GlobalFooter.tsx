'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import FeedbackWidget from '@/components/feedback/FeedbackWidget';
import FeedbackCallout from '@/components/feedback/FeedbackCallout';
import ReaderPresence from '@/components/presence/ReaderPresence';
import { clearConsent } from '@/lib/consent';
import { useLocale, FOOTER_STRINGS, type FooterStrings } from '@/lib/i18n';

// Labels are resolved per-locale from FOOTER_STRINGS via `key`; hrefs are
// constant and point at the English pages (deep pages have no `/es` route).
type FooterLinkKey = Exclude<keyof FooterStrings, 'colLibrary' | 'colAbout' | 'colParticipate'>;

const NAV_COLUMNS: ReadonlyArray<{
  titleKey: keyof FooterStrings;
  links: ReadonlyArray<{ key: FooterLinkKey; href: string }>;
}> = [
  {
    titleKey: 'colLibrary',
    links: [
      { key: 'browseBooks', href: '/' },
      { key: 'browseAZ', href: '/browse' },
      { key: 'gallery', href: '/gallery' },
      { key: 'collections', href: '/collections' },
      { key: 'explore', href: '/explore' },
      { key: 'search', href: '/search' },
    ],
  },
  {
    titleKey: 'colAbout',
    links: [
      { key: 'about', href: '/about' },
      { key: 'vision', href: '/vision' },
      { key: 'census', href: '/census' },
      { key: 'progress', href: '/about/progress' },
      { key: 'research', href: '/research' },
      { key: 'researchNotes', href: '/blog' },
      { key: 'privacy', href: '/privacy' },
      { key: 'cookieSettings', href: '#cookie-settings' },
      { key: 'terms', href: '/terms' },
      { key: 'copyright', href: '/dmca' },
    ],
  },
  {
    titleKey: 'colParticipate',
    links: [
      { key: 'libraries', href: '/libraries' },
      { key: 'contribute', href: '/contribute' },
      { key: 'support', href: '/support' },
      { key: 'sponsorship', href: '/sponsors' },
      { key: 'developers', href: '/developers' },
    ],
  },
];

type Partner = {
  name: string;
  href: string;
  src?: string;
  width?: number;
  height?: number;
  invert?: boolean;
};

// Logo PNGs are trimmed to their content (no internal transparent padding) so
// every logo fills the shared h-12/h-16 box and they all appear equally tall.
const PARTNERS: Partner[] = [
  { name: 'Embassy of the Free Mind', src: '/partners/efm-white.png', href: 'https://embassyofthefreemind.com', width: 770, height: 326, invert: false },
  { name: 'TU Delft', src: '/partners/tudelft-white.png', href: 'https://www.tudelft.nl', width: 299, height: 117, invert: false },
  { name: 'Frond Studio', src: '/partners/frond-studio-white.png', href: 'https://frond-studio.com', width: 400, height: 213, invert: false },
];

export default function GlobalFooter() {
  const pathname = usePathname();
  const t = FOOTER_STRINGS[useLocale()];
  const [hasFavorites, setHasFavorites] = useState(false);

  useEffect(() => {
    try {
      const likes = localStorage.getItem('sl_visitor_likes');
      if (likes && JSON.parse(likes).length > 0) {
        setHasFavorites(true);
      }
    } catch { /* ignore */ }
  }, []);

  // Ficino Society pages have their own footer
  if (pathname?.startsWith('/ficino-society')) return null;

  return (
    <>
    <FeedbackCallout />
    <footer className="bg-dark text-white/60 mt-auto">
      <div className="max-w-[1500px] mx-auto px-6 md:px-12">

        {/* Zone 1: Brand + Mission */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-8 border-b border-white/[0.08]">
          <Link href="/" className="group">
            <Image
              src="/brand/png/logo-compact--white-on-transparent--96h.png"
              alt="Source Library"
              width={300}
              height={96}
              sizes="auto"
              className="h-16 sm:h-20 w-auto opacity-90 group-hover:opacity-100 transition-opacity"
              unoptimized
            />
          </Link>
          <Link href="/in-memoriam" className="font-serif italic text-white/50 text-lg hover:text-white/70 transition-colors" title="In memoriam: Joost R. Ritman">
            ad fontes
          </Link>
        </div>

        {/* Zone 2: Navigation Columns. Mobile: 2 columns — Library + Participate
            stacked on the left, About on the right. Desktop: the usual 3-up. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-8 sm:gap-12 py-10 border-b border-white/[0.08]">
          {NAV_COLUMNS.map((col) => (
            <div
              key={col.titleKey}
              className={
                col.titleKey === 'colLibrary' ? 'col-start-1 row-start-1 sm:col-auto sm:row-auto'
                : col.titleKey === 'colAbout' ? 'col-start-2 row-start-1 row-span-2 sm:col-auto sm:row-auto'
                : 'col-start-1 row-start-2 sm:col-auto sm:row-auto'
              }
            >
              <h3 className="text-accent-gold text-xs font-semibold uppercase tracking-[0.15em] mb-4">
                {t[col.titleKey]}
              </h3>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    {link.key === 'support' ? (
                      <Link
                        href={link.href}
                        className="text-sm text-white/50 hover:text-white transition-colors inline-flex items-center gap-1.5"
                      >
                        {t[link.key]}
                        <span className="text-[11px] bg-accent-rust/20 text-accent-rust px-2 py-0.5 rounded-full font-bold">
                          {t.donate}
                        </span>
                      </Link>
                    ) : link.key === 'cookieSettings' ? (
                      <button
                        onClick={() => clearConsent()}
                        className="text-sm text-white/50 hover:text-white transition-colors"
                      >
                        {t[link.key]}
                      </button>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-white/50 hover:text-white transition-colors"
                      >
                        {t[link.key]}
                      </Link>
                    )}
                  </li>
                ))}
                {/* Conditional personal links under Library */}
                {col.titleKey === 'colLibrary' && hasFavorites && (
                  <li>
                    <Link href="/favorites" className="text-sm text-white/50 hover:text-white transition-colors">
                      {t.favorites}
                    </Link>
                  </li>
                )}
                {/* Feedback widget under Participate */}
                {col.titleKey === 'colParticipate' && (
                  <li>
                    <FeedbackWidget label={t.giveFeedback} className="text-sm font-bold text-accent-rust hover:text-white transition-colors" />
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>

        {/* Zone 3: Partners */}
        <div className="py-8">
          <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12">
            {PARTNERS.map((partner) => (
              <a
                key={partner.name}
                href={partner.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center h-[2.4rem] md:h-[3.2rem] opacity-50 hover:opacity-80 transition-opacity"
                title={partner.name}
              >
                <Image
                  src={partner.src!}
                  alt={partner.name}
                  width={partner.width}
                  height={partner.height}
                  sizes="auto"
                  className={`h-[2.4rem] md:h-[3.2rem] w-auto ${partner.invert ? 'brightness-0 invert' : ''}`}
                  unoptimized
                />
              </a>
            ))}
          </div>
        </div>

        {/* Zone 4: License line */}
        <div className="pb-4 -mt-2 text-center">
          <Link href="/licensing" className="text-xs text-white/35 hover:text-white/60 transition-colors">
            {t.licenseLine}
          </Link>
        </div>

        {/* Zone 5: Live reader presence — the very bottom line, on every page
            (#3059). The wrapper collapses (empty:hidden) when the chip renders
            nothing (below the display floor, or on tenant subdomains). */}
        <div className="flex justify-center pb-6 empty:hidden">
          <ReaderPresence variant="chip" />
        </div>
      </div>
    </footer>
    </>
  );
}
