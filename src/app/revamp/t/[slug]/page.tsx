import { notFound } from 'next/navigation';
import AxisPage from '../../_components/AxisPage';
import { collectionModel } from '../../_lib/data';
import { typeOfSlug } from '../../_lib/axes';

const n = (v: number) => v.toLocaleString('en-GB');

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = typeOfSlug(slug);
  const m0 = t && collectionModel(slug);
  if (!t || !m0) notFound();
  const m = { ...m0, name: t.map.label };
  const pictures = t.kind === 'picture';
  const term = t.map.terms[0];
  const sub = term && (
    <p>{pictures ? 'Getty Art & Architecture Thesaurus' : t.map.terms[0].scheme === 'LCGFT' ? 'Library of Congress genre and form terms' : 'Getty Art & Architecture Thesaurus'}: <a href={term.uri} className="underline underline-offset-[3px] decoration-white/50 hover:decoration-white">{term.label}</a></p>
  );
  // Text types have no pictures saved: the wall shows the books' own first pages.
  const tiles = pictures ? undefined : m.all.map((b) => b.thumbnail_blob || b.thumbnail).filter(Boolean) as string[];
  return <AxisPage m={m} scope="type" pictures={pictures} tiles={tiles} crumb={{ label: 'Types', href: '/revamp/types' }} sub={sub}
    counts={[pictures ? `${n(t.total)} pictures` : `${n(t.total)} books`, pictures ? t.map.kind : 'Text']} />;
}
