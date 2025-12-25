'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Highlighter, Trash2, ExternalLink, Loader2, BookOpen } from 'lucide-react';

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

export default function HighlightsPage() {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchHighlights = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/highlights?limit=200');
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
    fetchHighlights();
  }, []);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/highlights/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setHighlights(prev => prev.filter(h => h.id !== id));
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

  // Group highlights by book
  const highlightsByBook = highlights.reduce((acc, h) => {
    if (!acc[h.book_id]) {
      acc[h.book_id] = {
        book_title: h.book_title,
        highlights: [],
      };
    }
    acc[h.book_id].highlights.push(h);
    return acc;
  }, {} as Record<string, { book_title: string; highlights: Highlight[] }>);

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Library
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-b from-amber-50 to-yellow-50 border-b border-amber-100">
        <div className="max-w-4xl mx-auto px-4 py-8 text-center">
          <Highlighter className="w-10 h-10 text-amber-600 mx-auto mb-3" />
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Saved Highlights
          </h1>
          <p className="text-stone-600 mt-2">
            Notable passages from across the library
          </p>
          {!loading && (
            <p className="text-amber-700 text-sm mt-2 font-medium">
              {highlights.length} highlight{highlights.length !== 1 ? 's' : ''} saved
            </p>
          )}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
          </div>
        ) : highlights.length === 0 ? (
          <div className="text-center py-16">
            <BookOpen className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-stone-700 mb-2">No highlights yet</h2>
            <p className="text-stone-500 mb-6">
              Open a book and select text to save highlights.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
            >
              <BookOpen className="w-4 h-4" />
              Browse Library
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(highlightsByBook).map(([bookId, { book_title, highlights: bookHighlights }]) => (
              <div key={bookId} className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                {/* Book header */}
                <div className="px-4 py-3 bg-stone-50 border-b border-stone-200">
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/book/${bookId}`}
                      className="font-semibold text-stone-900 hover:text-amber-700 transition-colors"
                    >
                      {book_title || 'Untitled Book'}
                    </Link>
                    <span className="text-sm text-stone-500">
                      {bookHighlights.length} highlight{bookHighlights.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                {/* Highlights */}
                <div className="divide-y divide-stone-100">
                  {bookHighlights.map(highlight => (
                    <div key={highlight.id} className="p-4 group hover:bg-yellow-50/50 transition-colors">
                      <blockquote className="text-stone-700 leading-relaxed mb-3 border-l-2 border-yellow-400 pl-3">
                        &ldquo;{highlight.text}&rdquo;
                      </blockquote>

                      <div className="flex items-center justify-between text-xs">
                        <div className="text-stone-500">
                          <Link
                            href={`/book/${highlight.book_id}/page/${highlight.page_id}`}
                            className="text-amber-600 hover:text-amber-700 inline-flex items-center gap-1"
                          >
                            Page {highlight.page_number}
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                          <span className="text-stone-400 ml-3">
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
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
