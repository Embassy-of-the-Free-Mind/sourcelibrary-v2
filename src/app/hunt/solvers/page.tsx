import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { getReadDb } from '@/lib/mongodb';
import { DEFAULT_CHAIN, HUNT_SOLVERS_COLLECTION } from '@/lib/hunt';

export const metadata: Metadata = {
  title: 'Solvers of the hunt - Source Library',
  description: 'Readers who solved all seven riddles of the Source Library hunt.',
  alternates: { canonical: '/hunt/solvers' },
};

// A real window, never `false`: if the read fails the error throws and ISR keeps
// the last good page (rendering-and-seo.md), rather than freezing an empty list.
export const revalidate = 300;

interface SolverRow {
  finished_at: Date;
  name: string | null;
  name_status: string | null;
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default async function SolversPage() {
  const rows = await (await getReadDb())
    .collection<SolverRow>(HUNT_SOLVERS_COLLECTION)
    .find({ chain: DEFAULT_CHAIN }, { projection: { _id: 0, finished_at: 1, name: 1, name_status: 1 } })
    .sort({ finished_at: 1 })
    .limit(1000)
    .toArray();

  return (
    <ContentPageLayout
      header={<ContentHeader title="Solvers" subtitle="Readers who solved all seven riddles" />}
      bg="bg-cream"
    >
      <div className="prose-content max-w-none space-y-6 text-secondary leading-relaxed">
        {rows.length === 0 ? (
          <p>Nobody has solved it yet. <Link href="/hunt" className="text-accent-rust hover:underline">Start here</Link>.</p>
        ) : (
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li key={i}>
                {r.name && r.name_status === 'approved' ? r.name : 'A reader'}, {DATE.format(new Date(r.finished_at))}
              </li>
            ))}
          </ol>
        )}
        <p>
          Names appear only when the solver chose to show one, after a librarian has seen it.{' '}
          <Link href="/hunt" className="text-accent-rust hover:underline">The hunt</Link>.
        </p>
      </div>
    </ContentPageLayout>
  );
}
