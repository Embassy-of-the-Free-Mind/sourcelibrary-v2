import SiteHeader from '@/components/layout/SiteHeader';
import { BASE_URL } from '@/components/seo/schema-utils';
import { jsonLdHtml } from '@/lib/json-ld';
import BlogIndex from './BlogIndex';
import HeroBackdrop from './HeroBackdrop';
import { postHref } from './posts';
import { ALL_ARTICLES, PAGE_SIZE, listed, listingHref, type Listing } from './listing';

// The /articles index, each /articles/<category> page and their /page/N
// routes: one list of every article with search, category and sort. Dark bar
// and the wide container, like the book pages, so the content lines up with
// the nav and footer.
export default function ArticlesPage({ active = 'all', page = 1 }: { active?: Listing; page?: number }) {
  // The articles this route shows before any search, as an ItemList.
  const items = listed(active).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    url: `${BASE_URL}${listingHref(active, page)}`,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: items.map((p, i) => ({
        '@type': 'ListItem',
        position: (page - 1) * PAGE_SIZE + i + 1,
        url: `${BASE_URL}${postHref(p)}`,
        name: p.title,
      })),
    },
  };

  return (
    <div className="min-h-screen bg-cream">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(itemList) }} />
      <SiteHeader variant="dark" />
      <div className="relative">
        <HeroBackdrop />
        <main className="relative max-w-[var(--container-wide)] mx-auto px-6 md:px-12 pt-14 md:pt-20 pb-24">
          <BlogIndex posts={ALL_ARTICLES} active={active} initialPage={page} />
        </main>
      </div>
    </div>
  );
}
