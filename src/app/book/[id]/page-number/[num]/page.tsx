import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';
import { ArrowLeft, ArrowRight, BookOpen, FileText, Globe } from 'lucide-react';
import type { Book, Page } from '@/lib/types';

interface Props {
  params: Promise<{ id: string; num: string }>;
}

async function getPageData(bookId: string, pageNumber: number) {
  const db = await getDb();

  const [book, page] = await Promise.all([
    db.collection('books').findOne(
      { id: bookId },
      {
        projection: {
          id: 1, title: 1, display_title: 1, author: 1, published: 1,
          language: 1, free_tier: 1, featured: 1, thumbnail: 1, pages_count: 1,
        },
      }
    ),
    db.collection('pages').findOne(
      { book_id: bookId, page_number: pageNumber },
      {
        projection: {
          id: 1, page_number: 1, book_id: 1,
          photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1,
          'ocr.data': 1, 'ocr.language': 1,
          'translation.data': 1, 'translation.language': 1,
          columns: 1,
        },
      }
    ),
  ]);

  if (!book || !page) return null;

  // Get prev/next page numbers
  const [prevPage, nextPage] = await Promise.all([
    pageNumber > 1
      ? db.collection('pages').findOne(
          { book_id: bookId, page_number: pageNumber - 1 },
          { projection: { page_number: 1 } }
        )
      : null,
    db.collection('pages').findOne(
      { book_id: bookId, page_number: pageNumber + 1 },
      { projection: { page_number: 1 } }
    ),
  ]);

  return {
    book: JSON.parse(JSON.stringify(book)) as Book,
    page: JSON.parse(JSON.stringify(page)) as Page,
    hasPrev: !!prevPage,
    hasNext: !!nextPage,
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id: bookId, num } = await params;
  const pageNumber = parseInt(num, 10);

  if (isNaN(pageNumber)) {
    return { title: 'Page Not Found - Source Library' };
  }

  const data = await getPageData(bookId, pageNumber);
  if (!data) {
    return { title: 'Page Not Found - Source Library' };
  }

  const { book, page } = data;
  const bookTitle = book.display_title || book.title;
  const ogBookTitle = book.published ? `${bookTitle} (${book.published})` : bookTitle;
  const title = `${ogBookTitle} - Page ${pageNumber}`;

  const textContent = page.translation?.data || page.ocr?.data || '';
  const excerpt = textContent.length > 200
    ? textContent.substring(0, 197) + '...'
    : textContent;

  const description = excerpt
    ? `Page ${pageNumber} of "${bookTitle}" by ${book.author}. ${excerpt}`
    : `Page ${pageNumber} of "${bookTitle}" by ${book.author}${book.published ? ` (${book.published})` : ''}. Digitized from the original ${book.language || 'manuscript'}.`;

  const pageId = page.id || (page as any)._id?.toString();
  const canonicalPath = pageId
    ? `/book/${bookId}/page/${pageId}`
    : `/book/${bookId}`;

  const imageUrl = page.cropped_photo || page.archived_photo || page.photo || page.photo_original;

  return {
    title: `${title} - Source Library`,
    description,
    alternates: { canonical: canonicalPath },
    robots: { index: false, follow: true },
    openGraph: {
      title,
      description,
      type: 'article',
      siteName: 'Source Library',
      locale: 'en_US',
      ...(imageUrl && {
        images: [{ url: imageUrl, alt: `${bookTitle} - Page ${pageNumber}` }],
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(imageUrl && { images: [imageUrl] }),
    },
  };
}

/**
 * Strip XML-like tags from OCR/translation text for clean display.
 */
function stripTags(text: string): string {
  return text
    .replace(/<page-type>[\s\S]*?<\/page-type>/g, '')
    .replace(/<columns>\d+<\/columns>/g, '')
    .replace(/<column-break\s*\/>/g, '\n')
    .replace(/<detected-images>[\s\S]*?<\/detected-images>/g, '')
    .replace(/<language>.*?<\/language>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

export default async function PageNumberContent({ params }: Props) {
  const { id: bookId, num } = await params;
  const pageNumber = parseInt(num, 10);

  if (isNaN(pageNumber)) {
    notFound();
  }

  const data = await getPageData(bookId, pageNumber);
  if (!data) {
    notFound();
  }

  const { book, page, hasPrev, hasNext } = data;
  const bookTitle = book.display_title || book.title;
  const pageId = page.id || (page as any)._id?.toString();
  const readerUrl = `/book/${bookId}/page/${pageId}`;

  // Content gate: check if this book requires authentication
  const isFreeTier = !!(book as any).free_tier || !!(book as any).featured;
  const isGated = !isFreeTier;
  let showContent = true;

  if (isGated) {
    const session = await auth();
    if (!session?.user) {
      showContent = false;
    }
  }

  const imageUrl = page.cropped_photo || page.archived_photo || page.photo || page.photo_original;
  const ocrText = page.ocr?.data ? stripTags(page.ocr.data) : null;
  const translationText = page.translation?.data ? stripTags(page.translation.data) : null;
  const ocrLanguage = page.ocr?.language || book.language || 'unknown';

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
          <Link
            href={`/book/${bookId}`}
            className="flex items-center gap-2 text-stone-600 hover:text-stone-900 transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">{bookTitle}</span>
            <span className="sm:hidden">Back</span>
          </Link>
        </div>
      </header>

      {/* Page content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Book + page info */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            {bookTitle}
          </h1>
          <p className="text-stone-500 mt-1">
            {book.author}
            {book.published && <span className="text-stone-400"> ({book.published})</span>}
          </p>
          <div className="flex items-center gap-4 mt-3 text-sm text-stone-500">
            <span className="flex items-center gap-1.5">
              <FileText className="w-4 h-4" />
              Page {pageNumber}
              {book.pages_count && <span className="text-stone-400">of {book.pages_count}</span>}
            </span>
            {book.language && (
              <span className="flex items-center gap-1.5">
                <Globe className="w-4 h-4" />
                {book.language}
              </span>
            )}
          </div>
        </div>

        {/* Interactive reader link */}
        <Link
          href={readerUrl}
          className="inline-flex items-center gap-2 px-4 py-2 bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90 transition-colors text-sm font-medium"
        >
          <BookOpen className="w-4 h-4" />
          Open in interactive reader
        </Link>

        {showContent ? (
          <>
            {/* Page image */}
            {imageUrl && (
              <div className="border border-stone-200 rounded-lg overflow-hidden bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt={`Page ${pageNumber} of ${bookTitle}`}
                  className="max-w-full h-auto mx-auto"
                  loading="lazy"
                />
              </div>
            )}

            {/* Translation */}
            {translationText && (
              <section lang="en">
                <h2 className="text-lg font-semibold text-stone-800 mb-3 flex items-center gap-2">
                  English Translation
                </h2>
                <div className="prose-content max-w-none bg-white border border-stone-200 rounded-lg p-6">
                  {translationText.split('\n\n').map((paragraph, i) => (
                    <p key={i} className="mb-4 last:mb-0 leading-relaxed">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            )}

            {/* Original text (OCR) */}
            {ocrText && (
              <section lang={ocrLanguage === 'Latin' ? 'la' : ocrLanguage === 'German' ? 'de' : ocrLanguage === 'French' ? 'fr' : ocrLanguage === 'Italian' ? 'it' : ocrLanguage === 'Hebrew' ? 'he' : ocrLanguage === 'Arabic' ? 'ar' : ocrLanguage === 'Greek' ? 'el' : undefined}>
                <h2 className="text-lg font-semibold text-stone-800 mb-3">
                  Original Text ({ocrLanguage})
                </h2>
                <div className="prose-content max-w-none bg-warm border border-stone-200 rounded-lg p-6">
                  {ocrText.split('\n\n').map((paragraph, i) => (
                    <p key={i} className="mb-4 last:mb-0 leading-relaxed">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            )}

            {!ocrText && !translationText && (
              <div className="bg-white border border-stone-200 rounded-lg p-8 text-center text-stone-500">
                <p>This page has not been processed yet.</p>
                <p className="text-sm mt-1">OCR and translation are in progress for this book.</p>
              </div>
            )}
          </>
        ) : (
          /* Gated content */
          <div className="bg-white border border-stone-200 rounded-lg p-8 text-center">
            <h2 className="text-lg font-semibold text-stone-800 mb-2">Sign in to read</h2>
            <p className="text-stone-500 mb-4">
              Page content for this book requires authentication.
            </p>
            <Link
              href={`/book/${bookId}`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90 transition-colors text-sm"
            >
              View book details
            </Link>
          </div>
        )}

        {/* Prev/next navigation */}
        <nav className="flex items-center justify-between pt-4 border-t border-stone-200" aria-label="Page navigation">
          {hasPrev ? (
            <Link
              href={`/book/${bookId}/page-number/${pageNumber - 1}`}
              className="flex items-center gap-2 px-4 py-2 text-sm text-stone-600 hover:text-stone-900 bg-white border border-stone-200 rounded-lg hover:border-stone-300 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Page {pageNumber - 1}
            </Link>
          ) : (
            <div />
          )}
          <Link
            href={`/book/${bookId}`}
            className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
          >
            All pages
          </Link>
          {hasNext ? (
            <Link
              href={`/book/${bookId}/page-number/${pageNumber + 1}`}
              className="flex items-center gap-2 px-4 py-2 text-sm text-stone-600 hover:text-stone-900 bg-white border border-stone-200 rounded-lg hover:border-stone-300 transition-colors"
            >
              Page {pageNumber + 1}
              <ArrowRight className="w-4 h-4" />
            </Link>
          ) : (
            <div />
          )}
        </nav>
      </main>
    </div>
  );
}
