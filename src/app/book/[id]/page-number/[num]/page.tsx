import { redirect, notFound } from 'next/navigation';
import { connectToDatabase } from '@/lib/mongodb';

interface Props {
  params: Promise<{ id: string; num: string }>;
}

export default async function PageNumberRedirect({ params }: Props) {
  const { id: bookId, num } = await params;
  const pageNumber = parseInt(num, 10);

  if (isNaN(pageNumber)) {
    notFound();
  }

  const { db } = await connectToDatabase();

  // Find the page by book_id and page_number
  const page = await db.collection('pages').findOne(
    { book_id: bookId, page_number: pageNumber },
    { projection: { _id: 1 } }
  );

  if (!page) {
    // If page not found, redirect to the book page
    redirect(`/book/${bookId}`);
  }

  redirect(`/book/${bookId}/page/${page._id.toString()}`);
}
