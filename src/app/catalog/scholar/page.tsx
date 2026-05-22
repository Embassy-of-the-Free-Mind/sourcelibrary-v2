import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import ScholarCatalog from '@/components/catalog/ScholarCatalog';
import { browseBooks, getLanguageCounts } from '@/lib/books-catalog';

export const revalidate = 86400;
export const maxDuration = 30;

export const metadata: Metadata = {
  title: 'Scholar Catalogue - Source Library',
  description: 'Browse the Source Library catalogue in a clean bibliographic format designed for researchers and librarians.',
  alternates: { canonical: '/catalog/scholar' },
};

export default async function ScholarCatalogPage() {
  const [browseResult, languages] = await Promise.all([
    browseBooks({ sort: 'title', limit: 60 }).catch((err) => {
      console.error('[scholar-catalog] browseBooks failed:', err?.message || err);
      return { books: [], total: 0 };
    }),
    getLanguageCounts({}).catch((err) => {
      console.error('[scholar-catalog] getLanguageCounts failed:', err?.message || err);
      return [];
    }),
  ]);

  return (
    <>
      <SiteHeader variant="light" />
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-12 md:py-20">
        <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
          Catalog
        </h1>
        <p className="text-lg mb-10" style={{ color: 'var(--text-muted)' }}>
          {browseResult.total.toLocaleString('en-US')} works. Bibliographic records with permalinks, OCR status, and translation coverage.
        </p>

        <ScholarCatalog
          initialBooks={browseResult.books}
          initialTotal={browseResult.total}
          languages={languages}
        />
      </div>
    </>
  );
}
