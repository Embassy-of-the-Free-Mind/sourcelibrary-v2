'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { RatingOption } from '@/lib/review-queue';

/**
 * Shared shell for all rating queues: sticky header (queue name, session
 * counter, keyboard cheatsheet), main body, rating panel. Each queue
 * supplies its own item-rendering content via `body` and rating handlers.
 */
export function QueueShell(props: {
  queueTitle: string;
  question: string;
  ratings: RatingOption[];
  sessionCount: number;
  loading: boolean;
  error: string | null;
  onRate: (rating: string) => void;
  onSkip: () => void;
  onRetry: () => void;
  body: ReactNode | null;
  submitting: boolean;
}) {
  const { queueTitle, question, ratings, sessionCount, loading, error, onRate, onSkip, onRetry, body, submitting } = props;
  return (
    <main className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link href="/review" className="text-stone-600 hover:text-stone-900">&larr; All queues</Link>
          <div className="text-stone-700">
            <b>{queueTitle}</b> &middot; <span className="text-stone-500">{sessionCount} rated this session</span>
          </div>
          <div className="text-xs text-stone-500 flex flex-wrap gap-1">
            {ratings.map(r => (
              <span key={r.key}>
                <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-300 rounded mr-1">{r.key.toUpperCase()}</kbd>
                {r.rating}
              </span>
            ))}
            <span>
              <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-300 rounded mr-1">Space</kbd>skip
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-300 rounded mr-1">O</kbd>open
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {loading && <div className="text-stone-500 py-12 text-center">Loading next item…</div>}
        {!loading && error && (
          <div className="text-center py-12">
            <div className="text-stone-700 mb-3">{error}</div>
            <button onClick={onRetry} className="text-accent-rust hover:underline">
              Try again
            </button>
          </div>
        )}
        {!loading && !error && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {body}
            <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
              <div className="text-stone-700 text-sm font-medium">{question}</div>
              <div className="grid grid-cols-2 gap-2">
                {ratings.map(r => (
                  <button
                    key={r.rating}
                    onClick={() => onRate(r.rating)}
                    disabled={submitting}
                    className="text-left px-4 py-3 rounded-md border-2 border-stone-200 bg-white hover:border-stone-400 transition-colors disabled:opacity-50"
                    style={{ borderLeftColor: r.color, borderLeftWidth: 6 }}
                    title={r.hint}
                  >
                    <div className="font-medium text-stone-900">
                      <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-300 rounded text-xs mr-2">
                        {r.key.toUpperCase()}
                      </kbd>
                      {r.label}
                    </div>
                    <div className="text-xs text-stone-600 mt-1">{r.hint}</div>
                  </button>
                ))}
              </div>
              <button onClick={onSkip} className="text-sm text-stone-600 hover:text-stone-900">
                <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-300 rounded text-xs mr-1">Space</kbd>
                Skip (don't rate)
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
