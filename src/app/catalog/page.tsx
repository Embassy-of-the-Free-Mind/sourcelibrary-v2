import { Metadata } from 'next';
import { unstable_cache } from 'next/cache';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import SiteHeader from '@/components/layout/SiteHeader';
import CatalogBrowser from '@/components/catalog/CatalogBrowser';
import { browseBooks, getLanguageCounts } from '@/lib/books-catalog';
import { getReadDb } from '@/lib/mongodb';

export const revalidate = 86400;
export const maxDuration = 30;

export const metadata: Metadata = {
  title: 'Catalogue - Source Library',
  description: 'Browse the complete Source Library catalogue: thousands of translated primary sources in alchemy, philosophy, theology, and the esoteric traditions.',
  alternates: { canonical: '/catalog' },
};

async function getCollectionName(slug: string): Promise<string | null> {
  try {
    const db = await getReadDb();
    const c = await db.collection('collections').findOne({ slug }, { projection: { name: 1 } });
    return (c?.name as string) || null;
  } catch {
    return null;
  }
}

async function getCollections(): Promise<{ slug: string; name: string }[]> {
  try {
    const db = await getReadDb();
    const rows = await db.collection('collections')
      .find({ hidden: { $ne: true }, name: { $type: 'string' }, book_count: { $gt: 0 } }, { projection: { _id: 0, slug: 1, name: 1 } })
      .sort({ name: 1 }).limit(1000).toArray();
    return rows.map((r) => ({ slug: r.slug as string, name: r.name as string })).filter((r) => r.slug && r.name);
  } catch {
    return [];
  }
}

// The page reads `collection` from the URL, so it renders per request and the
// `revalidate` above never applies; uncached, every visit re-ran these two
// queries over the whole catalogue (~5s). An hour-old book list is fine here.
// The error fallbacks below sit OUTSIDE the cached functions, so a failed query
// is never stored as an empty catalogue.
const getBrowse = (collection?: string) =>
  unstable_cache(
    () => browseBooks({ sort: 'popular', limit: 60, collection }),
    ['catalog-browse-v1', collection || 'all'],
    { revalidate: 3600 },
  )();

const getLanguages = (collection?: string) =>
  unstable_cache(
    () => getLanguageCounts({ collection }),
    ['catalog-languages-v1', collection || 'all'],
    { revalidate: 3600 },
  )();

export default async function CatalogPage(
  { searchParams }: { searchParams: Promise<{ collection?: string }> },
) {
  const { collection } = await searchParams;

  const [browseResult, languages, collectionName, collections] = await Promise.all([
    getBrowse(collection).catch((err) => {
      console.error('[catalog] browseBooks failed:', err?.message || err);
      return { books: [], total: 0 };
    }),
    getLanguages(collection).catch((err) => {
      console.error('[catalog] getLanguageCounts failed:', err?.message || err);
      return [];
    }),
    collection ? getCollectionName(collection) : Promise.resolve(null),
    getCollections(),
  ]);
  const { books, total } = browseResult;

  return (
    <>
      <SiteHeader variant="light" />
      <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-12 md:py-20">
        {collection && (
          <Link href={`/collections/${collection}`} className="inline-flex items-center gap-1 text-sm text-accent-rust hover:opacity-70 transition-opacity mb-4">
            <ArrowLeft className="w-4 h-4" /> Back to {collectionName || collection}
          </Link>
        )}
        <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
          {collection ? (collectionName || 'Collection') : 'Catalog'}
        </h1>
        <p className="text-lg mb-10" style={{ color: 'var(--text-muted)' }}>
          {collection ? 'Every book in this collection.' : 'Every book in the library.'}
        </p>

        <CatalogBrowser
          initialBooks={books}
          initialTotal={total}
          languages={languages}
          collection={collection}
          collections={collections}
        />
      </div>
    </>
  );
}
