import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import BookDetailPage from '@/app/[tenant]/book/[id]/page';
export { generateMetadata } from '@/app/[tenant]/book/[id]/page';

export const revalidate = 86400;
export const preferredRegion = 'fra1';
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

/**
 * Bhutan tenant book page — verifies the book belongs to the bhutan tenant,
 * then renders the real BookDetailPage. Non-bhutan books 404.
 */
export default async function BhutanBookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const db = await getReadDb();
  const isBhutan = await db.collection('books').findOne(
    { $or: [{ slug }, { id: slug }], tenant_id: 'bhutan' },
    { projection: { _id: 1 } }
  );
  if (!isBhutan) notFound();

  return <BookDetailPage params={Promise.resolve({ id: slug })} />;
}
