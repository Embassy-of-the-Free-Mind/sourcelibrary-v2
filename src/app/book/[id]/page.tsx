import { Suspense } from 'react';
import { getDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Book, Page, TranslationEdition } from '@/lib/types';
import { ArrowLeft, BookOpen, Calendar, Globe, FileText, BookText, Glasses, Workflow, MessageCircle, BookMarked } from 'lucide-react';
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
import CategoryPicker from '@/components/CategoryPicker';
import EditBookButton from '@/components/EditBookButton';

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
  const ocrCount = pages.filter(p => p.ocr?.data).length;
  const translatedCount = pages.filter(p => p.translation?.data).length;
  const currentEdition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'published');

  // Progression: OCR → Translation → Summary → Ask AI / Publish
  const hasOcr = ocrCount > 0;
  const hasTranslations = translatedCount > 0;
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
              </div>

              {/* Actions - organized by progression */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-4 text-sm">
                {/* Always available */}
                <Link
                  href={`/book/${book.id}/read`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                >
                  <Glasses className="w-4 h-4" />
                  Read
                </Link>
                <ProcessBookButton
                  bookId={book.id}
                  bookTitle={book.display_title || book.title}
                  pages={pages}
                />

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
                <Link
                  href={`/book/${book.id}/pipeline`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-stone-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                >
                  <Workflow className="w-4 h-4" />
                  Pipeline
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
                <EditBookButton book={book} />
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
                    href={`/book/${book.id}/summary`}
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
