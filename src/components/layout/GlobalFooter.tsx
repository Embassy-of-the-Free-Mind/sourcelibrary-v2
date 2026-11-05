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
import { visibleFooterNavColumns, type FooterLinkKey } from '@/lib/footer-nav';
import { isGlobalOnlyNavHref } from '@/lib/tenant-global-paths';
import { useChromeLocale, useLocalePath, FOOTER_STRINGS } from '@/lib/i18n';
import { useStableSession } from '@/hooks/useStableSession';

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
  { name: 'Embassy of the Free Mind', src: '/ai-partners/efm-white.png', href: 'https://embassyofthefreemind.com', width: 770, height: 326, invert: false },
  { name: 'TU Delft', src: '/ai-partners/tudelft-white.png', href: 'https://www.tudelft.nl', width: 299, height: 117, invert: false },
  { name: 'Frond Studio', src: '/ai-partners/frond-studio-white.png', href: 'https://frond-studio.com', width: 400, height: 213, invert: false },
];

// Folium and Wisdom Frontiers show on sourcelibrary.org only. Partner subdomains keep exactly the
// row they have today (order included): a tenant reading room is the
// partner's surface, so changes there wait for the partner. The Folium PNG
// keeps some transparent space above and below, so the long one-line
// wordmark sits at the same visual weight as the stacked logos beside it.
const GLOBAL_PARTNERS: Partner[] = [
  { name: 'Folium', src: '/ai-partners/folium-white.png', href: 'https://folium-studio.com', width: 800, height: 272, invert: false },
  { name: 'Wisdom Frontiers', src: '/ai-partners/wisdom-frontiers-white.svg', href: 'https://wisdomfrontiers.org', width: 151, height: 25, invert: false },
];

// Source Library's own accounts. Kept beside PARTNERS so the two lists that
// render in the footer's lower zones live together. These are also mirrored in
// the homepage `sameAs` array (src/components/seo/HomePageSchema.tsx) — update
// both, or search engines and readers see different sets.
const SOCIALS: { name: string; href: string; path: string }[] = [
  {
    name: 'Instagram',
    href: 'https://www.instagram.com/source.library',
    path: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z',
  },
  {
    name: 'X',
    href: 'https://x.com/SourceLibrary_',
    path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  },
  {
    name: 'GitHub',
    href: 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2',
    path: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  },
];

