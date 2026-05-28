import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveTenantId } from '@/lib/tenant-context';
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

    return (
        <BookDetailPage
            params={Promise.resolve({ id: slug })}
            tenantContext={{ id: tenantId, slug: tenant, kind: 'subdomain', isEmbedded: true, source: 'embed-path' }}
        />
    );
}
