import { Suspense } from 'react';
import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Book, Page, TranslationEdition } from '@/lib/types';
import { Calendar, Globe, FileText, BookText, Workflow, MessageCircle, BookMarked, User, MapPin, Lightbulb, Images } from 'lucide-react';
import SearchPanel from '@/components/search/SearchPanel';
import BookPagesSection from '@/components/book/BookPagesSection';
import BookHistory from '@/components/book/BookHistory';
import BookChat from '@/components/book/BookChat';
import BookAnalytics from '@/components/book/BookAnalytics';
import CoverImagePicker from '@/components/book/CoverImagePicker';
import DownloadButton from '@/components/ui/DownloadButton';
import BibliographicInfo from '@/components/book/BibliographicInfo';
import PublishEditionButton from '@/components/editions/PublishEditionButton';
import EditionsPanel from '@/components/editions/EditionsPanel';
import SchemaOrgMetadata from '@/components/seo/SchemaOrgMetadata';
import CategoryPicker from '@/components/ui/CategoryPicker';
import { BookShare } from '@/components/ui/ShareButton';
import LikeButton from '@/components/ui/LikeButton';

interface PageProps {
  params: Promise<{ id: string }>;
}

// Lightweight book fetch for metadata (no pages)
async function getBookForMetadata(id: string): Promise<Book | null> {
  const db = await getDb();

  let book = await db.collection('books').findOne({ id });

  if (!book) {
    try {
      const { ObjectId } = await import('mongodb');
      if (ObjectId.isValid(id)) {
        book = await db.collection('books').findOne({ _id: new ObjectId(id) });
      }
    } catch {
      // Invalid ObjectId format
    }
  }

  return book as unknown as Book | null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const book = await getBookForMetadata(id);

  if (!book) {
    return {
      title: 'Book Not Found - Source Library',
    };
  }

  const title = book.display_title || book.title;
  const description = `Read the English translation of "${title}" by ${book.author}${book.published ? ` (${book.published})` : ''}. Digitized and translated with AI from the original ${book.language || 'manuscript'}.`;
  const bookUrl = `/book/${book.id}`;

  // Get publication date for OG tags
  const currentEdition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'published');
  const publishedDate = currentEdition?.published_at
    ? new Date(currentEdition.published_at).toISOString()
    : book.created_at
    ? new Date(book.created_at).toISOString()
    : undefined;
  const modifiedDate = book.updated_at
    ? new Date(book.updated_at).toISOString()
    : undefined;

  return {
    title: `${title} - Source Library`,
    description,
    alternates: {
      canonical: bookUrl,
    },
    openGraph: {
      title,
      description,
      type: 'article',
      siteName: 'Source Library',
      locale: 'en_US',
      url: bookUrl,
      ...(book.thumbnail && {
        images: [
          {
            url: book.thumbnail,
            width: 200,
            height: 300,
            alt: `${title} - cover page`,
          },
        ],
      }),
      ...(publishedDate && { publishedTime: publishedDate }),
      ...(modifiedDate && { modifiedTime: modifiedDate }),
      authors: [book.author],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(book.thumbnail && { images: [book.thumbnail] }),
    },
  };
}

async function getBook(id: string): Promise<{ book: Book; pages: Page[] } | null> {
  const db = await getDb();

  // Try to find by custom id field first, then by _id
  let book = await db.collection('books').findOne({ id });

  // If not found, try _id (for books imported without custom id)
  if (!book) {
    try {
      const { ObjectId } = await import('mongodb');
      if (ObjectId.isValid(id)) {
        book = await db.collection('books').findOne({ _id: new ObjectId(id) });
      }
    } catch {
      // Invalid ObjectId format, book not found
    }
  }

  if (!book) return null;

  // Use the book's id field, or fall back to _id string
  const bookId = book.id || book._id?.toString();

  // Exclude large text fields for listing - only need metadata for thumbnails
  const pages = await db.collection('pages')
    .find({ book_id: bookId })
    .project({ 'ocr.data': 0, 'translation.data': 0, 'summary.data': 0 })
    .sort({ page_number: 1 })
    .toArray();

  // Serialize MongoDB objects to plain JavaScript objects
  const serializedBook = JSON.parse(JSON.stringify(book));
  const serializedPages = JSON.parse(JSON.stringify(pages));

  return { book: serializedBook as Book, pages: serializedPages as Page[] };
}

