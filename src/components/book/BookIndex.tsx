'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import PlusToggle from './PlusToggle';
import { useLocale, useLocalePath } from '@/lib/i18n';
import { BOOK_STRINGS } from '@/lib/book-i18n';

interface IndexEntry {
  term: string;
  pages: number[];
  type: 'vocab' | 'term' | 'keyword';
}

interface BookIndexProps {
  entries: IndexEntry[];
  bookSlug: string;
  totalPages: number;
  isEmbedded?: boolean;
}

const THEME_THRESHOLD = 0.15; // >15% of pages = theme
const MAX_INDEX_VISIBLE = 40;
const MAX_PAGES_INLINE = 8;

export default function BookIndex({ entries, bookSlug, totalPages, isEmbedded = false }: BookIndexProps) {
  const [filter, setFilter] = useState('');
  const params = useParams<{ tenant: string }>();
  const tenantPrefix = params?.tenant ? `/${params.tenant}` : '';
  // Chrome follows the URL's locale; the index TERMS stay as generated (English
  // entity labels) — they are content, not chrome.
  const str = BOOK_STRINGS[useLocale()];
  const localePath = useLocalePath();

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
    <details className="card group sl-collapse">
      <summary className="p-4 md:p-6 cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-3 md:gap-4">
        <div className="flex items-baseline gap-3">
          <h3 className="font-display font-medium text-[17px] md:text-[22px]" style={{ color: '#2b2620' }}>{str.index}</h3>
          <span className="text-xs" style={{ color: '#a09884' }}>{str.indexTerms(entries.length)}</span>
        </div>
        <PlusToggle />
      </summary>
      <div className="px-4 pb-4 md:px-6 md:pb-6">
        {/* Themes — high-frequency terms shown as tags */}
        {themes.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">
              {str.majorThemes}
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
              placeholder={str.filterIndex(indexEntries.length)}
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-accent-rust/30 focus:border-accent-rust/50 placeholder:text-stone-400"
            />
          </div>
        )}

        {/* Index entries — alphabetical, with page links */}
        <div className="space-y-1">
          {filtered.map((entry) => (
            <div key={entry.term} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 border-b border-stone-50 last:border-0">
              <span className={`text-sm font-medium ${entry.type === 'vocab' ? 'italic text-stone-600' : 'text-stone-800'
                }`}>
                {entry.term}
              </span>
              <span className="text-xs text-stone-400">
                {entry.pages.slice(0, MAX_PAGES_INLINE).map((p, i) => (
                  <span key={p}>
                    {i > 0 && ', '}
                    {isEmbedded ? (
                      <span className="text-accent-rust">
                        p.&thinsp;{p}
                      </span>
                    ) : (
                      <Link
                        href={localePath(`${tenantPrefix}/book/${bookSlug}/page-number/${p}`)}
                        className="text-accent-rust hover:text-accent-gold-dark hover:underline"
                      >
                        p.&thinsp;{p}
                      </Link>
                    )}
                  </span>
                ))}
                {entry.pages.length > MAX_PAGES_INLINE && (
                  <span className="text-stone-300 ml-1">
                    {str.more(entry.pages.length - MAX_PAGES_INLINE)}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        {!filter && indexEntries.length > MAX_INDEX_VISIBLE && (
          <p className="text-xs text-stone-400 mt-4 pt-3 border-t border-stone-100">
            {str.indexShowing(MAX_INDEX_VISIBLE, indexEntries.length)}
            {hapaxCount > 0 && str.indexHiddenHapax(hapaxCount)}
          </p>
        )}
        {filter && filtered.length === 0 && (
          <p className="text-xs text-stone-400 py-4">
            {str.indexNoMatch(filter)}
          </p>
        )}
      </div>
    </details>
  );
}
