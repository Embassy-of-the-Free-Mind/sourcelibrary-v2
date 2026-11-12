import { notFound } from 'next/navigation';
import AxisPage from '../../_components/AxisPage';
import { collectionModel } from '../../_lib/data';
import { axisSlugs, languageGroups } from '../../_lib/axes';
import { howLanguages } from '../../_lib/how';

const n = (v: number) => v.toLocaleString('en-GB');

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = axisSlugs().languages.includes(slug) ? collectionModel(slug) : null;
  if (!m) notFound();
  return <AxisPage m={m} scope="language" how={howLanguages(languageGroups().values, languageGroups().unmatched)} crumb={{ label: 'Languages', href: '/revamp/languages' }}
    counts={[`${n(m.stats.works)} books`]} />;
}
