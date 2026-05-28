'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, X, BookOpen, Image as ImageIcon } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { BookLoader } from '@/components/ui/BookLoader';
import CollectionBookCard from '@/components/CollectionBookCard';
import { formatAuthor } from '@/lib/utils';
import type { TimelineOverview, TimelineBook, TimelineArtItem, DecadeBucket } from '@/lib/api-client/types/timeline';

/* ── Historical eras ── */
interface Era {
  name: string;
  label: string;
  from: number;
  to: number;
  color: string;
  description: string;
}

// Timeline range: classical antiquity through the early modern period
const TIMELINE_YEAR_MIN = -800;
const TIMELINE_YEAR_MAX = 1930;

const ERAS: Era[] = [
  {
    name: 'antiquity',
    label: 'Antiquity',
    from: -800,
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
    to: 1930,
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

  const [overviewData, setOverviewData] = useState<TimelineOverview>(initialData);
  const [books, setBooks] = useState<TimelineBook[]>([]);
  const [artItems, setArtItems] = useState<TimelineArtItem[]>([]);
  const [booksTotal, setBooksTotal] = useState(0);
  const [loadingBooks, setLoadingBooks] = useState(false);
  const [viewMode, setViewMode] = useState<'books' | 'art'>('books');

  // Client-side fallback: if SSR returned empty data, fetch from API
  useEffect(() => {
    if (overviewData.decades.length === 0) {
      fetch('/api/books/timeline')
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.decades?.length > 0) setOverviewData(data); })
        .catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Show only the core range: classical antiquity through the early modern period
    let decades = overviewData.decades.filter(d => d.decade >= TIMELINE_YEAR_MIN && d.decade < TIMELINE_YEAR_MAX);

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
  }, [overviewData.decades, language, selectedEraName]);

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

  // Fetch books or art when decade selected
  useEffect(() => {
    if (selectedDecade === null) {
      setBooks([]);
      setArtItems([]);
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
    if (viewMode === 'art') qs.set('mode', 'art');

    fetch(`/api/books/timeline?${qs}`)
      .then(r => r.json())
      .then(d => {
        if (!cancelled) {
          if (viewMode === 'art') {
            setArtItems(d.art || []);
            setBooks([]);
          } else {
            setBooks(d.books || []);
            setArtItems([]);
          }
          setBooksTotal(d.total || 0);
        }
      })
      .finally(() => { if (!cancelled) setLoadingBooks(false); });

    return () => { cancelled = true; };
  }, [selectedDecade, offset, language, viewMode]);

  // Scroll to detail panel when books load
  useEffect(() => {
    if (selectedDecade !== null && detailRef.current && !loadingBooks && books.length > 0) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedDecade, loadingBooks, books.length]);

  // Breakline scaling: cap at a threshold so outlier decades don't crush everything
  // Bars above the cap get a jagged break and a count label
  const barCap = useMemo(() => {
    if (filteredDecades.length === 0) return 1;
    const counts = filteredDecades.map(d => d.count).sort((a, b) => a - b);
    const p90 = counts[Math.floor(counts.length * 0.9)] || 1;
    // Cap at 1.5x the P90 — anything above gets a breakline
    return Math.max(p90 * 1.5, 10);
  }, [filteredDecades]);

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
    return overviewData.summary.topLanguages.slice(0, 6);
  }, [overviewData.summary.topLanguages]);

  const selectedEra = selectedDecade !== null ? getEraForDecade(selectedDecade) : null;

  return (
    <div className="space-y-10">
      {/* Era navigation pills */}
      <div className="flex flex-wrap gap-2 justify-center">
        {ERAS.filter(era => {
          // Only show eras that have data
          return overviewData.decades.some(d => d.decade >= TIMELINE_YEAR_MIN && d.decade < TIMELINE_YEAR_MAX && d.decade >= era.from && d.decade < era.to);
        }).map(era => {
          const isActive = selectedEraName === era.name;
          const eraCount = overviewData.decades
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
          options={overviewData.filters.languages}
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
          {filteredSummary.total.toLocaleString('en-US')} texts
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
          {overviewData.summary.topLanguages.length > 6 && (
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
                barCap={barCap}
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

          {/* Decade tick labels along x-axis */}
          <div className="flex mt-1.5" style={{ minWidth: Math.max(filteredDecades.length * 14, 600) }}>
            {filteredDecades.map((d, i) => {
              // Compute label interval based on pixel density
              // Each bar is ~14px min, so show labels spaced >=60px apart
              const barWidth = Math.max(14, 600 / filteredDecades.length);
              const labelEvery = Math.max(1, Math.ceil(60 / barWidth)); // bars between labels
              const centuryStep = labelEvery <= 3 ? 50 : labelEvery <= 6 ? 100 : 200;
              const absDecade = Math.abs(d.decade);
              const showLabel = absDecade % centuryStep === 0;
              return (
                <div key={d.decade} className="flex-1 text-center" style={{ minWidth: 8 }}>
                  {showLabel && (
                    <span className="text-[9px] text-stone-400 font-mono whitespace-nowrap">
                      {d.decade < 0 ? `${Math.abs(d.decade)} BC` : d.decade}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Era labels along x-axis */}
          <div className="flex mt-1 border-t border-[var(--accent-gold)]/20 pt-2" style={{ minWidth: Math.max(filteredDecades.length * 14, 600) }}>
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

      {/* ── Detail panel ── */}
      {selectedDecade !== null && (
        <div ref={detailRef} className="pt-2">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
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
                  {booksTotal.toLocaleString('en-US')} {viewMode === 'art' ? (booksTotal === 1 ? 'artist' : 'artists') : (booksTotal === 1 ? 'text' : 'texts')}
                </span>
              </h2>

              {/* Books / Art toggle */}
              <div className="flex rounded-lg border border-stone-200 overflow-hidden text-sm">
                <button
                  onClick={() => { setViewMode('books'); updateParams({ offset: null }); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                    viewMode === 'books'
                      ? 'bg-stone-800 text-white'
                      : 'bg-white text-stone-500 hover:text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  Books
                </button>
                <button
                  onClick={() => { setViewMode('art'); updateParams({ offset: null }); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                    viewMode === 'art'
                      ? 'bg-stone-800 text-white'
                      : 'bg-white text-stone-500 hover:text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  Art
                </button>
              </div>
            </div>

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
          ) : viewMode === 'art' ? (
            artItems.length === 0 ? (
              <p className="text-center py-12 text-stone-500 font-body">No illustrations found for this decade.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {artItems.map((item, i) => (
                    <TimelineArtCard key={item.id} item={item} priority={i < 5} />
                  ))}
                </div>

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
            )
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
                      thumbnail: book.thumbnail,
                      thumbnail_blob: book.thumbnail_blob,
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
  barCap,
  isSelected,
  era,
  onClick,
}: {
  bucket: DecadeBucket;
  barCap: number;
  isSelected: boolean;
  era?: Era;
  onClick: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const isClipped = bucket.count > barCap;
  // Clipped bars fill to 100%, normal bars scale linearly against the cap
  const heightPct = isClipped ? 100 : Math.max(1.5, (bucket.count / barCap) * 100);
  const top3 = bucket.languages.slice(0, 3);
  const rest = bucket.count - top3.reduce((s, l) => s + l.count, 0);

  const handleMouseEnter = useCallback(() => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
  }, []);

  return (
    <div
      ref={barRef}
      className="flex-1 relative cursor-pointer group"
      style={{ minWidth: 10, height: '100%' }}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setTooltipPos(null)}
      onTouchStart={handleMouseEnter}
      onTouchEnd={() => setTimeout(() => setTooltipPos(null), 2000)}
    >
      {/* Tooltip — fixed position to escape overflow:hidden */}
      {tooltipPos && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: tooltipPos.x, top: tooltipPos.y, transform: 'translate(-50%, -100%)' }}
        >
          <div className="bg-[#1a1612] text-white text-xs rounded-lg px-3 py-2.5 whitespace-nowrap shadow-lg mb-2">
            <div className="font-serif text-sm mb-1">
              {formatDecadeLabel(bucket.decade)}
              <span className="text-stone-400 font-sans text-[10px] ml-1.5">
                ({bucket.decade}&ndash;{bucket.decade + 9})
              </span>
            </div>
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
        {/* Breakline zigzag for clipped bars */}
        {isClipped && (
          <svg
            className="absolute left-0 right-0"
            style={{ top: `${100 - heightPct}%`, transform: 'translateY(-3px)' }}
            height="8"
            preserveAspectRatio="none"
            viewBox="0 0 20 8"
          >
            <path
              d="M0,4 L2,1 L4,7 L6,1 L8,7 L10,1 L12,7 L14,1 L16,7 L18,1 L20,4"
              fill="none"
              stroke="#faf8f4"
              strokeWidth="2.5"
            />
            <path
              d="M0,4 L2,1 L4,7 L6,1 L8,7 L10,1 L12,7 L14,1 L16,7 L18,1 L20,4"
              fill="none"
              stroke="var(--border-light)"
              strokeWidth="1"
            />
          </svg>
        )}

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

function TimelineArtCard({ item, priority = false }: { item: TimelineArtItem; priority?: boolean }) {
  const [imageError, setImageError] = useState(false);
  const displayUrl = item.thumbnailUrl || item.extractedUrl || item.imageUrl;
  const galleryImageId = `${item.pageId}-${item.detectionIndex}`;
  const authorDisplay = item.author && item.author !== 'Unknown' && item.author !== 'Various'
    ? formatAuthor(item.author).name
    : null;

  return (
    <div className="group rounded-lg overflow-hidden bg-white border border-stone-200/60 hover:shadow-md transition-all hover:-translate-y-0.5">
      <Link href={`/gallery/image/${galleryImageId}`} className="block relative aspect-square bg-stone-100">
        {!imageError ? (
          <Image
            src={displayUrl}
            alt={item.description}
            fill
            quality={85}
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
            onError={() => setImageError(true)}
            unoptimized={!item.thumbnailUrl && !item.extractedUrl}
            priority={priority}
            loading={priority ? 'eager' : 'lazy'}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-stone-300">
            <ImageIcon className="w-8 h-8" />
          </div>
        )}

        {item.type && (
          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] bg-black/60 text-white capitalize">
            {item.type}
          </span>
        )}
      </Link>

      <div className="p-2.5">
        {authorDisplay && (
          <p className="text-sm font-serif text-stone-900 truncate">{authorDisplay}</p>
        )}
        <p className="text-xs text-stone-500 truncate mt-0.5">
          {item.bookTitle}{item.year ? `, ${item.year}` : ''}
        </p>
        {item.description && (
          <p className="text-xs text-stone-400 line-clamp-2 mt-1 leading-relaxed">
            {item.description}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Helpers ── */

function formatDecadeLabel(decade: number): string {
  if (decade < 0) return `${Math.abs(decade)}s BC`;
  return `${decade}s`;
}
