'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Highlighter, Trash2, ExternalLink, Loader2, X, Share2, Twitter, MessageCircle, Link2, Check } from 'lucide-react';
import { getShortUrl } from '@/lib/shortlinks';
import { highlights as highlightsApi } from '@/lib/api-client';
import type { Highlight } from '@/lib/api-client';

interface HighlightsPanelProps {
  bookId?: string;  // If provided, filter to this book
  isOpen: boolean;
  onClose: () => void;
  onHighlightDeleted?: () => void;
}

export default function HighlightsPanel({
  bookId,
  isOpen,
  onClose,
  onHighlightDeleted,
}: HighlightsPanelProps) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [shareMenuOpen, setShareMenuOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchHighlights = async () => {
    setLoading(true);
    try {
      const data = await highlightsApi.list(
        bookId ? { book_id: bookId, limit: 100 } : { limit: 100 }
      );
      setHighlights(data.highlights || []);
    } catch (error) {
      console.error('Failed to fetch highlights:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchHighlights();
    }
  }, [isOpen, bookId]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await highlightsApi.delete(id);
      setHighlights(prev => prev.filter(h => h.id !== id));
      onHighlightDeleted?.();
    } catch (error) {
      console.error('Failed to delete highlight:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateStr: string | Date) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const shareToTwitter = (highlight: Highlight) => {
    const citation = `${highlight.book_title}, p. ${highlight.page_number}`;
    const maxQuoteLength = 200;
    const quote = highlight.text.length > maxQuoteLength
      ? highlight.text.substring(0, maxQuoteLength - 3) + '...'
      : highlight.text;
    const tweetText = `"${quote}"\n\n— ${citation}`;
    const shareUrl = getShortUrl(highlight.book_id, highlight.page_number, highlight.page_id);

    const twitterUrl = new URL('https://twitter.com/intent/tweet');
    twitterUrl.searchParams.set('text', tweetText);
    twitterUrl.searchParams.set('url', shareUrl);
    window.open(twitterUrl.toString(), '_blank', 'width=550,height=420');
    setShareMenuOpen(null);
  };

  const shareToBluesky = (highlight: Highlight) => {
    const citation = `${highlight.book_title}, p. ${highlight.page_number}`;
    const shareUrl = getShortUrl(highlight.book_id, highlight.page_number, highlight.page_id);
    const fullText = `"${highlight.text.substring(0, 250)}"\n\n— ${citation}\n\n${shareUrl}`;

    const bskyUrl = new URL('https://bsky.app/intent/compose');
    bskyUrl.searchParams.set('text', fullText);
    window.open(bskyUrl.toString(), '_blank', 'width=550,height=420');
    setShareMenuOpen(null);
  };

  const copyQuote = async (highlight: Highlight) => {
    const citation = `${highlight.book_title}, p. ${highlight.page_number}`;
    const shareUrl = getShortUrl(highlight.book_id, highlight.page_number, highlight.page_id);
    const quoteToCopy = `"${highlight.text}"\n\n— ${citation}\n${shareUrl}`;

    await navigator.clipboard.writeText(quoteToCopy);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      setShareMenuOpen(null);
    }, 1500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-white shadow-xl flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 bg-gradient-to-r from-amber-50 to-yellow-50">
          <div className="flex items-center gap-2">
            <Highlighter className="w-5 h-5 text-amber-600" />
            <h2 className="font-semibold text-stone-900">
              {bookId ? 'Book Highlights' : 'All Highlights'}
            </h2>
            {!loading && (
              <span className="text-sm text-stone-500">
                ({highlights.length})
              </span>
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
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-amber-600" />
            </div>
          ) : highlights.length === 0 ? (
            <div className="text-center py-12">
              <Highlighter className="w-12 h-12 text-stone-300 mx-auto mb-3" />
              <p className="text-stone-500">No highlights saved yet.</p>
              <p className="text-stone-400 text-sm mt-1">
                Select text to save highlights.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {highlights.map(highlight => (
                <div
                  key={highlight.id}
                  className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 group"
                >
                  <blockquote className="text-stone-700 text-sm leading-relaxed mb-3 border-l-2 border-yellow-400 pl-3">
                    &ldquo;{highlight.text}&rdquo;
                  </blockquote>

                  <div className="flex items-center justify-between text-xs">
                    <div className="text-stone-500">
                      {!bookId && (
                        <span className="font-medium text-stone-700">
                          {highlight.book_title}
                        </span>
                      )}
                      {!bookId && ' · '}
                      <Link
                        href={`/book/${highlight.book_id}/page/${highlight.page_id}`}
                        className="text-amber-600 hover:text-amber-700 inline-flex items-center gap-1"
                      >
                        Page {highlight.page_number}
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                      <span className="text-stone-400 ml-2">
                        {formatDate(highlight.created_at)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      {/* Share button */}
                      <div className="relative">
                        <button
                          onClick={() => setShareMenuOpen(shareMenuOpen === highlight.id ? null : highlight.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-stone-400 hover:text-amber-600 transition-all"
                          title="Share"
                        >
                          {copied && shareMenuOpen === highlight.id ? (
                            <Check className="w-4 h-4 text-green-500" />
                          ) : (
                            <Share2 className="w-4 h-4" />
                          )}
                        </button>
                        {shareMenuOpen === highlight.id && (
                          <div className="absolute right-0 bottom-full mb-1 bg-white rounded-lg shadow-lg border border-stone-200 py-1 min-w-[140px] z-10">
                            <button
                              onClick={() => shareToTwitter(highlight)}
                              className="w-full px-3 py-1.5 text-left text-sm hover:bg-stone-50 flex items-center gap-2"
                            >
                              <Twitter className="w-3.5 h-3.5" />
                              Share on X
                            </button>
                            <button
                              onClick={() => shareToBluesky(highlight)}
                              className="w-full px-3 py-1.5 text-left text-sm hover:bg-stone-50 flex items-center gap-2"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              Bluesky
                            </button>
                            <button
                              onClick={() => copyQuote(highlight)}
                              className="w-full px-3 py-1.5 text-left text-sm hover:bg-stone-50 flex items-center gap-2"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                              Copy quote
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Delete button */}
                      <button
                        onClick={() => handleDelete(highlight.id)}
                        disabled={deletingId === highlight.id}
                        className="opacity-0 group-hover:opacity-100 p-1 text-stone-400 hover:text-red-500 transition-all"
                        title="Delete highlight"
                      >
                        {deletingId === highlight.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
