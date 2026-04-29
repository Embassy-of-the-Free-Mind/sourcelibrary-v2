import CollectionDetailPage from '../../../../collections/[id]/page';

export const revalidate = 86400;
export const dynamicParams = true;
export const maxDuration = 60;
export async function generateStaticParams() { return []; }

/**
 * BPH embed collection detail — renders CollectionDetailPage filtered to BPH books.
 * Chrome hidden by embed layout CSS.
 */
export default async function EmbedCollectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <CollectionDetailPage params={params} provider="bph" />;
}
