import { notFound } from 'next/navigation';
import AxisPage from '../../_components/AxisPage';
import { collectionModel } from '../../_lib/data';
import { axisSlugs } from '../../_lib/axes';

const n = (v: number) => v.toLocaleString('en-GB');

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = axisSlugs().languages.includes(slug) ? collectionModel(slug) : null;
  if (!m) notFound();
  return <AxisPage m={m} scope="language" crumb={{ label: 'Languages', href: '/revamp/languages' }}
    counts={[`${n(m.stats.works)} books`]} />;
}
