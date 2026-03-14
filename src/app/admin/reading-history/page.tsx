'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, RefreshCw, Trash2, BookOpen, Clock, Eye } from 'lucide-react';
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

export default function AdminReadingHistoryPage() {
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

  const handleClearBook = async (bookId: string) => {
    await readingHistory.clear(bookId);
    setEntries(prev => prev.filter(e => e.book_id !== bookId));
    setTotal(prev => prev - 1);
  };

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-stone-400 hover:text-stone-600">
                <ChevronLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-lg font-semibold text-stone-800">Reading History</h1>
                <p className="text-sm text-stone-400">{total} sessions</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => load(offset)}
                className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              {total > 0 && (
                <button
                  onClick={handleClearAll}
                  className="px-3 py-1.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {loading ? (
          <div className="py-16"><BookLoader size="sm" /></div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-stone-400">
            <BookOpen className="w-8 h-8 mx-auto mb-3 opacity-50" />
            <p>No reading history yet</p>
            <p className="text-sm mt-1">Pages you read will appear here</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {entries.map((entry, i) => {
                const book = entry.book;
                const displayTitle = book.display_title || book.title;
                const url = bookUrl({ slug: book.slug, id: book.id });
                const pageUrl = `${url}/page/${entry.last_page_id}`;

                return (
                  <div
                    key={`${entry.book_id}-${entry.started_at}-${i}`}
                    className="bg-white rounded-lg border border-stone-200 hover:border-stone-300 transition-colors"
                  >
                    <div className="flex items-start gap-3 p-3">
                      {/* Thumbnail */}
                      {book.thumbnail ? (
                        <Link href={url} className="flex-shrink-0">
                          <img
                            src={book.thumbnail}
                            alt=""
                            className="w-12 h-16 rounded object-cover bg-stone-100"
                          />
                        </Link>
                      ) : (
                        <Link href={url} className="flex-shrink-0 w-12 h-16 bg-stone-100 rounded flex items-center justify-center">
                          <BookOpen className="w-5 h-5 text-stone-300" />
                        </Link>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <Link href={url} className="text-sm font-medium text-stone-800 hover:text-stone-600 line-clamp-1">
                          {displayTitle}
                        </Link>
                        {book.author && (
                          <p className="text-xs text-stone-400 mt-0.5 line-clamp-1">{book.author}{book.year ? ` (${book.year})` : ''}</p>
                        )}

                        <div className="flex items-center gap-3 mt-1.5 text-xs text-stone-400">
                          <Link href={pageUrl} className="flex items-center gap-1 hover:text-stone-600">
                            <Eye className="w-3 h-3" />
                            <span>p. {entry.last_page_number}{book.pages_count ? ` / ${book.pages_count}` : ''}</span>
                          </Link>
                          <span className="flex items-center gap-1">
                            <BookOpen className="w-3 h-3" />
                            {entry.pages_viewed} pages
                          </span>
                          <span className="flex items-center gap-1" title={formatDate(entry.updated_at)}>
                            <Clock className="w-3 h-3" />
                            {timeAgo(entry.updated_at)}
                          </span>
                        </div>
                      </div>

                      {/* Remove */}
                      <button
                        onClick={() => handleClearBook(entry.book_id)}
                        className="p-1.5 text-stone-300 hover:text-red-400 rounded transition-colors flex-shrink-0"
                        title="Remove from history"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {total > limit && (
              <div className="flex items-center justify-center gap-3 mt-6">
                <button
                  onClick={() => load(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="px-3 py-1.5 text-sm text-stone-500 bg-white border border-stone-200 rounded-lg hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-sm text-stone-400">
                  {offset + 1}–{Math.min(offset + limit, total)} of {total}
                </span>
                <button
                  onClick={() => load(offset + limit)}
                  disabled={offset + limit >= total}
                  className="px-3 py-1.5 text-sm text-stone-500 bg-white border border-stone-200 rounded-lg hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
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