export default function GlobalFooter() {
  const pathname = usePathname();
  const t = FOOTER_STRINGS[useChromeLocale()];
  // Footer labels were localized before the pages were; now that `/collections`,
  // `/support` and `/auth/signin` have twins, the LINKS follow too. localePath
  // is registry-guarded, so everything else still points at its English page.
  const localePath = useLocalePath();
  const [hasFavorites, setHasFavorites] = useState(false);
  // Signed-in readers see Account where everyone else sees Sign up.
  const { status: sessionStatus } = useStableSession();
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
  const allColumns = visibleFooterNavColumns(isEmbedded);
  const navColumns = allColumns.filter(col => col.titleKey !== 'colLegal');
  const legalLinks = allColumns.find(col => col.titleKey === 'colLegal')?.links ?? [];
  // Same rule the header's Support pill follows: /give is global-only.
  const showDonate = !(isEmbedded && isGlobalOnlyNavHref('/give'));

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

  const linkClass = 'text-sm text-white/60 hover:text-white transition-colors';
  const renderLink = ({ key, href }: { key: FooterLinkKey; href: string }, className = linkClass) =>
    key === 'cookieSettings' ? (
      <button onClick={() => clearConsent()} className={className}>{t[key]}</button>
    ) : key === 'signUp' && sessionStatus === 'authenticated' ? (
      <Link href="/account" className={className}>{t.account}</Link>
    ) : (
      <Link href={localePath(href)} className={className}>{t[key]}</Link>
    );
  const partners = isEmbedded ? PARTNERS : [...PARTNERS, ...GLOBAL_PARTNERS].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
    <FeedbackCallout />
    <footer className="bg-dark text-white/60 mt-auto">
      <div className="max-w-[1500px] mx-auto px-4 md:px-12">

        {/* Top bar: brand on the left; the two actions start on the last link
            column's line, so they sit on the same grid as the columns below. */}
        <div className="grid grid-cols-1 md:grid-cols-[26%_1fr] gap-6 md:gap-12 items-center pt-8 md:pt-14">
          <div className="flex items-center gap-4 md:gap-5 whitespace-nowrap">
            <Link href={localePath('/')} className="shrink-0 opacity-90 hover:opacity-100 transition-opacity">
              <Image
                src="/brand/svg/logo-compact--white-on-dark.svg"
                alt="Source Library"
                width={205}
                height={32}
                className="h-7 md:h-8 w-auto"
                unoptimized
              />
            </Link>
            <span className="w-px h-[18px] md:h-5 bg-white/20" aria-hidden="true" />
            <Link href={isEmbedded ? '/in-memoriam' : '/articles/in-memoriam'} className="font-serif italic text-white/45 text-lg md:text-xl hover:text-white/70 transition-colors" title="In memoriam: Joost R. Ritman">
              ad fontes
            </Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
            <div className="col-start-1 md:col-start-2 lg:col-start-4 flex items-center gap-5">
              {/* A text link, not a bordered box: an outlined box beside the
                  filled Donate button read as a text field and its submit
                  button. Donate stays the one filled action in the bar. */}
              <FeedbackWidget
                label={t.giveFeedback}
                className="inline-flex items-center h-[34px] text-sm font-medium text-white/70 hover:text-white underline decoration-white/30 hover:decoration-white underline-offset-4 whitespace-nowrap transition-colors"
              />
              {showDonate && (
                <Link
                  href={localePath('/give')}
                  // The header's Support pill reports the same event, so the
                  // two entry points stay comparable (#3364 era instrumentation).
                  onClick={() => trackEvent('give_nav_click', { source: 'footer', url: '/give' })}
                    className="inline-flex items-center h-[34px] px-[13px] bg-accent-rust hover:bg-[#ad5442] text-sm font-medium text-[#f6ece8] hover:text-white whitespace-nowrap no-underline transition-colors"
                >
                  {t.donate}
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Socials + live presence on the left, link columns on the right. */}
        <div className="grid grid-cols-1 md:grid-cols-[26%_1fr] gap-x-12 pt-8 md:pt-11 pb-14 md:pb-[72px]">
          <div className="flex flex-col gap-6 items-start">
            <p className="text-sm leading-relaxed text-white/55 max-w-[280px]">{t.blurb}</p>
            {/* Our own accounts. Hidden on partner subdomains (#3364): a tenant
                reading room is the partner's surface. */}
            {!isEmbedded && (
              <div className="flex gap-[18px]">
                {SOCIALS.map((s) => (
                  <a
                    key={s.name}
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer me"
                    aria-label={s.name}
                    title={s.name}
                    className="text-white/45 hover:text-white/80 transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-[18px] w-[18px]">
                      <path d={s.path} />
                    </svg>
                  </a>
                ))}
              </div>
            )}
            {/* Live reader presence (#3059); collapses when the chip renders nothing. */}
            <div className="empty:hidden">
              <ReaderPresence variant="chip" />
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 lg:gap-x-8 gap-y-10 pt-10 md:pt-0">
            {navColumns.map((col) => (
              <div key={col.titleKey}>
                <h3 className="font-sans text-sm tracking-normal leading-snug text-white mb-3.5" style={{ fontWeight: 600 }}>{t[col.titleKey]}</h3>
                <ul className="space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link.href}>{renderLink(link)}</li>
                  ))}
                  {col.titleKey === 'colLibrary' && hasFavorites && (
                    <li>
                      <Link href="/favorites" className={linkClass}>{t.favorites}</Link>
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Small print: a darker band instead of hairlines. Partner subdomains
          keep exactly the partner row they have today (order included). */}
      <div className="bg-[#13100d]">
        <div className="max-w-[1500px] mx-auto px-4 md:px-12 pt-8 pb-9 flex flex-col gap-[22px]">
          <div className="flex flex-col md:flex-row md:items-center gap-[18px] md:gap-9">
            <span className="text-[13px] text-white/45 whitespace-nowrap">{t.partnersLabel}</span>
            <div className="grid grid-cols-2 md:flex md:flex-wrap items-center gap-x-4 md:gap-x-10 gap-y-6">
              {partners.map((partner) => (
                <a
                  key={partner.name}
                  href={partner.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center opacity-60 hover:opacity-100 transition-opacity"
                  title={partner.name}
                >
                  <Image
                    src={partner.src!}
                    alt={partner.name}
                    width={partner.width}
                    height={partner.height}
                    sizes="auto"
                    className={`w-auto ${partner.name === 'Folium' ? 'h-[26px] md:h-7' : partner.name === 'TU Delft' ? 'h-5 md:h-[21px]' : partner.name === 'Wisdom Frontiers' ? 'h-[22px]' : 'h-6'} ${partner.invert ? 'brightness-0 invert' : ''}`}
                    unoptimized
                  />
                </a>
              ))}
            </div>
          </div>
          <div className="flex flex-col md:flex-row md:flex-wrap md:items-baseline gap-3.5 md:gap-x-10 md:gap-y-2">
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {legalLinks.map((link) => (
                <span key={link.href}>{renderLink(link, 'text-[13px] text-white/45 hover:text-white/80 transition-colors')}</span>
              ))}
            </div>
            <Link href="/licensing" className="text-[13px] text-white/45 hover:text-white/80 transition-colors">
              {t.licenseLine}
            </Link>
          </div>
        </div>
      </div>
    </footer>
    </>
  );
}
