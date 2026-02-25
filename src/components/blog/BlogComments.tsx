'use client';

import { useState, useEffect, useCallback } from 'react';
import { annotations } from '@/lib/api-client/annotations';
import type { Annotation } from '@/lib/types';

interface BlogCommentsProps {
  slug: string;
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

function CommentForm({
  slug,
  parentId,
  onSubmitted,
  onCancel,
  placeholder = 'Share your thoughts...',
  autoFocus = false,
}: {
  slug: string;
  parentId?: string;
  onSubmitted: () => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('blog_comment_name');
    if (saved) setName(saved);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || content.trim().length < 3) {
      setError('Comment must be at least 3 characters');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const displayName = name.trim() || 'Anonymous';
      localStorage.setItem('blog_comment_name', displayName);
      await annotations.create({
        book_id: 'blog',
        page_id: slug,
        page_number: 0,
        anchor: { text: slug },
        content: content.trim(),
        type: 'comment',
        user_name: displayName,
        parent_id: parentId,
      });
      setContent('');
      onSubmitted();
    } catch {
      setError('Failed to post comment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={3}
        className="w-full px-4 py-3 rounded-lg border border-border-light bg-white text-primary font-body text-base resize-none focus:outline-none focus:ring-2 focus:ring-accent-gold/30 focus:border-accent-gold/50 placeholder:text-muted"
      />
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name (optional)"
          className="flex-1 max-w-[200px] px-3 py-2 rounded-lg border border-border-light bg-white text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/30 focus:border-accent-gold/50 placeholder:text-muted"
        />
        <div className="flex items-center gap-2 ml-auto">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm text-muted hover:text-secondary transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={submitting || !content.trim()}
            className="px-5 py-2 rounded-lg bg-accent-rust text-white text-sm font-medium hover:bg-accent-rust/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Posting...' : parentId ? 'Reply' : 'Post comment'}
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-status-error">{error}</p>}
    </form>
  );
}

function Comment({
  comment,
  slug,
  onRefresh,
}: {
  comment: Annotation;
  slug: string;
  onRefresh: () => void;
}) {
  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState<Annotation[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [upvotes, setUpvotes] = useState(comment.upvotes);
  const [upvoted, setUpvoted] = useState(false);

  const loadReplies = useCallback(async () => {
    if (comment.reply_count === 0) return;
    setLoadingReplies(true);
    try {
      const res = await annotations.list({
        book_id: 'blog',
        page_id: slug,
        parent_id: comment.id,
      });
      setReplies(res.annotations);
    } catch {
      // silently fail
    } finally {
      setLoadingReplies(false);
    }
  }, [comment.id, comment.reply_count, slug]);

  const handleToggleReplies = () => {
    if (!showReplies && replies.length === 0) {
      loadReplies();
    }
    setShowReplies(!showReplies);
  };

  const handleUpvote = async () => {
    try {
      const res = await annotations.upvote(comment.id);
      setUpvotes(res.upvotes);
      setUpvoted(res.upvoted);
    } catch {
      // silently fail
    }
  };

  const handleReplied = () => {
    setShowReplyForm(false);
    loadReplies();
    setShowReplies(true);
    onRefresh();
  };

  return (
    <div className="py-5">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-accent-sage/15 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-accent-sage-dark text-sm font-medium">
            {(comment.user_name || 'A')[0].toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-sm font-medium text-primary">{comment.user_name}</span>
            <span className="text-xs text-muted">{timeAgo(comment.created_at)}</span>
          </div>
          <p className="text-base text-secondary leading-relaxed font-body whitespace-pre-wrap">{comment.content}</p>
          <div className="flex items-center gap-4 mt-2">
            <button
              onClick={handleUpvote}
              className={`flex items-center gap-1.5 text-xs transition-colors ${
                upvoted ? 'text-accent-rust' : 'text-muted hover:text-secondary'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill={upvoted ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              {upvotes > 0 && <span>{upvotes}</span>}
            </button>
            <button
              onClick={() => setShowReplyForm(!showReplyForm)}
              className="text-xs text-muted hover:text-secondary transition-colors"
            >
              Reply
            </button>
            {comment.reply_count > 0 && (
              <button
                onClick={handleToggleReplies}
                className="text-xs text-accent-rust hover:text-accent-rust/80 transition-colors"
              >
                {showReplies ? 'Hide' : 'Show'} {comment.reply_count} {comment.reply_count === 1 ? 'reply' : 'replies'}
              </button>
            )}
          </div>

          {showReplyForm && (
            <div className="mt-3">
              <CommentForm
                slug={slug}
                parentId={comment.id}
                onSubmitted={handleReplied}
                onCancel={() => setShowReplyForm(false)}
                placeholder="Write a reply..."
                autoFocus
              />
            </div>
          )}

          {showReplies && (
            <div className="mt-3 pl-4 border-l-2 border-border-light space-y-0 divide-y divide-border-light">
              {loadingReplies ? (
                <p className="text-sm text-muted py-3">Loading replies...</p>
              ) : (
                replies.map((reply) => (
                  <div key={reply.id} className="py-3">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-sm font-medium text-primary">{reply.user_name}</span>
                      <span className="text-xs text-muted">{timeAgo(reply.created_at)}</span>
                    </div>
                    <p className="text-sm text-secondary leading-relaxed font-body whitespace-pre-wrap">{reply.content}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BlogComments({ slug }: BlogCommentsProps) {
  const [comments, setComments] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const fetchComments = useCallback(async () => {
    try {
      const res = await annotations.list({
        book_id: 'blog',
        page_id: slug,
        limit: 50,
      });
      // Filter to top-level comments only (no parent_id)
      const topLevel = res.annotations.filter((a) => !a.parent_id);
      setComments(topLevel);
      setTotal(res.total);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  return (
    <section className="mt-16 pt-10 border-t border-border-medium">
      <h2 className="font-serif text-2xl text-primary mb-6">
        Comments{total > 0 && <span className="text-muted font-sans text-lg ml-2">({total})</span>}
      </h2>

      <div className="mb-8">
        <CommentForm slug={slug} onSubmitted={fetchComments} />
      </div>

      {loading ? (
        <p className="text-muted text-sm py-4">Loading comments...</p>
      ) : comments.length === 0 ? (
        <p className="text-muted text-sm py-4">No comments yet. Be the first to share your thoughts.</p>
      ) : (
        <div className="divide-y divide-border-light">
          {comments.map((comment) => (
            <Comment key={comment.id} comment={comment} slug={slug} onRefresh={fetchComments} />
          ))}
        </div>
      )}
    </section>
  );
}
