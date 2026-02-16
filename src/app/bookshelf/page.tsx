'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, Library, Loader2, BookMarked, CheckCircle2, ArrowRight } from 'lucide-react';
import { bookshelf, type BookshelfEntryWithBook } from '@/lib/api-client';
import type { BookshelfStatus } from '@/lib/types/bookshelf';

const TABS: { key: BookshelfStatus | 'all'; label: string; icon: React.ReactNode }[] = [
  { key: 'reading', label: 'Currently Reading', icon: <BookOpen className="w-4 h-4" /> },
  { key: 'want_to_read', label: 'Want to Read', icon: <BookMarked className="w-4 h-4" /> },
  { key: 'completed', label: 'Completed', icon: <CheckCircle2 className="w-4 h-4" /> },
];

export default function BookshelfPage() {
  const [entries, setEntries] = useState<BookshelfEntryWithBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<BookshelfStatus | 'all'>('reading');

  useEffect(() => {
    bookshelf.list()
      .then((data) => setEntries(data.entries))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filteredEntries = activeTab === 'all'
    ? entries
    : entries.filter((e) => e.status === activeTab);

  const counts: Record<string, number> = {
    reading: entries.filter((e) => e.status === 'reading').length,
    want_to_read: entries.filter((e) => e.status === 'want_to_read').length,
    completed: entries.filter((e) => e.status === 'completed').length,
  };

  // If no reading entries, default to want_to_read; if none of those, show first with entries
  useEffect(() => {
    if (!loading && entries.length > 0 && counts.reading === 0) {
      if (counts.want_to_read > 0) setActiveTab('want_to_read');
      else if (counts.completed > 0) setActiveTab('completed');
    }
  }, [loading, entries.length, counts.reading, counts.want_to_read, counts.completed]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      {/* Header */}
      <header className="bg-stone-900 text-white py-6">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-serif">My Bookshelf</h1>
              <p className="text-stone-400 text-sm mt-1">
                {entries.length} {entries.length === 1 ? 'book' : 'books'} saved
              </p>
            </div>
            <Library className="w-8 h-8 text-amber-500" />
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-amber-600 animate-spin" />
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div className="text-center py-20">
            <Library className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <h2 className="text-xl font-serif text-stone-700 mb-2">Your bookshelf is empty</h2>
            <p className="text-stone-500 mb-6">
              Browse the library to find books and add them to your reading list.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
            >
              Browse Library
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {!loading && entries.length > 0 && (
          <>
            {/* Tabs */}
            <div className="flex gap-1 bg-white rounded-lg p-1 shadow-sm border border-stone-200 mb-6">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                    activeTab === tab.key
                      ? 'bg-amber-600 text-white'
                      : 'text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {tab.icon}
                  <span className="hidden sm:inline">{tab.label}</span>
                  {counts[tab.key] > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      activeTab === tab.key ? 'bg-amber-500' : 'bg-stone-100'
                    }`}>
                      {counts[tab.key]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Book list */}
            {filteredEntries.length === 0 ? (
              <div className="text-center py-12 text-stone-500">
                No books in this category yet.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredEntries.map((entry) => (
                  <BookshelfCard key={entry.book_id} entry={entry} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BookshelfCard({ entry }: { entry: BookshelfEntryWithBook }) {
  const [imageError, setImageError] = useState(false);
  const progress = entry.book.pages_count
    ? Math.round(((entry.last_read_page_number || 0) / entry.book.pages_count) * 100)
    : 0;

  const translationPercent = entry.book.pages_count && entry.book.pages_count > 0
    ? Math.round((entry.book.pages_translated || 0) / entry.book.pages_count * 100)
    : 0;

  const continueUrl = entry.last_read_page_id
    ? `/book/${entry.book_id}/page/${entry.last_read_page_id}`
    : `/book/${entry.book_id}`;

  return (
    <Link
      href={continueUrl}
      className="flex gap-4 bg-white rounded-lg shadow-sm border border-stone-200 p-4 hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
      {/* Cover */}
      <div className="relative w-16 h-20 flex-shrink-0 bg-stone-100 rounded overflow-hidden">
        {entry.book.cover_image && !imageError ? (
          <Image
            src={entry.book.cover_image}
            alt={entry.book.title}
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
        <h3 className="font-serif text-stone-800 line-clamp-1">{entry.book.title}</h3>
        <div className="flex items-center gap-2 text-sm text-stone-500 mt-0.5">
          {entry.book.author && <span>{entry.book.author}</span>}
          {entry.book.year && <span>({entry.book.year})</span>}
        </div>

        {/* Progress bar */}
        {entry.status === 'reading' && entry.last_read_page_number && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs text-stone-500 mb-1">
              <span>
                Page {entry.last_read_page_number}
                {entry.book.pages_count ? ` of ${entry.book.pages_count}` : ''}
              </span>
              {progress > 0 && <span>{progress}%</span>}
            </div>
            <div className="w-full h-1.5 bg-stone-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
          </div>
        )}

        {/* Translation progress */}
        {translationPercent > 0 && translationPercent < 100 && (
          <p className="text-xs text-stone-400 mt-1">
            {translationPercent}% translated
          </p>
        )}
      </div>

      {/* Action */}
      <div className="flex items-center text-amber-600">
        {entry.status === 'reading' && entry.last_read_page_id && (
          <span className="text-xs whitespace-nowrap">Continue</span>
        )}
        <ArrowRight className="w-4 h-4 ml-1" />
      </div>
    </Link>
  );
}
