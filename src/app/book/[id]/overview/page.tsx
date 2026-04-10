import { notFound } from 'next/navigation';
import { getDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import type { Metadata } from 'next';
import BookOverview from '@/components/reader/BookOverview';

// ISR: 24h background revalidation + on-demand via pipeline
export const revalidate = 86400;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

// Run near the database
export const preferredRegion = 'fra1';

interface PageProps {
  params: Promise<{ id: string }>;
}

const BOOK_PROJECTION = {
  _id: 0,
  id: 1,
  slug: 1,
  title: 1,
  display_title: 1,
  author: 1,
  pages_count: 1,
};

const PAGE_PROJECTION = {
  _id: 0,
  id: 1,
  page_number: 1,
  photo: 1,
  photo_original: 1,
  archived_photo: 1,
  cropped_photo: 1,
  thumbnail: 1,
  thumbnail_blob: 1,
  display_photo: 1,
  split_from_spread: 1,
  crop: 1,
  page_type: 1,
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const db = await getDb();
  const result = await findBookByIdOrSlug(db, id, { _id: 0, title: 1, display_title: 1 });
  if (!result) return { title: 'Book Not Found - Source Library' };
  const title = result.book.display_title || result.book.title;
  return {
    title: `Overview — ${title} - Source Library`,
    robots: { index: false, follow: true },
  };
}

export default async function BookOverviewPage({ params }: PageProps) {
  const { id } = await params;

  const db = await Promise.race([
    getDb(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 15000)),
  ]);

  const bookResult = await findBookByIdOrSlug(db, id, BOOK_PROJECTION);
  if (!bookResult) notFound();

  const book = bookResult.book;
  const bookId = book.id || book._id?.toString();

  // Fetch ALL pages (not just first 100) — overview needs them all
  // Use a generous limit but cap at 2000 for sanity
  const pagesRaw = await db.collection('pages')
    .find(
      { book_id: bookId },
      { projection: PAGE_PROJECTION, maxTimeMS: 10000 },
    )
    .sort({ page_number: 1 })
    .limit(2000)
    .toArray()
    .then(docs => docs.filter(d => d.page_type !== 'digitizer-insert'));

  const pages = pagesRaw.map(p => ({
    id: p.id as string,
    page_number: p.page_number as number,
    photo: p.photo as string | undefined,
    photo_original: p.photo_original as string | undefined,
    archived_photo: p.archived_photo as string | undefined,
    cropped_photo: p.cropped_photo as string | undefined,
    thumbnail: p.thumbnail as string | undefined,
    thumbnail_blob: p.thumbnail_blob as string | undefined,
    display_photo: p.display_photo as string | undefined,
    split_from_spread: p.split_from_spread as boolean | undefined,
    crop: p.crop as { xStart?: number; xEnd?: number } | undefined,
  }));

  if (pages.length === 0) notFound();

  return (
    <BookOverview
      bookId={bookId}
      bookSlug={book.slug}
      bookTitle={book.display_title || book.title}
      pages={pages}
    />
  );
}
