'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  MessageSquare,
  X,
  Loader2,
  ThumbsUp,
  Reply,
  Trash2,
  BookOpen,
  AlertCircle,
  HelpCircle,
  Quote,
  Languages,
  Link2,
  ChevronDown,
  ChevronUp,
  Share2,
  Twitter,
  Check,
} from 'lucide-react';
import { Annotation, AnnotationType } from '@/lib/types';
import AnnotationEditor from './AnnotationEditor';

interface AnnotationPanelProps {
  bookId: string;
  pageId: string;
  pageNumber: number;
  bookTitle?: string;
  bookAuthor?: string;
  isOpen: boolean;
  onClose: () => void;
  onAnnotationChange?: () => void;
}

const TYPE_ICONS: Record<AnnotationType, React.ReactNode> = {
  comment: <MessageSquare className="w-3.5 h-3.5" />,
  context: <BookOpen className="w-3.5 h-3.5" />,
  reference: <Quote className="w-3.5 h-3.5" />,
  correction: <AlertCircle className="w-3.5 h-3.5" />,
  etymology: <Languages className="w-3.5 h-3.5" />,
  question: <HelpCircle className="w-3.5 h-3.5" />,
};

const TYPE_LABELS: Record<AnnotationType, string> = {
  comment: 'Comment',
  context: 'Context',
  reference: 'Reference',
  correction: 'Correction',
  etymology: 'Etymology',
  question: 'Question',
};

const TYPE_COLORS: Record<AnnotationType, string> = {
  comment: 'bg-stone-100 text-stone-700',
  context: 'bg-blue-100 text-blue-700',
  reference: 'bg-purple-100 text-purple-700',
  correction: 'bg-red-100 text-red-700',
  etymology: 'bg-green-100 text-green-700',
  question: 'bg-yellow-100 text-yellow-700',
};