// Skeleton for book info while loading
function BookInfoSkeleton() {
  return (
    <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
          <div className="flex-shrink-0 flex justify-center sm:justify-start">
            <div className="w-32 sm:w-48 aspect-[3/4] rounded-lg overflow-hidden bg-stone-700">
              <div className="w-full h-full bg-gradient-to-r from-stone-700 via-stone-600 to-stone-700 bg-[length:200%_100%] animate-shimmer" />
            </div>
          </div>
          <div className="flex-1 text-center sm:text-left">
            <div className="h-8 w-64 bg-stone-700 rounded mb-2" />
            <div className="h-6 w-40 bg-stone-700 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Skeleton for pages grid
function PagesGridSkeleton() {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3 sm:gap-4">
      {Array.from({ length: 20 }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[3/4] bg-white border border-stone-200 rounded-lg overflow-hidden">
            <div className="w-full h-full bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer" />
          </div>
          <div className="h-3 w-6 bg-stone-100 rounded mx-auto mt-1" />
        </div>
      ))}
    </div>
  );
}

// Book info component (streams in)
async function BookInfo({ id }: { id: string }) {
  const data = await getBook(id);

  if (!data) {
    notFound();
  }

  const { book, pages } = data;

  // Redirect to canonical URL if accessed via ObjectId instead of custom id
  // This prevents duplicate content issues with Google indexing
  if (book.id && id !== book.id) {
    redirect(`/book/${book.id}`);
  }
  // Note: projection excludes .data fields, so check for object existence instead
  const ocrCount = pages.filter(p => p.ocr).length;
  const translatedCount = pages.filter(p => p.translation).length;
  const imageCount = pages.reduce((sum, p) => sum + ((p.detected_images as any[])?.length || 0), 0);
  const currentEdition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'published');

  // Progression: OCR → Translation → Summary → Ask AI / Publish
  const hasOcr = ocrCount > 0;
  const hasTranslations = translatedCount > pages.length / 2; // >50% translated
  const indexBrief = (book as unknown as { index?: { bookSummary?: { brief?: string } } }).index?.bookSummary?.brief;
  const readingSummary = (book as unknown as { reading_summary?: { overview?: string } }).reading_summary?.overview;
  const summaryText = indexBrief || readingSummary || (typeof book.summary === 'string' ? book.summary : book.summary?.data);
  const hasSummary = !!summaryText;
  const isComplete = ocrCount === pages.length && translatedCount === pages.length && hasSummary;

  return (
    <>
      {/* Schema.org JSON-LD for Google Scholar */}
      <SchemaOrgMetadata
        book={book}
        pageCount={pages.length}
        translatedCount={translatedCount}
        currentEdition={currentEdition}
      />

      {/* Book Info */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
            {/* Thumbnail - clickable to change */}
            <div className="flex-shrink-0 flex justify-center sm:justify-start">
              <CoverImagePicker
                bookId={book.id}
                currentThumbnail={book.thumbnail}
                bookTitle={book.title}
                pages={pages}
              />
            </div>

            {/* Details */}
            <div className="flex-1 text-center sm:text-left">
              <h1 className="text-2xl sm:text-3xl font-serif font-bold">{book.display_title || book.title}</h1>
              {book.display_title && book.title !== book.display_title && (
                <p className="text-stone-400 mt-1 italic text-sm sm:text-base">{book.title}</p>
              )}
              <p className="text-lg sm:text-xl text-stone-300 mt-2">{book.author}</p>

              {/* Book metadata */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 sm:gap-6 mt-4 sm:mt-6 text-sm text-stone-400">
                {book.language && (
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    {book.language}
                  </div>
                )}
                {book.published && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {book.published}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  {pages.length} pages
                </div>
                {imageCount > 0 && (
                  <Link
                    href={`/gallery?bookId=${book.id}`}
                    className="flex items-center gap-2 text-amber-400 hover:text-amber-300 transition-colors"
                    title="View identified images in gallery"
                  >
                    <Images className="w-4 h-4" />
                    {imageCount} images
                  </Link>
                )}
              </div>

              {/* Actions - organized by progression */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-4 text-sm">
                {/* Unlocks after translation */}
                {hasTranslations ? (
                  <BookChat bookId={book.id} bookTitle={book.display_title || book.title} inline />
                ) : (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 text-stone-500 cursor-not-allowed" title="Translate pages first">
                    <MessageCircle className="w-4 h-4" />
                    <span className="opacity-60">Ask AI</span>
                  </span>
                )}

                {/* Unlocks after complete */}
                {isComplete ? (
                  <PublishEditionButton
                    bookId={book.id}
                    bookTitle={book.display_title || book.title}
                    translatedCount={translatedCount}
                    totalPages={pages.length}
                    currentEdition={currentEdition}
                  />
                ) : (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 text-stone-500 cursor-not-allowed" title="Complete OCR, translation & summary first">
                    <BookMarked className="w-4 h-4" />
                    <span className="opacity-60">Publish</span>
                  </span>
                )}

                {/* Utilities - always available */}
                <span className="hidden sm:inline text-stone-600">|</span>
                <div className="px-2 py-1.5 text-stone-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                  <LikeButton
                    targetType="book"
                    targetId={book.id}
                    size="sm"
                    showCount={true}
                  />
                </div>
                <BookShare
                  title={book.display_title || book.title}
                  author={book.author}
                  year={book.published}
                  bookId={book.id}
                  doi={book.doi}
                  className="text-stone-300 hover:text-white hover:bg-white/10"
                />
                <Link
                  href={`/book/${book.id}/pipeline`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-stone-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                >
                  <Workflow className="w-4 h-4" />
                  Pipeline
                </Link>
                <Link
                  href={`/gallery?bookId=${book.id}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-stone-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                >
                  <Images className="w-4 h-4" />
                  Gallery
                </Link>
                <DownloadButton
                  bookId={book.id}
                  hasTranslations={hasTranslations}
                  hasOcr={hasOcr}
                  hasImages={pages.length > 0}
                  variant="header"
                />
                <BookAnalytics bookId={book.id} />
                <SearchPanel bookId={book.id} />
              </div>

              {/* Bibliographic Info */}
              <BibliographicInfo book={book} pagesCount={pages.length} />
            </div>
          </div>
        </div>
      </div>

      {/* Book Summary */}
      {(() => {
        return (
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="bg-white rounded-lg border border-stone-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-stone-900">About This Book</h2>
                {hasTranslations ? (
                  <Link
                    href={`/book/${book.id}/guide`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-amber-700 hover:text-amber-800 hover:bg-amber-50 rounded-lg transition-colors"
                  >
                    <BookText className="w-4 h-4" />
                    {hasSummary ? 'Full Summary & Index' : 'Generate Summary'}
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-stone-400 cursor-not-allowed" title="Translate pages first">
                    <BookText className="w-4 h-4" />
                    <span className="opacity-60">Generate Summary</span>
                  </span>
                )}
              </div>

              {/* Categories */}
              <div className="mb-4 pb-4 border-b border-stone-100">
                <CategoryPicker
                  bookId={book.id}
                  currentCategories={book.categories || []}
                />
              </div>
              {hasSummary ? (
                <div className="prose prose-stone prose-sm max-w-none">
                  {summaryText!.split('\n\n').map((paragraph: string, i: number) => (
                    <p key={i} className="text-stone-700 leading-relaxed mb-4 last:mb-0">
                      {paragraph}
                    </p>
                  ))}
                </div>
              ) : hasTranslations ? (
                <p className="text-stone-500 text-sm">
                  No summary yet. Generate a summary to unlock the full book index.
                </p>
              ) : (
                <p className="text-stone-500 text-sm">
                  Translate pages to unlock summary generation.
                </p>
              )}
            </div>

            {/* Editions Panel */}
            {book.editions?.length ? (
              <EditionsPanel
                bookId={book.id}
                editions={book.editions as TranslationEdition[]}
              />
            ) : null}

            {/* Entity Links - People, Places, Concepts */}
            {(() => {
              const index = (book as unknown as { index?: { people?: Array<{ term: string; pages: number[] }>; places?: Array<{ term: string; pages: number[] }>; concepts?: Array<{ term: string; pages: number[] }> } }).index;
              const people = index?.people || [];
              const places = index?.places || [];
              const concepts = index?.concepts || [];
              const hasEntities = people.length > 0 || places.length > 0 || concepts.length > 0;

              if (!hasEntities) return null;

              return (
                <div className="bg-white rounded-lg border border-stone-200 p-6 mt-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-stone-900">Index</h2>
                    <Link
                      href="/encyclopedia"
                      className="text-sm text-amber-700 hover:text-amber-800"
                    >
                      Browse all →
                    </Link>
                  </div>
                  <div className="space-y-4">
                    {/* People */}
                    {people.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium text-stone-700 mb-2">
                          <User className="w-4 h-4 text-blue-600" />
                          People ({people.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {people.slice(0, 15).map((p) => (
                            <Link
                              key={p.term}
                              href={`/encyclopedia/${encodeURIComponent(p.term)}`}
                              className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors"
                            >
                              {p.term}
                            </Link>
                          ))}
                          {people.length > 15 && (
                            <span className="px-2 py-1 text-xs text-stone-400">
                              +{people.length - 15} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Places */}
                    {places.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium text-stone-700 mb-2">
                          <MapPin className="w-4 h-4 text-green-600" />
                          Places ({places.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {places.slice(0, 15).map((p) => (
                            <Link
                              key={p.term}
                              href={`/encyclopedia/${encodeURIComponent(p.term)}`}
                              className="px-2 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100 transition-colors"
                            >
                              {p.term}
                            </Link>
                          ))}
                          {places.length > 15 && (
                            <span className="px-2 py-1 text-xs text-stone-400">
                              +{places.length - 15} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Concepts */}
                    {concepts.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium text-stone-700 mb-2">
                          <Lightbulb className="w-4 h-4 text-purple-600" />
                          Concepts ({concepts.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {concepts.slice(0, 15).map((c) => (
                            <Link
                              key={c.term}
                              href={`/encyclopedia/${encodeURIComponent(c.term)}`}
                              className="px-2 py-1 text-xs bg-purple-50 text-purple-700 rounded hover:bg-purple-100 transition-colors"
                            >
                              {c.term}
                            </Link>
                          ))}
                          {concepts.length > 15 && (
                            <span className="px-2 py-1 text-xs text-stone-400">
                              +{concepts.length - 15} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Stats + Pages Grid with Batch Mode */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-6">
        <BookPagesSection bookId={book.id} bookTitle={book.display_title || book.title} pages={pages} />
        <BookHistory bookId={book.id} />
      </main>
    </>
  );
}

export default async function BookDetailPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header - renders immediately */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-stone-700 hover:text-stone-900 transition-colors" title="Back to Library">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1" />
            </svg>
          </Link>
        </div>
      </header>

      {/* Book content streams in */}
      <Suspense fallback={
        <>
          <BookInfoSkeleton />
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <h2 className="text-xl font-semibold text-stone-900 mb-6">Pages</h2>
            <PagesGridSkeleton />
          </main>
        </>
      }>
        <BookInfo id={id} />
      </Suspense>
    </div>
  );
}
