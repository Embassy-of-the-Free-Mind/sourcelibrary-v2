import { Metadata } from 'next';
import { browseBooks, getLanguageCounts } from '@/lib/books-catalog';
import ScholarCatalog from '@/components/catalog/ScholarCatalog';

export const revalidate = 86400;
export const maxDuration = 30;

export const metadata: Metadata = {
  title: 'Scholar Catalog - Source Library',
  description: 'Browse the Source Library catalog in a clean bibliographic format designed for researchers and librarians.',
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
    <ScholarCatalog
      initialBooks={browseResult.books}
      initialTotal={browseResult.total}
      languages={languages}
    />
  );
}
