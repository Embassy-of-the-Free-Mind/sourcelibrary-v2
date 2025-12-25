'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, Loader2, Sparkles, Quote, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { Book, Page } from '@/lib/types';

interface ReadPageProps {
  params: Promise<{ id: string }>;
}

interface BookSummary {
  overview: string;
  quotes: Array<{ text: string; page: number }>;
  themes: string[];
  generated_at?: Date;
}

export default function ReadPage({ params }: ReadPageProps) {
  const [bookId, setBookId] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [summary, setSummary] = useState<BookSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFullText, setShowFullText] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  // Resolve params
  useEffect(() => {
    params.then(p => setBookId(p.id));
  }, [params]);

  // Fetch book data
  useEffect(() => {
    if (!bookId) return;

    async function fetchData() {
      try {
        setLoading(true);

        // Fetch book with pages
        const bookRes = await fetch(`/api/books/${bookId}`);
        if (!bookRes.ok) throw new Error('Book not found');
        const bookData = await bookRes.json();
        setBook(bookData);
        setPages(bookData.pages || []);

        // Check if book has a reading summary
        if (bookData.reading_summary) {
          setSummary(bookData.reading_summary);
        }

        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [bookId]);

  // Generate book summary
  const generateSummary = async () => {
    setGeneratingSummary(true);

    try {
      const response = await fetch(`/api/books/${bookId}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate');
      }

      const data = await response.json();
      setSummary(data);
    } catch (err) {
      console.error('Error generating summary:', err);
    } finally {
      setGeneratingSummary(false);
    }
  };

  // Get translated pages
  const translatedPages = pages.filter(p => p.translation?.data);
  const translationProgress = pages.length > 0
    ? Math.round((translatedPages.length / pages.length) * 100)
    : 0;

  // Render translation text with basic formatting
  const renderTranslation = (text: string) => {
    // Remove [[tags]] and clean up
    const cleaned = text
      .replace(/\[\[[^\]]+\]\]/g, '')
      .trim();

    return cleaned.split('\n\n').map((paragraph, i) => (
      <p key={i} className="mb-4 leading-relaxed">
        {paragraph}
      </p>
    ));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <BookOpen className="w-12 h-12 text-stone-400 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Book Not Found</h1>
          <Link href="/" className="text-amber-600 hover:text-amber-700">
            Back to Library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link
              href={`/book/${bookId}`}
              className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back to Book</span>
            </Link>
            <span className="text-sm text-stone-500">
              {translatedPages.length}/{pages.length} pages translated
            </span>
          </div>
        </div>
      </header>

      {/* Book info */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-8 sm:py-10">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h1 className="text-2xl sm:text-3xl font-serif font-bold">
            {book.display_title || book.title}
          </h1>
          <p className="text-stone-300 mt-2">{book.author}</p>
          {book.year && (
            <p className="text-stone-400 text-sm mt-1">{book.year}</p>
          )}
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Summary Section */}
        <section className="mb-8">
          {summary ? (
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <div className="p-6">
                <h2 className="text-lg font-semibold text-stone-900 mb-4">Overview</h2>
                <div className="prose prose-stone prose-sm max-w-none">
                  {summary.overview.split('\n\n').map((p, i) => (
                    <p key={i} className="text-stone-700 leading-relaxed mb-3">{p}</p>
                  ))}
                </div>

                {/* Key Quotes */}
                {summary.quotes && summary.quotes.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-stone-100">
                    <h3 className="text-sm font-semibold text-stone-600 mb-4">Notable Passages</h3>
                    <div className="space-y-4">
                      {summary.quotes.map((quote, i) => (
                        <blockquote
                          key={i}
                          className="relative pl-4 border-l-2 border-amber-300"
                        >
                          <Quote className="absolute -left-1.5 -top-0.5 w-3 h-3 text-amber-400 bg-white" />
                          <p className="text-stone-600 italic text-sm leading-relaxed">
                            &ldquo;{quote.text}&rdquo;
                          </p>
                          <Link
                            href={`/book/${bookId}/page/${pages.find(p => p.page_number === quote.page)?.id || ''}`}
                            className="text-xs text-amber-600 hover:text-amber-700 mt-1 inline-flex items-center gap-1"
                          >
                            Page {quote.page}
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        </blockquote>
                      ))}
                    </div>
                  </div>
                )}

                {/* Themes */}
                {summary.themes && summary.themes.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-stone-100">
                    <h3 className="text-sm font-semibold text-stone-600 mb-3">Key Themes</h3>
                    <div className="flex flex-wrap gap-2">
                      {summary.themes.map((theme, i) => (
                        <span
                          key={i}
                          className="px-3 py-1 bg-amber-50 text-amber-800 text-sm rounded-full"
                        >
                          {theme}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : translatedPages.length > 0 ? (
            <div className="bg-white rounded-xl border border-stone-200 p-6 text-center">
              <Sparkles className="w-8 h-8 text-amber-500 mx-auto mb-3" />
              <h2 className="text-lg font-semibold text-stone-900 mb-2">Generate Reading Guide</h2>
              <p className="text-stone-600 text-sm mb-4">
                Create an overview of this text with key quotes and themes.
              </p>
              <button
                onClick={generateSummary}
                disabled={generatingSummary}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {generatingSummary ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate Overview
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="bg-stone-100 rounded-xl p-6 text-center">
              <BookOpen className="w-8 h-8 text-stone-400 mx-auto mb-3" />
              <p className="text-stone-600">
                Translate pages to generate a reading guide.
              </p>
              <div className="mt-3">
                <div className="w-full bg-stone-200 rounded-full h-2 max-w-xs mx-auto">
                  <div
                    className="bg-amber-500 h-2 rounded-full transition-all"
                    style={{ width: `${translationProgress}%` }}
                  />
                </div>
                <p className="text-xs text-stone-500 mt-1">{translationProgress}% translated</p>
              </div>
            </div>
          )}
        </section>

        {/* Full Text Section */}
        {translatedPages.length > 0 && (
          <section>
            <button
              onClick={() => setShowFullText(!showFullText)}
              className="w-full flex items-center justify-between p-4 bg-white rounded-xl border border-stone-200 hover:bg-stone-50 transition-colors"
            >
              <span className="font-semibold text-stone-900">
                Full Translation ({translatedPages.length} pages)
              </span>
              {showFullText ? (
                <ChevronUp className="w-5 h-5 text-stone-500" />
              ) : (
                <ChevronDown className="w-5 h-5 text-stone-500" />
              )}
            </button>

            {showFullText && (
              <div
                ref={textRef}
                className="mt-4 bg-white rounded-xl border border-stone-200 p-6 sm:p-8"
              >
                <div className="prose prose-stone max-w-none font-serif text-lg leading-relaxed">
                  {translatedPages.map((page, index) => (
                    <div key={page.id} className="mb-8">
                      {index > 0 && (
                        <div className="flex items-center gap-4 my-8 text-stone-400">
                          <div className="flex-1 h-px bg-stone-200" />
                          <Link
                            href={`/book/${bookId}/page/${page.id}`}
                            className="text-xs hover:text-amber-600 transition-colors"
                          >
                            Page {page.page_number}
                          </Link>
                          <div className="flex-1 h-px bg-stone-200" />
                        </div>
                      )}
                      {renderTranslation(page.translation?.data || '')}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Quick Navigation */}
        {pages.length > 0 && (
          <section className="mt-8 pt-8 border-t border-stone-200">
            <h3 className="text-sm font-semibold text-stone-600 mb-4">Jump to Page</h3>
            <div className="flex flex-wrap gap-2">
              {pages.slice(0, 20).map(page => (
                <Link
                  key={page.id}
                  href={`/book/${bookId}/page/${page.id}`}
                  className={`w-10 h-10 flex items-center justify-center rounded-lg text-sm transition-colors ${
                    page.translation?.data
                      ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                      : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                  }`}
                >
                  {page.page_number}
                </Link>
              ))}
              {pages.length > 20 && (
                <span className="w-10 h-10 flex items-center justify-center text-stone-400 text-sm">
                  +{pages.length - 20}
                </span>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
