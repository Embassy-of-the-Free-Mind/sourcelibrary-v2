import { notFound } from 'next/navigation';
import CollectionTemplate from '../../_components/CollectionTemplate';
import CollectionBasic from '../../_components/CollectionBasic';
import { collectionModel } from '../../_lib/data';
import { demoModel } from '../../_lib/demos';
import { HAND_MADE } from '../../_data/maker-demo';

/** Mycology and Slime Moulds keep their hand-made page; every other collection gets the base page. ?v=old shows the earlier template. */
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ v?: string; act?: string; tone?: string }> }) {
  const { slug } = await params;
  const { v, act, tone } = await searchParams;
  const demo = demoModel(slug);
  const m = demo ?? collectionModel(slug);
  if (!m) notFound();
  if (demo || HAND_MADE.includes(slug) || v === 'old' || m.opensOn === 'artworks') return <CollectionTemplate m={m} />;
  return <CollectionBasic m={m} act={act} tone={tone} />;
}
