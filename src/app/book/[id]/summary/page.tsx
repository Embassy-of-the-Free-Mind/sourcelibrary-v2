'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, BookOpen, RefreshCw, FileText, Users, MapPin, Lightbulb, BookMarked } from 'lucide-react';

interface ConceptEntry {
  term: string;
  pages: number[];
}

interface BookIndex {
  vocabulary: ConceptEntry[];
  keywords: ConceptEntry[];
  people: ConceptEntry[];
  places: ConceptEntry[];
  concepts: ConceptEntry[];
  pageSummaries: { page: number; summary: string }[];
  sectionSummaries?: { title: string; startPage: number; endPage: number; summary: string }[];
  bookSummary: {
    brief: string;
    abstract: string;
    detailed: string;
  };
  generatedAt: string;
  pagesCovered: number;
  totalPages: number;
}

interface Book {
  id: string;
  title: string;
  display_title?: string;
  author: string;
}

export default function BookSummaryPage() {
  const params = useParams();
  const bookId = params.id as string;

  const [book, setBook] = useState<Book | null>(null);
  const [index, setIndex] = useState<BookIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'summary' | 'pages' | 'index'>('summary');

  useEffect(() => {
    fetchData();
  }, [bookId]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch book info
      const bookRes = await fetch(`/api/books/${bookId}`);
      if (bookRes.ok) {
        const bookData = await bookRes.json();
        setBook(bookData.book);
      }

      // Fetch index
      const indexRes = await fetch(`/api/books/${bookId}/index`);
      if (indexRes.ok) {
        const indexData = await indexRes.json();
        setIndex(indexData);
      } else if (indexRes.status === 404) {
        setError('Book not found');
      }
    } catch (e) {
      setError('Failed to load summary');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const regenerateIndex = async () => {
    setGenerating(true);
    try {
      // Force regenerate
      await fetch(`/api/books/${bookId}/index`, { method: 'POST' });
      // Fetch fresh
      const res = await fetch(`/api/books/${bookId}/index`);
      if (res.ok) {
        setIndex(await res.json());
      }
    } catch (e) {
      console.error('Failed to regenerate:', e);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50">
        <header className="bg-white border-b border-stone-200">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="h-6 w-32 bg-stone-200 rounded animate-pulse" />
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="space-y-4">
            <div className="h-8 w-64 bg-stone-200 rounded animate-pulse" />
            <div className="h-4 w-full bg-stone-200 rounded animate-pulse" />
            <div className="h-4 w-3/4 bg-stone-200 rounded animate-pulse" />
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-stone-600 mb-4">{error}</p>
          <Link href="/" className="text-amber-700 hover:text-amber-800">
            Return to library
          </Link>
        </div>
      </div>
    );
  }

  const hasSummary = index?.bookSummary?.brief || index?.bookSummary?.abstract;
  const hasPageSummaries = (index?.pageSummaries?.length || 0) > 0;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link
              href={`/book/${bookId}`}
              className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Book
            </Link>
            <button
              onClick={regenerateIndex}
              disabled={generating}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Generating...' : 'Regenerate'}
            </button>
          </div>
        </div>
      </header>

      {/* Book Title */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-start gap-4">
            <BookOpen className="w-8 h-8 text-amber-400 flex-shrink-0 mt-1" />
            <div>
              <h1 className="text-2xl sm:text-3xl font-serif font-bold">
                {book?.display_title || book?.title}
              </h1>
              <p className="text-stone-300 mt-1">{book?.author}</p>
              {index && (
                <p className="text-stone-400 text-sm mt-2">
                  {index.pagesCovered} of {index.totalPages} pages summarized
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-6">
            <button
              onClick={() => setActiveTab('summary')}
              className={`py-3 border-b-2 text-sm font-medium transition-colors ${
                activeTab === 'summary'
                  ? 'border-amber-600 text-amber-700'
                  : 'border-transparent text-stone-500 hover:text-stone-700'
              }`}
            >
              Book Summary
            </button>
            <button
              onClick={() => setActiveTab('pages')}
              className={`py-3 border-b-2 text-sm font-medium transition-colors ${
                activeTab === 'pages'
                  ? 'border-amber-600 text-amber-700'
                  : 'border-transparent text-stone-500 hover:text-stone-700'
              }`}
            >
              Page by Page ({index?.pageSummaries?.length || 0})
            </button>
            <button
              onClick={() => setActiveTab('index')}
              className={`py-3 border-b-2 text-sm font-medium transition-colors ${
                activeTab === 'index'
                  ? 'border-amber-600 text-amber-700'
                  : 'border-transparent text-stone-500 hover:text-stone-700'
              }`}
            >
              Index
            </button>
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!hasSummary && !hasPageSummaries ? (
          <div className="text-center py-16 bg-white rounded-lg border border-stone-200">
            <FileText className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-stone-600">No summaries yet</h3>
            <p className="text-stone-500 mt-2 mb-6">
              Process page summaries first, then generate the book summary.
            </p>
            <Link
              href={`/book/${bookId}/prepare`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
            >
              Prepare Pages
            </Link>
          </div>
        ) : activeTab === 'summary' ? (
          <div className="space-y-8">
            {/* Brief Summary */}
            {index?.bookSummary?.brief && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
                <h2 className="text-sm font-semibold text-amber-800 uppercase tracking-wide mb-2">
                  In Brief
                </h2>
                <p className="text-lg text-stone-800 leading-relaxed">
                  {index.bookSummary.brief}
                </p>
              </div>
            )}

            {/* Abstract */}
            {index?.bookSummary?.abstract && (
              <div className="bg-white border border-stone-200 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-stone-900 mb-4">Abstract</h2>
                <p className="text-stone-700 leading-relaxed">
                  {index.bookSummary.abstract}
                </p>
              </div>
            )}

            {/* Detailed Summary */}
            {index?.bookSummary?.detailed && (
              <div className="bg-white border border-stone-200 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-stone-900 mb-4">Detailed Summary</h2>
                <div className="prose prose-stone max-w-none">
                  {index.bookSummary.detailed.split('\n\n').map((para, i) => (
                    <p key={i} className="text-stone-700 leading-relaxed mb-4 last:mb-0">
                      {para}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Section Summaries */}
            {index?.sectionSummaries && index.sectionSummaries.length > 0 && (
              <div className="bg-white border border-stone-200 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-stone-900 mb-4">Sections</h2>
                <div className="space-y-4">
                  {index.sectionSummaries.map((section, i) => (
                    <div key={i} className="border-l-2 border-amber-400 pl-4">
                      <h3 className="font-medium text-stone-900">
                        {section.title}
                        <span className="text-stone-400 text-sm ml-2">
                          (pp. {section.startPage}-{section.endPage})
                        </span>
                      </h3>
                      <p className="text-stone-600 text-sm mt-1">{section.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'pages' ? (
          <div className="space-y-4">
            {index?.pageSummaries?.map((ps) => (
              <Link
                key={ps.page}
                href={`/book/${bookId}/page/${ps.page}`}
                className="block bg-white border border-stone-200 rounded-lg p-4 hover:border-amber-400 hover:shadow-sm transition-all"
              >
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center text-sm font-medium text-stone-600">
                    {ps.page}
                  </span>
                  <p className="text-stone-700 text-sm leading-relaxed">{ps.summary}</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {/* People */}
            {index?.people && index.people.length > 0 && (
              <div className="bg-white border border-stone-200 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-stone-900 mb-4 flex items-center gap-2">
                  <Users className="w-5 h-5 text-amber-600" />
                  People
                </h2>
                <div className="flex flex-wrap gap-2">
                  {index.people.slice(0, 20).map((entry) => (
                    <span
                      key={entry.term}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-stone-100 text-stone-700 rounded-full text-sm"
                    >
                      {entry.term}
                      <span className="text-stone-400 text-xs">({entry.pages.length})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Places */}
            {index?.places && index.places.length > 0 && (
              <div className="bg-white border border-stone-200 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-stone-900 mb-4 flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-amber-600" />
                  Places
                </h2>
                <div className="flex flex-wrap gap-2">
                  {index.places.slice(0, 20).map((entry) => (
                    <span
                      key={entry.term}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-stone-100 text-stone-700 rounded-full text-sm"
                    >
                      {entry.term}
                      <span className="text-stone-400 text-xs">({entry.pages.length})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Concepts */}
            {index?.concepts && index.concepts.length > 0 && (
              <div className="bg-white border border-stone-200 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-stone-900 mb-4 flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-amber-600" />
                  Concepts
                </h2>
                <div className="flex flex-wrap gap-2">
                  {index.concepts.slice(0, 30).map((entry) => (
                    <span
                      key={entry.term}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-stone-100 text-stone-700 rounded-full text-sm"
                    >
                      {entry.term}
                      <span className="text-stone-400 text-xs">({entry.pages.length})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Vocabulary */}
            {index?.vocabulary && index.vocabulary.length > 0 && (
              <div className="bg-white border border-stone-200 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-stone-900 mb-4 flex items-center gap-2">
                  <BookMarked className="w-5 h-5 text-amber-600" />
                  Original Language Terms
                </h2>
                <div className="flex flex-wrap gap-2">
                  {index.vocabulary.slice(0, 30).map((entry) => (
                    <span
                      key={entry.term}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-amber-50 text-amber-800 rounded-full text-sm italic"
                    >
                      {entry.term}
                      <span className="text-amber-600 text-xs">({entry.pages.length})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      {index?.generatedAt && (
        <footer className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-center text-sm text-stone-400">
          Summary generated {new Date(index.generatedAt).toLocaleDateString()}
        </footer>
      )}
    </div>
  );
}
