import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';

interface Props {
  params: Promise<{ id: string; num: string }>;
}

export default async function PageNumberRedirect({ params }: Props) {
  const { id, num } = await params;
  const pageNumber = parseInt(num, 10);

  if (isNaN(pageNumber)) {
    notFound();
  }

  const db = await getDb();

  // Resolve slug/id/ObjectId to actual book
  const result = await findBookByIdOrSlug(db, id, { id: 1, slug: 1 });
  if (!result) {
    notFound();
  }

  const bookId = (result.book.id || result.book._id?.toString()) as string;
  const bookSlug = (result.book.slug || bookId) as string;

  const page = await db.collection('pages').findOne(
    { book_id: bookId, page_number: pageNumber },
    { projection: { id: 1 } }
  );

  if (!page) {
    notFound();
  }

  const pageId = page.id || page._id?.toString();
  redirect(`/book/${bookSlug}/page/${pageId}`);
}
