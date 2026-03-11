'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Clock, BookOpen, ArrowRight, Trash2, Library } from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';
import UserMenu from '@/components/layout/UserMenu';
import { useIdentity } from '@/hooks/useIdentity';
import { readingHistory, type ReadingHistoryEntry } from '@/lib/api-client';

function LogoBar() {
  return (
    <header className="bg-white border-b border-border-light">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-secondary hover:text-primary transition-colors"
        >
          <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" />
            <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1" />
            <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1" />
          </svg>
          <span className="font-medium">Source Library</span>
        </Link>
        <UserMenu />
      </div>
    </header>
  );
}

function groupByDate(entries: ReadingHistoryEntry[]): Record<string, ReadingHistoryEntry[]> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const weekStart = todayStart - 6 * 86400000;

  const groups: Record<string, ReadingHistoryEntry[]> = {};

  for (const entry of entries) {
    const t = new Date(entry.updated_at).getTime();
    let label: string;
    if (t >= todayStart) label = 'Today';
    else if (t >= yesterdayStart) label = 'Yesterday';
    else if (t >= weekStart) label = 'This week';
    else label = 'Earlier';

    if (!groups[label]) groups[label] = [];
    groups[label].push(entry);
  }

  return groups;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = Date.now();
  const diff = now - d.getTime();

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function HistoryPage() {
  const identity = useIdentity();
  const [entries, setEntries] = useState<ReadingHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (identity.loading) return;
    if (identity.type !== 'authenticated') {
      setLoading(false);
      return;
    }

    readingHistory.list({ limit: 100 })
      .then((data) => setEntries(data.entries))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [identity.loading, identity.type]);

  const grouped = useMemo(() => groupByDate(entries), [entries]);
  const groupOrder = ['Today', 'Yesterday', 'This week', 'Earlier'];

  const handleClear = async () => {
    if (!confirm('Clear all reading history?')) return;
    setClearing(true);
    try {
      await readingHistory.clear();
      setEntries([]);
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  };

  if (identity.loading || loading) {
    return (
      <div className="min-h-screen bg-stone-50">
        <LogoBar />
        <div className="flex items-center justify-center py-20">
          <BookLoader size="sm" />
        </div>
      </div>
    );
  }

  if (identity.type !== 'authenticated') {
    return (
      <div className="min-h-screen bg-stone-50">
        <LogoBar />
        <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-16">
          <div className="max-w-5xl mx-auto px-6">
            <h1 className="text-4xl md:text-5xl mb-4">Reading History</h1>
            <p className="text-xl text-stone-300 max-w-2xl">
              Track the books and pages you&apos;ve been reading.
            </p>
          </div>
        </div>
        <div className="text-center py-20">
          <Clock className="w-16 h-16 text-stone-300 mx-auto mb-4" />
          <h2 className="text-xl font-serif text-stone-700 mb-2">Sign in to track your reading</h2>
          <p className="text-stone-500 mb-6">
            Reading history is saved when you&apos;re signed in.
          </p>
          <Link
            href="/auth/signin?callbackUrl=/history"
            className="inline-flex items-center gap-2 px-6 py-2 bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <LogoBar />
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-16">
        <div className="max-w-5xl mx-auto px-6">
          <h1 className="text-4xl md:text-5xl mb-4">Reading History</h1>
          <p className="text-xl text-stone-300 max-w-2xl">
            {entries.length} {entries.length === 1 ? 'reading session' : 'reading sessions'}
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {entries.length === 0 ? (
          <div className="text-center py-20">
            <Library className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <h2 className="text-xl font-serif text-stone-700 mb-2">No reading history yet</h2>
            <p className="text-stone-500 mb-6">
              Start reading a book and your history will appear here.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-2 bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90 transition-colors"
            >
              Browse Library
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <>
            {groupOrder.map((label) => {
              const group = grouped[label];
              if (!group?.length) return null;
              return (
                <div key={label} className="mb-6">
                  <h2 className="text-sm font-medium text-stone-500 uppercase tracking-wide mb-3">
                    {label}
                  </h2>
                  <div className="space-y-3">
                    {group.map((entry, i) => (
                      <HistoryCard key={`${entry.book_id}-${entry.started_at}-${i}`} entry={entry} />
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="mt-8 pt-6 border-t border-stone-200 text-center">
              <button
                onClick={handleClear}
                disabled={clearing}
                className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-accent-rust transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                {clearing ? 'Clearing...' : 'Clear all history'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function HistoryCard({ entry }: { entry: ReadingHistoryEntry }) {
  const [imageError, setImageError] = useState(false);
  const continueUrl = `/book/${entry.book.slug || entry.book_id}/page/${entry.last_page_id}`;

  const pageRange =
    entry.first_page_number === entry.last_page_number
      ? `Page ${entry.last_page_number}`
      : `Page ${entry.first_page_number} → ${entry.last_page_number}`;

  return (
    <Link
      href={continueUrl}
      className="flex gap-4 bg-white rounded-lg shadow-sm border border-stone-200 p-4 hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
      {/* Cover */}
      <div className="relative w-16 h-20 flex-shrink-0 bg-stone-100 rounded overflow-hidden">
        {entry.book.thumbnail && !imageError ? (
          <Image
            src={entry.book.thumbnail}
            alt={entry.book.display_title || entry.book.title}
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
        <h3 className="font-serif text-stone-800 line-clamp-1">
          {entry.book.display_title || entry.book.title}
        </h3>
        <div className="flex items-center gap-2 text-sm text-stone-500 mt-0.5">
          {entry.book.author && <span>{entry.book.author}</span>}
          {entry.book.year && <span>({entry.book.year})</span>}
        </div>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-stone-400">
          <span>{pageRange}</span>
          {entry.pages_viewed > 1 && (
            <span>({entry.pages_viewed} pages)</span>
          )}
          <span>{formatTime(entry.updated_at)}</span>
        </div>
      </div>

      {/* Continue */}
      <div className="flex items-center text-accent-rust">
        <span className="text-xs whitespace-nowrap">Continue</span>
        <ArrowRight className="w-4 h-4 ml-1" />
      </div>
    </Link>
  );
}
