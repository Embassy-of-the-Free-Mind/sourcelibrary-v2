'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, X } from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';
import CollectionBookCard from '@/components/CollectionBookCard';
import type { TimelineOverview, TimelineBook, DecadeBucket } from '@/lib/api-client/types/timeline';

/* ── Historical eras ── */
interface Era {
  name: string;
  label: string;
  from: number;
  to: number;
  color: string;
  description: string;
}

const ERAS: Era[] = [
  {
    name: 'antiquity',
    label: 'Antiquity',
    from: -3000,
    to: 500,
    color: 'var(--accent-sage)',
    description: 'The classical foundations — Hermes Trismegistus, Plato, the Neoplatonists, and the Corpus Hermeticum.',
  },
  {
    name: 'medieval',
    label: 'Medieval',
    from: 500,
    to: 1400,
    color: 'var(--accent-gold)',
    description: 'Transmission and transformation — Arab scholars preserve Greek wisdom, the Kabbalah emerges, alchemy enters the Latin West.',
  },
  {
    name: 'renaissance',
    label: 'Renaissance',
    from: 1400,
    to: 1550,
    color: 'var(--accent-rust)',
    description: 'The great recovery — Ficino translates the Hermetica, Pico writes the Oration, the prisca theologia becomes philosophy.',
  },
  {
    name: 'reformation',
    label: 'Reformation',
    from: 1550,
    to: 1650,
    color: 'var(--accent-violet)',
    description: 'Rosicrucian manifestos, Paracelsian medicine, Dee and Fludd — esoteric thought flourishes amid religious upheaval.',
  },
  {
    name: 'enlightenment',
    label: 'Enlightenment',
    from: 1650,
    to: 1800,
    color: '#6b8a9e',
    description: 'Freemasonry, Swedenborg, and the occult underground — hidden knowledge adapts to the age of reason.',
  },
  {
    name: 'modern',
    label: 'Modern',
    from: 1800,
    to: 2100,
    color: '#8a8480',
    description: 'Revival and scholarship — the Golden Dawn, Theosophy, and the academic study of Western esotericism.',
  },
];

function getEraForDecade(decade: number): Era | undefined {
  return ERAS.find(e => decade >= e.from && decade < e.to);
}

