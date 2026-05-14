import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { resolveTenantId } from '@/lib/tenant-context';
import BookDetailPage, { generateMetadata as parentGenerateMetadata } from '@/app/[tenant]/book/[id]/page';

// The parent generateMetadata expects params.id; this route's param is named
// `slug`. Forward it as id so the lookup actually has a value — otherwise
// findBookByIdOrSlug builds {$or: [{slug: undefined}, {id: undefined}]},
// which Mongo collapses to {$or: [{}, {}]} and returns the first book in
// the tenant, breaking <title> tags on every embed book page.
export async function generateMetadata({ params }: { params: Promise<{ tenant: string; slug: string }> }): Promise<Metadata> {
  const { tenant, slug } = await params;
  return parentGenerateMetadata({ params: Promise.resolve({ tenant, id: slug }) });
}

export const revalidate = 86400;
export const preferredRegion = 'fra1';
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

export default async function EmbedBookPage({ params }: { params: Promise<{ tenant: string; slug: string }> }) {
    const { tenant, slug } = await params;

    const tenantId = await resolveTenantId(tenant);
    if (!tenantId) notFound();

    const db = await getReadDb();
    const book = await db.collection('books').findOne(
        { $or: [{ slug }, { id: slug }], visible: true, pages_count: { $gt: 0 } },
        { projection: { _id: 1, id: 1 } }
    );

    if (!book) notFound();

    const bookId = (book as any).id || slug;
    return <BookDetailPage params={Promise.resolve({ tenant, id: bookId })} isEmbedded />;
}
