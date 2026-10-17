import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ArticlesPage from '../../ArticlesPage';
import { listingMetadata, pageCount } from '../../listing';

// /articles/page/2 onwards: page 1 is /articles itself.
export const dynamicParams = false;

export function generateStaticParams() {
  return Array.from({ length: pageCount('all') - 1 }, (_, i) => ({ n: String(i + 2) }));
}

export async function generateMetadata({ params }: { params: Promise<{ n: string }> }): Promise<Metadata> {
  const { n } = await params;
  return listingMetadata('all', Number(n));
}

export default async function ArticlesPageN({ params }: { params: Promise<{ n: string }> }) {
  const page = Number((await params).n);
  if (!(page >= 2 && page <= pageCount('all'))) notFound();
  return <ArticlesPage page={page} />;
}
