'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, ThumbsUp, Trash2, ChevronDown, Send } from 'lucide-react';
import { annotations as annotationsApi } from '@/lib/api-client';
import { ANNOTATION_TYPE_STYLES } from '@/lib/style-constants';
import type { Annotation, AnnotationType } from '@/lib/types';

interface InlineAnnotationsProps {
  bookId: string;
  pageId: string;
  pageNumber: number;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

const TYPE_LABELS: Record<string, string> = {
  comment: 'Comment',
  context: 'Context',
  reference: 'Reference',
  correction: 'Correction',
  etymology: 'Etymology',
  question: 'Question',
};

export default function InlineAnnotations({ bookId, pageId, pageNumber }: InlineAnnotationsProps) {
  const [items, setItems] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [replies, setReplies] = useState<Record<string, Annotation[]>>({});
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
  const [loadingReplies, setLoadingReplies] = useState<Set<string>>(new Set());
  const [upvoting, setUpvoting] = useState<Set<string>>(new Set());

  // Inline comment form state
  const [commentText, setCommentText] = useState('');
  const [userName, setUserName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showNameInput, setShowNameInput] = useState(false);

  // Reply form state
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('annotation_username');
    if (saved) setUserName(saved);
    else setShowNameInput(true);
  }, []);

  const fetchAnnotations = useCallback(async () => {
    try {
      const data = await annotationsApi.list({ page_id: pageId, limit: 100 });
      setItems((data.annotations || []).filter((a: Annotation) => !a.parent_id));
    } catch {
      // Silently fail — annotations are not critical
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    fetchAnnotations();
  }, [fetchAnnotations]);

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || commentText.trim().length < 3) return;
    if (!userName.trim()) {
      setShowNameInput(true);
      return;
    }

    setSubmitting(true);
    try {
      localStorage.setItem('annotation_username', userName.trim());
      await annotationsApi.create({
        book_id: bookId,
        page_id: pageId,
        page_number: pageNumber,
        anchor: { text: '' },
        content: commentText.trim(),
        type: 'comment',
        user_name: userName.trim(),
      });
      setCommentText('');
      fetchAnnotations();
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitReply = async (parentId: string) => {
    if (!replyText.trim() || replyText.trim().length < 3) return;
    if (!userName.trim()) {
      setShowNameInput(true);
      return;
    }

    setReplySubmitting(true);
    try {
      localStorage.setItem('annotation_username', userName.trim());
      await annotationsApi.create({
        book_id: bookId,
        page_id: pageId,
        page_number: pageNumber,
        anchor: { text: '' },
        content: replyText.trim(),
        type: 'comment',
        user_name: userName.trim(),
        parent_id: parentId,
      });
      setReplyText('');
      setReplyingTo(null);
      // Refresh replies for this parent
      const data = await annotationsApi.replies(parentId);
      setReplies(prev => ({ ...prev, [parentId]: data.replies || [] }));
      fetchAnnotations();
    } catch {
      // ignore
    } finally {
      setReplySubmitting(false);
    }
  };

  const handleUpvote = async (id: string) => {
    if (upvoting.has(id)) return;
    setUpvoting(prev => new Set(prev).add(id));
    try {
      const data = await annotationsApi.upvote(id);
      setItems(prev => prev.map(a => a.id === id ? { ...a, upvotes: data.upvotes } : a));
    } catch {
      // ignore
    } finally {
      setUpvoting(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await annotationsApi.delete(id);
      setItems(prev => prev.filter(a => a.id !== id));
    } catch {
      // ignore
    }
  };

  const toggleReplies = async (id: string) => {
    if (expandedReplies.has(id)) {
      setExpandedReplies(prev => { const s = new Set(prev); s.delete(id); return s; });
      return;
    }
    if (!replies[id]) {
      setLoadingReplies(prev => new Set(prev).add(id));
      try {
        const data = await annotationsApi.replies(id);
        setReplies(prev => ({ ...prev, [id]: data.replies || [] }));
      } catch {
        // ignore
      } finally {
        setLoadingReplies(prev => { const s = new Set(prev); s.delete(id); return s; });
      }
    }
    setExpandedReplies(prev => new Set(prev).add(id));
  };

  const renderAnnotation = (a: Annotation, isReply = false) => (
    <div key={a.id} className={`${isReply ? 'ml-6 border-l-2 border-stone-200 pl-4' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {/* Header: name + type + time */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{a.user_name}</span>
            {a.type !== 'comment' && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${ANNOTATION_TYPE_STYLES[a.type as AnnotationType]}`}>
                {TYPE_LABELS[a.type] || a.type}
              </span>
            )}
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{timeAgo(a.created_at)}</span>
          </div>

          {/* Quoted text (if any) */}
          {a.anchor?.text && (
            <div className="mt-1 text-xs italic border-l-2 border-yellow-400 pl-2" style={{ color: 'var(--text-muted)' }}>
              &ldquo;{a.anchor.text.length > 120 ? a.anchor.text.slice(0, 120) + '...' : a.anchor.text}&rdquo;
            </div>
          )}

          {/* Content */}
          <p className="mt-1 text-sm whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{a.content}</p>

          {/* Actions */}
          <div className="flex items-center gap-3 mt-1.5">
            <button
              onClick={() => handleUpvote(a.id)}
              disabled={upvoting.has(a.id)}
              className="flex items-center gap-1 text-xs hover:text-accent-rust transition-colors"
              style={{ color: 'var(--text-faint)' }}
            >
              <ThumbsUp className="w-3 h-3" />
              {a.upvotes > 0 && <span>{a.upvotes}</span>}
            </button>
            {!isReply && (
              <button
                onClick={() => { setReplyingTo(replyingTo === a.id ? null : a.id); setReplyText(''); }}
                className="text-xs hover:text-accent-rust transition-colors"
                style={{ color: 'var(--text-faint)' }}
              >
                Reply
              </button>
            )}
            {a.user_name === userName && (
              <button
                onClick={() => handleDelete(a.id)}
                className="text-xs hover:text-red-600 transition-colors"
                style={{ color: 'var(--text-faint)' }}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Reply form */}
          {replyingTo === a.id && (
            <form
              onSubmit={(e) => { e.preventDefault(); handleSubmitReply(a.id); }}
              className="flex items-center gap-2 mt-2"
            >
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write a reply..."
                autoFocus
                className="flex-1 px-3 py-1.5 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-accent-rust"
              />
              <button
                type="submit"
                disabled={replySubmitting || replyText.trim().length < 3}
                className="p-1.5 rounded-lg bg-accent-rust text-white disabled:opacity-40"
              >
                {replySubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </form>
          )}

          {/* Replies */}
          {!isReply && a.reply_count > 0 && (
            <button
              onClick={() => toggleReplies(a.id)}
              className="flex items-center gap-1 mt-2 text-xs hover:text-accent-rust transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${expandedReplies.has(a.id) ? 'rotate-180' : ''}`} />
              {loadingReplies.has(a.id) ? 'Loading...' : expandedReplies.has(a.id) ? 'Hide replies' : `${a.reply_count} ${a.reply_count === 1 ? 'reply' : 'replies'}`}
            </button>
          )}
          {expandedReplies.has(a.id) && replies[a.id] && (
            <div className="mt-2 space-y-3">
              {replies[a.id].map(r => renderAnnotation(r, true))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="border-t pt-4 mt-4" style={{ borderColor: 'var(--border-light)' }}>
      {/* Comment form */}
      <form onSubmit={handleSubmitComment} className="mb-4">
        {showNameInput && !userName && (
          <input
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="Your name"
            className="w-full px-3 py-1.5 mb-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-accent-rust"
          />
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Comment on this page..."
            className="flex-1 px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-accent-rust"
            style={{ background: 'var(--bg-cream)' }}
          />
          <button
            type="submit"
            disabled={submitting || commentText.trim().length < 3}
            className="p-2 rounded-lg bg-accent-rust text-white disabled:opacity-40 transition-opacity"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </form>

      {/* Annotations list */}
      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      ) : items.length > 0 ? (
        <div className="space-y-4">
          {items.map(a => renderAnnotation(a))}
        </div>
      ) : null}
    </div>
  );
}
