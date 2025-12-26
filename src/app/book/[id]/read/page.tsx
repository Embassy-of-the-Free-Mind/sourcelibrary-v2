'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, Loader2, Sparkles, Quote, ChevronDown, ChevronUp, ExternalLink, Highlighter, Info, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import { Book, Page } from '@/lib/types';
import HighlightSelection from '@/components/HighlightSelection';
import HighlightsPanel from '@/components/HighlightsPanel';

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
  const [showHighlights, setShowHighlights] = useState(false);
  const [highlightCount, setHighlightCount] = useState(0);
  const [metadataPageId, setMetadataPageId] = useState<string | null>(null);
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
        setHighlightCount(data.length);
      }
    } catch (e) {
      console.error('Failed to fetch highlights:', e);
    }
  };

  useEffect(() => {
    if (bookId) {
      fetchHighlightCount();
    }
  }, [bookId]);

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

  // Preprocess text to handle special syntax before markdown parsing
  const preprocessText = (text: string): string => {
    let result = text;

    // Handle centered headings: ->## text<- → <h2 class="text-center">text</h2>
    // Must be done before generic centering to preserve heading semantics
    result = result.replace(/->\s*(#{1,6})\s*([\s\S]*?)\s*<-/g, (match, hashes, content) => {
      const level = hashes.length;
      const cleaned = content.trim().replace(/\s*\n\s*/g, ' ');
      return `<h${level} class="text-center">${cleaned}</h${level}>`;
    });

    // Handle regular centered text: ->text<-
    result = result.replace(/->([\s\S]*?)<-/g, (match, content) => {
      const cleaned = content.trim().replace(/\s*\n\s*/g, '<br>');
      return `<div class="text-center">${cleaned}</div>`;
    });

    // Convert margin notes to visible styled spans
    result = result.replace(/\[\[margin:\s*([\s\S]*?)\]\]/gi, (match, content) => {
      return `<span class="margin-note">${content.trim()}</span>`;
    });

    // Convert editorial notes to visible styled spans
    result = result.replace(/\[\[notes?:\s*([\s\S]*?)\]\]/gi, (match, content) => {
      return `<span class="editorial-note">${content.trim()}</span>`;
    });

    // Convert image descriptions to visible blocks (multiline)
    result = result.replace(/\[\[image:\s*([\s\S]*?)\]\]/gi, (match, content) => {
      return `<div class="image-description">${content.trim()}</div>`;
    });

    // Remove other [[tags]] that shouldn't be shown (meta, language, page number, etc.)
    result = result.replace(/\[\[(meta|language|page number|header|signature|vocabulary|summary|keywords|warning):[^\]]*\]\]/gi, '');

    return result.trim();
  };

  // Extract hidden metadata from text for the metadata panel
  const extractHiddenMetadata = (text: string): Record<string, string> => {
    const metadata: Record<string, string> = {};
    const tagPatterns = [
      'meta', 'language', 'page number', 'header', 'signature',
      'vocabulary', 'summary', 'keywords', 'warning'
    ];

    for (const tag of tagPatterns) {
      const regex = new RegExp(`\\[\\[${tag}:\\s*([\\s\\S]*?)\\]\\]`, 'gi');
      const matches = text.matchAll(regex);
      const values: string[] = [];
      for (const match of matches) {
        values.push(match[1].trim());
      }
      if (values.length > 0) {
        metadata[tag] = values.join('; ');
      }
    }

    return metadata;
  };

  // Format date for display
  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return 'Unknown';
    return new Date(dateStr).toLocaleString();
  };

  // Render translation text with full markdown support
  const renderTranslation = (text: string) => {
    const processed = preprocessText(text);

    return (
      <div style={{ fontVariantEmoji: 'text' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeRaw]}
        components={{
          p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          h1: ({ children, className }) => (
            <h1 className={`text-2xl font-serif font-bold mt-6 mb-3 ${className || ''}`}>{children}</h1>
          ),
          h2: ({ children, className }) => (
            <h2 className={`text-xl font-serif font-bold mt-5 mb-2 ${className || ''}`}>{children}</h2>
          ),
          h3: ({ children, className }) => (
            <h3 className={`text-lg font-serif font-semibold mt-4 mb-2 ${className || ''}`}>{children}</h3>
          ),
          h4: ({ children, className }) => (
            <h4 className={`text-base font-serif font-semibold mt-3 mb-1 ${className || ''}`}>{children}</h4>
          ),
          ul: ({ children }) => <ul className="list-disc ml-5 my-3 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal ml-5 my-3 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-3 border-amber-300 pl-4 my-4 italic text-stone-600 bg-amber-50/30 py-2 pr-2 rounded-r">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-6 border-stone-200" />,
          a: ({ href, children }) => (
            <a href={href} className="text-amber-700 underline hover:text-amber-800" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-4">
              <table className="min-w-full border-collapse border border-stone-200">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-stone-100">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-b border-stone-200">{children}</tr>,
          th: ({ children }) => (
            <th className="px-3 py-2 text-left text-sm font-semibold text-stone-700 border border-stone-200">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-sm text-stone-600 border border-stone-200">{children}</td>
          ),
          // Custom styling for margin notes, editorial notes, and image descriptions
          span: ({ className, children }) => {
            if (className === 'margin-note') {
              return (
                <span className="inline-block text-sm text-teal-700 bg-teal-50 border-l-2 border-teal-400 px-2 py-0.5 ml-1 rounded-r">
                  {children}
                </span>
              );
            }
            if (className === 'editorial-note') {
              return (
                <span className="inline-block text-sm text-amber-700 bg-amber-50 border-l-2 border-amber-400 px-2 py-0.5 ml-1 rounded-r">
                  {children}
                </span>
              );
            }
            return <span className={className}>{children}</span>;
          },
          div: ({ className, children }) => {
            if (className === 'text-center') {
              return <div className="text-center">{children}</div>;
            }
            if (className === 'image-description') {
              return (
                <div className="my-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-stone-600 italic">
                  <span className="text-amber-700 font-medium not-italic">[Image: </span>
                  {children}
                  <span className="text-amber-700 font-medium not-italic">]</span>
                </div>
              );
            }
            return <div className={className}>{children}</div>;
          },
        }}
      >
        {processed}
      </ReactMarkdown>
      </div>
    );
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
            <div className="flex items-center gap-4">
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
                <p className="text-xs text-stone-400 mb-4 text-center">
                  Select text to save highlights
                </p>
                <div className="prose prose-stone max-w-none font-serif text-lg leading-relaxed">
                  {translatedPages.map((page, index) => (
                    <HighlightSelection
                      key={page.id}
                      bookId={bookId!}
                      pageId={page.id}
                      pageNumber={page.page_number}
                      bookTitle={book?.display_title || book?.title || ''}
                      onHighlightSaved={fetchHighlightCount}
                    >
                      <div className="mb-8">
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
    </div>
  );
}
