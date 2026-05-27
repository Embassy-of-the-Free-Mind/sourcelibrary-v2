import GuidePage from '@/app/book/[id]/guide/page';

export const revalidate = 86400;

export default async function EmbedGuidePage({
  params,
}: {
  params: Promise<{ tenant: string; slug: string }>;
}) {
  const { slug } = await params;
  return <GuidePage params={Promise.resolve({ id: slug })} />;
}
