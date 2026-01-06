'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Eye, Edit3, BarChart3 } from 'lucide-react';

interface GlobalStats {
  totalReads: number;
  totalEdits: number;
  totalBooks: number;
  totalPages: number;
  pagesTranslated: number;
}

export default function GlobalFooter() {
  const [stats, setStats] = useState<GlobalStats | null>(null);

  useEffect(() => {
    fetch('/api/analytics/stats')
      .then(res => res.json())
      .then(data => {
        if (data.global) {
          setStats(data);
        }
      })
      .catch(console.error);
  }, []);

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

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
            <span>books</span>
          </div>
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-amber-600" />
            <span className="text-stone-300 font-medium">{stats ? formatNumber(stats.totalReads) : '—'}</span>
            <span>reads</span>
          </div>
          <div className="flex items-center gap-2">
            <Edit3 className="w-4 h-4 text-amber-600" />
            <span className="text-stone-300 font-medium">{stats ? formatNumber(stats.pagesTranslated) : '—'}</span>
            <span>pages translated</span>
          </div>
          <div className="flex items-center gap-1.5 text-amber-600 group-hover:text-amber-500">
            <BarChart3 className="w-4 h-4" />
            <span className="text-xs">View Analytics</span>
          </div>
        </Link>

        {/* Bottom row */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 text-xs text-stone-500 border-t border-stone-800 pt-6">
          <span>CC0 Public Domain</span>
          <span className="hidden sm:inline">•</span>
          <Link
            href="/about/research"
            className="text-amber-600 hover:text-amber-500 transition-colors"
          >
            Research
          </Link>
          <span className="hidden sm:inline">•</span>
          <Link
            href="/support"
            className="text-amber-600 hover:text-amber-500 transition-colors"
          >
            Support
          </Link>
          <span className="hidden sm:inline">•</span>
          <a
            href="mailto:derek@ancientwisdomtrust.org"
            className="text-amber-600 hover:text-amber-500 transition-colors"
          >
            derek@ancientwisdomtrust.org
          </a>
        </div>
      </div>
    </footer>
  );
}
