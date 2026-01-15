'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Loader2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import Image from 'next/image';
import { Book, Page } from '@/lib/types';
import { QuoteShare } from '@/components/ui/ShareButton';
import SectionsNav from '@/components/layout/SectionsNav';
import { BookLoader } from '@/components/ui/BookLoader';
import LikeButton from '@/components/ui/LikeButton';
import { books, gallery } from '@/lib/api-client';

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

interface GalleryItem {
  pageId: string;
  bookId: string;
  pageNumber: number;
  detectionIndex: number;
  imageUrl: string;
  description: string;
  type?: string;
  bbox?: { x: number; y: number; width: number; height: number };
}

export default function GuidePage({ params }: GuidePageProps) {
  const [bookId, setBookId] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [summary, setSummary] = useState<BookSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<SectionSummary[]>([]);
  const [showSections, setShowSections] = useState(true);
  const [illustrations, setIllustrations] = useState<GalleryItem[]>([]);
  const [showIllustrations, setShowIllustrations] = useState(true);

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

        // Fetch book with pages (include full text for reader)
        const bookData = await books.get(bookId!, { full: true }) as import('@/lib/api-client').BookWithPages;
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

        // Fetch high-quality illustrations for this book (minQuality=0.75 filters out decorative elements)
        try {
          const galleryData = await gallery.list({
            bookId: bookId!,
            limit: 50,
            minQuality: 0.75
          });
          setIllustrations(galleryData.items || []);
        } catch (e) {
          console.error('Failed to fetch illustrations:', e);
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
      await books.index.generate(bookId!);

      // Then fetch fresh index
      const indexData = await books.index.get(bookId!);

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
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-cream)' }}>
        <BookLoader />
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-cream)' }}>
        <div className="text-center">
          <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Book Not Found</h1>
          <Link href="/" style={{ color: 'var(--accent-rust)' }} className="hover:opacity-80">
            Back to Library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      {/* Header */}
      <header className="sticky top-0 z-10 px-4 py-3" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-2 hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-primary)' }}
            >
              {/* Source Library Logo - Concentric Circles */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                className="w-6 h-6"
                style={{ color: 'var(--accent-rust)' }}
              >
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1" />
                <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1" />
                <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
              <span
                className="hidden sm:inline text-base font-medium"
                style={{ fontFamily: 'Cormorant Garamond, Georgia, serif' }}
              >
                Source Library
              </span>
            </Link>
            <div className="flex items-center gap-3">
              {bookId && (
                <div className="p-1.5 rounded-lg hover:bg-stone-100 transition-all">
                  <LikeButton
                    targetType="book"
                    targetId={bookId}
                    size="sm"
                    showCount={true}
                  />
                </div>
              )}
              <span
                className="text-xs uppercase tracking-wider px-2 py-1 rounded"
                style={{ background: 'var(--bg-warm)', color: 'var(--accent-rust)' }}
              >
                Reading Guide
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Book Title Section with Poster */}
      <div className="py-10 sm:py-14 border-b" style={{ borderColor: 'var(--border-light)' }}>
        <div className="max-w-3xl mx-auto px-4">
          <div className="flex flex-col sm:flex-row gap-8 items-start">
            {/* Poster Image */}
            {book.thumbnail && (
              <Link
                href={`/book/${bookId}`}
                className="flex-shrink-0 mx-auto sm:mx-0 hover:opacity-90 transition-opacity"
              >
                <div
                  className="relative w-32 sm:w-40 aspect-[3/4] rounded-lg overflow-hidden shadow-lg"
                  style={{ border: '1px solid var(--border-light)' }}
                >
                  <Image
                    src={book.thumbnail}
                    alt={book.display_title || book.title}
                    fill
                    sizes="160px"
                    className="object-cover"
                  />
                </div>
              </Link>
            )}

            {/* Title and Meta */}
            <div className={`flex-1 ${book.thumbnail ? 'text-left' : 'text-center'}`}>
              <h1
                className="text-3xl sm:text-4xl leading-tight"
                style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}
              >
                {book.display_title || book.title}
              </h1>

              {/* Author */}
              <p className="mt-3 text-lg" style={{ color: 'var(--text-secondary)' }}>
                {book.author}
              </p>

              {/* Publication Info */}
              {(book.published || book.place_published) && (
                <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                  {[book.place_published, book.published].filter(Boolean).join(', ')}
                </p>
              )}

              {/* Brief Abstract */}
              {(book.index?.bookSummary?.brief || book.reading_summary?.overview) && (
                <p
                  className="mt-5 text-lg leading-relaxed"
                  style={{ fontFamily: 'Newsreader, Georgia, serif', color: 'var(--text-secondary)' }}
                >
                  {book.index?.bookSummary?.brief ||
                   (book.reading_summary?.overview && book.reading_summary.overview.split('\n\n')[0]?.slice(0, 300) + (book.reading_summary.overview.length > 300 ? '...' : ''))}
                </p>
              )}

              {/* Link to Book */}
              <div className="mt-5">
                <Link
                  href={`/book/${bookId}`}
                  className="inline-flex items-center gap-2 text-sm hover:opacity-70"
                  style={{ color: 'var(--accent-rust)' }}
                >
                  View Book
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Summary Section */}
        <section className="mb-8">
          {summary ? (
            <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
              <div className="p-6 sm:p-8">
                <h2
                  className="text-2xl mb-5"
                  style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}
                >
                  Overview
                </h2>
                <div className="prose max-w-none" style={{ fontFamily: 'Newsreader, Georgia, serif' }}>
                  {summary.overview.split('\n\n').map((p, i) => (
                    <p key={i} className="leading-relaxed mb-4 text-base" style={{ color: 'var(--text-secondary)' }}>{p}</p>
                  ))}
                </div>

                {/* Key Quotes */}
                {summary.quotes && summary.quotes.length > 0 && (
                  <div className="mt-8 pt-8" style={{ borderTop: '1px solid var(--border-light)' }}>
                    <h3
                      className="text-xl mb-5"
                      style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}
                    >
                      Notable Passages
                    </h3>
                    <div className="space-y-5">
                      {summary.quotes.map((quote, i) => (
                        <blockquote
                          key={i}
                          className="relative pl-5"
                          style={{ borderLeft: '2px solid var(--accent-gold)' }}
                        >
                          <p className="italic leading-relaxed" style={{ fontFamily: 'Newsreader, Georgia, serif', color: 'var(--text-secondary)' }}>
                            &ldquo;{quote.text}&rdquo;
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            <Link
                              href={`/book/${bookId}/page/${pages.find(p => p.page_number === quote.page)?.id || ''}`}
                              className="text-xs hover:opacity-70 inline-flex items-center gap-1"
                              style={{ color: 'var(--accent-rust)' }}
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
                  <div className="mt-8 pt-8" style={{ borderTop: '1px solid var(--border-light)' }}>
                    <h3
                      className="text-xl mb-4"
                      style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}
                    >
                      Key Themes
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {summary.themes.map((theme, i) => (
                        <span
                          key={i}
                          className="px-3 py-1.5 text-sm rounded-full"
                          style={{ background: 'var(--bg-warm)', color: 'var(--text-secondary)' }}
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
            <div className="rounded-xl p-8 sm:p-10 text-center" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
              <h2
                className="text-2xl mb-3"
                style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}
              >
                Generate Reading Guide
              </h2>
              <p className="mb-6 max-w-md mx-auto" style={{ color: 'var(--text-secondary)' }}>
                Create an overview of this text with key quotes and themes.
              </p>
              <button
                onClick={generateSummary}
                disabled={generatingSummary}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-lg disabled:opacity-50 transition-colors hover:opacity-90"
                style={{ background: 'var(--accent-rust)' }}
              >
                {generatingSummary ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate Overview'
                )}
              </button>
            </div>
          ) : (
            <div className="rounded-xl p-6 text-center" style={{ background: 'var(--bg-warm)' }}>
              <p style={{ color: 'var(--text-secondary)' }}>
                Translate pages to generate a reading guide.
              </p>
              <div className="mt-3">
                <div className="w-full rounded-full h-2 max-w-xs mx-auto" style={{ background: 'var(--border-light)' }}>
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{ width: `${translationProgress}%`, background: 'var(--accent-rust)' }}
                  />
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{translationProgress}% translated</p>
              </div>
            </div>
          )}
        </section>

        {/* Sections Navigation */}
        {sections.length > 0 && (
          <section className="mb-8">
            <button
              onClick={() => setShowSections(!showSections)}
              className="w-full flex items-center justify-between p-5 rounded-xl transition-colors mb-4 hover:opacity-90"
              style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}
            >
              <span
                className="text-xl flex items-center gap-3"
                style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}
              >
                Table of Contents
                <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>
                  ({sections.length} sections)
                </span>
              </span>
              {showSections ? (
                <ChevronUp className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              ) : (
                <ChevronDown className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              )}
            </button>
            {showSections && (
              <SectionsNav
                bookId={bookId!}
                sections={sections}
                pages={pages.map(p => ({ id: p.id, page_number: p.page_number }))}
                illustrations={illustrations}
              />
            )}
          </section>
        )}

        {/* Illustrations Section */}
        {illustrations.length > 0 && (
          <section className="mb-8">
            <button
              onClick={() => setShowIllustrations(!showIllustrations)}
              className="w-full flex items-center justify-between p-5 rounded-xl transition-colors mb-4 hover:opacity-90"
              style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}
            >
              <span
                className="text-xl flex items-center gap-3"
                style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}
              >
                Illustrations
                <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>
                  ({illustrations.length} images)
                </span>
              </span>
              {showIllustrations ? (
                <ChevronUp className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              ) : (
                <ChevronDown className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              )}
            </button>
            {showIllustrations && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {illustrations.map((item) => {
                  const imageId = `${item.pageId}:${item.detectionIndex}`;
                  // Build cropped URL if bbox exists
                  const cropUrl = item.bbox
                    ? `/api/crop-image?url=${encodeURIComponent(item.imageUrl)}&x=${item.bbox.x}&y=${item.bbox.y}&w=${item.bbox.width}&h=${item.bbox.height}`
                    : item.imageUrl;

                  return (
                    <Link
                      key={imageId}
                      href={`/gallery/image/${imageId}`}
                      className="group relative aspect-square rounded-lg overflow-hidden transition-all hover:shadow-md"
                      style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
                    >
                      <Image
                        src={cropUrl}
                        alt={item.description || 'Illustration'}
                        fill
                        sizes="(max-width: 640px) 50vw, 33vw"
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      {/* Overlay with description */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="absolute bottom-0 left-0 right-0 p-2">
                          <p className="text-white text-xs line-clamp-2">
                            {item.description || `Page ${item.pageNumber}`}
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
            {illustrations.length > 0 && (
              <div className="mt-4 text-center">
                <Link
                  href={`/gallery?bookId=${bookId}`}
                  className="inline-flex items-center gap-2 text-sm hover:opacity-70"
                  style={{ color: 'var(--accent-rust)' }}
                >
                  View all in Gallery
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              </div>
            )}
          </section>
        )}

      </main>
    </div>
  );
}
