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

    // Get book
    let book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      const { ObjectId } = await import('mongodb');
      if (ObjectId.isValid(bookId)) {
        book = await db.collection('books').findOne({ _id: new ObjectId(bookId) });
      }
    }

    if (!book) return { book: null, page: null };

    // Get page
    const page = await db.collection('pages').findOne({ id: pageId });

    return {
      book: book as unknown as Book,
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
  const title = `${bookTitle} - Page ${pageNum}`;

  // Use translation excerpt if available, otherwise OCR excerpt
  const textContent = page.translation?.data || page.ocr?.data || '';
  const excerpt = textContent.length > 200
    ? textContent.substring(0, 197) + '...'
    : textContent;

  const description = excerpt
    ? `Page ${pageNum} of "${bookTitle}" by ${book.author}. ${excerpt}`
    : `Page ${pageNum} of "${bookTitle}" by ${book.author}${book.published ? ` (${book.published})` : ''}. Digitized from the original ${book.language || 'manuscript'}.`;

  return {
    title: `${title} - Source Library`,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      siteName: 'Source Library',
      locale: 'en_US',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default function PageLayout({ children }: LayoutProps) {
  return children;
}
