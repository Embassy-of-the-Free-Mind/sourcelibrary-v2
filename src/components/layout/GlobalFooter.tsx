'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import FeedbackWidget from '@/components/feedback/FeedbackWidget';
import FeedbackCallout from '@/components/feedback/FeedbackCallout';
import ReaderPresence from '@/components/presence/ReaderPresence';
import { clearConsent } from '@/lib/consent';
import { trackEvent } from '@/lib/track-event';
import { useIsEmbedded } from '@/hooks/useEmbedContext';
import { visibleFooterNavColumns } from '@/lib/footer-nav';
import { useLocale, useLocalePath, FOOTER_STRINGS } from '@/lib/i18n';

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

// Source Library's own accounts. Kept beside PARTNERS so the two lists that
// render in the footer's lower zones live together. These are also mirrored in
// the homepage `sameAs` array (src/components/seo/HomePageSchema.tsx) — update
// both, or search engines and readers see different sets.
const SOCIALS: { name: string; href: string; path: string }[] = [
  {
    name: 'X',
    href: 'https://x.com/SourceLibrary_',
    path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  },
  {
    name: 'Instagram',
    href: 'https://www.instagram.com/source.library',
    path: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z',
  },
  {
    name: 'GitHub',
    href: 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2',
    path: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  },
];

export default function GlobalFooter() {
  const pathname = usePathname();
  const t = FOOTER_STRINGS[useLocale()];
  // Footer labels were localized before the pages were; now that `/collections`,
  // `/support` and `/auth/signin` have twins, the LINKS follow too. localePath
  // is registry-guarded, so everything else still points at its English page.
  const localePath = useLocalePath();
  const [hasFavorites, setHasFavorites] = useState(false);
  // Global-only surfaces 404 on partner subdomains (the list and its rationale
  // live in src/lib/tenant-global-paths.ts — #3364, #3370). SiteHeader has
  // filtered on that list since #3364; the footer never did, so on
  // bph.sourcelibrary.org it shipped ten links that all returned 404 —
  // /about, /vision, /census, /research, /blog, /contribute, /support,
  // /sponsors, /libraries and /about/progress. That is the failure the
  // one-list rule exists to prevent: blocking a route the nav links to just
  // moves the leak into a dead link.
  //
  // Same shared `useEmbedContext` signal the header uses, not a second
  // hostname check (#3367). Resolved after mount, so the static HTML the
  // global site serves is unchanged and only a tenant visitor sees links drop.
  const isEmbedded = useIsEmbedded();
  const navColumns = visibleFooterNavColumns(isEmbedded);

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
          <Link href={localePath('/')} className="group">
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
          {navColumns.map((col) => (
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
                        href={localePath(link.href)}
                        // Instrumented alongside the header pill so the two paths
                        // are comparable. Before the pill existed this footer link
                        // was the ONLY route to giving, and it drew 60 of 330,698
                        // pageviews in 30 days — the baseline the pill is meant to
                        // beat. Attributing the split needs an event at each
                        // control; the referrer cannot tell them apart.
                        onClick={() => trackEvent('give_nav_click', { source: 'footer', url: link.href })}
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
                        href={localePath(link.href)}
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

        {/* Zone 3b: Our own accounts. Hidden on partner subdomains for the same
            reason the global-only nav links are (#3364): a tenant reading room
            is the partner's surface, and Source Library's social accounts are
            not theirs to carry. */}
        {!isEmbedded && (
          <div className="flex justify-center gap-6 pb-6">
            {SOCIALS.map((s) => (
              <a
                key={s.name}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer me"
                aria-label={s.name}
                title={s.name}
                className="text-white/35 hover:text-white/70 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-5 w-5">
                  <path d={s.path} />
                </svg>
              </a>
            ))}
          </div>
        )}

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
