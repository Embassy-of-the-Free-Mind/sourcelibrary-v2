import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/lib/mongodb';

interface Props {
  params: Promise<{ id: string; num: string }>;
}

export default async function PageNumberRedirect({ params }: Props) {
  const { id: bookId, num } = await params;
  const pageNumber = parseInt(num, 10);

  if (isNaN(pageNumber)) {
    notFound();
  }

  const db = await getDb();
  const page = await db.collection('pages').findOne(
    { book_id: bookId, page_number: pageNumber },
    { projection: { id: 1 } }
  );

  if (!page) {
    notFound();
  }

  const pageId = page.id || page._id?.toString();
  redirect(`/book/${bookId}/page/${pageId}`);
}
