import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogIndex from './BlogIndex';
import { posts, LINKED_PAGES, type BlogKind } from './posts';

// The /articles index and each /articles/<category> page: same header, same
// chip row, with the chosen category open. Dark bar and the wide container,
// like the book pages, so the content lines up with the nav and footer.
export default function ArticlesPage({ active = 'all' }: { active?: BlogKind | 'all' }) {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Articles"
          subtitle="Stories followed through the books, reading tours, research notes and things to try. Every claim is grounded in primary sources from the collection."
          image="https://images.sourcelibrary.org/archived/699065973dc2ed39a49f1e71/4.jpg"
          imageAlt="The Fountain of Hermes from the Ripley Scroll, Bodleian Library, c. 1450"
          maxWidth="wide"
          headerVariant="dark"
        />
      }
      maxWidth="wide"
      bg="bg-cream"
    >
      <BlogIndex posts={[...posts, ...LINKED_PAGES]} active={active} />
    </ContentPageLayout>
  );
}
