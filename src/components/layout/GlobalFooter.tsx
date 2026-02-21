'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { analytics } from '@/lib/api-client';
import FeedbackWidget from '@/components/feedback/FeedbackWidget';

interface GlobalStats {
  totalBooks: number;
  pagesTranslated: number;
}

const NAV_COLUMNS = [
  {
    title: 'Library',
    links: [
      { label: 'Browse Books', href: '/' },
      { label: 'Gallery', href: '/gallery' },
      { label: 'Collections', href: '/collections' },
      { label: 'Timeline', href: '/timeline' },
      { label: 'Encyclopedia', href: '/encyclopedia' },
      { label: 'Search', href: '/search' },
    ],
  },
  {
    title: 'About',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Blog', href: '/blog' },
      { label: 'Press', href: '/press' },
      { label: 'Roadmap', href: '/roadmap' },
    ],
  },
  {
    title: 'Participate',
    links: [
      { label: 'Contribute', href: '/contribute' },
      { label: 'Support', href: '/support' },
      { label: 'Developers', href: '/developers' },
      { label: 'Standards', href: '/about/standards' },
    ],
  },
] as const;

const PARTNERS = [
  { name: 'Embassy of the Free Mind', src: '/partners/efm-white.svg', href: 'https://embassyofthefreemind.com', width: 200, height: 40 },
  { name: 'UNESCO Memory of the World', src: '/partners/unesco-white.svg', href: 'https://en.unesco.org/programme/mow', width: 200, height: 40 },
  { name: 'TU Delft', src: '/partners/tudelft-white.svg', href: 'https://www.tudelft.nl', width: 180, height: 40 },
];

export default function GlobalFooter() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [hasBookshelf, setHasBookshelf] = useState(false);
  const [hasFavorites, setHasFavorites] = useState(false);

  useEffect(() => {
    try {
      const cache = localStorage.getItem('sl_bookshelf_cache');
      if (cache && Object.keys(JSON.parse(cache)).length > 0) {
        setHasBookshelf(true);
      }
    } catch { /* ignore */ }

    try {
      const likes = localStorage.getItem('sl_visitor_likes');
      if (likes && JSON.parse(likes).length > 0) {
        setHasFavorites(true);
      }
    } catch { /* ignore */ }

    analytics.stats()
      .then((data: any) => {
        setStats({
          totalBooks: data.totalBooks || 0,
          pagesTranslated: data.pagesTranslated || 0,
        });
      })
      .catch(() => {});
  }, []);

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${Math.round(n / 1000)}K`;
    return n.toLocaleString();
  };

  return (
    <footer className="bg-dark text-white/60 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Zone 1: Brand + Mission */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-8 border-b border-white/[0.08]">
          <Link href="/" className="flex items-center gap-3 group">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="white" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1" />
            </svg>
            <span className="text-white font-sans text-sm font-semibold tracking-[0.15em] uppercase">
              Source Library
            </span>
          </Link>
          <p className="font-serif italic text-white/50 text-lg">
            Wisdom belongs to everyone.
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
                {col.title === 'Library' && hasBookshelf && (
                  <li>
                    <Link href="/bookshelf" className="text-sm text-white/50 hover:text-white transition-colors">
                      My Bookshelf
                    </Link>
                  </li>
                )}
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

        {/* Zone 3: Partners + Stats + Copyright */}
        <div className="py-8 space-y-6">
          {/* Partner logos */}
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
                  className="h-8 w-auto"
                  unoptimized
                />
              </a>
            ))}
          </div>

          {/* Stats line */}
          <div className="text-center">
            <Link
              href="/analytics"
              className="text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              {stats
                ? `${formatNumber(stats.totalBooks)} Books \u00B7 ${formatNumber(stats.pagesTranslated)} Pages Translated \u00B7 CC0 Public Domain`
                : 'CC0 Public Domain'}
            </Link>
          </div>

          {/* Copyright + legal */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 text-xs text-white/30">
            <span>&copy; 2026 Source Library &mdash; An initiative of the Embassy of the Free Mind</span>
            <span className="hidden sm:inline">&middot;</span>
            <div className="flex items-center gap-3">
              <Link href="/privacy" className="hover:text-white/50 transition-colors">Privacy</Link>
              <Link href="/terms" className="hover:text-white/50 transition-colors">Terms</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
