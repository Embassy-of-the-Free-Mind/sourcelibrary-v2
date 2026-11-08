import { notFound } from 'next/navigation';
import { collectionModel } from '../../_lib/data';
import ThumbMaker from '../../_components/ThumbMaker';

/** What a maker sees when choosing the collection's square thumbnail. Saved in this browser only. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = collectionModel(slug);
  if (!m) notFound();
  const am = m.askMedia && 'plate' in m.askMedia ? m.askMedia : null;
  const covers = m.books.map((b) => b.thumbnail_blob || b.thumbnail).filter(Boolean) as string[];
  const plates = m.plates.map((p) => p.src);
  const suggested = [...new Set([am?.fallback || am?.plate, m.introPlate?.src, m.heroImage, ...plates.slice(2, 12).filter((_x, i) => i % 3 === 0), covers[0]].filter(Boolean) as string[])].slice(0, 6);
  const all = [...new Set([...plates.slice(0, 48), ...covers.slice(0, 24)])];
  return <ThumbMaker slug={m.slug} name={m.name} suggested={suggested} all={all} />;
}
