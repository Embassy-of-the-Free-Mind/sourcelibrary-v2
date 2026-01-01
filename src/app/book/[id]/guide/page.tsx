'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, Loader2, Sparkles, Quote, ChevronDown, ChevronUp, ExternalLink, Highlighter, StickyNote, MessageSquare, List, Info, X } from 'lucide-react';
import { Book, Page } from '@/lib/types';
import HighlightSelection from '@/components/HighlightSelection';
import HighlightsPanel from '@/components/HighlightsPanel';
import AnnotationPanel from '@/components/AnnotationPanel';
import { QuoteShare } from '@/components/ShareButton';
import NotesRenderer from '@/components/NotesRenderer';
import SectionsNav from '@/components/SectionsNav';
import PageMetadataPanel from '@/components/PageMetadataPanel';

interface SectionSummary {
  title: string;
  startPage: number;
  endPage: number;
  summary: string;
  quotes?: Array<{ text: string; page: number; significance?: string }>;
  concepts?: string[];
}

interface GuidePageProps {
  params: Promise<{ id: string }>;
}

interface BookSummary {
  overview: string;
  quotes: Array<{ text: string; page: number }>;
  themes: string[];
  generated_at?: Date;
}

export default function GuidePage({ params }: GuidePageProps) {
  const [bookId, setBookId] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [summary, setSummary] = useState<BookSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFullText, setShowFullText] = useState(false);
  const [showHighlights, setShowHighlights] = useState(false);
  const [highlightCount, setHighlightCount] = useState(0);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [annotationCount, setAnnotationCount] = useState(0);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const [currentPageNumber, setCurrentPageNumber] = useState(1);
  const [showNotes, setShowNotes] = useState(false);
  const [showBookInfo, setShowBookInfo] = useState(false);
  const [sections, setSections] = useState<SectionSummary[]>([]);
  const [showSections, setShowSections] = useState(true);
  const [metadataPage, setMetadataPage] = useState<Page | null>(null);
  const textRef = useRef<HTMLDivElement>(null);

  // Resolve params
  useEffect(() => {
    params.then(p => setBookId(p.id));
  }, [params]);

  // Fetch highlight count
  const fetchHighlightCount = async () => {
    if (!bookId) return;
    try {
      const res = await fetch(`/api/highlights?book_id=${bookId}`);
      if (res.ok) {
        const data = await res.json();
        const highlights = data.highlights || data;
        setHighlightCount(highlights.length);
      }
    } catch (e) {
      console.error('Failed to fetch highlights:', e);
    }
  };

  // Fetch annotation count for the book
  const fetchAnnotationCount = async () => {
    if (!bookId) return;
    try {
      const res = await fetch(`/api/annotations?book_id=${bookId}&limit=1`);
      if (res.ok) {
        const data = await res.json();
        setAnnotationCount(data.total || 0);
      }
    } catch (e) {
      console.error('Failed to fetch annotations:', e);
    }
  };

  useEffect(() => {
    if (bookId) {
      fetchHighlightCount();
      fetchAnnotationCount();
    }
  }, [bookId]);

  // Fetch book data
  useEffect(() => {
    if (!bookId) return;

    async function fetchData() {
      try {
        setLoading(true);

        // Fetch book with pages (include full text for reader)
        const bookRes = await fetch(`/api/books/${bookId}?full=true`);
        if (!bookRes.ok) throw new Error('Book not found');
        const bookData = await bookRes.json();
        setBook(bookData);
        setPages(bookData.pages || []);

        // Check for summary - prefer reading_summary, fall back to index.bookSummary
        if (bookData.reading_summary) {
          setSummary(bookData.reading_summary);
        } else if (bookData.index?.bookSummary) {
          // Convert index summary to reading summary format
          setSummary({
            overview: bookData.index.bookSummary.detailed || bookData.index.bookSummary.abstract || bookData.index.bookSummary.brief || '',
            quotes: [],
            themes: [],
            generated_at: bookData.index.generatedAt,
          });
        }

        // Load section summaries from index
        if (bookData.index?.sectionSummaries && Array.isArray(bookData.index.sectionSummaries)) {
          setSections(bookData.index.sectionSummaries);
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

  // Generate book summary using the index API
  const generateSummary = async () => {
    setGeneratingSummary(true);

    try {
      // First clear cached index to force regeneration
      await fetch(`/api/books/${bookId}/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      // Then fetch fresh index
      const response = await fetch(`/api/books/${bookId}/index`);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate');
      }

      const indexData = await response.json();

      // Convert to BookSummary format
      if (indexData.bookSummary) {
        setSummary({
          overview: indexData.bookSummary.detailed || indexData.bookSummary.abstract || indexData.bookSummary.brief || '',
          quotes: [],
          themes: [],
          generated_at: indexData.generatedAt,
        });
      }
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
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowBookInfo(true)}
                className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900 transition-colors"
                title="Book metadata"
              >
                <Info className="w-4 h-4" />
                <span className="hidden sm:inline">Info</span>
              </button>
              <button
                onClick={() => setShowNotes(!showNotes)}
                className={`inline-flex items-center gap-1.5 text-sm transition-colors ${
                  showNotes
                    ? 'text-teal-600 hover:text-teal-700'
                    : 'text-stone-400 hover:text-stone-600'
                }`}
                title={showNotes ? 'Hide margin notes & annotations' : 'Show margin notes & annotations'}
              >
                <StickyNote className="w-4 h-4" />
                <span className="hidden sm:inline">{showNotes ? 'Notes On' : 'Notes'}</span>
              </button>
              <button
                onClick={() => setShowHighlights(true)}
                className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-amber-600 transition-colors"
              >
                <Highlighter className="w-4 h-4" />
                <span className="hidden sm:inline">Highlights</span>
                {highlightCount > 0 && (
                  <span className="bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">
                    {highlightCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => {
                  // Use first translated page as default
                  const firstPage = translatedPages[0];
                  if (firstPage) {
                    setCurrentPageId(firstPage.id);
                    setCurrentPageNumber(firstPage.page_number);
                  }
                  setShowAnnotations(true);
                }}
                className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-blue-600 transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
                <span className="hidden sm:inline">Annotations</span>
                {annotationCount > 0 && (
                  <span className="bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded-full">
                    {annotationCount}
                  </span>
                )}
              </button>
              <span className="text-sm text-stone-500">
                {translatedPages.length}/{pages.length} pages
              </span>
            </div>
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
          {book.published && (
            <p className="text-stone-400 text-sm mt-1">{book.published}</p>
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
                          <div className="flex items-center gap-2 mt-1">
                            <Link
                              href={`/book/${bookId}/page/${pages.find(p => p.page_number === quote.page)?.id || ''}`}
                              className="text-xs text-amber-600 hover:text-amber-700 inline-flex items-center gap-1"
                            >
                              Page {quote.page}
                              <ExternalLink className="w-3 h-3" />
                            </Link>
                            <QuoteShare
                              text={quote.text}
                              title={book?.display_title || book?.title || ''}
                              author={book?.author || ''}
                              year={book?.published}
                              page={quote.page}
                              bookId={bookId!}
                              doi={book?.doi}
                            />
                          </div>
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

        {/* Sections Navigation */}
        {sections.length > 0 && (
          <section className="mb-8">
            <button
              onClick={() => setShowSections(!showSections)}
              className="w-full flex items-center justify-between p-4 bg-white rounded-xl border border-stone-200 hover:bg-stone-50 transition-colors mb-4"
            >
              <span className="font-semibold text-stone-900 flex items-center gap-2">
                <List className="w-4 h-4 text-amber-600" />
                Table of Contents ({sections.length} sections)
              </span>
              {showSections ? (
                <ChevronUp className="w-5 h-5 text-stone-500" />
              ) : (
                <ChevronDown className="w-5 h-5 text-stone-500" />
              )}
            </button>
            {showSections && (
              <SectionsNav
                bookId={bookId!}
                sections={sections}
                pages={pages.map(p => ({ id: p.id, page_number: p.page_number }))}
              />
            )}
          </section>
        )}

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
                <p className="text-xs text-stone-400 mb-4 text-center">
                  Select text to save highlights
                </p>
                <div className="prose prose-stone max-w-none font-serif text-lg leading-relaxed">
                  {translatedPages.map((page) => (
                    <HighlightSelection
                      key={page.id}
                      bookId={bookId!}
                      pageId={page.id}
                      pageNumber={page.page_number}
                      bookTitle={book?.display_title || book?.title || ''}
                      bookAuthor={book?.author}
                      bookYear={book?.published}
                      doi={book?.doi}
                      onHighlightSaved={fetchHighlightCount}
                      onAnnotationSaved={fetchAnnotationCount}
                    >
                      <div className="mb-8">
                        <div className="flex items-center gap-4 my-8 text-stone-400">
                          <div className="flex-1 h-px bg-stone-200" />
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/book/${bookId}/page/${page.id}`}
                              className="text-xs hover:text-amber-600 transition-colors"
                            >
                              Page {page.page_number}
                            </Link>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setMetadataPage(page);
                              }}
                              className="p-1 hover:bg-stone-100 rounded transition-colors text-stone-400 hover:text-stone-600"
                              title="View page metadata"
                            >
                              <Info className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="flex-1 h-px bg-stone-200" />
                        </div>

                        <NotesRenderer
                          key={`translation-${page.id}-${showNotes}`}
                          text={page.translation?.data || ''}
                          showNotes={showNotes}
                          showMetadata={false}
                        />
                      </div>
                    </HighlightSelection>
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

      {/* Highlights Panel */}
      <HighlightsPanel
        bookId={bookId || undefined}
        isOpen={showHighlights}
        onClose={() => setShowHighlights(false)}
        onHighlightDeleted={fetchHighlightCount}
      />

      {/* Annotations Panel */}
      {currentPageId && (
        <AnnotationPanel
          bookId={bookId!}
          pageId={currentPageId}
          pageNumber={currentPageNumber}
          bookTitle={book?.display_title || book?.title}
          bookAuthor={book?.author}
          isOpen={showAnnotations}
          onClose={() => setShowAnnotations(false)}
          onAnnotationChange={fetchAnnotationCount}
        />
      )}

      {/* Book Info Modal */}
      {showBookInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between">
              <h2 className="font-semibold text-stone-900">Book Information</h2>
              <button
                onClick={() => setShowBookInfo(false)}
                className="p-1 text-stone-400 hover:text-stone-600 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {/* Title */}
              <div>
                <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Title</h3>
                <p className="text-stone-900">{book.display_title || book.title}</p>
                {book.display_title && book.title !== book.display_title && (
                  <p className="text-sm text-stone-500 mt-0.5 italic">{book.title}</p>
                )}
              </div>

              {/* Author */}
              <div>
                <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Author</h3>
                <p className="text-stone-900">{book.author}</p>
              </div>

              {/* Publication */}
              <div className="grid grid-cols-2 gap-4">
                {book.published && (
                  <div>
                    <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Published</h3>
                    <p className="text-stone-900">{book.published}</p>
                  </div>
                )}
                {book.place_published && (
                  <div>
                    <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Place</h3>
                    <p className="text-stone-900">{book.place_published}</p>
                  </div>
                )}
              </div>

              {/* Publisher */}
              {book.publisher && (
                <div>
                  <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Publisher</h3>
                  <p className="text-stone-900">{book.publisher}</p>
                </div>
              )}

              {/* Language & Format */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Language</h3>
                  <p className="text-stone-900">{book.language}</p>
                </div>
                {book.format && (
                  <div>
                    <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Format</h3>
                    <p className="text-stone-900">{book.format}</p>
                  </div>
                )}
              </div>

              {/* Categories */}
              {book.categories && book.categories.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Categories</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {book.categories.map((cat, i) => (
                      <span key={i} className="px-2 py-0.5 bg-amber-100 text-amber-800 text-sm rounded">
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Identifiers */}
              {(book.doi || book.ustc_id || book.ia_identifier) && (
                <div>
                  <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Identifiers</h3>
                  <div className="space-y-1 text-sm">
                    {book.doi && (
                      <p>
                        <span className="text-stone-500">DOI:</span>{' '}
                        <a
                          href={`https://doi.org/${book.doi}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-amber-600 hover:text-amber-700"
                        >
                          {book.doi}
                        </a>
                      </p>
                    )}
                    {book.ustc_id && (
                      <p>
                        <span className="text-stone-500">USTC:</span>{' '}
                        <a
                          href={`https://www.ustc.ac.uk/editions/${book.ustc_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-amber-600 hover:text-amber-700"
                        >
                          {book.ustc_id}
                        </a>
                      </p>
                    )}
                    {book.ia_identifier && (
                      <p>
                        <span className="text-stone-500">Internet Archive:</span>{' '}
                        <a
                          href={`https://archive.org/details/${book.ia_identifier}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-amber-600 hover:text-amber-700"
                        >
                          {book.ia_identifier}
                        </a>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* License */}
              {book.license && (
                <div>
                  <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">License</h3>
                  <p className="text-stone-900">{book.license}</p>
                </div>
              )}

              {/* Image Source */}
              {book.image_source && (
                <div>
                  <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Image Source</h3>
                  <p className="text-stone-900">
                    {book.image_source.provider_name || book.image_source.provider}
                    {book.image_source.source_url && (
                      <>
                        {' '}
                        <a
                          href={book.image_source.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-amber-600 hover:text-amber-700"
                        >
                          <ExternalLink className="w-3 h-3 inline" />
                        </a>
                      </>
                    )}
                  </p>
                  {book.image_source.license && (
                    <p className="text-sm text-stone-500">{book.image_source.license}</p>
                  )}
                </div>
              )}

              {/* Translation Progress */}
              <div className="pt-2 border-t border-stone-200">
                <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">Translation Progress</h3>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-stone-200 rounded-full h-2">
                    <div
                      className="bg-amber-500 h-2 rounded-full transition-all"
                      style={{ width: `${translationProgress}%` }}
                    />
                  </div>
                  <span className="text-sm text-stone-600">
                    {translatedPages.length}/{pages.length} pages ({translationProgress}%)
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Page Metadata Panel */}
      {metadataPage && (
        <PageMetadataPanel
          page={metadataPage}
          onClose={() => setMetadataPage(null)}
        />
      )}
    </div>
  );
}
