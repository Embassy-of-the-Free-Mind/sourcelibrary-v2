import BookOverviewPage from '@/app/book/[id]/overview/page';

export const revalidate = 86400;

export default async function EmbedOverviewPage({
  params,
}: {
  params: Promise<{ tenant: string; slug: string }>;
}) {
  const { tenant, slug } = await params;
  return <BookOverviewPage params={Promise.resolve({ tenant, id: slug })} />;
}
