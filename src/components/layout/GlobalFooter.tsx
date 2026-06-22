'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import FeedbackWidget from '@/components/feedback/FeedbackWidget';
import FeedbackCallout from '@/components/feedback/FeedbackCallout';
import { clearConsent } from '@/lib/consent';

const NAV_COLUMNS = [
  {
    title: 'Library',
    links: [
      { label: 'Browse Books', href: '/' },
      { label: 'Browse A–Z', href: '/browse' },
      { label: 'Gallery', href: '/gallery' },
      { label: 'Collections', href: '/collections' },
      { label: 'Explore', href: '/explore' },
      { label: 'Search', href: '/search' },
    ],
  },
  {
    title: 'About',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Our Vision', href: '/vision' },
      { label: 'Translation Census', href: '/census' },
      { label: 'Progress', href: '/about/progress' },
      { label: 'Research Notes', href: '/blog' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Cookie Settings', href: '#cookie-settings' },
      { label: 'Terms', href: '/terms' },
      { label: 'Copyright & DMCA', href: '/dmca' },
    ],
  },
  {
    title: 'Participate',
    links: [
      { label: 'Libraries', href: '/libraries' },
      { label: 'Contribute', href: '/contribute' },
      { label: 'Support', href: '/support' },
      { label: 'Corporate Sponsorship', href: '/sponsors' },
      { label: 'Developers', href: '/developers' },
    ],
  },
] as const;

type Partner = {
  name: string;
  href: string;
  src?: string;
  width?: number;
  height?: number;
  invert?: boolean;
  /** Render the partner's text wordmark instead of an image (e.g. Frond Studio). */
  wordmark?: boolean;
};

// Logo PNGs are trimmed to their content (no internal transparent padding) so
// every logo fills the shared h-12/h-16 box and they all appear equally tall.
const PARTNERS: Partner[] = [
  { name: 'Embassy of the Free Mind', src: '/partners/efm-white.png', href: 'https://embassyofthefreemind.com', width: 770, height: 326, invert: false },
  { name: 'TU Delft', src: '/partners/tudelft-white.png', href: 'https://www.tudelft.nl', width: 299, height: 117, invert: false },
  { name: 'Frond Studio', href: 'https://frond-studio.com', wordmark: true },
];

export default function GlobalFooter() {
  const pathname = usePathname();
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
      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8">

        {/* Zone 1: Brand + Mission */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-8 border-b border-white/[0.08]">
          <Link href="/" className="group">
            <Image
              src="/brand/png/logo-compact--white-on-transparent--96h.png"
              alt="Source Library"
              width={300}
              height={96}
              sizes="auto"
              className="h-12 sm:h-16 w-auto opacity-90 group-hover:opacity-100 transition-opacity"
              unoptimized
            />
          </Link>
          <Link href="/about" className="font-serif italic text-white/50 text-lg hover:text-white/70 transition-colors">
            ad fontes
          </Link>
        </div>

        {/* Zone 2: Navigation Columns */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-12 py-10 border-b border-white/[0.08]">
          {NAV_COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-accent-gold text-xs font-semibold uppercase tracking-[0.15em] mb-4">
                {col.title}
              </h3>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    {link.label === 'Support' ? (
                      <Link
                        href={link.href}
                        className="text-sm text-white/50 hover:text-white transition-colors inline-flex items-center gap-1.5"
                      >
                        {link.label}
                        <span className="text-[11px] bg-accent-rust/20 text-accent-rust px-2 py-0.5 rounded-full font-bold">
                          Donate
                        </span>
                      </Link>
                    ) : link.label === 'Cookie Settings' ? (
                      <button
                        onClick={() => clearConsent()}
                        className="text-sm text-white/50 hover:text-white transition-colors"
                      >
                        {link.label}
                      </button>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-white/50 hover:text-white transition-colors"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
                {/* Conditional personal links under Library */}
                {col.title === 'Library' && hasFavorites && (
                  <li>
                    <Link href="/favorites" className="text-sm text-white/50 hover:text-white transition-colors">
                      Favorites
                    </Link>
                  </li>
                )}
                {/* Feedback widget under Participate */}
                {col.title === 'Participate' && (
                  <li>
                    <FeedbackWidget label="Give Feedback" className="text-sm font-bold text-accent-rust hover:text-white transition-colors" />
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
                className="flex items-center h-12 md:h-16 opacity-50 hover:opacity-80 transition-opacity"
                title={partner.name}
              >
                {partner.wordmark ? (
                  // Frond Studio's logo is a stacked text wordmark (no image asset).
                  <span className="flex flex-col leading-none gap-[3px] text-white">
                    <span className="font-sans font-light tracking-tight text-[1.75rem] md:text-[2.25rem]">Frond</span>
                    <span className="font-sans font-medium uppercase tracking-[0.44em] text-[0.6rem] md:text-[0.7rem] text-white/70 pl-px">Studio</span>
                  </span>
                ) : (
                  <Image
                    src={partner.src!}
                    alt={partner.name}
                    width={partner.width}
                    height={partner.height}
                    sizes="auto"
                    className={`h-12 md:h-16 w-auto ${partner.invert ? 'brightness-0 invert' : ''}`}
                    unoptimized
                  />
                )}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
    </>
  );
}
