import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ArticlesPage from '../../../ArticlesPage';
import { BLOG_KINDS } from '../../../posts';
import { isKind, listingMetadata, pageCount } from '../../../listing';

// /articles/<category>/page/2 onwards, for categories longer than one page.
export const dynamicParams = false;

export function generateStaticParams() {
  return BLOG_KINDS.flatMap((category) =>
    Array.from({ length: pageCount(category) - 1 }, (_, i) => ({ category, n: String(i + 2) })),
  );
}

export async function generateMetadata({ params }: { params: Promise<{ category: string; n: string }> }): Promise<Metadata> {
  const { category, n } = await params;
  return isKind(category) ? listingMetadata(category, Number(n)) : {};
}

export default async function ArticlesCategoryPageN({ params }: { params: Promise<{ category: string; n: string }> }) {
  const { category, n } = await params;
  const page = Number(n);
  if (!isKind(category) || !(page >= 2 && page <= pageCount(category))) notFound();
  return <ArticlesPage active={category} page={page} />;
}
