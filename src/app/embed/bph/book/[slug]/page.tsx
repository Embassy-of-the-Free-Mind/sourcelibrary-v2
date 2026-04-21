import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import BookDetailPage from '@/app/book/[id]/page';
export { generateMetadata } from '@/app/book/[id]/page';

export const revalidate = 86400;
export const preferredRegion = 'fra1';
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

/**
 * BPH embed book page — verifies the book belongs to BPH, then renders
 * the real BookDetailPage. Non-BPH books 404 in the embed.
 */
export default async function EmbedBookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Verify this is a BPH book before rendering
  const db = await getReadDb();
  const isBph = await db.collection('books').findOne(
    { $or: [{ slug }, { id: slug }], 'image_source.provider': 'bph' },
    { projection: { _id: 1 } }
  );
  if (!isBph) notFound();

  return <BookDetailPage params={Promise.resolve({ id: slug })} />;
}
