'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getOrCreateVolunteerId } from '@/lib/volunteer-id';

type Item = {
  item_id: string;
  book_id: string;
  page_number: number;
  page_type: string | null;
  image_url: string;
  page_link: string;
  book: { title?: string; author?: string; year?: number; language?: string; slug?: string } | null;
  descriptions: Array<{
    type: string | null;
    significance: string | null;
    size: string | null;
    description: string;
  }>;
};

type Rating = 'matches' | 'partial' | 'hallucination' | 'unclear';

const RATINGS: { key: string; rating: Rating; label: string; color: string; hint: string }[] = [
  { key: 'k', rating: 'matches',       label: '✓ matches',       color: '#10b981', hint: 'Description matches the page' },
  { key: 'p', rating: 'partial',       label: '~ partial',       color: '#f59e0b', hint: 'Description mentions real element but adds invented detail' },
  { key: 'j', rating: 'hallucination', label: '✗ hallucination', color: '#ef4444', hint: 'Description is fictional / page is blank or bleedthrough' },
  { key: 'u', rating: 'unclear',       label: '? unclear',       color: '#6b7280', hint: 'Can\'t tell' },
];

export default function HallucinationReview() {
  const [volunteerId, setVolunteerId] = useState('');
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [streak, setStreak] = useState<{ rating: Rating; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const itemRef = useRef<Item | null>(null);
  itemRef.current = item;

  const fetchNext = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/review/hallucination/next?volunteer_id=${id}`);
      const data = await r.json();
      if (data.item) setItem(data.item);
      else {
        setItem(null);
        setError(data.message || 'No more items.');
      }
    } catch (e) {
      setError('Network error — try refreshing.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = getOrCreateVolunteerId();
    setVolunteerId(id);
    fetchNext(id);
  }, [fetchNext]);

  const submit = useCallback(
    async (rating: Rating) => {
      const current = itemRef.current;
      if (!current || submitting || !volunteerId) return;
      setSubmitting(true);
      try {
        await fetch('/api/review/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queue: 'hallucination',
            item_id: current.item_id,
            rating,
            volunteer_id: volunteerId,
            detail: {
              book_id: current.book_id,
              page_number: current.page_number,
              page_type: current.page_type,
              n_descriptions: current.descriptions.length,
              tag_types: current.descriptions.map(d => `${d.type}/${d.significance}`),
            },
          }),
        });
        setSessionCount(c => c + 1);
        setStreak({ rating, at: Date.now() });
        fetchNext(volunteerId);
      } catch {
        setError('Submit failed — try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, volunteerId, fetchNext],
  );

  const skipItem = useCallback(() => {
    if (volunteerId) fetchNext(volunteerId);
  }, [volunteerId, fetchNext]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      const hit = RATINGS.find(r => r.key === k);
      if (hit) {
        e.preventDefault();
        submit(hit.rating);
        return;
      }
      if (k === 'n' || k === ' ' || k === 'enter') {
        e.preventDefault();
        skipItem();
      } else if (k === 'o' && itemRef.current) {
        e.preventDefault();
        window.open(itemRef.current.page_link, '_blank');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit, skipItem]);

  return (
    <main className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between text-sm">
          <Link href="/review" className="text-stone-600 hover:text-stone-900">&larr; All queues</Link>
          <div className="text-stone-700">
            <b>OCR hallucination check</b> &middot; <span className="text-stone-500">{sessionCount} rated this session</span>
          </div>
          <div className="text-xs text-stone-500">
            <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-300 rounded mr-1">K</kbd>match
            <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-300 rounded mx-1">P</kbd>partial
            <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-300 rounded mx-1">J</kbd>halluc.
            <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-300 rounded mx-1">U</kbd>unclear
            <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-300 rounded mx-1">N</kbd>skip
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {loading && <div className="text-stone-500 py-12 text-center">Loading next page…</div>}
        {!loading && error && (
          <div className="text-center py-12">
            <div className="text-stone-700 mb-3">{error}</div>
            <button onClick={() => fetchNext(volunteerId)} className="text-accent-rust hover:underline">
              Try again
            </button>
          </div>
        )}
        {!loading && item && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <a href={item.page_link} target="_blank" rel="noreferrer" className="block">
              <img
                src={item.image_url}
                alt=""
                className="w-full max-h-[80vh] object-contain bg-white border border-stone-200 rounded-lg"
              />
              <div className="text-xs text-stone-500 mt-2 text-center">Click to open the actual page (new tab)</div>
            </a>

            <div className="space-y-4">
              <div>
                <div className="text-stone-900 font-semibold">{item.book?.title || '(untitled)'}</div>
                <div className="text-stone-600 text-sm">
                  {item.book?.author ? `${item.book.author} · ` : ''}
                  {item.book?.year ? `${item.book.year} · ` : ''}
                  {item.book?.language ? `${item.book.language} · ` : ''}
                  page {item.page_number}
                  {item.page_type ? ` · page_type=${item.page_type}` : ''}
                </div>
              </div>

              <div>
                <div className="text-stone-700 text-sm mb-2 font-medium">
                  OCR said this page contains {item.descriptions.length} illustration
                  {item.descriptions.length === 1 ? '' : 's'}:
                </div>
                <div className="space-y-2">
                  {item.descriptions.map((d, i) => (
                    <div key={i} className="bg-white border border-stone-200 rounded-md p-3 text-sm">
                      <div className="flex gap-2 mb-1.5 text-xs text-stone-600">
                        {d.type && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded">{d.type}</span>}
                        {d.significance && (
                          <span
                            className={`px-2 py-0.5 rounded ${
                              d.significance === 'high'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-stone-100 text-stone-600'
                            }`}
                          >
                            sig: {d.significance}
                          </span>
                        )}
                        {d.size && <span className="px-2 py-0.5 bg-stone-100 text-stone-600 rounded">{d.size}</span>}
                      </div>
                      <div className="text-stone-800 leading-relaxed">{d.description}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-stone-700 text-sm mb-2 font-medium">Does the description match what's on the page?</div>
                <div className="grid grid-cols-2 gap-2">
                  {RATINGS.map(r => (
                    <button
                      key={r.rating}
                      onClick={() => submit(r.rating)}
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
                <button
                  onClick={skipItem}
                  className="mt-3 text-sm text-stone-600 hover:text-stone-900"
                >
                  <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-300 rounded text-xs mr-1">N</kbd>
                  Skip this one (don't rate)
                </button>
              </div>

              {streak && Date.now() - streak.at < 1500 && (
                <div className="text-sm text-stone-600">
                  Recorded: <b>{streak.rating}</b>. Loading next…
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