export default function AnnotationPanel({
  bookId,
  pageId,
  pageNumber,
  bookTitle,
  bookAuthor,
  isOpen,
  onClose,
  onAnnotationChange,
}: AnnotationPanelProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
  const [replies, setReplies] = useState<Record<string, Annotation[]>>({});
  const [loadingReplies, setLoadingReplies] = useState<Set<string>>(new Set());
  const [upvoting, setUpvoting] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [shareMenuOpen, setShareMenuOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reply editor state
  const [replyingTo, setReplyingTo] = useState<Annotation | null>(null);

  // Share functions
  const getShareUrl = (annotation: Annotation) => {
    return `${window.location.origin}/book/${bookId}/read#page-${annotation.page_number}`;
  };

  const shareToTwitter = (annotation: Annotation) => {
    const quote = annotation.anchor?.text?.slice(0, 100) || '';
    const comment = annotation.content.slice(0, 100);
    const citation = bookTitle ? `${bookTitle}, p. ${annotation.page_number}` : `p. ${annotation.page_number}`;

    const text = quote
      ? `"${quote}${quote.length >= 100 ? '...' : ''}" — ${citation}\n\n💬 ${comment}${comment.length >= 100 ? '...' : ''}`
      : `💬 ${comment}${comment.length >= 100 ? '...' : ''}\n\n— ${citation}`;

    const twitterUrl = new URL('https://twitter.com/intent/tweet');
    twitterUrl.searchParams.set('text', text);
    twitterUrl.searchParams.set('url', getShareUrl(annotation));
    window.open(twitterUrl.toString(), '_blank', 'width=550,height=420');
    setShareMenuOpen(null);
  };

  const shareToBluesky = (annotation: Annotation) => {
    const quote = annotation.anchor?.text?.slice(0, 150) || '';
    const comment = annotation.content.slice(0, 150);
    const citation = bookTitle ? `${bookTitle}, p. ${annotation.page_number}` : `p. ${annotation.page_number}`;
    const url = getShareUrl(annotation);

    const text = quote
      ? `"${quote}${quote.length >= 150 ? '...' : ''}" — ${citation}\n\n💬 ${comment}${comment.length >= 150 ? '...' : ''}\n\n${url}`
      : `💬 ${comment}${comment.length >= 150 ? '...' : ''}\n\n— ${citation}\n\n${url}`;

    const bskyUrl = new URL('https://bsky.app/intent/compose');
    bskyUrl.searchParams.set('text', text);
    window.open(bskyUrl.toString(), '_blank', 'width=550,height=420');
    setShareMenuOpen(null);
  };

  const copyAnnotation = async (annotation: Annotation) => {
    const quote = annotation.anchor?.text || '';
    const citation = [bookAuthor, bookTitle, `p. ${annotation.page_number}`].filter(Boolean).join(', ');
    const url = getShareUrl(annotation);

    const text = quote
      ? `"${quote}"\n— ${citation}\n\n💬 ${annotation.content}\n\n${url}`
      : `💬 ${annotation.content}\n\n— ${citation}\n${url}`;

    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      setShareMenuOpen(null);
    }, 1500);
  };

  const fetchAnnotations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/annotations?page_id=${pageId}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        // Filter to only top-level annotations (no parent_id)
        setAnnotations(data.annotations?.filter((a: Annotation) => !a.parent_id) || []);
      }
    } catch (error) {
      console.error('Failed to fetch annotations:', error);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    if (isOpen) {
      fetchAnnotations();
    }
  }, [isOpen, fetchAnnotations]);

  const fetchReplies = async (annotationId: string) => {
    if (replies[annotationId]) return; // Already loaded

    setLoadingReplies((prev) => new Set(prev).add(annotationId));
    try {
      const res = await fetch(`/api/annotations?parent_id=${annotationId}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setReplies((prev) => ({
          ...prev,
          [annotationId]: data.annotations || [],
        }));
      }
    } catch (error) {
      console.error('Failed to fetch replies:', error);
    } finally {
      setLoadingReplies((prev) => {
        const next = new Set(prev);
        next.delete(annotationId);
        return next;
      });
    }
  };

  const toggleReplies = async (annotationId: string) => {
    if (expandedReplies.has(annotationId)) {
      setExpandedReplies((prev) => {
        const next = new Set(prev);
        next.delete(annotationId);
        return next;
      });
    } else {
      setExpandedReplies((prev) => new Set(prev).add(annotationId));
      await fetchReplies(annotationId);
    }
  };

  const handleUpvote = async (annotationId: string) => {
    setUpvoting((prev) => new Set(prev).add(annotationId));
    try {
      const res = await fetch(`/api/annotations/${annotationId}/upvote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        // Update annotation in state
        setAnnotations((prev) =>
          prev.map((a) =>
            a.id === annotationId ? { ...a, upvotes: data.upvotes } : a
          )
        );
        // Also update in replies if applicable
        setReplies((prev) => {
          const updated = { ...prev };
          for (const parentId of Object.keys(updated)) {
            updated[parentId] = updated[parentId].map((a) =>
              a.id === annotationId ? { ...a, upvotes: data.upvotes } : a
            );
          }
          return updated;
        });
      }
    } catch (error) {
      console.error('Failed to upvote:', error);
    } finally {
      setUpvoting((prev) => {
        const next = new Set(prev);
        next.delete(annotationId);
        return next;
      });
    }
  };

  const handleDelete = async (annotationId: string) => {
    if (!confirm('Delete this annotation?')) return;

    setDeleting((prev) => new Set(prev).add(annotationId));
    try {
      const res = await fetch(`/api/annotations/${annotationId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        // Remove from state
        setAnnotations((prev) => prev.filter((a) => a.id !== annotationId));
        // Also remove from replies
        setReplies((prev) => {
          const updated = { ...prev };
          for (const parentId of Object.keys(updated)) {
            updated[parentId] = updated[parentId].filter((a) => a.id !== annotationId);
          }
          return updated;
        });
        onAnnotationChange?.();
      }
    } catch (error) {
      console.error('Failed to delete:', error);
    } finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(annotationId);
        return next;
      });
    }
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const renderAnnotation = (annotation: Annotation, isReply = false) => (
    <div
      key={annotation.id}
      className={`${isReply ? 'ml-6 border-l-2 border-stone-200 pl-4' : ''} py-4 ${
        !isReply ? 'border-b border-stone-100 last:border-0' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-stone-900 text-sm">{annotation.user_name}</span>
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${TYPE_COLORS[annotation.type]}`}>
            {TYPE_ICONS[annotation.type]}
            {TYPE_LABELS[annotation.type]}
          </span>
          <span className="text-xs text-stone-400">{formatDate(annotation.created_at)}</span>
        </div>
      </div>

      {/* Anchor text (the text being annotated) */}
      {!isReply && annotation.anchor?.text && (
        <div className="mb-2 bg-yellow-50 border-l-2 border-yellow-400 px-2 py-1 text-sm text-stone-600 italic">
          &ldquo;{annotation.anchor.text.length > 100
            ? annotation.anchor.text.slice(0, 100) + '...'
            : annotation.anchor.text}&rdquo;
        </div>
      )}

      {/* Content */}
      <div className="text-sm text-stone-700 whitespace-pre-wrap">{annotation.content}</div>

      {/* Encyclopedia links */}
      {annotation.encyclopedia_refs && annotation.encyclopedia_refs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {annotation.encyclopedia_refs.map((refId: string) => (
            <Link
              key={refId}
              href={`/encyclopedia/${refId}`}
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
            >
              <Link2 className="w-3 h-3" />
              Encyclopedia
            </Link>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={() => handleUpvote(annotation.id)}
          disabled={upvoting.has(annotation.id)}
          className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-amber-600 transition-colors"
        >
          {upvoting.has(annotation.id) ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ThumbsUp className="w-3.5 h-3.5" />
          )}
          {annotation.upvotes || 0}
        </button>

        {!isReply && (
          <button
            onClick={() => setReplyingTo(annotation)}
            className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700 transition-colors"
          >
            <Reply className="w-3.5 h-3.5" />
            Reply
          </button>
        )}

        {/* Show replies toggle */}
        {!isReply && annotation.reply_count > 0 && (
          <button
            onClick={() => toggleReplies(annotation.id)}
            className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700 transition-colors"
          >
            {expandedReplies.has(annotation.id) ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
            {annotation.reply_count} {annotation.reply_count === 1 ? 'reply' : 'replies'}
          </button>
        )}

        {/* Share button with dropdown */}
        <div className="relative ml-auto">
          <button
            onClick={() => setShareMenuOpen(shareMenuOpen === annotation.id ? null : annotation.id)}
            className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-amber-600 transition-colors"
          >
            {copied && shareMenuOpen === annotation.id ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Share2 className="w-3.5 h-3.5" />
            )}
          </button>
          {shareMenuOpen === annotation.id && (
            <div className="absolute right-0 bottom-full mb-1 bg-white rounded-lg shadow-lg border border-stone-200 py-1 min-w-[120px] z-10">
              <button
                onClick={() => shareToTwitter(annotation)}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-stone-50 flex items-center gap-2"
              >
                <Twitter className="w-3 h-3" />
                Share on X
              </button>
              <button
                onClick={() => shareToBluesky(annotation)}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-stone-50 flex items-center gap-2"
              >
                <MessageSquare className="w-3 h-3" />
                Bluesky
              </button>
              <button
                onClick={() => copyAnnotation(annotation)}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-stone-50 flex items-center gap-2"
              >
                <Link2 className="w-3 h-3" />
                Copy
              </button>
            </div>
          )}
        </div>

        {/* Delete button (only for own annotations - would check user_id with auth) */}
        <button
          onClick={() => handleDelete(annotation.id)}
          disabled={deleting.has(annotation.id)}
          className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-red-500 transition-colors"
        >
          {deleting.has(annotation.id) ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Replies */}
      {!isReply && expandedReplies.has(annotation.id) && (
        <div className="mt-3">
          {loadingReplies.has(annotation.id) ? (
            <div className="flex items-center gap-2 text-sm text-stone-500 ml-6">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading replies...
            </div>
          ) : (
            replies[annotation.id]?.map((reply) => renderAnnotation(reply, true))
          )}
        </div>
      )}
    </div>
  );

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 flex justify-end">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/20" onClick={onClose} />

        {/* Panel */}
        <div className="relative w-full max-w-md bg-white shadow-xl flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-blue-600" />
              <h2 className="font-semibold text-stone-900">Page Annotations</h2>
              {!loading && (
                <span className="text-sm text-stone-500">({annotations.length})</span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1 hover:bg-stone-200 rounded transition-colors"
            >
              <X className="w-5 h-5 text-stone-600" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : annotations.length === 0 ? (
              <div className="text-center py-12 px-4">
                <MessageSquare className="w-12 h-12 text-stone-300 mx-auto mb-3" />
                <p className="text-stone-500">No annotations on this page yet.</p>
                <p className="text-stone-400 text-sm mt-1">
                  Select text to add the first annotation.
                </p>
              </div>
            ) : (
              <div className="px-4">{annotations.map((a) => renderAnnotation(a))}</div>
            )}
          </div>
        </div>
      </div>

      {/* Reply editor */}
      {replyingTo && (
        <AnnotationEditor
          isOpen={true}
          onClose={() => setReplyingTo(null)}
          onSave={() => {
            // Refresh replies for this annotation
            setReplies((prev) => {
              const updated = { ...prev };
              delete updated[replyingTo.id];
              return updated;
            });
            fetchReplies(replyingTo.id);
            // Update reply count
            setAnnotations((prev) =>
              prev.map((a) =>
                a.id === replyingTo.id
                  ? { ...a, reply_count: (a.reply_count || 0) + 1 }
                  : a
              )
            );
            setExpandedReplies((prev) => new Set(prev).add(replyingTo.id));
            onAnnotationChange?.();
          }}
          bookId={bookId}
          pageId={pageId}
          pageNumber={pageNumber}
          selectedText={replyingTo.anchor?.text || ''}
          parentId={replyingTo.id}
        />
      )}
    </>
  );
}
