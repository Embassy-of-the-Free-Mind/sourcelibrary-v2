import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import { Book, Page } from '@/lib/types';

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string; pageId: string }>;
}

async function getPageData(bookId: string, pageId: string): Promise<{ book: Book | null; page: Page | null }> {
  try {
    const db = await getDb();

    // Fetch book and page in parallel
    const [book, page] = await Promise.all([
      db.collection('books').findOne({ id: bookId }),
      db.collection('pages').findOne({ id: pageId }),
    ]);

    // Fallback: try ObjectId lookup for book
    if (!book) {
      const { ObjectId } = await import('mongodb');
      if (ObjectId.isValid(bookId)) {
        const bookByOid = await db.collection('books').findOne({ _id: new ObjectId(bookId) });
        return { book: bookByOid as unknown as Book | null, page: page as unknown as Page | null };
      }
    }

    return {
      book: book as unknown as Book | null,
      page: page as unknown as Page | null
    };
  } catch {
    return { book: null, page: null };
  }
}

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { id, pageId } = await params;
  const { book, page } = await getPageData(id, pageId);

  if (!book || !page) {
    return {
      title: 'Page Not Found - Source Library',
    };
  }

  const bookTitle = book.display_title || book.title;
  const pageNum = page.page_number;
  const ogBookTitle = book.published ? `${bookTitle} (${book.published})` : bookTitle;
  const title = `${ogBookTitle} - Page ${pageNum}`;

  // Use translation excerpt if available, otherwise OCR excerpt
  const textContent = page.translation?.data || page.ocr?.data || '';
  const excerpt = textContent.length > 200
    ? textContent.substring(0, 197) + '...'
    : textContent;

  const description = excerpt
    ? `Page ${pageNum} of "${bookTitle}" by ${book.author}. ${excerpt}`
    : `Page ${pageNum} of "${bookTitle}" by ${book.author}${book.published ? ` (${book.published})` : ''}. Digitized from the original ${book.language || 'manuscript'}.`;

  const pageUrl = `/book/${id}/page/${pageId}`;

  return {
    title: `${title} - Source Library`,
    description,
    alternates: {
      canonical: pageUrl,
    },
    openGraph: {
      title,
      description,
      type: 'article',
      siteName: 'Source Library',
      locale: 'en_US',
      url: pageUrl,
      ...(page.photo && {
        images: [
          {
            url: page.photo,
            alt: `${bookTitle} - Page ${pageNum}`,
          },
        ],
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(page.photo && { images: [page.photo] }),
    },
  };
}

export default function PageLayout({ children }: LayoutProps) {
  return children;
}
