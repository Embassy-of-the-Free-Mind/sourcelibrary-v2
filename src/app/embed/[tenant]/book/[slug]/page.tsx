import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import BookDetailPage, { generateMetadata as parentGenerateMetadata } from '@/app/book/[id]/page';

// Iframe-target wrapper. Partner Webflow sites embed Source Library via
// public/embed/v1.js, which loads iframes at
// `${BASE_URL}/embed/${tenant}/book/${slug}` (BASE_URL defaults to
// sourcelibrary.org). Phase Final kept this wrapper intact — proxy.ts
// stamps the x-tenant-* headers for /embed/[tenant]/* so the global
// BookDetailPage downstream sees `isEmbedded` and applies the lockdown UI.

export async function generateMetadata({ params }: { params: Promise<{ tenant: string; slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return parentGenerateMetadata({ params: Promise.resolve({ id: slug }) });
}

export const preferredRegion = 'fra1';
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

export default async function EmbedBookPage({ params }: { params: Promise<{ tenant: string; slug: string }> }) {
    const { slug } = await params;

    const db = await getReadDb();
    const book = await db.collection('books').findOne(
        { $or: [{ slug }, { id: slug }], visible: true, pages_count: { $gt: 0 } },
        { projection: { _id: 1, id: 1 } }
    );

    if (!book) notFound();

    const bookId = (book as { id?: string }).id || slug;
    return <BookDetailPage params={Promise.resolve({ id: bookId })} />;
}
