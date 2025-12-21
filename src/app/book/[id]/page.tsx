import { Suspense } from 'react';
import { getDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Book, Page } from '@/lib/types';
import { ArrowLeft, BookOpen, Calendar, Globe, FileText, Scissors } from 'lucide-react';
import SearchPanel from '@/components/SearchPanel';
import DownloadButton from '@/components/DownloadButton';
import PageThumbnail from '@/components/PageThumbnail';

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getBook(id: string): Promise<{ book: Book; pages: Page[] } | null> {
  const db = await getDb();

  const book = await db.collection('books').findOne({ id });
  if (!book) return null;

  const pages = await db.collection('pages')
    .find({ book_id: id })
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
  const pagesWithOcr = pages.filter(p => p.ocr?.data).length;
  const pagesWithTranslation = pages.filter(p => p.translation?.data).length;
  const pagesWithSummary = pages.filter(p => p.summary?.data).length;

  return (
    <>
      {/* Book Info */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
            {/* Thumbnail - priority loading */}
            <div className="flex-shrink-0 flex justify-center sm:justify-start">
              <div className="w-32 sm:w-48 aspect-[3/4] relative rounded-lg overflow-hidden shadow-xl bg-stone-700">
                {book.thumbnail ? (
                  <Image
                    src={book.thumbnail}
                    alt={book.title}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 128px, 192px"
                    priority
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <BookOpen className="w-12 sm:w-16 h-12 sm:h-16 text-stone-500" />
                  </div>
                )}
              </div>
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
                <SearchPanel bookId={book.id} />
              </div>

              {/* Processing Stats + Download */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 sm:gap-6 mt-4 sm:mt-6">
                <div className="bg-stone-700/50 rounded-lg px-3 sm:px-4 py-2 sm:py-3">
                  <div className="text-xl sm:text-2xl font-bold text-amber-400">{pagesWithOcr}</div>
                  <div className="text-xs text-stone-400">OCR</div>
                </div>
                <div className="bg-stone-700/50 rounded-lg px-3 sm:px-4 py-2 sm:py-3">
                  <div className="text-xl sm:text-2xl font-bold text-amber-400">{pagesWithTranslation}</div>
                  <div className="text-xs text-stone-400">Translated</div>
                </div>
                <div className="bg-stone-700/50 rounded-lg px-3 sm:px-4 py-2 sm:py-3">
                  <div className="text-xl sm:text-2xl font-bold text-amber-400">{pagesWithSummary}</div>
                  <div className="text-xs text-stone-400">Summarized</div>
                </div>

                {/* Prepare & Download */}
                <div className="w-full sm:w-auto sm:ml-auto mt-2 sm:mt-0 flex items-center justify-center sm:justify-end gap-2">
                  <Link
                    href={`/book/${book.id}/prepare`}
                    className="flex items-center gap-2 px-4 py-2 bg-stone-600 text-white rounded-lg hover:bg-stone-500 transition-colors text-sm"
                  >
                    <Scissors className="w-4 h-4" />
                    Prepare Pages
                  </Link>
                  <DownloadButton
                    bookId={book.id}
                    hasTranslations={pagesWithTranslation > 0}
                    hasOcr={pagesWithOcr > 0}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Book Summary */}
      {book.summary && (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white rounded-lg border border-stone-200 p-6">
            <h2 className="text-lg font-semibold text-stone-900 mb-4">About This Book</h2>
            <div className="prose prose-stone prose-sm max-w-none">
              {(typeof book.summary === 'string' ? book.summary : book.summary.data)
                .split('\n\n')
                .map((paragraph: string, i: number) => (
                  <p key={i} className="text-stone-700 leading-relaxed mb-4 last:mb-0">
                    {paragraph}
                  </p>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Pages Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="text-xl font-semibold text-stone-900 mb-6">Pages</h2>

        {pages.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg border border-stone-200">
            <FileText className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-stone-600">No pages yet</h3>
            <p className="text-stone-500 mt-2">Upload pages to start processing.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3 sm:gap-4">
            {pages.map((page, index) => (
              <PageThumbnail
                key={page.id}
                page={page}
                bookId={book.id}
                index={index}
              />
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-stone-100 border-t border-stone-200 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm text-stone-500">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
            <span>CC0 Public Domain</span>
            <span className="hidden sm:inline">•</span>
            <a
              href="mailto:derek@ancientwisdomtrust.org"
              className="text-amber-700 hover:text-amber-800 transition-colors"
            >
              derek@ancientwisdomtrust.org
            </a>
          </div>
        </div>
      </footer>
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
