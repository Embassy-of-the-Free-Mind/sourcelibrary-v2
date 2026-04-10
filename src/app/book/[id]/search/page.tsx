import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import { bookUrl } from '@/lib/slugify';
import BookSearchResults from './BookSearchResults';

// ISR: 24h background revalidation. Pipeline also calls /api/admin/revalidate-book for immediate updates.
export const revalidate = 86400;

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params;
  const { q } = await searchParams;
  const db = await getDb();
  const book = await db.collection('books').findOne(
    { id },
    { projection: { title: 1, display_title: 1 } }
  );
  const title = book?.display_title || book?.title || 'Book';
  return {
    title: q ? `"${q}" in ${title}` : `Search ${title}`,
    robots: { index: false },
  };
}

export default async function BookSearchPage({ params, searchParams }: Props) {
  const { id: bookId } = await params;
  const { q } = await searchParams;
  const db = await getDb();

  const book = await db.collection('books').findOne(
    { id: bookId },
    { projection: { id: 1, title: 1, display_title: 1, author: 1, slug: 1 } }
  );

  if (!book) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-stone-500">Book not found</p>
      </div>
    );
  }

  const bookTitle = book.display_title || book.title;
  const backUrl = bookUrl({ id: book.id as string, slug: book.slug as string | undefined });

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-warm)' }}>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <BookSearchResults
          bookId={bookId}
          bookTitle={bookTitle}
          backUrl={backUrl}
          initialQuery={q || ''}
        />
      </div>
    </div>
  );
}
