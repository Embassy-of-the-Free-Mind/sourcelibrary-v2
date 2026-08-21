import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { getTenantContext } from '@/lib/tenant-context';
import type { Metadata } from 'next';
import BookOverviewShell from '@/components/reader/BookOverviewShell';
export const dynamic = 'force-dynamic';
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
  chapters: 1,
};

const PAGE_PROJECTION = {
  _id: 0,
  id: 1,
  page_number: 1,
  photo: 1,
  photo_original: 1,
  archived_photo: 1,
  cropped_photo: 1,
  thumbnail: 1, image_display: 1,
  thumbnail_blob: 1, image_thumb: 1,
  display_photo: 1,
  split_from_spread: 1,
  crop: 1,
  page_type: 1,
  // First gallery-worthy illustration only (>=0.5 = gallery materialization
  // threshold) — mapped to a has_illustration boolean before serialization.
  detected_images: { $elemMatch: { gallery_quality: { $gte: 0.5 } } },
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const ctx = await getTenantContext();
  const db = await getReadDb();
  const result = await findBookByIdOrSlug(db, id, { _id: 0, title: 1, display_title: 1 }, ctx?.id ?? undefined);
  if (!result) return {
    title: 'Book Not Found - Source Library',
    robots: { index: false, follow: true },
    alternates: { canonical: `/book/${id}/overview` },
  };
  const title = result.book.display_title || result.book.title;
  return {
    title: `Overview — ${title} - Source Library`,
    robots: { index: false, follow: true },
    alternates: { canonical: `/book/${id}/overview` },
  };
}

export default async function BookOverviewPage({ params }: PageProps) {
  const { id } = await params;
  const ctx = await getTenantContext();

  const db = await Promise.race([
    getReadDb(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 15000)),
  ]);

  const bookResult = await findBookByIdOrSlug(db, id, BOOK_PROJECTION, ctx?.id ?? undefined);
  if (!bookResult) notFound();

  const book = bookResult.book;
  const bookId = book.id || book._id?.toString();

  // Fetch ALL pages (not just first 100) — overview needs them all
  // Use a generous limit but cap at 2000 for sanity
  const pagesRaw = await db.collection('pages')
    .find(
      { book_id: bookId, page_number: { $gt: 0 } },
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
    has_illustration: Array.isArray(p.detected_images) && p.detected_images.length > 0 ? true : undefined,
  }));

  if (pages.length === 0) notFound();

  const chapters = (Array.isArray(book.chapters) ? book.chapters : [])
    .filter(c => typeof c?.pageNumber === 'number' && c.confidence !== 'low')
    .map(c => ({
      title: c.title as string,
      titleEn: c.titleEn as string | undefined,
      pageNumber: c.pageNumber as number,
      level: (c.level as number) || 1,
    }));

  return (
    <BookOverviewShell
      bookId={bookId}
      bookSlug={book.slug}
      bookTitle={book.display_title || book.title}
      pages={pages}
      chapters={chapters}
    />
  );
}
