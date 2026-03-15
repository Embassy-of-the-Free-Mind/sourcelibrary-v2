'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { History, BookOpen, Clock, Eye, ArrowRight, Trash2 } from 'lucide-react';
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      {/* Header */}
      <header className="bg-stone-900 text-white py-6">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-serif">Reading History</h1>
              <p className="text-stone-400 text-sm mt-1">
                {total} {total === 1 ? 'session' : 'sessions'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {total > 0 && (
                <button
                  onClick={handleClearAll}
                  className="text-sm text-stone-400 hover:text-white transition-colors"
                >
                  Clear all
                </button>
              )}
              <History className="w-8 h-8 text-accent-gold" />
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <BookLoader size="sm" />
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div className="text-center py-20">
            <History className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <h2 className="text-xl font-serif text-stone-700 mb-2">No reading history yet</h2>
            <p className="text-stone-500 mb-6">
              Pages you read will appear here so you can pick up where you left off.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-2 bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90 transition-colors"
            >
              Browse Library
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {!loading && entries.length > 0 && (
          <>
            <div className="space-y-3">
              {entries.map((entry, i) => (
                <ReadingHistoryCard
                  key={`${entry.book_id}-${entry.started_at}-${i}`}
                  entry={entry}
                  onRemove={handleClearBook}
                />
              ))}
            </div>

            {/* Pagination */}
            {total > limit && (
              <div className="flex items-center justify-center gap-3 mt-6">
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
      </div>
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
  const book = entry.book;
  const displayTitle = book.display_title || book.title;
  const url = bookUrl({ slug: book.slug, id: book.id });
  const pageUrl = `${url}/page/${entry.last_page_id}`;

  const progress = book.pages_count
    ? Math.round((entry.last_page_number / book.pages_count) * 100)
    : 0;

  return (
    <Link
      href={pageUrl}
      className="flex gap-4 bg-white rounded-lg shadow-sm border border-stone-200 p-4 hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
      {/* Cover */}
      <div className="relative w-16 h-20 flex-shrink-0 bg-stone-100 rounded overflow-hidden">
        {book.thumbnail && !imageError ? (
          <Image
            src={book.thumbnail}
            alt={displayTitle}
            fill
            className="object-cover"
            sizes="64px"
            onError={() => setImageError(true)}
            unoptimized
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-stone-300">
            <BookOpen className="w-6 h-6" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="font-serif text-stone-800 line-clamp-1">{displayTitle}</h3>
        <div className="flex items-center gap-2 text-sm text-stone-500 mt-0.5">
          {book.author && <span>{book.author}</span>}
          {book.year && <span>({book.year})</span>}
        </div>

        {/* Progress bar */}
        {entry.last_page_number > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs text-stone-500 mb-1">
              <span className="flex items-center gap-1">
                <Eye className="w-3 h-3" />
                Page {entry.last_page_number}
                {book.pages_count ? ` of ${book.pages_count}` : ''}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {timeAgo(entry.updated_at)}
              </span>
            </div>
            {book.pages_count && (
              <div className="w-full h-1.5 bg-stone-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent-gold/80 rounded-full transition-all"
                  style={{ width: `${Math.min(100, progress)}%` }}
                />
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-stone-400 mt-1">
          {entry.pages_viewed} {entry.pages_viewed === 1 ? 'page' : 'pages'} read
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-col items-end justify-between">
        <button
          onClick={(e) => onRemove(entry.book_id, e)}
          className="p-1.5 text-stone-300 hover:text-red-400 rounded transition-colors"
          title="Remove from history"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <div className="flex items-center text-accent-rust">
          <span className="text-xs whitespace-nowrap">Continue</span>
          <ArrowRight className="w-4 h-4 ml-1" />
        </div>
      </div>
    </Link>
  );
}
