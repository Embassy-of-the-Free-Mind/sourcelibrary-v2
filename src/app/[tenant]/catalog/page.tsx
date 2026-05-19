import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import CatalogBrowser from '@/components/catalog/CatalogBrowser';
import { browseBooks, getLanguageCounts } from '@/lib/books-catalog';

export const revalidate = 86400;
export const maxDuration = 30;

export const metadata: Metadata = {
  title: 'Catalogue - Source Library',
  description: 'Browse the complete Source Library catalogue — thousands of translated primary sources in alchemy, philosophy, theology, and the esoteric traditions.',
  alternates: { canonical: '/catalog' },
};

export default async function CatalogPage() {
  const [browseResult, languages] = await Promise.all([
    browseBooks({ sort: 'popular', limit: 60 }).catch((err) => {
      console.error('[catalog] browseBooks failed:', err?.message || err);
      return { books: [], total: 0 };
    }),
    getLanguageCounts({}).catch((err) => {
      console.error('[catalog] getLanguageCounts failed:', err?.message || err);
      return [];
    }),
  ]);
  const { books, total } = browseResult;

  return (
    <>
      <SiteHeader variant="light" />
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-12 md:py-20">
        <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
          Catalog
        </h1>
        <p className="text-lg mb-10" style={{ color: 'var(--text-muted)' }}>
          Every book in the library.
        </p>

        <CatalogBrowser
          initialBooks={books}
          initialTotal={total}
          languages={languages}
        />
      </div>
    </>
  );
}
