import SiteHeader from '@/components/layout/SiteHeader';
import BlogIndex from './BlogIndex';
import HeroBackdrop from './HeroBackdrop';
import { posts, LINKED_PAGES, type BlogKind } from './posts';

// The /articles index and each /articles/<category> page: one list of every
// article with search, category and sort. Dark bar and the wide container,
// like the book pages, so the content lines up with the nav and footer.
export default function ArticlesPage({ active = 'all' }: { active?: BlogKind | 'all' }) {
  const all = [...posts, ...LINKED_PAGES];
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="dark" />
      <div className="relative">
        <HeroBackdrop />
        <main className="relative max-w-[var(--container-wide)] mx-auto px-6 md:px-12 pt-14 md:pt-20 pb-24">
          <h1 className="font-serif text-5xl md:text-7xl text-primary tracking-tight">Articles</h1>
          <p className="mt-6 mb-10 max-w-3xl text-lg md:text-xl text-secondary font-body leading-relaxed">
            Stories followed through the books, reading tours, research notes and things to try. Every claim is
            grounded in primary sources from the collection.
          </p>
          <BlogIndex posts={all} active={active} />
        </main>
      </div>
    </div>
  );
}
