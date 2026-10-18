import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ArticlesPage from '../ArticlesPage';
import { BLOG_KINDS } from '../posts';
import { isKind, listingMetadata } from '../listing';

// One page per category (/articles/tours). Articles themselves are static
// folders beside this one, which Next matches first, so a category name must
// never also be an article slug (tests/blog-posts.test.ts).
export const dynamicParams = false;

export function generateStaticParams() {
  return BLOG_KINDS.map((category) => ({ category }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  return isKind(category) ? listingMetadata(category) : {};
}

export default async function ArticlesCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  if (!isKind(category)) notFound();
  return <ArticlesPage active={category} />;
}
