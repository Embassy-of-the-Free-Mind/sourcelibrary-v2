import { notFound, permanentRedirect } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { findTenantBookByIdOrSlug } from '@/lib/tenant-book-lookup';

interface Props {
  params: Promise<{ tenant: string; id: string; num: string }>;
}

export default async function PageNumberRedirect({ params }: Props) {
  const { tenant, id, num } = await params;
  const pageNumber = parseInt(num, 10);

  if (isNaN(pageNumber)) {
    notFound();
  }

  const db = await getReadDb();

  // Resolve slug/id/ObjectId to actual book
  const result = await findTenantBookByIdOrSlug(db, tenant, id, { id: 1, slug: 1 });
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
  permanentRedirect(`/book/${bookSlug}/page/${pageId}`);
}
