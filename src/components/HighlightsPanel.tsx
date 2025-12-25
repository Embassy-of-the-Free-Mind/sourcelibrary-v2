'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Highlighter, Trash2, ExternalLink, Loader2, X } from 'lucide-react';

interface Highlight {
  id: string;
  book_id: string;
  page_id: string;
  page_number: number;
  book_title: string;
  text: string;
  note?: string;
  created_at: string;
}

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

  const fetchHighlights = async () => {
    setLoading(true);
    try {
      const url = bookId
        ? `/api/highlights?book_id=${bookId}`
        : '/api/highlights?limit=100';
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setHighlights(data);
      }
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
      const response = await fetch(`/api/highlights/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setHighlights(prev => prev.filter(h => h.id !== id));
        onHighlightDeleted?.();
      }
    } catch (error) {
      console.error('Failed to delete highlight:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
