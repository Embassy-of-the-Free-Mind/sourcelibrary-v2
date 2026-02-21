'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, X } from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';
import CollectionBookCard from '@/components/CollectionBookCard';
import type { TimelineOverview, TimelineBook, DecadeBucket } from '@/lib/api-client/types/timeline';

const LANG_COLORS: Record<string, string> = {
  Latin: 'var(--accent-rust)',
  German: 'var(--accent-sage)',
  French: 'var(--accent-violet)',
  English: 'var(--accent-gold)',
  Italian: '#7c8c6e',
  Hebrew: '#b0856a',
  Arabic: '#8a7b6b',
  Greek: '#6b8a9e',
};
const DEFAULT_COLOR = '#a8a29e'; // stone-400

function getLangColor(lang: string): string {
  return LANG_COLORS[lang] || DEFAULT_COLOR;
}

const PER_PAGE = 30;

interface Props {
  initialData: TimelineOverview;
}

export default function TimelineClient({ initialData }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const language = searchParams.get('language') || '';
  const selectedDecade = searchParams.get('decade') ? parseInt(searchParams.get('decade')!) : null;
  const offset = parseInt(searchParams.get('offset') || '0');

  const [books, setBooks] = useState<TimelineBook[]>([]);
  const [booksTotal, setBooksTotal] = useState(0);
  const [loadingBooks, setLoadingBooks] = useState(false);

  const detailRef = useRef<HTMLDivElement>(null);

  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    router.push(`/timeline?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // Filter decades client-side from initial data — no API call needed
  const filteredDecades = useMemo(() => {
    if (!language) return initialData.decades;

    return initialData.decades
      .map(d => {
        const match = d.languages.find(l => l.lang === language);
        if (!match) return null;
        return {
          decade: d.decade,
          count: match.count,
          languages: [match],
        } as DecadeBucket;
      })
      .filter((d): d is DecadeBucket => d !== null);
  }, [initialData.decades, language]);

  const filteredSummary = useMemo(() => {
    const total = filteredDecades.reduce((sum, d) => sum + d.count, 0);
    const allYears = filteredDecades.map(d => d.decade);
    return {
      total,
      yearRange: {
        min: allYears.length ? allYears[0] : 0,
        max: allYears.length ? allYears[allYears.length - 1] + 9 : 0,
      },
    };
  }, [filteredDecades]);

  // Fetch books when decade selected (this still needs an API call)
  useEffect(() => {
    if (selectedDecade === null) {
      setBooks([]);
      setBooksTotal(0);
      return;
    }
    let cancelled = false;
    setLoadingBooks(true);
    const qs = new URLSearchParams({
      decade: String(selectedDecade),
      limit: String(PER_PAGE),
      offset: String(offset),
    });
    if (language) qs.set('language', language);

    fetch(`/api/books/timeline?${qs}`)
      .then(r => r.json())
      .then(d => {
        if (!cancelled) {
          setBooks(d.books || []);
          setBooksTotal(d.total || 0);
        }
      })
      .finally(() => { if (!cancelled) setLoadingBooks(false); });

    return () => { cancelled = true; };
  }, [selectedDecade, offset, language]);

  // Scroll to detail panel when books load
  useEffect(() => {
    if (selectedDecade !== null && detailRef.current && !loadingBooks && books.length > 0) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedDecade, loadingBooks, books.length]);

  const maxCount = useMemo(() => Math.max(...filteredDecades.map(d => d.count), 1), [filteredDecades]);

  // Group decades by century for labeling
  const centuries = useMemo(() => {
    if (!filteredDecades.length) return [];
    const result: { century: number; startIndex: number; span: number }[] = [];
    let currentCentury = Math.floor(filteredDecades[0].decade / 100) * 100;
    let startIndex = 0;
    let span = 0;
    for (let i = 0; i < filteredDecades.length; i++) {
      const c = Math.floor(filteredDecades[i].decade / 100) * 100;
      if (c !== currentCentury) {
        result.push({ century: currentCentury, startIndex, span });
        currentCentury = c;
        startIndex = i;
        span = 0;
      }
      span++;
    }
    result.push({ century: currentCentury, startIndex, span });
    return result;
  }, [filteredDecades]);

  // Top languages for the legend
  const legendLanguages = useMemo(() => {
    return initialData.summary.topLanguages.slice(0, 6);
  }, [initialData.summary.topLanguages]);

  return (
    <div className="space-y-8">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterDropdown
          label="Language"
          value={language}
          options={initialData.filters.languages}
          onChange={v => updateParams({ language: v || null, decade: null, offset: null })}
        />
        {language && (
          <button
            onClick={() => updateParams({ language: null, decade: null, offset: null })}
            className="flex items-center gap-1 px-3 py-2 text-sm text-stone-600 hover:text-stone-900 border border-stone-200 rounded-lg hover:bg-stone-50 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Reset
          </button>
        )}

        <span className="text-sm text-stone-500 ml-auto">
          {filteredSummary.total.toLocaleString()} books
        </span>
      </div>

      {/* Legend */}
      {!language && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
          {legendLanguages.map(l => (
            <span key={l.lang} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-sm inline-block"
                style={{ backgroundColor: getLangColor(l.lang) }}
              />
              {l.lang} ({l.count.toLocaleString()})
            </span>
          ))}
          {initialData.summary.topLanguages.length > 6 && (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: DEFAULT_COLOR }} />
              Other
            </span>
          )}
        </div>
      )}

      {/* Decade bar chart */}
      <div className="relative">
        <div className="overflow-x-auto pb-2">
          <div
            className="flex items-end gap-px"
            style={{ minWidth: Math.max(filteredDecades.length * 14, 600) }}
          >
            {filteredDecades.map(d => (
              <DecadeBar
                key={d.decade}
                bucket={d}
                maxCount={maxCount}
                isSelected={d.decade === selectedDecade}
                onClick={() => {
                  if (d.decade === selectedDecade) {
                    updateParams({ decade: null, offset: null });
                  } else {
                    updateParams({ decade: String(d.decade), offset: null });
                  }
                }}
              />
            ))}
          </div>
          {/* Century labels */}
          <div className="flex mt-1" style={{ minWidth: Math.max(filteredDecades.length * 14, 600) }}>
            {centuries.map(c => (
              <div
                key={c.century}
                className="text-[10px] text-stone-400 text-center border-l border-stone-200 first:border-l-0"
                style={{ flex: `${c.span} 1 0%` }}
              >
                {formatCentury(c.century)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Book detail panel */}
      {selectedDecade !== null && (
        <div ref={detailRef} className="pt-2">
          <div className="flex items-center justify-between mb-6">
            <h2
              className="text-2xl font-bold text-stone-900"
              style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
            >
              {formatDecadeLabel(selectedDecade)}
              <span className="ml-3 text-base font-normal text-stone-500">
                {booksTotal.toLocaleString()} {booksTotal === 1 ? 'book' : 'books'}
              </span>
            </h2>
            <button
              onClick={() => updateParams({ decade: null, offset: null })}
              className="text-stone-400 hover:text-stone-600 p-1"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {loadingBooks ? (
            <div className="flex justify-center py-16">
              <BookLoader size="sm" />
            </div>
          ) : books.length === 0 ? (
            <p className="text-center py-12 text-stone-500">No books found for this decade.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {books.map((book, i) => (
                  <CollectionBookCard
                    key={book.id}
                    book={{
                      bookId: book.id,
                      id: book.id,
                      title: book.display_title || book.title,
                      author: book.author || '',
                      year: book.year,
                      pages_count: book.pages_count,
                      pages_translated: book.pages_translated,
                      thumbnail: book.thumbnail,
                      language: book.language,
                    }}
                    priority={i < 5}
                  />
                ))}
              </div>

              {/* Pagination */}
              {booksTotal > PER_PAGE && (
                <div className="flex items-center justify-center gap-4 mt-8">
                  <button
                    onClick={() => updateParams({ offset: String(Math.max(0, offset - PER_PAGE)) })}
                    disabled={offset === 0}
                    className="px-4 py-2 text-sm border border-stone-200 rounded-lg disabled:opacity-40 hover:bg-stone-50 transition-colors"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-stone-500">
                    {offset + 1}&ndash;{Math.min(offset + PER_PAGE, booksTotal)} of {booksTotal}
                  </span>
                  <button
                    onClick={() => updateParams({ offset: String(offset + PER_PAGE) })}
                    disabled={offset + PER_PAGE >= booksTotal}
                    className="px-4 py-2 text-sm border border-stone-200 rounded-lg disabled:opacity-40 hover:bg-stone-50 transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

function DecadeBar({
  bucket,
  maxCount,
  isSelected,
  onClick,
}: {
  bucket: DecadeBucket;
  maxCount: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const height = Math.max(4, (bucket.count / maxCount) * 280);
  const top3 = bucket.languages.slice(0, 3);
  const rest = bucket.count - top3.reduce((s, l) => s + l.count, 0);

  return (
    <div
      className="flex-1 relative cursor-pointer group"
      style={{ minWidth: 8 }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Tooltip */}
      {hovered && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 pointer-events-none">
          <div className="bg-stone-800 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
            <div className="font-semibold mb-1">{formatDecadeLabel(bucket.decade)}</div>
            <div className="text-stone-300 mb-1">{bucket.count} {bucket.count === 1 ? 'book' : 'books'}</div>
            {bucket.languages.slice(0, 4).map(l => (
              <div key={l.lang} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: getLangColor(l.lang) }} />
                <span>{l.lang}: {l.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bar */}
      <div
        className={`rounded-t-sm overflow-hidden transition-all ${
          isSelected
            ? 'ring-2 ring-[var(--accent-rust)] ring-offset-1'
            : 'opacity-80 group-hover:opacity-100'
        }`}
        style={{ height }}
      >
        {/* Stacked language segments */}
        <div className="w-full h-full flex flex-col-reverse">
          {rest > 0 && (
            <div
              style={{
                height: `${(rest / bucket.count) * 100}%`,
                backgroundColor: DEFAULT_COLOR,
              }}
            />
          )}
          {[...top3].reverse().map(l => (
            <div
              key={l.lang}
              style={{
                height: `${(l.count / bucket.count) * 100}%`,
                backgroundColor: getLangColor(l.lang),
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FilterDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none bg-white border border-stone-200 rounded-lg pl-3 pr-8 py-2 text-sm text-stone-700 hover:border-stone-300 focus:outline-none focus:ring-2 focus:ring-[var(--accent-rust)]/30 focus:border-[var(--accent-rust)] cursor-pointer"
      >
        <option value="">All {label}s</option>
        {options.map(o => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
    </div>
  );
}

// --- Helpers ---

function formatDecadeLabel(decade: number): string {
  if (decade < 0) return `${Math.abs(decade)}s BC`;
  return `${decade}s`;
}

function formatCentury(centuryStart: number): string {
  if (centuryStart < 0) {
    const num = Math.abs(centuryStart / 100);
    return `${num}th c. BC`;
  }
  const num = centuryStart / 100 + 1;
  const suffix = num === 1 ? 'st' : num === 2 ? 'nd' : num === 3 ? 'rd' : 'th';
  return `${num}${suffix} c.`;
}
