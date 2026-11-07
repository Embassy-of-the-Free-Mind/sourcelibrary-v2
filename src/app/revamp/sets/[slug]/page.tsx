import { notFound } from 'next/navigation';
import CollectionTemplate from '../../_components/CollectionTemplate';
import { gallerySetModel } from '../../_lib/data';

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = gallerySetModel(slug);
  if (!m) notFound();
  return <CollectionTemplate m={m} />;
}
