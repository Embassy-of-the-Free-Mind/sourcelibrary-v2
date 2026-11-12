import { notFound } from 'next/navigation';
import AxisPage from '../../_components/AxisPage';
import { collectionModel } from '../../_lib/data';
import { centuryName, centuryOfSlug } from '../../_lib/axes';

const n = (v: number) => v.toLocaleString('en-GB');

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = centuryOfSlug(slug);
  const m = c && collectionModel(slug);
  if (!c || !m) notFound();
  return <AxisPage m={m} scope="period" crumb={{ label: 'Centuries', href: '/revamp/periods' }}
    counts={[`${n(c.total)} ${c.total === 1 ? 'book' : 'books'}`, centuryName(c.from)]} />;
}
