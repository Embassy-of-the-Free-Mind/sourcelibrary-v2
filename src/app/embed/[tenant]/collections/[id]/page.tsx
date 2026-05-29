import CollectionDetailPage from '@/app/collections/[id]/page';

// Iframe-target wrapper. Partner Webflow sites loaded with
// data-collection="<slug>" point iframes at
// `${BASE_URL}/embed/${tenant}/collections/${slug}` (see public/embed/v1.js).

export const revalidate = 86400;
export const dynamicParams = true;
export const maxDuration = 60;
export async function generateStaticParams() { return []; }

export default async function EmbedCollectionDetailPage({
    params,
}: {
    params: Promise<{ tenant: string; id: string }>;
}) {
    const { tenant, id } = await params;
    return <CollectionDetailPage params={Promise.resolve({ id })} provider={tenant} />;
}