/* ── Language colors ── */
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
const DEFAULT_COLOR = '#a8a29e';

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
  const selectedEraName = searchParams.get('era') || '';
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

  // Filter decades by language and/or era
  const filteredDecades = useMemo(() => {
    let decades = initialData.decades;

    if (language) {
      decades = decades
        .map(d => {
          const match = d.languages.find(l => l.lang === language);
          if (!match) return null;
          return { decade: d.decade, count: match.count, languages: [match] } as DecadeBucket;
        })
        .filter((d): d is DecadeBucket => d !== null);
    }

    if (selectedEraName) {
      const era = ERAS.find(e => e.name === selectedEraName);
      if (era) {
        decades = decades.filter(d => d.decade >= era.from && d.decade < era.to);
      }
    }

    return decades;
  }, [initialData.decades, language, selectedEraName]);

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

  // Fetch books when decade selected
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

  // Group decades by era for bracket labels
  const eraGroups = useMemo(() => {
    if (!filteredDecades.length) return [];
    const result: { era: Era; startIndex: number; span: number }[] = [];
    let currentEra = getEraForDecade(filteredDecades[0].decade);
    let startIndex = 0;
    let span = 0;

    for (let i = 0; i < filteredDecades.length; i++) {
      const era = getEraForDecade(filteredDecades[i].decade);
      if (era?.name !== currentEra?.name) {
        if (currentEra) result.push({ era: currentEra, startIndex, span });
        currentEra = era;
        startIndex = i;
        span = 0;
      }
      span++;
    }
    if (currentEra) result.push({ era: currentEra, startIndex, span });
    return result;
  }, [filteredDecades]);

  // Top languages for the legend
  const legendLanguages = useMemo(() => {
    return initialData.summary.topLanguages.slice(0, 6);
  }, [initialData.summary.topLanguages]);

  const selectedEra = selectedDecade !== null ? getEraForDecade(selectedDecade) : null;

  return (
    <div className="space-y-10">
      {/* Era navigation pills */}
      <div className="flex flex-wrap gap-2 justify-center">
        {ERAS.filter(era => {
          // Only show eras that have data
          return initialData.decades.some(d => d.decade >= era.from && d.decade < era.to);
        }).map(era => {
          const isActive = selectedEraName === era.name;
          const eraCount = initialData.decades
            .filter(d => d.decade >= era.from && d.decade < era.to)
            .reduce((sum, d) => sum + d.count, 0);

          return (
            <button
              key={era.name}
              onClick={() => updateParams({
                era: isActive ? null : era.name,
                decade: null,
                offset: null,
              })}
              className={`group relative px-4 py-2 rounded-full text-sm transition-all ${
                isActive
                  ? 'text-white shadow-md'
                  : 'text-stone-600 hover:text-stone-900 bg-stone-100/60 hover:bg-stone-100'
              }`}
              style={isActive ? { backgroundColor: era.color } : undefined}
            >
              <span className="font-serif tracking-wide">{era.label}</span>
              <span className={`ml-1.5 text-xs ${isActive ? 'text-white/70' : 'text-stone-400'}`}>
                {eraCount}
              </span>
            </button>
          );
        })}
      </div>

      {/* Era description card */}
      {selectedEraName && (() => {
        const era = ERAS.find(e => e.name === selectedEraName);
        if (!era) return null;
        return (
          <div
            className="rounded-xl px-6 py-5 border"
            style={{
              borderColor: `color-mix(in srgb, ${era.color} 25%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${era.color} 4%, white)`,
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-serif text-xl text-stone-900 mb-1">
                  {era.label}
                  <span className="ml-2 text-sm font-sans text-stone-400 font-normal">
                    {era.from < 0 ? `${Math.abs(era.from)} BC` : era.from}&ndash;{era.to}
                  </span>
                </h3>
                <p className="text-stone-600 text-sm leading-relaxed font-body max-w-2xl">
                  {era.description}
                </p>
              </div>
              <button
                onClick={() => updateParams({ era: null, decade: null, offset: null })}
                className="text-stone-400 hover:text-stone-600 p-1 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })()}

      {/* Filter bar + legend */}
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
        <span className="text-sm text-stone-500 ml-auto font-body">
          {filteredSummary.total.toLocaleString()} texts
        </span>
      </div>

      {/* Language legend */}
      {!language && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-stone-500">
          {legendLanguages.map(l => (
            <button
              key={l.lang}
              className="flex items-center gap-1.5 hover:text-stone-700 transition-colors"
              onClick={() => updateParams({ language: l.lang, decade: null, offset: null })}
            >
              <span
                className="w-2.5 h-2.5 rounded-sm inline-block"
                style={{ backgroundColor: getLangColor(l.lang) }}
              />
              {l.lang}
            </button>
          ))}
          {initialData.summary.topLanguages.length > 6 && (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: DEFAULT_COLOR }} />
              Other
            </span>
          )}
        </div>
      )}

      {/* ── Histogram ── */}
      <div className="relative">
        {/* Chart area with warm background */}
        <div className="rounded-xl bg-[#faf8f4] border border-stone-200/60 p-4 pb-2 overflow-x-auto">
          <div
            className="flex items-end gap-px relative"
            style={{ minWidth: Math.max(filteredDecades.length * 14, 600), height: 320 }}
          >
            {/* Horizontal guide lines */}
            {[0.25, 0.5, 0.75, 1].map(frac => (
              <div
                key={frac}
                className="absolute left-0 right-0 border-t border-stone-200/40"
                style={{ bottom: `${frac * 100}%` }}
              />
            ))}

            {filteredDecades.map(d => (
              <DecadeBar
                key={d.decade}
                bucket={d}
                maxCount={maxCount}
                isSelected={d.decade === selectedDecade}
                era={getEraForDecade(d.decade)}
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

          {/* Era labels along x-axis */}
          <div className="flex mt-3 border-t border-[var(--accent-gold)]/20 pt-2" style={{ minWidth: Math.max(filteredDecades.length * 14, 600) }}>
            {eraGroups.map(({ era, span }) => (
              <button
                key={era.name}
                className="text-center group cursor-pointer"
                style={{ flex: `${span} 1 0%` }}
                onClick={() => updateParams({
                  era: selectedEraName === era.name ? null : era.name,
                  decade: null,
                  offset: null,
                })}
              >
                <div
                  className="h-0.5 mx-2 mb-1.5 rounded-full opacity-40 group-hover:opacity-70 transition-opacity"
                  style={{ backgroundColor: era.color }}
                />
                <span
                  className="text-[11px] font-serif tracking-wide transition-colors"
                  style={{ color: selectedEraName === era.name ? era.color : 'var(--text-muted)' }}
                >
                  {era.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Book detail panel ── */}
      {selectedDecade !== null && (
        <div ref={detailRef} className="pt-2">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-serif text-stone-900">
              {formatDecadeLabel(selectedDecade)}
              {selectedEra && (
                <span
                  className="ml-3 text-sm font-sans font-normal"
                  style={{ color: selectedEra.color }}
                >
                  {selectedEra.label}
                </span>
              )}
              <span className="ml-3 text-base font-sans font-normal text-stone-500">
                {booksTotal.toLocaleString()} {booksTotal === 1 ? 'text' : 'texts'}
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
            <p className="text-center py-12 text-stone-500 font-body">No texts found for this decade.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {books.map((book, i) => (
                  <CollectionBookCard
                    key={book.id}
                    book={{
                      bookId: book.id,
                      id: book.id,
                      slug: book.slug,
                      title: book.display_title || book.title,
                      author: book.author || '',
                      year: book.year,
                      pages_count: book.pages_count,
                      pages_translated: book.pages_translated,
                      thumbnail: book.thumbnail_blob || book.thumbnail,
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
                  <span className="text-sm text-stone-500 font-body">
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

/* ── Sub-components ── */

function DecadeBar({
  bucket,
  maxCount,
  isSelected,
  era,
  onClick,
}: {
  bucket: DecadeBucket;
  maxCount: number;
  isSelected: boolean;
  era?: Era;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const heightPct = Math.max(1.5, (bucket.count / maxCount) * 100);
  const top3 = bucket.languages.slice(0, 3);
  const rest = bucket.count - top3.reduce((s, l) => s + l.count, 0);

  return (
    <div
      className="flex-1 relative cursor-pointer group"
      style={{ minWidth: 8, height: '100%' }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Tooltip */}
      {hovered && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 pointer-events-none">
          <div className="bg-[#1a1612] text-white text-xs rounded-lg px-3 py-2.5 whitespace-nowrap shadow-lg">
            <div className="font-serif text-sm mb-1">{formatDecadeLabel(bucket.decade)}</div>
            {era && (
              <div className="text-stone-400 text-[10px] mb-1.5">{era.label}</div>
            )}
            <div className="text-stone-300 mb-1.5">{bucket.count} {bucket.count === 1 ? 'text' : 'texts'}</div>
            {bucket.languages.slice(0, 4).map(l => (
              <div key={l.lang} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: getLangColor(l.lang) }} />
                <span>{l.lang}: {l.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bar — positioned at the bottom */}
      <div className="absolute bottom-0 left-0 right-0 flex flex-col justify-end" style={{ height: '100%' }}>
        <div
          className={`rounded-t-sm overflow-hidden transition-all duration-200 ${
            isSelected
              ? 'ring-2 ring-[var(--accent-rust)] ring-offset-1 ring-offset-[#faf8f4]'
              : 'opacity-75 group-hover:opacity-100'
          }`}
          style={{ height: `${heightPct}%` }}
        >
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

/* ── Helpers ── */

function formatDecadeLabel(decade: number): string {
  if (decade < 0) return `${Math.abs(decade)}s BC`;
  return `${decade}s`;
}
