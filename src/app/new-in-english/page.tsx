import type { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import { getNewInEnglish } from '@/lib/new-in-english';

// ISR, a real number and never `false`: the Supabase read can fail, and `false`
// would freeze whatever rendered. No try/catch on purpose: a throw makes ISR
// keep serving the last good page (rendering-and-seo.md).
export const revalidate = 3600;

const DESCRIPTION = 'Books that became readable in English in the last few weeks, newest first.';

export const metadata: Metadata = {
  title: 'New in English | Source Library',
  description: DESCRIPTION,
  alternates: { canonical: '/new-in-english' },
  openGraph: { title: 'New in English | Source Library', description: DESCRIPTION, type: 'website' },
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

export default async function NewInEnglishPage() {
  const weeks = await getNewInEnglish();
  const total = weeks.reduce((n, w) => n + w.bookCount, 0);
  const latest = weeks[0];

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="New in English"
          subtitle={
            latest.bookCount > 0
              ? `${latest.bookCount.toLocaleString('en')} books became readable in English in the past seven days.`
              : DESCRIPTION
          }
          backHref="/"
          backLabel="Home"
        />
      }
      bg="bg-cream"
    >
      {total === 0 && <p className="text-stone-500">Nothing new has been added in the last four weeks.</p>}
      {weeks.map((w, i) =>
        w.works.length === 0 ? null : (
          <section key={w.from} className="mb-14">
            <h2 className="font-display text-2xl text-primary mb-1">
              {i === 0 ? 'This week' : i === 1 ? 'Last week' : `${fmt(w.from)} to ${fmt(w.to)}`}
            </h2>
            <p className="text-muted mb-6">
              {fmt(w.from)} to {fmt(w.to)} · {w.bookCount.toLocaleString('en')} {w.bookCount === 1 ? 'book' : 'books'}
              {w.works.length !== w.bookCount && ` in ${w.works.length.toLocaleString('en')} works`}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6">
              {w.works.map(({ lead, volumes, pagesTranslated }) => (
                <div key={lead.id}>
                  <CollectionBookCard book={lead as unknown as CollectionBook} />
                  <p className="mt-2 text-xs text-muted">
                    {[
                      lead.language,
                      volumes > 1 ? `${volumes} volumes` : null,
                      `${pagesTranslated.toLocaleString('en')} pages in English`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ),
      )}
    </ContentPageLayout>
  );
}
