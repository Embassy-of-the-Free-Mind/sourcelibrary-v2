import SearchPage from '@/app/search/page';

export const metadata = {
  title: 'Digital Catalogue — Bibliotheca Philosophica Hermetica',
  robots: { index: false, follow: false },
};

/**
 * BPH embed catalogue — renders the same search page.
 * The embed layout hides SiteHeader/footer via CSS.
 * TODO: pass library=bph as default filter once SearchPage accepts props.
 */
export default function EmbedCataloguePage() {
  return <SearchPage />;
}
