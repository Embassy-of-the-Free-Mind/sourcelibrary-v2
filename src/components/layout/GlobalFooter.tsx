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
      { label: 'Libraries', href: '/libraries' },
      { label: 'Timeline', href: '/timeline' },
      { label: 'Search', href: '/search' },
    ],
  },
  {
    title: 'About',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Research Notes', href: '/blog' },
      { label: 'Press', href: '/press' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Cookie Settings', href: '#cookie-settings' },
      { label: 'Terms', href: '/terms' },
    ],
  },
  {
    title: 'Participate',
    links: [
      { label: 'Contribute', href: '/contribute' },
      { label: 'Support', href: '/support' },
      { label: 'Scan the Renaissance', href: '/scan-the-renaissance' },
      { label: 'Developers', href: '/developers' },
      { label: 'Standards', href: '/about/standards' },
    ],
  },
] as const;

const PARTNERS = [
  { name: 'Embassy of the Free Mind', src: 'https://images.sourcelibrary.org/assets/embassy-of-the-free-mind-logo.png', href: 'https://embassyofthefreemind.com', width: 200, height: 60, invert: true },
  { name: 'TU Delft', src: '/partners/tudelft-white.png', href: 'https://www.tudelft.nl', width: 373, height: 174, invert: false },
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

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
          <p className="font-serif italic text-white/50 text-lg">
            ad fontes
          </p>
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
                        <span className="text-[10px] bg-accent-gold/20 text-accent-gold px-1.5 py-0.5 rounded-full font-medium">
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
                    <FeedbackWidget className="text-sm text-white/50 hover:text-white transition-colors" />
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
                className="opacity-50 hover:opacity-80 transition-opacity"
                title={partner.name}
              >
                <Image
                  src={partner.src}
                  alt={partner.name}
                  width={partner.width}
                  height={partner.height}
                  sizes="auto"
                  className={`h-12 md:h-16 w-auto ${partner.invert ? 'brightness-0 invert' : ''}`}
                  unoptimized
                />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
    </>
  );
}
