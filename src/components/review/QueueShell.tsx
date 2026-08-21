'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { RatingOption } from '@/lib/review-queue';

/**
 * Shared shell for all rating queues: sticky header (queue name, session
 * counter, keyboard cheatsheet), main body, rating panel, and the note box.
 * Each queue supplies its own item-rendering content via `body` and handlers.
 *
 * The note box lives HERE, not in the individual queues, so that every queue
 * — including any added later — has a way to leave qualitative feedback by
 * construction. A volunteer who can see something our four buttons can't
 * express should never have to email us about it.
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
  note: string;
  /** Queue-specific example. The default was written for the hallucination
   *  queue and read as nonsense everywhere else. */
  notePlaceholder?: string;
  /** False when nobody is signed in: the queue still renders, but it cannot be
   *  written to. Ratings are attributed to an account, never to a browser. */
  canSubmit?: boolean;
  authStatus?: 'loading' | 'authenticated' | 'unauthenticated';
  onNoteChange: (v: string) => void;
  onNoteSubmit: () => void;
  noteSaved: boolean;
}) {
  const {
    queueTitle, question, ratings, sessionCount, loading, error,
    onRate, onSkip, onRetry, body, submitting,
    note, notePlaceholder, onNoteChange, onNoteSubmit, noteSaved,
    canSubmit = true, authStatus,
  } = props;
  return (
    <main className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-[1500px] mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
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

      <div className="max-w-[1500px] mx-auto px-4 py-6">
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
              {!canSubmit && authStatus !== 'loading' && (
                <div className="rounded-md border border-accent-rust/30 bg-accent-rust/5 p-4 text-sm">
                  <p className="text-stone-800 font-medium mb-1">Sign in to record your answer</p>
                  <p className="text-stone-600 mb-3">
                    Judgments are credited to you, not to this browser &mdash; so your work
                    follows you between devices, and we can come back to you about it.
                  </p>
                  <Link
                    href={`/auth/signin?callbackUrl=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname : '/review')}`}
                    className="inline-block px-4 py-2 rounded-md bg-accent-rust text-white text-sm font-medium hover:opacity-90"
                  >
                    Sign in
                  </Link>
                </div>
              )}
              <div className={`grid grid-cols-2 gap-2 ${canSubmit ? '' : 'opacity-40 pointer-events-none'}`}>
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

              <div className="border-t border-stone-200 pt-4">
                <label htmlFor="review-note" className="block text-sm font-medium text-stone-700">
                  Anything the buttons can't say?
                </label>
                <p className="text-xs text-stone-500 mt-0.5 mb-2">
                  Optional. Sent with your rating — or on its own if none of the options is right.
                </p>
                <textarea
                  id="review-note"
                  disabled={!canSubmit}
                  value={note}
                  onChange={e => onNoteChange(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  placeholder={notePlaceholder ?? 'Anything the buttons cannot express'}
                  className="w-full px-3 py-2 border border-stone-300 rounded-md text-sm text-stone-900 bg-white resize-y focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
                />
                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={onNoteSubmit}
                    disabled={submitting || note.trim().length === 0}
                    className="text-sm px-3 py-1.5 rounded-md border border-stone-300 text-stone-700 hover:border-stone-400 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Send note only
                  </button>
                  {noteSaved && <span className="text-sm text-green-700">Note saved — thank you.</span>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
