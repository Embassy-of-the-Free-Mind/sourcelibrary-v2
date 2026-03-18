'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { BookOpen, Languages, Globe, Scroll, TrendingUp, DollarSign, Loader2 } from 'lucide-react';
import { analytics } from '@/lib/api-client';
import { BookLoader } from '@/components/ui/BookLoader';
import type { CanonData } from '@/lib/api-client/types/analytics';
import { formatNumber, formatCost } from '../shared/formatters';

export default function CanonTab() {
  const [data, setData] = useState<CanonData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    analytics.canon().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-12"><BookLoader size="xs" /></div>;
  if (!data) return null;

  const { canon, coverage, languages, traditions, recent_completions, economics, pipeline } = data;

  return (
    <div className="space-y-8">
      {/* Mission headline */}
      <div
        className="p-6 rounded-xl"
        style={{
          background: 'linear-gradient(135deg, var(--bg-white), #fef7ed)',
          border: '1px solid var(--border-light)',
        }}
      >
        <p className="text-sm uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>
          The Canon
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <div className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {formatNumber(canon.total_books)}
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              books in collection
            </div>
          </div>
          <div>
            <div className="text-3xl font-bold" style={{ color: 'var(--accent-rust)' }}>
              {formatNumber(canon.readable_books)}
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              fully readable ({canon.readable_percent}%)
            </div>
          </div>
          <div>
            <div className="text-3xl font-bold" style={{ color: 'var(--accent-sage-dark)' }}>
              {formatNumber(canon.first_translations)}
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              first English translations
            </div>
          </div>
          <div>
            <div className="text-3xl font-bold" style={{ color: 'var(--accent-violet)' }}>
              {formatNumber(canon.first_translations_complete)}
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              complete first translations
            </div>
          </div>
        </div>
      </div>

      {/* Coverage + Economics row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4" style={{ color: 'var(--accent-sage)' }} />
            <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>OCR Coverage</span>
          </div>
          <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {formatNumber(coverage.ocr_pages)}
          </div>
          <div className="text-sm" style={{ color: 'var(--accent-sage)' }}>
            {coverage.ocr_percent}% of {formatNumber(canon.total_pages)} pages
          </div>
          <ProgressBar percent={coverage.ocr_percent} color="var(--accent-sage)" />
        </div>

        <div className="p-5 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Languages className="w-4 h-4" style={{ color: 'var(--accent-rust)' }} />
            <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Translation Coverage</span>
          </div>
          <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {formatNumber(coverage.translated_pages)}
          </div>
          <div className="text-sm" style={{ color: 'var(--accent-rust)' }}>
            {coverage.translated_percent}% of all pages
          </div>
          <ProgressBar percent={coverage.translated_percent} color="var(--accent-rust)" />
        </div>

        <div className="p-5 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Economics (30d)</span>
          </div>
          <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {formatCost(economics.cost_per_page_30d)}
            <span className="text-sm font-normal ml-1" style={{ color: 'var(--text-muted)' }}>/page</span>
          </div>
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {formatNumber(economics.pages_translated_30d)} pages for {formatCost(economics.total_cost_30d)}
          </div>
          {pipeline.processing > 0 && (
            <div className="flex items-center gap-1 mt-2 text-xs" style={{ color: 'var(--accent-sage)' }}>
              <Loader2 className="w-3 h-3 animate-spin" />
              {pipeline.processing} jobs active, {pipeline.queued} queued
            </div>
          )}
        </div>
      </div>

      {/* Languages table */}
      <div>
        <h3 className="text-lg font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
          <Globe className="w-4 h-4 inline mr-2" style={{ color: 'var(--text-muted)' }} />
          Coverage by Language
        </h3>
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-light)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-warm)' }}>
                <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text-muted)' }}>Language</th>
                <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--text-muted)' }}>Books</th>
                <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--text-muted)' }}>Readable</th>
                <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--text-muted)' }}>Pages</th>
                <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--text-muted)' }}>Translated</th>
                <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--text-muted)' }}>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {languages.map((lang) => (
                <tr
                  key={lang.language}
                  className="border-t"
                  style={{ borderColor: 'var(--border-light)', background: 'var(--bg-white)' }}
                >
                  <td className="px-4 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                    {lang.language}
                  </td>
                  <td className="px-4 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>
                    {formatNumber(lang.books)}
                  </td>
                  <td className="px-4 py-2 text-right" style={{ color: 'var(--accent-sage-dark)' }}>
                    {formatNumber(lang.readable)}
                  </td>
                  <td className="px-4 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>
                    {formatNumber(lang.pages)}
                  </td>
                  <td className="px-4 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>
                    {formatNumber(lang.translated)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span
                      className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                      style={{
                        background: lang.coverage > 50 ? '#f0fdf4' : lang.coverage > 10 ? '#fef7ed' : '#fef2f2',
                        color: lang.coverage > 50 ? '#166534' : lang.coverage > 10 ? '#9a3412' : '#991b1b',
                      }}
                    >
                      {lang.coverage}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Traditions + Recent completions row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* By tradition */}
        <div>
          <h3 className="text-lg font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
            <Scroll className="w-4 h-4 inline mr-2" style={{ color: 'var(--text-muted)' }} />
            By Tradition
          </h3>
          <div className="space-y-2">
            {traditions.map((t) => (
              <div
                key={t.collection}
                className="flex items-center justify-between p-3 rounded-lg"
                style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}
              >
                <div>
                  <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                    {t.collection}
                  </span>
                  <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                    {t.books} books
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium" style={{ color: 'var(--accent-sage-dark)' }}>
                    {t.readable}
                  </span>
                  <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>readable</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent completions */}
        <div>
          <h3 className="text-lg font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
            <TrendingUp className="w-4 h-4 inline mr-2" style={{ color: 'var(--text-muted)' }} />
            Recently Completed Translations
          </h3>
          {recent_completions.length === 0 ? (
            <p className="text-sm py-4" style={{ color: 'var(--text-muted)' }}>
              No completions in the last 30 days
            </p>
          ) : (
            <div className="space-y-2">
              {recent_completions.map((book) => (
                <Link
                  key={book.id}
                  href={`/book/${book.id}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:opacity-80 transition-opacity"
                  style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                      {book.title}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {book.language} · {book.translated}/{book.pages} pages
                    </div>
                  </div>
                  <div className="text-xs ml-3 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                    {book.completed ? new Date(book.completed).toLocaleDateString() : ''}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div
      className="mt-3 h-2 rounded-full overflow-hidden"
      style={{ background: 'var(--bg-warm)' }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.min(percent, 100)}%`, background: color }}
      />
    </div>
  );
}
