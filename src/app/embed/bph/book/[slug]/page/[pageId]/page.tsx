import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import PageEditorPage from '@/app/[tenant]/book/[id]/page/[pageId]/page';

export const revalidate = 86400;
export const preferredRegion = 'fra1';
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

/**
 * BPH embed page reader — verifies the book exists, then renders the real page component.
 */
export default async function EmbedPageRoute({ params }: { params: Promise<{ slug: string; pageId: string }> }) {
  const { slug, pageId } = await params;

  const db = await getReadDb();
  const exists = await db.collection('books').findOne(
    { $or: [{ slug }, { id: slug }], visible: true, pages_count: { $gt: 0 } },
    { projection: { _id: 1 } }
  );
  if (!exists) notFound();

  return <PageEditorPage params={Promise.resolve({ tenant: 'bph', id: slug, pageId })} />;
}
