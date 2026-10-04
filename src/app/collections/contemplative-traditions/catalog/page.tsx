import CollectionCatalogPage, {
  collectionCatalogMetadata,
  type CollectionCatalogProps,
} from '@/components/collections/CollectionCatalogPage';

// This collection has its own hand-built page, so the [id]/catalog route
// never matches it; the full crawlable list lives here instead.
const SLUG = 'contemplative-traditions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function generateMetadata({ searchParams }: Pick<CollectionCatalogProps, 'searchParams'>) {
  return collectionCatalogMetadata(SLUG, searchParams);
}

export default function Page({ searchParams }: Pick<CollectionCatalogProps, 'searchParams'>) {
  return <CollectionCatalogPage slug={SLUG} searchParams={searchParams} />;
}
