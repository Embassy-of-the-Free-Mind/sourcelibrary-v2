'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';

interface IndexEntry {
  term: string;
  pages: number[];
  type: 'vocab' | 'term' | 'keyword';
}

interface BookIndexProps {
  entries: IndexEntry[];
  bookSlug: string;
  totalPages: number;
}

const THEME_THRESHOLD = 0.15; // >15% of pages = theme
const MAX_INDEX_VISIBLE = 40;
const MAX_PAGES_INLINE = 8;

export default function BookIndex({ entries, bookSlug, totalPages }: BookIndexProps) {
  const [filter, setFilter] = useState('');

  const { themes, indexEntries } = useMemo(() => {
    const themeThreshold = Math.max(totalPages * THEME_THRESHOLD, 10);
    const themes: IndexEntry[] = [];
    const index: IndexEntry[] = [];

    for (const entry of entries) {
      if (entry.pages.length >= themeThreshold) {
        themes.push(entry);
      } else if (entry.pages.length >= 2) {
        index.push(entry);
      }
      // Skip hapax (1-page entries)
    }

    // Themes stay sorted by frequency; index entries go alphabetical
    index.sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }));

    return { themes, indexEntries: index };
  }, [entries, totalPages]);

  const filtered = useMemo(() => {
    if (!filter) return indexEntries.slice(0, MAX_INDEX_VISIBLE);
    const q = filter.toLowerCase();
    return indexEntries.filter(e => e.term.toLowerCase().includes(q));
  }, [indexEntries, filter]);

  const hapaxCount = entries.length - themes.length - indexEntries.length;

  return (
    <details className="card mt-6">
      <summary className="flex items-center justify-between p-6 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Index</h2>
          <span className="text-xs text-stone-400">{entries.length} terms</span>
        </div>
        <span className="text-sm text-accent-rust">
          See All &rarr;
        </span>
      </summary>
      <div className="px-6 pb-6">
        {/* Themes — high-frequency terms shown as tags */}
        {themes.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">
              Major Themes
            </p>
            <div className="flex flex-wrap gap-1.5">
              {themes.map((t) => (
                <span
                  key={t.term}
                  className="px-2.5 py-1 text-xs bg-stone-100 text-stone-600 rounded-full"
                >
                  {t.term}
                  <span className="ml-1 text-stone-400">{t.pages.length}p</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Filter input */}
        {indexEntries.length > 15 && (
          <div className="mb-4">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filter ${indexEntries.length} index entries...`}
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-accent-rust/30 focus:border-accent-rust/50 placeholder:text-stone-400"
            />
          </div>
        )}

        {/* Index entries — alphabetical, with page links */}
        <div className="space-y-1">
          {filtered.map((entry) => (
            <div key={entry.term} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 border-b border-stone-50 last:border-0">
              <span className={`text-sm font-medium ${
                entry.type === 'vocab' ? 'italic text-stone-600' : 'text-stone-800'
              }`}>
                {entry.term}
              </span>
              <span className="text-xs text-stone-400">
                {entry.pages.slice(0, MAX_PAGES_INLINE).map((p, i) => (
                  <span key={p}>
                    {i > 0 && ', '}
                    <Link
                      href={`/book/${bookSlug}/page/${p}`}
                      className="text-accent-rust hover:text-accent-gold-dark hover:underline"
                    >
                      p.&thinsp;{p}
                    </Link>
                  </span>
                ))}
                {entry.pages.length > MAX_PAGES_INLINE && (
                  <span className="text-stone-300 ml-1">
                    +{entry.pages.length - MAX_PAGES_INLINE} more
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        {!filter && indexEntries.length > MAX_INDEX_VISIBLE && (
          <p className="text-xs text-stone-400 mt-4 pt-3 border-t border-stone-100">
            Showing {MAX_INDEX_VISIBLE} of {indexEntries.length} entries.
            {hapaxCount > 0 && ` ${hapaxCount} single-mention terms hidden.`}
          </p>
        )}
        {filter && filtered.length === 0 && (
          <p className="text-xs text-stone-400 py-4">
            No entries matching &ldquo;{filter}&rdquo;
          </p>
        )}
      </div>
    </details>
  );
}
