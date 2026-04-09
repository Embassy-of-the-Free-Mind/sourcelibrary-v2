'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, Clock, Eye, ArrowRight, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import SiteHeader from '@/components/layout/SiteHeader';
import { readingHistory, type ReadingHistoryEntry } from '@/lib/api-client';
import { BookLoader } from '@/components/ui/BookLoader';
import { bookUrl } from '@/lib/slugify';

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ReadingHistoryPage() {
  const [entries, setEntries] = useState<ReadingHistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const load = useCallback(async (newOffset = 0) => {
    setLoading(true);
    try {
      const res = await readingHistory.list({ limit, offset: newOffset });
      setEntries(res.entries);
      setTotal(res.total);
      setOffset(newOffset);
    } catch (err) {
      console.error('Failed to load reading history:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClearAll = async () => {
    if (!confirm('Clear all reading history?')) return;
    await readingHistory.clear();
    load();
  };

  const handleClearBook = async (bookId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await readingHistory.clear(bookId);
    setEntries(prev => prev.filter(entry => entry.book_id !== bookId));
    setTotal(prev => prev - 1);
  };

  // Group entries by date
  const groupedEntries = entries.reduce<Record<string, ReadingHistoryEntry[]>>((groups, entry) => {
    const date = formatDate(entry.updated_at);
    if (!groups[date]) groups[date] = [];
    groups[date].push(entry);
    return groups;
  }, {});

  return (
    <div className="min-h-screen bg-stone-50">
      <SiteHeader variant="light" />

      {/* Dark hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-16">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl md:text-5xl mb-4">Reading History</h1>
              <p className="text-xl text-stone-300 max-w-2xl">
                Every page you read is saved here, so you can pick up where you left off
                or revisit passages that caught your eye.
              </p>
              {total > 0 && (
                <p className="text-stone-500 text-sm mt-4">
                  {total} reading {total === 1 ? 'session' : 'sessions'}
                </p>
              )}
            </div>
            {total > 0 && (
              <button
                onClick={handleClearAll}
                className="flex-shrink-0 text-sm text-stone-500 hover:text-stone-300 transition-colors mt-2"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-10">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <BookLoader size="sm" />
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div className="text-center py-20">
            <BookOpen className="w-12 h-12 text-stone-300 mx-auto mb-4" />
            <h2 className="text-lg font-medium text-stone-600 mb-2">No reading history yet</h2>
            <p className="text-stone-400 mb-6 text-sm">
              Pages you read will appear here so you can pick up where you left off.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 transition-colors"
            >
              Browse Library
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {!loading && entries.length > 0 && (
          <>
            <div className="space-y-8">
              {Object.entries(groupedEntries).map(([date, dateEntries]) => (
                <div key={date}>
                  <h2 className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-3">
                    {date}
                  </h2>
                  <div className="space-y-3">
                    {dateEntries.map((entry, i) => (
                      <ReadingHistoryCard
                        key={`${entry.book_id}-${entry.started_at}-${i}`}
                        entry={entry}
                        onRemove={handleClearBook}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {total > limit && (
              <div className="flex items-center justify-center gap-3 mt-10">
                <button
                  onClick={() => load(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="px-4 py-2 text-sm text-stone-600 bg-white border border-stone-200 rounded-lg shadow-sm hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  Previous
                </button>
                <span className="text-sm text-stone-500">
                  {offset + 1}&ndash;{Math.min(offset + limit, total)} of {total}
                </span>
                <button
                  onClick={() => load(offset + limit)}
                  disabled={offset + limit >= total}
                  className="px-4 py-2 text-sm text-stone-600 bg-white border border-stone-200 rounded-lg shadow-sm hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ReadingHistoryCard({
  entry,
  onRemove,
}: {
  entry: ReadingHistoryEntry;
  onRemove: (bookId: string, e: React.MouseEvent) => void;
}) {
  const [imageError, setImageError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const book = entry.book;
  const displayTitle = book.display_title || book.title;
  const url = bookUrl({ slug: book.slug, id: book.id });
  const pageUrl = `${url}/page/${entry.last_page_id}`;

  const progress = book.pages_count
    ? Math.round((entry.last_page_number / book.pages_count) * 100)
    : 0;

  const pagesRead = entry.pages_read || [];
  const sortedPages = [...pagesRead].sort((a, b) => a.page_number - b.page_number);
  const hasPageDetail = sortedPages.length > 0;

  return (
    <div className="group rounded-lg overflow-hidden bg-warm border border-border-light hover:border-border-medium transition-colors">
      <Link
        href={pageUrl}
        className="flex gap-4 p-5"
      >
        {/* Cover */}
        <div className="relative w-14 h-[72px] flex-shrink-0 bg-stone-100 rounded overflow-hidden">
          {(book.thumbnail_blob || book.thumbnail) && !imageError ? (
            <Image
              src={(book.thumbnail_blob || book.thumbnail)!}
              alt={displayTitle}
              fill
              className="object-cover opacity-90 group-hover:opacity-100 transition-opacity"
              sizes="56px"
              onError={() => setImageError(true)}
              unoptimized
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-stone-300">
              <BookOpen className="w-5 h-5" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-serif font-medium text-primary group-hover:text-accent-rust transition-colors line-clamp-1">
                {displayTitle}
              </h3>
              <div className="flex items-center gap-2 text-sm text-muted mt-0.5">
                {book.author && <span>{book.author}</span>}
                {book.year && <span className="text-faint">({book.year})</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-faint flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {timeAgo(entry.updated_at)}
              </span>
              <button
                onClick={(e) => onRemove(entry.book_id, e)}
                className="p-1.5 text-stone-300 hover:text-red-400 rounded transition-colors opacity-0 group-hover:opacity-100"
                title="Remove from history"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Progress row */}
          <div className="mt-3 flex items-center gap-3">
            {book.pages_count && (
              <div className="flex-1 max-w-xs">
                <div className="w-full h-1.5 bg-stone-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-gold/80 rounded-full transition-all"
                    style={{ width: `${Math.min(100, progress)}%` }}
                  />
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 text-xs text-faint">
              <span className="flex items-center gap-1">
                <Eye className="w-3 h-3" />
                {entry.pages_viewed} {entry.pages_viewed === 1 ? 'page' : 'pages'}
              </span>
              {book.pages_count && (
                <span>p. {entry.last_page_number} of {book.pages_count}</span>
              )}
              <span className="text-accent-rust flex items-center gap-1 font-medium">
                Continue
                <ArrowRight className="w-3 h-3" />
              </span>
            </div>
          </div>
        </div>
      </Link>

      {/* Expandable pages-read detail */}
      {hasPageDetail && (
        <div className="border-t border-border-light">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full px-5 py-2 flex items-center gap-2 text-xs text-faint hover:text-muted transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {sortedPages.length} {sortedPages.length === 1 ? 'page' : 'pages'} visited
          </button>
          {expanded && (
            <div className="px-5 pb-3 flex flex-wrap gap-1.5">
              {sortedPages.map((p) => (
                <Link
                  key={p.page_id}
                  href={`${url}/page/${p.page_id}`}
                  className="px-2 py-0.5 text-xs bg-stone-100 text-stone-600 hover:bg-accent-gold/20 hover:text-accent-rust rounded transition-colors"
                >
                  p. {p.page_number}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
