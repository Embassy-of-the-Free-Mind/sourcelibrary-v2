import { notFound } from 'next/navigation';
import CollectionTemplate from '../../_components/CollectionTemplate';
import { collectionModel } from '../../_lib/data';
import { demoModel } from '../../_lib/demos';

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = demoModel(slug) ?? collectionModel(slug);
  if (!m) notFound();
  return <CollectionTemplate m={m} />;
}
