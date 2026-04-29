import { Suspense } from 'react';
import Link from 'next/link';
import { Library } from 'lucide-react';
import SearchPage from '@/app/[tenant]/search/page';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Digital Catalogue — Bibliotheca Philosophica Hermetica',
  robots: { index: false, follow: false },
};

/**
 * BPH embed catalogue — renders the same search page, filtered to BPH books.
 * The embed layout hides SiteHeader/footer via CSS.
 */
export default function EmbedCataloguePage() {
  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-2">
        <Link
          href="/catalog"
          className="inline-flex items-center gap-2 text-sm text-secondary hover:text-accent-rust transition-colors border border-border-light rounded-md px-3 py-1.5 hover:bg-warm"
        >
          <Library className="w-4 h-4" />
          Browse Full Catalog (27,000+ works)
        </Link>
      </div>
      <Suspense>
        <SearchPage defaultLibrary="bph" />
      </Suspense>
    </>
  );
}
