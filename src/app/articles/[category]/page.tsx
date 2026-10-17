import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ArticlesPage from '../ArticlesPage';
import { BLOG_KINDS, KIND_INFO, type BlogKind } from '../posts';

// One page per category (/articles/tours). Articles themselves are static
// folders beside this one, which Next matches first, so a category name must
// never also be an article slug (tests/blog-posts.test.ts).
export const dynamicParams = false;

export function generateStaticParams() {
  return BLOG_KINDS.map((category) => ({ category }));
}

function isKind(value: string): value is BlogKind {
  return (BLOG_KINDS as readonly string[]).includes(value);
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  if (!isKind(category)) return {};
  const info = KIND_INFO[category];
  return {
    title: `${info.label} - Articles - Source Library`,
    description: info.definition,
    alternates: { canonical: `/articles/${category}` },
  };
}

export default async function ArticlesCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  if (!isKind(category)) notFound();
  return <ArticlesPage active={category} />;
}
