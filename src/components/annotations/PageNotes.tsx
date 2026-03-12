'use client';

import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { ChevronUp, Trash2, Send } from 'lucide-react';
import { annotations as annotationsApi } from '@/lib/api-client';
import { useIdentity } from '@/hooks/useIdentity';
import type { Annotation } from '@/lib/types';

export interface PageNotesHandle {
  refresh: () => void;
}

interface PageNotesProps {
  bookId: string;
  pageId: string;
  pageNumber: number;
}

function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const PageNotes = forwardRef<PageNotesHandle, PageNotesProps>(function PageNotes(
  { bookId, pageId, pageNumber },
  ref
) {
  const identity = useIdentity();
  const isAuthenticated = identity.type === 'authenticated';

  const [notes, setNotes] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchNotes = useCallback(async () => {
    try {
      const res = await annotationsApi.list({ book_id: bookId, page_id: pageId, limit: 50 });
      setNotes(res.annotations);
    } catch {
      // Silently fail — notes are non-critical
    } finally {
      setLoading(false);
    }
  }, [bookId, pageId]);

  useEffect(() => {
    setLoading(true);
    setNotes([]);
    fetchNotes();
  }, [fetchNotes]);

  useImperativeHandle(ref, () => ({
    refresh: fetchNotes,
  }));

  const handleSubmit = async () => {
    const trimmed = noteText.trim();
    if (!trimmed || trimmed.length < 3) return;
    setSubmitting(true);
    setError('');
    try {
      await annotationsApi.create({
        book_id: bookId,
        page_id: pageId,
        page_number: pageNumber,
        content: trimmed,
      });
      setNoteText('');
      fetchNotes();
    } catch {
      setError('Failed to save note');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpvote = async (id: string) => {
    try {
      const res = await annotationsApi.upvote(id);
      setNotes(prev => prev.map(n => n.id === id ? { ...n, upvotes: res.upvotes } : n));
    } catch {
      // Silent fail
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await annotationsApi.delete(id);
      setNotes(prev => prev.filter(n => n.id !== id));
    } catch {
      // Silent fail
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Don't render section at all if loading and no auth (avoid layout shift)
  if (loading && notes.length === 0 && !isAuthenticated) return null;

  // Don't render if no notes and not authenticated
  if (!loading && notes.length === 0 && !isAuthenticated) return null;

  return (
    <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--border-light)' }}>
      {/* Header */}
      {(notes.length > 0 || isAuthenticated) && (
        <h4
          className="text-sm font-medium mb-3 flex items-center gap-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          Notes
          {notes.length > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)' }}
            >
              {notes.length}
            </span>
          )}
        </h4>
      )}

      {/* Notes list */}
      {notes.length > 0 && (
        <div className="space-y-3 mb-4">
          {notes.map(note => (
            <div
              key={note.id}
              className="rounded-lg p-3"
              style={{ background: 'var(--bg-warm)' }}
            >
              {/* Quoted passage if present */}
              {note.anchor?.text && (
                <p
                  className="text-xs italic mb-1.5 pl-2"
                  style={{
                    color: 'var(--text-muted)',
                    borderLeft: '2px solid var(--border-medium)',
                  }}
                >
                  &ldquo;{note.anchor.text.length > 120
                    ? note.anchor.text.slice(0, 120) + '...'
                    : note.anchor.text}&rdquo;
                </p>
              )}

              {/* Note content */}
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {note.content}
              </p>

              {/* Footer: attribution + actions */}
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {note.user_name} &middot; {formatRelativeTime(note.created_at)}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleUpvote(note.id)}
                    className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded hover:bg-stone-200 transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    title="Upvote"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                    {note.upvotes > 0 && <span>{note.upvotes}</span>}
                  </button>
                  {isAuthenticated && identity.id === note.user_id && (
                    <button
                      onClick={() => handleDelete(note.id)}
                      className="text-xs px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors"
                      style={{ color: 'var(--text-muted)' }}
                      title="Delete note"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add note form (authenticated only) */}
      {isAuthenticated ? (
        <div>
          <div className="flex gap-2">
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a note..."
              rows={1}
              className="flex-1 text-sm rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1"
              style={{
                background: 'var(--bg-warm)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-light)',
              }}
              disabled={submitting}
            />
            <button
              onClick={handleSubmit}
              disabled={submitting || noteText.trim().length < 3}
              className="px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
              style={{
                background: 'var(--accent-rust)',
                color: '#fff',
              }}
              title="Submit note"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          {error && (
            <p className="text-xs mt-1" style={{ color: 'var(--status-error)' }}>{error}</p>
          )}
        </div>
      ) : notes.length > 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          <a href="/auth/signin" className="underline" style={{ color: 'var(--accent-rust)' }}>
            Sign in
          </a>{' '}
          to add notes
        </p>
      ) : null}
    </div>
  );
});

export default PageNotes;
