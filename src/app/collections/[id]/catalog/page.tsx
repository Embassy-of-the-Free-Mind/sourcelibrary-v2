import CollectionCatalogPage, {
  collectionCatalogMetadata,
  type CollectionCatalogProps,
} from '@/components/collections/CollectionCatalogPage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function generateMetadata({ params, searchParams }: CollectionCatalogProps) {
  return collectionCatalogMetadata((await params).id, searchParams);
}

export default async function Page({ params, searchParams }: CollectionCatalogProps) {
  return <CollectionCatalogPage slug={(await params).id} searchParams={searchParams} />;
}
