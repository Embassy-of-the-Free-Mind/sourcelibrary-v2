import { Metadata } from 'next';
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
  description: 'Browse the complete Source Library catalogue — thousands of translated primary sources in alchemy, philosophy, theology, and the esoteric traditions.',
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

export default async function CatalogPage(
  { searchParams }: { searchParams: Promise<{ collection?: string }> },
) {
  const { collection } = await searchParams;

  const [browseResult, languages, collectionName] = await Promise.all([
    browseBooks({ sort: 'popular', limit: 60, collection }).catch((err) => {
      console.error('[catalog] browseBooks failed:', err?.message || err);
      return { books: [], total: 0 };
    }),
    getLanguageCounts({ collection }).catch((err) => {
      console.error('[catalog] getLanguageCounts failed:', err?.message || err);
      return [];
    }),
    collection ? getCollectionName(collection) : Promise.resolve(null),
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
        />
      </div>
    </>
  );
}
