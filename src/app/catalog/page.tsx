import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import CatalogBrowser from '@/components/catalog/CatalogBrowser';
import { browseBooks, getLanguageCounts } from '@/lib/books-catalog';

export const revalidate = false;

export const metadata: Metadata = {
  title: 'Catalog - Source Library',
  description: 'Browse the complete Source Library catalog — thousands of translated primary sources in alchemy, philosophy, theology, and the esoteric traditions.',
  alternates: { canonical: '/catalog' },
};

export default async function CatalogPage() {
  const [{ books, total }, languages] = await Promise.all([
    browseBooks({ hasTranslation: true, sort: 'popular', limit: 60 }),
    getLanguageCounts({}),
  ]);

  return (
    <>
      <SiteHeader variant="light" />
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-12 md:py-20">
        <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
          Catalog
        </h1>
        <p className="text-lg mb-10" style={{ color: 'var(--text-muted)' }}>
          Every translated book in the library.
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
