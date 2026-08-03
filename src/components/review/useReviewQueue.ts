'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getOrCreateVolunteerId } from '@/lib/volunteer-id';
import { getRatingOptions } from '@/lib/review-queue';

export type QueueItem = { item_id: string; page_link?: string };

/**
 * Shared rating-state hook for review queues. Handles volunteer ID,
 * fetching the next item, submitting a rating, qualitative notes, keyboard
 * shortcuts, session counter, and error state.
 *
 * Each queue passes the queue slug + a function to derive the `detail`
 * jsonb payload from the current item.
 *
 * NOTES: every queue can carry free text. The note travels with the rating
 * when there is one, and can be sent alone when the volunteer has something
 * to say but no honest button to press. Rating buttons are the cheap signal;
 * the note is where a specialist tells us the thing we didn't know to ask.
 */
export function useReviewQueue<T extends QueueItem>(opts: {
  queue: string;
  fetchUrl: string; // base URL — volunteer_id is appended as ?volunteer_id=...
  itemToDetail?: (item: T) => Record<string, unknown> | undefined;
}) {
  const { queue, fetchUrl, itemToDetail } = opts;
  const ratings = getRatingOptions(queue);

  const [volunteerId, setVolunteerId] = useState('');
  const [item, setItem] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [streak, setStreak] = useState<{ rating: string; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const itemRef = useRef<T | null>(null);
  itemRef.current = item;
  // Read inside submit() without making every keystroke re-create the handler
  // (which would tear down and rebuild the keydown listener on every letter).
  const noteRef = useRef('');
  noteRef.current = note;

  const fetchNext = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const sep = fetchUrl.includes('?') ? '&' : '?';
        const r = await fetch(`${fetchUrl}${sep}volunteer_id=${id}`);
        const data = await r.json();
        if (data.item) setItem(data.item as T);
        else {
          setItem(null);
          setError(data.message || 'No more items.');
        }
      } catch {
        setError('Network error — try refreshing.');
      } finally {
        setLoading(false);
      }
    },
    [fetchUrl],
  );

  useEffect(() => {
    const id = getOrCreateVolunteerId();
    setVolunteerId(id);
    fetchNext(id);
  }, [fetchNext]);

  /** Post one judgment. `rating: null` means "note only" — the server accepts
   *  it as long as the note is non-empty. Advances to the next item unless
   *  `advance` is false (used when saving a note without moving on). */
  const post = useCallback(
    async (rating: string | null, noteText: string, advance: boolean) => {
      const current = itemRef.current;
      if (!current || submitting || !volunteerId) return false;
      setSubmitting(true);
      try {
        const res = await fetch('/api/review/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queue,
            item_id: current.item_id,
            rating,
            note: noteText.trim() || null,
            volunteer_id: volunteerId,
            detail: itemToDetail?.(current) ?? null,
          }),
        });
        if (!res.ok) {
          setError('Submit failed — try again.');
          return false;
        }
        if (rating) {
          setSessionCount(c => c + 1);
          setStreak({ rating, at: Date.now() });
        }
        setNote('');
        if (advance) fetchNext(volunteerId);
        return true;
      } catch {
        setError('Submit failed — try again.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, volunteerId, fetchNext, queue, itemToDetail],
  );

  const submit = useCallback(
    (rating: string) => post(rating, noteRef.current, true),
    [post],
  );

  /** Send free text without rating — for when none of the buttons is honest. */
  const submitNote = useCallback(async () => {
    if (!noteRef.current.trim()) return;
    const ok = await post(null, noteRef.current, false);
    if (ok) {
      setNoteSaved(true);
      window.setTimeout(() => setNoteSaved(false), 2500);
    }
  }, [post]);

  const skipItem = useCallback(() => {
    setNote('');
    if (volunteerId) fetchNext(volunteerId);
  }, [volunteerId, fetchNext]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      const hit = ratings.find(r => r.key === k);
      if (hit) {
        e.preventDefault();
        submit(hit.rating);
        return;
      }
      if (k === ' ' || k === 'enter') {
        e.preventDefault();
        skipItem();
      } else if (k === 'o' && itemRef.current?.page_link) {
        e.preventDefault();
        window.open(itemRef.current.page_link, '_blank');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit, skipItem, ratings]);

  return {
    volunteerId, item, loading, submitting, sessionCount, streak, error,
    submit, skipItem, fetchNext, ratings,
    note, setNote, submitNote, noteSaved,
  };
}
