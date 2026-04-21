import { Suspense } from 'react';
import SearchPage from '@/app/search/page';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Digital Catalogue — Bibliotheca Philosophica Hermetica',
  robots: { index: false, follow: false },
};

/**
 * BPH embed catalogue — renders the same search page.
 * The embed layout hides SiteHeader/footer via CSS.
 */
export default function EmbedCataloguePage() {
  return (
    <Suspense>
      <SearchPage />
    </Suspense>
  );
}
