import { Suspense } from 'react';
import { getDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Book, Page, TranslationEdition } from '@/lib/types';
import { ArrowLeft, BookOpen, Calendar, Globe, FileText, BookText, Glasses } from 'lucide-react';
import SearchPanel from '@/components/SearchPanel';
import BookPagesSection from '@/components/BookPagesSection';
import BookHistory from '@/components/BookHistory';
import BookChat from '@/components/BookChat';
import BookAnalytics from '@/components/BookAnalytics';
import ProcessBookButton from '@/components/ProcessBookButton';
import CoverImagePicker from '@/components/CoverImagePicker';
import DownloadButton from '@/components/DownloadButton';
import BibliographicInfo from '@/components/BibliographicInfo';
import PublishEditionButton from '@/components/PublishEditionButton';
import EditionsPanel from '@/components/EditionsPanel';
import SchemaOrgMetadata from '@/components/SchemaOrgMetadata';

interface PageProps {
  params: Promise<{ id: string }>;
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

  const pages = await db.collection('pages')
    .find({ book_id: bookId })
    .sort({ page_number: 1 })
    .toArray();

  return { book: book as unknown as Book, pages: pages as unknown as Page[] };
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
  const translatedCount = pages.filter(p => p.translation?.data).length;
  const currentEdition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'published');

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
                <Link
                  href={`/book/${book.id}/read`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm"
                >
                  <Glasses className="w-4 h-4" />
                  Read
                </Link>
                <ProcessBookButton
                  bookId={book.id}
                  bookTitle={book.display_title || book.title}
                  pages={pages}
                />
                <DownloadButton
                  bookId={book.id}
                  hasTranslations={pages.some(p => p.translation?.data)}
                  hasOcr={pages.some(p => p.ocr?.data)}
                  hasImages={pages.length > 0}
                  variant="header"
                />
                <PublishEditionButton
                  bookId={book.id}
                  bookTitle={book.display_title || book.title}
                  translatedCount={translatedCount}
                  totalPages={pages.length}
                  currentEdition={currentEdition}
                />
                <BookAnalytics bookId={book.id} />
                <SearchPanel bookId={book.id} />
                <BookChat bookId={book.id} bookTitle={book.display_title || book.title} inline />
              </div>

              {/* Bibliographic Info */}
              <BibliographicInfo book={book} pagesCount={pages.length} />
            </div>
          </div>
        </div>
      </div>

      {/* Book Summary */}
      {(() => {
        // Get summary from index.bookSummary.brief or fall back to book.summary
        const indexBrief = (book as unknown as { index?: { bookSummary?: { brief?: string } } }).index?.bookSummary?.brief;
        const summaryText = indexBrief || (typeof book.summary === 'string' ? book.summary : book.summary?.data);
        const hasSummary = !!summaryText;

        return (
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="bg-white rounded-lg border border-stone-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-stone-900">About This Book</h2>
                <Link
                  href={`/book/${book.id}/summary`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-amber-700 hover:text-amber-800 hover:bg-amber-50 rounded-lg transition-colors"
                >
                  <BookText className="w-4 h-4" />
                  {hasSummary ? 'Full Summary & Index' : 'Generate Summary'}
                </Link>
              </div>
              {hasSummary ? (
                <div className="prose prose-stone prose-sm max-w-none">
                  {summaryText!.split('\n\n').map((paragraph: string, i: number) => (
                    <p key={i} className="text-stone-700 leading-relaxed mb-4 last:mb-0">
                      {paragraph}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-stone-500 text-sm">
                  No summary yet. Process page summaries and generate a book summary to see it here.
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link href="/" className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900">
            <ArrowLeft className="w-4 h-4" />
            Back to Library
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
