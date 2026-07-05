import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveTenantId } from '@/lib/tenant-context';
import { getReadDb } from '@/lib/mongodb';
import { isInnerCircle } from '@/lib/auth-helpers';
import CatalogueUnavailable from '@/components/embed/CatalogueUnavailable';
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
    const { tenant, slug } = await params;
    const tenantId = await resolveTenantId(tenant);

    if (!tenantId) notFound();

    // The catalogue must never dead-end. A hidden/unpublished book that is still
    // catalogued (imported-but-unprocessed holdings, or an item held back for
    // rights review) would otherwise soft-404 at the reader's visibility gate.
    // Instead, render a graceful "catalogued, not yet available" landing with a
    // "New search" link. Editors keep their hidden-book preview.
    const db = await getReadDb();
    const book = await db.collection('books').findOne(
        { $or: [{ slug }, { id: slug }] },
        { projection: { visible: 1 } },
    );
    if (book && book.visible === false && !(await isInnerCircle())) {
        return (
            <CatalogueUnavailable
                heading="Not yet available to read"
                detail="This item is catalogued but not currently available to read online in this reading room. Browse the catalogue to find related works."
            />
        );
    }

    return (
        <BookDetailPage
            params={Promise.resolve({ id: slug })}
            tenantContext={{ id: tenantId, slug: tenant, isEmbedded: true, source: 'embed-path' }}
        />
    );
}
