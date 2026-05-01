import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import BookDetailPage from '@/app/[tenant]/book/[id]/page';
export { generateMetadata } from '@/app/[tenant]/book/[id]/page';

export const revalidate = 86400;
export const preferredRegion = 'fra1';
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

/**
 * BPH embed book page — verifies the book exists on Source Library, then renders
 * the real BookDetailPage. Allows any visible book (not just BPH-sourced) since
 * BPH holds copies of books we may have imported from other providers (MDZ, IA, etc).
 */
export default async function EmbedBookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const db = await getReadDb();
  const exists = await db.collection('books').findOne(
    { $or: [{ slug }, { id: slug }], visible: true, pages_count: { $gt: 0 } },
    { projection: { _id: 1 } }
  );
  if (!exists) notFound();

  return <BookDetailPage params={Promise.resolve({ tenant: 'bph', id: slug })} isEmbedded />;
}
