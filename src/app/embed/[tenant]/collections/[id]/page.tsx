import CollectionDetailPage from '@/app/collections/[id]/page';

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
