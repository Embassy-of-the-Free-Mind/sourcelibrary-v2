'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Eye, Edit3, BarChart3, Library, Heart } from 'lucide-react';
import { analytics } from '@/lib/api-client';
import FeedbackWidget from '@/components/feedback/FeedbackWidget';

interface GlobalStats {
  totalReads: number;
  totalEdits: number;
  totalBooks: number;
  totalPages: number;
  pagesTranslated: number;
}

export default function GlobalFooter() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [mounted, setMounted] = useState(false);
  const [hasBookshelf, setHasBookshelf] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Check if visitor has bookshelf entries
    try {
      const cache = localStorage.getItem('sl_bookshelf_cache');
      if (cache && Object.keys(JSON.parse(cache)).length > 0) {
        setHasBookshelf(true);
      }
    } catch { /* ignore */ }
    analytics.stats()
      .then((data: any) => {
        setStats({
          totalReads: data.totalReads || 0,
          totalEdits: data.totalEdits || 0,
          totalBooks: data.totalBooks || 0,
          totalPages: data.totalPages || 0,
          pagesTranslated: data.pagesTranslated || 0,
        });
      })
      .catch(console.error);
  }, []);

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  // Prevent hydration mismatch by showing consistent content during SSR
  if (!mounted) {
    return (
      <footer className="bg-stone-900 text-stone-400 py-8 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/analytics"
            className="flex flex-wrap items-center justify-center gap-6 sm:gap-10 mb-6 text-sm hover:text-stone-300 transition-colors group"
          >
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-amber-600" />
              <span className="text-stone-300 font-medium">—</span>
              <span>Books</span>
            </div>
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-amber-600" />
              <span className="text-stone-300 font-medium">—</span>
              <span>Reads</span>
            </div>
            <div className="flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-amber-600" />
              <span className="text-stone-300 font-medium">—</span>
              <span>Pages Translated</span>
            </div>
          </Link>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 text-xs text-stone-500 border-t border-stone-800 pt-6">
            <span>CC0 Public Domain</span>
            <span className="hidden sm:inline">•</span>
            <Link href="/gallery" className="text-amber-600 hover:text-amber-500 transition-colors">
              Gallery
            </Link>
            <span className="hidden sm:inline">•</span>
            <Link href="/favorites" className="text-amber-600 hover:text-amber-500 transition-colors">
              Favorites
            </Link>
            <span className="hidden sm:inline">•</span>
            <Link href="/about" className="text-amber-600 hover:text-amber-500 transition-colors">
              About
            </Link>
            <span className="hidden sm:inline">•</span>
            <Link href="/blog" className="text-amber-600 hover:text-amber-500 transition-colors">
              Blog
            </Link>
            <span className="hidden sm:inline">•</span>
            <Link href="/contribute" className="text-amber-600 hover:text-amber-500 transition-colors">
              Participate
            </Link>
            <span className="hidden sm:inline">•</span>
            <Link href="/support" className="inline-flex items-center gap-1 bg-amber-600/15 text-amber-500 hover:bg-amber-600/25 transition-colors px-2.5 py-0.5 rounded-full">
              Donate
            </Link>
            <span className="hidden sm:inline">•</span>
            <span className="text-amber-600">Feedback</span>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="bg-stone-900 text-stone-400 py-8 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Stats row with link */}
        <Link
          href="/analytics"
          className="flex flex-wrap items-center justify-center gap-6 sm:gap-10 mb-6 text-sm hover:text-stone-300 transition-colors group"
        >
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-amber-600" />
            <span className="text-stone-300 font-medium">{stats ? formatNumber(stats.totalBooks) : '—'}</span>
            <span>Books</span>
          </div>
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-amber-600" />
            <span className="text-stone-300 font-medium">{stats ? formatNumber(stats.totalReads) : '—'}</span>
            <span>Reads</span>
          </div>
          <div className="flex items-center gap-2">
            <Edit3 className="w-4 h-4 text-amber-600" />
            <span className="text-stone-300 font-medium">{stats ? formatNumber(stats.pagesTranslated) : '—'}</span>
            <span>Pages Translated</span>
          </div>
        </Link>

        {/* Bottom row */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 text-xs text-stone-500 border-t border-stone-800 pt-6">
          <span>CC0 Public Domain</span>
          <span className="hidden sm:inline">•</span>
          <Link
            href="/gallery"
            className="text-amber-600 hover:text-amber-500 transition-colors"
          >
            Gallery
          </Link>
          {hasBookshelf && (
            <>
              <span className="hidden sm:inline">•</span>
              <Link
                href="/bookshelf"
                className="flex items-center gap-1 text-amber-600 hover:text-amber-500 transition-colors"
              >
                <Library className="w-3 h-3" />
                My Bookshelf
              </Link>
            </>
          )}
          <span className="hidden sm:inline">•</span>
          <Link
            href="/favorites"
            className="flex items-center gap-1 text-amber-600 hover:text-amber-500 transition-colors"
          >
            <Heart className="w-3 h-3" />
            Favorites
          </Link>
          <span className="hidden sm:inline">•</span>
          <Link
            href="/about"
            className="text-amber-600 hover:text-amber-500 transition-colors"
          >
            About
          </Link>
          <span className="hidden sm:inline">•</span>
          <Link
            href="/blog"
            className="text-amber-600 hover:text-amber-500 transition-colors"
          >
            Blog
          </Link>
          <span className="hidden sm:inline">•</span>
          <Link
            href="/contribute"
            className="text-amber-600 hover:text-amber-500 transition-colors"
          >
            Participate
          </Link>
          <span className="hidden sm:inline">•</span>
          <Link
            href="/support"
            className="inline-flex items-center gap-1 bg-amber-600/15 text-amber-500 hover:bg-amber-600/25 transition-colors px-2.5 py-0.5 rounded-full"
          >
            Donate
          </Link>
          <span className="hidden sm:inline">•</span>
          <FeedbackWidget />
        </div>
      </div>
    </footer>
  );
}
