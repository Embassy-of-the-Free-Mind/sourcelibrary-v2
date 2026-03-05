'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import type { ShwepIndexData, EnrichedEpisode, EnrichedPeriod, GalleryImage } from './shwep-data';

type ViewMode = 'recent' | 'storytime' | 'period';

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default function ShwepClient({ data }: { data: ShwepIndexData }) {
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('recent');

  const allEpisodes = useMemo(() => data.periods.flatMap(p => p.episodes), [data.periods]);

  const filteredEpisodes = useMemo(() => {
    const q = search.toLowerCase().trim();
    let eps = allEpisodes.filter(ep => {
      if (!q) return true;
      return (
        ep.title.toLowerCase().includes(q) ||
        ep.tags.some(t => t.toLowerCase().includes(q)) ||
        ep.description?.toLowerCase().includes(q) ||
        ep.books.some(b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q))
      );
    });
    if (viewMode === 'storytime') {
      eps = eps.filter(ep => ep.title.startsWith('Storytime:'));
    } else if (viewMode === 'recent') {
      eps = eps.filter(ep => !ep.title.startsWith('Storytime:'));
    }
    return [...eps].sort((a, b) => {
      if (a.publishDate && b.publishDate) return b.publishDate.localeCompare(a.publishDate);
      if (a.publishDate) return -1;
      if (b.publishDate) return 1;
      return b.number - a.number;
    });
  }, [allEpisodes, search, viewMode]);

  const filteredPeriods = useMemo(() => {
    const q = search.toLowerCase().trim();
    return data.periods.map(period => ({
      ...period,
      episodes: period.episodes.filter(ep => {
        if (!q) return true;
        return (
          ep.title.toLowerCase().includes(q) ||
          ep.tags.some(t => t.toLowerCase().includes(q)) ||
          ep.description?.toLowerCase().includes(q) ||
          ep.books.some(b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q))
        );
      }),
    })).filter(p => p.episodes.length > 0);
  }, [data.periods, search]);

  const storytimeCount = allEpisodes.filter(ep => ep.title.startsWith('Storytime:')).length;

  return (
    <>
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-stone-500 hover:text-stone-800 transition-colors">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1" />
            </svg>
            <span className="font-medium">Source Library</span>
          </Link>
        </div>
      </header>

      {/* Hero with search */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-12 md:py-16">
        <div className="max-w-5xl mx-auto px-6">
          <h1 className="text-4xl md:text-5xl mb-3">SHWEP Reading Room</h1>
          <p className="text-lg text-stone-300 max-w-2xl mb-8">
            Read the primary sources discussed on the{' '}
            <a href="https://shwep.net" target="_blank" rel="noopener noreferrer" className="text-accent-gold underline">
              Secret History of Western Esotericism Podcast
            </a>
          </p>
          <div className="relative max-w-xl">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search episodes, authors, texts..."
              className="w-full pl-12 pr-4 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-stone-400 text-lg focus:outline-none focus:ring-2 focus:ring-accent-gold/50 focus:bg-white/15"
            />
          </div>
          <div className="flex flex-wrap gap-6 text-sm text-stone-400 mt-6">
            <span>{data.stats.totalEpisodes} episodes</span>
            <span>{data.stats.episodesWithBooks} with source texts</span>
            <span>{data.stats.totalMatches} books linked</span>
          </div>
        </div>
      </div>

      {/* Gallery images */}
      {data.galleryImages.length > 0 && !search && (
        <div className="bg-warm border-b border-stone-200">
          <div className="max-w-5xl mx-auto px-6 py-6">
            <p className="text-sm text-stone-400 mb-3">Illustrations from the sources</p>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-2">
              {data.galleryImages.map(img => (
                <a
                  key={img.id}
                  href={img.bookId ? `https://sourcelibrary.org/book/${img.bookId}` : '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="aspect-square rounded-lg overflow-hidden bg-stone-200 hover:opacity-80 transition-opacity"
                  title={img.description || img.bookTitle}
                >
                  <img src={img.thumbnailUrl} alt={img.description || ''} className="w-full h-full object-cover" loading="lazy" />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-stone-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-2.5 flex items-center gap-1">
          {([
            { id: 'recent' as ViewMode, label: 'Podcast' },
            { id: 'storytime' as ViewMode, label: `Storytime (${storytimeCount})` },
            { id: 'period' as ViewMode, label: 'By Period' },
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
          <span className="ml-auto text-sm text-stone-400">
            {viewMode === 'period'
              ? filteredPeriods.reduce((s, p) => s + p.episodes.length, 0)
              : filteredEpisodes.length} episodes
          </span>
        </div>
      </div>

      {/* Episode list */}
      <div className="max-w-5xl mx-auto px-6 py-6">
        {viewMode === 'period' ? (
          filteredPeriods.map(period => (
            <section key={period.id} className="mb-12 scroll-mt-16">
              <h2 className="text-2xl md:text-3xl font-serif text-stone-800 mb-1">{period.name}</h2>
              <p className="text-sm text-stone-400 mb-4">{period.dateRange}</p>
              <div className="divide-y divide-stone-100">
                {period.episodes.map(ep => (
                  <EpisodeRow key={ep.number} episode={ep} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="divide-y divide-stone-100">
            {filteredEpisodes.map(ep => (
              <EpisodeRow key={ep.number} episode={ep} />
            ))}
          </div>
        )}

        {(viewMode === 'period' ? filteredPeriods.length === 0 : filteredEpisodes.length === 0) && (
          <div className="text-center py-16 text-stone-500">
            <p className="text-lg mb-2">No episodes match your search.</p>
            <button onClick={() => setSearch('')} className="text-accent-rust underline">Clear search</button>
          </div>
        )}

        <footer className="mt-16 pt-8 border-t border-stone-200 pb-12 text-center text-stone-500 text-sm space-y-2">
          <p>
            SHWEP is created by{' '}
            <a href="https://shwep.net" target="_blank" rel="noopener noreferrer" className="text-accent-rust underline">Earl Fontainelle</a>
            . Source Library provides the primary texts — we are not affiliated with SHWEP.
          </p>
          <p>
            Missing a source?{' '}
            <Link href="/contribute" className="text-accent-rust underline">Suggest a book</Link>
            {' or '}
            <Link href="/support" className="text-accent-rust underline">support the project</Link>.
          </p>
        </footer>
      </div>
    </>
  );
}

function EpisodeRow({ episode }: { episode: EnrichedEpisode }) {
  const hasBooks = episode.bookCount > 0;
  const translatedCount = episode.books.filter(b => (b.pages_translated || 0) > 0).length;
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const isRecent = episode.publishDate ? new Date(episode.publishDate) >= sixMonthsAgo : false;

  return (
    <div className="py-5 first:pt-0">
      {/* Title — links to episode page */}
      <h3 className={`text-xl md:text-2xl font-serif leading-snug ${hasBooks ? 'text-stone-800' : 'text-stone-400'}`}>
        <Link href={`/shwep/${episode.number}`} className="hover:text-accent-rust transition-colors">
          {episode.title}
        </Link>
        {isRecent && (
          <span className="ml-2 align-middle px-2 py-0.5 rounded-full text-xs font-sans font-medium bg-accent-rust/10 text-accent-rust">
            New
          </span>
        )}
      </h3>

      {/* Metadata */}
      <div className="flex items-center gap-3 mt-1 text-sm text-stone-400">
        {episode.publishDate && <span>{formatDate(episode.publishDate)}</span>}
        <span>#{episode.number}</span>
        {hasBooks && (
          <span className="text-accent-gold-dark">
            {translatedCount > 0
              ? `${translatedCount}/${episode.bookCount} translated`
              : `${episode.bookCount} source${episode.bookCount !== 1 ? 's' : ''}`}
          </span>
        )}
        <a href={episode.url} target="_blank" rel="noopener noreferrer" className="hover:text-stone-600 transition-colors">
          Listen
        </a>
      </div>
    </div>
  );
}
