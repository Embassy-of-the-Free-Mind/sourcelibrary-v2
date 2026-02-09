import { redirect, notFound } from 'next/navigation';
import { Metadata } from 'next';
import { connectToDatabase } from '@/lib/mongodb';

interface Props {
  params: Promise<{ id: string; num: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id: bookId, num } = await params;
  const pageNumber = parseInt(num, 10);

  if (isNaN(pageNumber)) {
    return { title: 'Page Not Found - Source Library' };
  }

  const { db } = await connectToDatabase();
  const page = await db.collection('pages').findOne(
    { book_id: bookId, page_number: pageNumber },
    { projection: { _id: 1 } }
  );

  const canonicalPath = page
    ? `/book/${bookId}/page/${page._id.toString()}`
    : `/book/${bookId}`;

  return {
    alternates: { canonical: canonicalPath },
    robots: { index: false, follow: true },
  };
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
