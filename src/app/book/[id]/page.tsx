import { getDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Book, Page } from '@/lib/types';
import { ArrowLeft, BookOpen, Calendar, Globe, FileText, CheckCircle } from 'lucide-react';
import SearchPanel from '@/components/SearchPanel';

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

export default async function BookDetailPage({ params }: PageProps) {
  const { id } = await params;
  const data = await getBook(id);

  if (!data) {
    notFound();
  }

  const { book, pages } = data;

  // Calculate processing stats
  const pagesWithOcr = pages.filter(p => p.ocr?.data).length;
  const pagesWithTranslation = pages.filter(p => p.translation?.data).length;
  const pagesWithSummary = pages.filter(p => p.summary?.data).length;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link href="/" className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900">
            <ArrowLeft className="w-4 h-4" />
            Back to Library
          </Link>
        </div>
      </header>

      {/* Book Info */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex gap-8">
            {/* Thumbnail */}
            <div className="flex-shrink-0">
              <div className="w-48 aspect-[3/4] relative rounded-lg overflow-hidden shadow-xl bg-stone-700">
                {book.thumbnail ? (
                  <Image
                    src={book.thumbnail}
                    alt={book.title}
                    fill
                    className="object-cover"
                    sizes="192px"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <BookOpen className="w-16 h-16 text-stone-500" />
                  </div>
                )}
              </div>
            </div>

            {/* Details */}
            <div className="flex-1">
              <h1 className="text-3xl font-serif font-bold">{book.display_title || book.title}</h1>
              {book.display_title && book.title !== book.display_title && (
                <p className="text-stone-400 mt-1 italic">{book.title}</p>
              )}
              <p className="text-xl text-stone-300 mt-2">{book.author}</p>

              <div className="flex items-center gap-6 mt-6 text-sm text-stone-400">
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

              {/* Processing Stats */}
              <div className="flex gap-6 mt-6">
                <div className="bg-stone-700/50 rounded-lg px-4 py-3">
                  <div className="text-2xl font-bold text-amber-400">{pagesWithOcr}</div>
                  <div className="text-xs text-stone-400">OCR Complete</div>
                </div>
                <div className="bg-stone-700/50 rounded-lg px-4 py-3">
                  <div className="text-2xl font-bold text-amber-400">{pagesWithTranslation}</div>
                  <div className="text-xs text-stone-400">Translated</div>
                </div>
                <div className="bg-stone-700/50 rounded-lg px-4 py-3">
                  <div className="text-2xl font-bold text-amber-400">{pagesWithSummary}</div>
                  <div className="text-xs text-stone-400">Summarized</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

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
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-4">
            {pages.map((page) => {
              const hasOcr = !!page.ocr?.data;
              const hasTranslation = !!page.translation?.data;
              const hasSummary = !!page.summary?.data;
              const isComplete = hasOcr && hasTranslation && hasSummary;

              return (
                <Link
                  key={page.id}
                  href={`/book/${book.id}/page/${page.id}`}
                  className="group relative"
                >
                  <div className="aspect-[3/4] bg-white border border-stone-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow">
                    {page.thumbnail || page.photo ? (
                      <Image
                        src={page.thumbnail || page.photo}
                        alt={`Page ${page.page_number}`}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform"
                        sizes="(max-width: 640px) 25vw, 12.5vw"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-stone-100">
                        <span className="text-stone-400 text-sm">{page.page_number}</span>
                      </div>
                    )}

                    {/* Status indicators */}
                    <div className="absolute bottom-1 right-1 flex gap-0.5">
                      {hasOcr && (
                        <div className="w-2 h-2 rounded-full bg-blue-500" title="OCR complete" />
                      )}
                      {hasTranslation && (
                        <div className="w-2 h-2 rounded-full bg-green-500" title="Translated" />
                      )}
                      {hasSummary && (
                        <div className="w-2 h-2 rounded-full bg-purple-500" title="Summarized" />
                      )}
                    </div>

                    {isComplete && (
                      <div className="absolute top-1 right-1">
                        <CheckCircle className="w-4 h-4 text-green-500 bg-white rounded-full" />
                      </div>
                    )}
                  </div>
                  <div className="text-center text-xs text-stone-500 mt-1">
                    {page.page_number}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
