'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import type { ShwepPageData, EnrichedEpisode, MatchedBook } from './page';

type ViewMode = 'period' | 'recent' | 'storytime';

function getEpisodeType(ep: EnrichedEpisode): 'storytime' | 'podcast' {
  return ep.title.startsWith('Storytime:') ? 'storytime' : 'podcast';
}

interface Props {
  data: ShwepPageData;
}

export default function ShwepClient({ data }: Props) {
  const [search, setSearch] = useState('');
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);
  const [showOnlyWithBooks, setShowOnlyWithBooks] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('recent');

  // Flatten all episodes for non-period views
  const allEpisodes = useMemo(() => {
    return data.periods.flatMap(p => p.episodes);
  }, [data.periods]);

  // Filter episodes
  const filterEpisode = (ep: EnrichedEpisode, q: string) => {
    if (showOnlyWithBooks && ep.bookCount === 0) return false;
    if (!q) return true;
    return (
      ep.title.toLowerCase().includes(q) ||
      ep.tags.some(t => t.toLowerCase().includes(q)) ||
      ep.description?.toLowerCase().includes(q) ||
      ep.books.some(b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q))
    );
  };

  const filteredPeriods = useMemo(() => {
    const q = search.toLowerCase().trim();
    return data.periods.map(period => ({
      ...period,
      episodes: period.episodes.filter(ep => filterEpisode(ep, q)),
    })).filter(p => p.episodes.length > 0);
  }, [data.periods, search, showOnlyWithBooks]);

  const filteredEpisodes = useMemo(() => {
    const q = search.toLowerCase().trim();
    let eps = allEpisodes.filter(ep => filterEpisode(ep, q));
    if (viewMode === 'storytime') {
      eps = eps.filter(ep => getEpisodeType(ep) === 'storytime');
    } else if (viewMode === 'recent') {
      eps = eps.filter(ep => getEpisodeType(ep) === 'podcast');
    }
    // Sort by publication date descending (newest first), fall back to episode number
    return [...eps].sort((a, b) => {
      if (a.publishDate && b.publishDate) return b.publishDate.localeCompare(a.publishDate);
      if (a.publishDate) return -1;
      if (b.publishDate) return 1;
      return b.number - a.number;
    });
  }, [allEpisodes, search, showOnlyWithBooks, viewMode]);

  const totalFiltered = viewMode === 'period'
    ? filteredPeriods.reduce((s, p) => s + p.episodes.length, 0)
    : filteredEpisodes.length;

  const storytimeCount = allEpisodes.filter(ep => getEpisodeType(ep) === 'storytime').length;

  return (
    <>
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-stone-500 hover:text-stone-800 transition-colors"
          >
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1" />
            </svg>
            <span className="font-medium">Source Library</span>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-16">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-start gap-4 mb-4">
            <h1 className="text-4xl md:text-5xl">SHWEP Reading Room</h1>
          </div>
          <p className="text-xl text-stone-300 max-w-3xl mb-6">
            Read the primary sources discussed on the{' '}
            <a
              href="https://shwep.net"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-gold hover:text-accent-gold underline"
            >
              Secret History of Western Esotericism Podcast
            </a>
            . Browse episodes and access original texts in Latin, Greek, Arabic, and more.
          </p>
          <p className="text-sm text-stone-400 max-w-2xl mb-4">
            Find the episode you just listened to, then read the original texts discussed.
            Books marked &ldquo;translated&rdquo; have full English translations you can read alongside the original.
          </p>
          <div className="flex flex-wrap gap-6 text-sm text-stone-400">
            <span>{data.stats.totalEpisodes} episodes</span>
            <span>{data.stats.episodesWithBooks} with source texts</span>
            <span>{data.stats.totalMatches} books linked</span>
            <span>{data.stats.totalBooksInCollection.toLocaleString()} in collection</span>
          </div>
        </div>
      </div>

      {/* Search, Tabs, and Filters */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-stone-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-3 space-y-3">
          {/* View mode tabs */}
          <div className="flex items-center gap-1">
            {([
              { id: 'recent' as const, label: 'Podcast' },
              { id: 'storytime' as const, label: `Storytime (${storytimeCount})` },
              { id: 'period' as const, label: 'By Period' },
            ]).map(tab => (
              <button
                key={tab.id}
                onClick={() => setViewMode(tab.id)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  viewMode === tab.id
                    ? 'bg-stone-800 text-white'
                    : 'text-stone-500 hover:text-stone-700 hover:bg-stone-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search + filter */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search episodes, authors, texts..."
                className="w-full pl-10 pr-4 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-gold focus:border-transparent"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showOnlyWithBooks}
                onChange={e => setShowOnlyWithBooks(e.target.checked)}
                className="rounded border-stone-300 text-accent-rust focus:ring-accent-gold"
              />
              Only episodes with source texts
            </label>
            <span className="text-sm text-stone-400">
              {totalFiltered} episode{totalFiltered !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        {viewMode === 'period' ? (
          <>
            {/* Period Navigation */}
            <div className="flex flex-wrap gap-2 mb-8">
              {data.periods.map(period => {
                const epCount = filteredPeriods.find(p => p.id === period.id)?.episodes.length || 0;
                const bookCount = filteredPeriods
                  .find(p => p.id === period.id)
                  ?.episodes.reduce((s, e) => s + e.bookCount, 0) || 0;
                return (
                  <button
                    key={period.id}
                    onClick={() => {
                      const el = document.getElementById(`period-${period.id}`);
                      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      epCount > 0
                        ? 'border-stone-300 text-stone-700 hover:bg-stone-100'
                        : 'border-stone-200 text-stone-400'
                    }`}
                  >
                    {period.name}
                    {bookCount > 0 && (
                      <span className="ml-1.5 text-xs text-accent-rust font-medium">{bookCount}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Episodes by Period */}
            {filteredPeriods.map(period => (
              <section key={period.id} id={`period-${period.id}`} className="mb-12 scroll-mt-20">
                <div className="mb-6">
                  <h2 className="text-2xl md:text-3xl text-stone-800 mb-1">{period.name}</h2>
                  <p className="text-stone-500">{period.dateRange}</p>
                  <p className="text-stone-600 mt-2">{period.description}</p>
                </div>

                <div className="space-y-3">
                  {period.episodes.map(ep => (
                    <EpisodeCard key={ep.number} episode={ep} />
                  ))}
                </div>
              </section>
            ))}
          </>
        ) : (
          /* Flat list sorted by episode number (newest first) */
          <div className="space-y-3">
            {filteredEpisodes.map(ep => (
              <EpisodeCard key={ep.number} episode={ep} />
            ))}
          </div>
        )}

        {totalFiltered === 0 && (
          <div className="text-center py-16 text-stone-500">
            <p className="text-lg mb-2">No episodes match your search.</p>
            <button
              onClick={() => {
                setSearch('');
                setShowOnlyWithBooks(false);
              }}
              className="text-accent-rust hover:text-accent-rust underline"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-stone-200 pb-12">
          <div className="text-center text-stone-500 text-sm space-y-2">
            <p>
              SHWEP is created by{' '}
              <a
                href="https://shwep.net"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-rust hover:text-accent-rust underline"
              >
                Earl Fontainelle
              </a>
              . Source Library provides the primary texts — we are not affiliated with SHWEP.
            </p>
            <p>
              Missing a source?{' '}
              <Link href="/contribute" className="text-accent-rust hover:text-accent-rust underline">
                Suggest a book
              </Link>{' '}
              or{' '}
              <Link href="/support" className="text-accent-rust hover:text-accent-rust underline">
                support the project
              </Link>
              .
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}

function EpisodeCard({ episode }: { episode: EnrichedEpisode }) {
  const [expanded, setExpanded] = useState(false);
  const hasBooks = episode.bookCount > 0;
  const translatedCount = episode.books.filter(b => (b.pages_translated || 0) > 0).length;
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const isRecent = episode.publishDate ? new Date(episode.publishDate) >= sixMonthsAgo : false;
  const isStorytime = episode.title.startsWith('Storytime:');
  const thumbBooks = episode.books.filter(b => b.thumbnail).slice(0, 5);

  return (
    <div
      className={`rounded-xl border transition-colors ${
        hasBooks
          ? 'bg-white border-stone-200 shadow-sm'
          : 'bg-stone-50/50 border-stone-100'
      }`}
    >
      <button
        onClick={() => hasBooks && setExpanded(!expanded)}
        className={`w-full text-left px-5 py-4 flex items-start gap-4 ${
          hasBooks ? 'cursor-pointer hover:bg-stone-50/50' : 'cursor-default'
        }`}
      >
        {/* Thumbnail strip OR episode number */}
        {thumbBooks.length > 0 ? (
          <div className="flex -space-x-1.5 shrink-0 mt-0.5">
            {thumbBooks.map((b, i) => (
              <img
                key={b.id}
                src={b.thumbnail}
                alt=""
                className="w-8 h-11 object-cover rounded shadow-sm border border-white"
                style={{ zIndex: thumbBooks.length - i }}
                loading="lazy"
              />
            ))}
          </div>
        ) : (
          <span className="text-sm font-mono text-stone-400 mt-0.5 w-8 shrink-0 text-right">
            {episode.number}
          </span>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-stone-400">{episode.number}</span>
                {episode.publishDate && (
                  <span className="text-xs text-stone-400">
                    {new Date(episode.publishDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </span>
                )}
                <h3 className={`text-lg font-medium ${hasBooks ? 'text-stone-800' : 'text-stone-500'}`}>
                  {episode.title}
                </h3>
                {isStorytime && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent-violet/10 text-accent-violet">
                    Storytime
                  </span>
                )}
                {isRecent && !isStorytime && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent-rust/10 text-accent-rust">
                    New
                  </span>
                )}
              </div>
              {episode.description && (
                <p className="text-base text-stone-500 mt-1 line-clamp-2">
                  {episode.description}
                </p>
              )}
            </div>

            {/* Book count + translation readiness */}
            {hasBooks && (
              <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-gold/8 text-accent-gold-dark text-xs font-medium border border-accent-gold/20">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                {translatedCount > 0
                  ? `${translatedCount}/${episode.bookCount} translated`
                  : `${episode.bookCount} source${episode.bookCount !== 1 ? 's' : ''}`
                }
              </span>
            )}

            {/* Listen on SHWEP */}
            <a
              href={episode.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-stone-500 hover:text-stone-700 bg-stone-100 hover:bg-stone-200 transition-colors"
              onClick={e => e.stopPropagation()}
              title="Listen on SHWEP"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
              <span className="hidden sm:inline">Listen</span>
            </a>

            {/* Expand chevron */}
            {hasBooks && (
              <svg
                className={`w-4 h-4 text-stone-400 transition-transform shrink-0 mt-1 ${
                  expanded ? 'rotate-180' : ''
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </div>
        </div>
      </button>

      {/* Expanded book list */}
      {expanded && hasBooks && (
        <div className="px-5 pb-4 pt-0 border-t border-stone-100">
          <div className="ml-12 space-y-2 pt-3">
            <p className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">
              Primary Sources in Collection
            </p>
            {episode.books.map(book => (
              <BookLink key={book.id} book={book} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BookLink({ book }: { book: MatchedBook }) {
  const hasTranslation = (book.pages_translated || 0) > 0;
  const hasOcr = (book.pages_ocr || 0) > 0;

  return (
    <a
      href={book.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 p-3 rounded-lg hover:bg-stone-50 transition-colors group"
    >
      {book.thumbnail ? (
        <img
          src={book.thumbnail}
          alt=""
          className="w-10 h-14 object-cover rounded shadow-sm shrink-0 bg-stone-100"
          loading="lazy"
        />
      ) : (
        <div className="w-10 h-14 rounded bg-stone-100 shrink-0 flex items-center justify-center">
          <svg className="w-4 h-4 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-base font-medium text-stone-700 group-hover:text-stone-900 truncate">
          {book.title}
        </div>
        <div className="text-sm text-stone-500 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
          <span>{book.author}</span>
          {book.year && <span>{book.year}</span>}
          <span>{book.language}</span>
          {book.pages_count && <span>{book.pages_count} pp.</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {hasTranslation && (
          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700 border border-green-200">
            translated
          </span>
        )}
        {hasOcr && !hasTranslation && (
          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
            OCR&apos;d
          </span>
        )}
        <svg
          className="w-3.5 h-3.5 text-stone-400 group-hover:text-accent-rust"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </a>
  );
}
