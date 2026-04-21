import BookDetailPage from '@/app/book/[id]/page';
export { generateMetadata } from '@/app/book/[id]/page';

export const revalidate = 86400;
export const preferredRegion = 'fra1';
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

/**
 * BPH embed book page — renders the exact same BookDetailPage.
 * Chrome (header/footer) is hidden by the embed layout's CSS.
 * The [slug] param maps to the book page's [id] param.
 */
export default async function EmbedBookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <BookDetailPage params={Promise.resolve({ id: slug })} />;
}
