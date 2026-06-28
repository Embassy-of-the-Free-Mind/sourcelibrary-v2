'use client';

import { useState, useEffect, useCallback } from 'react';
import { annotations } from '@/lib/api-client/annotations';
import { useIdentity } from '@/hooks/useIdentity';
import AuthPrompt from '@/components/auth/AuthPrompt';
import type { Annotation } from '@/lib/types';

interface PageCommentsProps {
  bookId: string;
  pageId: string;
  pageNumber?: number;
}

function timeAgo(date: Date | string): string {
  const now = new Date();
  const d = new Date(date);
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Lightweight per-page comments for the reader footer.
 * Reuses the community annotations system (type: 'comment', no anchor =
 * page-level note). Posting requires login — the annotations POST route is
 * gated by withAuth, and we surface a sign-in prompt before that 401 can fire.
 */
export default function PageComments({ bookId, pageId, pageNumber }: PageCommentsProps) {
  const identity = useIdentity();
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<Annotation[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);

  const fetchComments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await annotations.list({ book_id: bookId, page_id: pageId, limit: 100 });
      const topLevel = res.annotations.filter((a) => !a.parent_id);
      setComments(topLevel);
      setCount(topLevel.length);
    } catch {
      // silently fail — comments are non-critical
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [bookId, pageId]);

  // Fetch a count on mount so the trigger can show "(N)" without expanding.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await annotations.list({ book_id: bookId, page_id: pageId, limit: 100 });
        if (cancelled) return;
        const topLevel = res.annotations.filter((a) => !a.parent_id);
        setComments(topLevel);
        setCount(topLevel.length);
        setLoaded(true);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, pageId]);

  const handleTriggerClick = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) fetchComments();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (identity.type !== 'authenticated') {
      setShowAuthPrompt(true);
      return;
    }
    const trimmed = content.trim();
    if (trimmed.length < 3) {
      setError('Comment must be at least 3 characters');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const created = await annotations.create({
        book_id: bookId,
        page_id: pageId,
        page_number: pageNumber ?? 0,
        content: trimmed,
        type: 'comment',
      });
      setContent('');
      setComments((prev) => [created, ...prev]);
      setCount((c) => c + 1);
    } catch {
      setError('Could not post your comment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const triggerLabel = count > 0 ? `Comments (${count})` : 'Leave comment';

  return (
    <>
      <button
        type="button"
        onClick={handleTriggerClick}
        className="hover:underline"
        style={{ color: 'var(--text-muted)' }}
        aria-expanded={open}
      >
        {triggerLabel}
      </button>

      {open && (
        <div
          className="basis-full mt-2 mx-auto w-full max-w-xl text-left"
          style={{ color: 'var(--text-secondary)' }}
        >
          {/* Composer */}
          {identity.type === 'authenticated' ? (
            <form onSubmit={handleSubmit} className="mb-3">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Share a thought about this page…"
                rows={2}
                className="w-full px-3 py-2 rounded-lg text-sm resize-none focus:outline-none focus:ring-2"
                style={{
                  background: 'var(--bg-white, #fff)',
                  border: '1px solid var(--border-light)',
                  color: 'var(--text-primary)',
                }}
              />
              <div className="flex items-center gap-2 mt-2 justify-end">
                {error && (
                  <span className="text-xs mr-auto" style={{ color: 'var(--status-error, #b91c1c)' }}>
                    {error}
                  </span>
                )}
                <button
                  type="submit"
                  disabled={submitting || content.trim().length < 3}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50"
                  style={{ background: 'var(--text-primary, #1c1917)', color: '#fff' }}
                >
                  {submitting ? 'Posting…' : 'Post'}
                </button>
              </div>
            </form>
          ) : identity.loading ? null : showAuthPrompt ? (
            <div className="mb-3 flex justify-center">
              <AuthPrompt
                message="Sign in to leave a comment on this page."
                onClose={() => setShowAuthPrompt(false)}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAuthPrompt(true)}
              className="mb-3 w-full px-3 py-2 rounded-lg text-sm text-left hover:opacity-90"
              style={{
                background: 'var(--bg-white, #fff)',
                border: '1px solid var(--border-light)',
                color: 'var(--text-muted)',
              }}
            >
              Sign in to leave a comment…
            </button>
          )}

          {/* List */}
          {loading && !comments.length ? (
            <p className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>
              Loading comments…
            </p>
          ) : comments.length === 0 ? (
            <p className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>
              No comments yet. Be the first to share a thought.
            </p>
          ) : (
            <ul className="space-y-3">
              {comments.map((c) => (
                <li key={c.id} className="flex items-start gap-2.5">
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-xs font-medium"
                    style={{ background: 'var(--bg-warm)', color: 'var(--text-secondary)' }}
                  >
                    {(c.user_name || 'A')[0].toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                        {c.user_name}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                        {timeAgo(c.created_at)}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {c.content}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
