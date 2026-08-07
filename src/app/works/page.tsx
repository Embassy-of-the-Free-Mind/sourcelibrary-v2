import Link from 'next/link';
import type { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { fetchWorksIndex, type WorkSummary } from '@/lib/works-index';
import { formatYear } from '@/lib/format-year';

// ISR. Deliberately a real number, never `false`: the aggregation below can
// fail, and `false` would cache whatever rendered — permanently, until the next
// deploy (the #2973 pattern that froze /explore/timeline). There is also no
// try/catch here on purpose. Letting it throw means ISR keeps serving the last
// good page, and src/app/error.tsx covers a cold failure.
export const revalidate = 86400;

const DESCRIPTION =
  'Works held in several editions across several centuries — the same text as manuscript, early printing, and modern edition, each one readable page by page.';

export const metadata: Metadata = {
  title: 'Works | Source Library',
  description: DESCRIPTION,
  alternates: { canonical: '/works' },
  openGraph: { title: 'Works | Source Library', description: DESCRIPTION, type: 'website' },
};

/** Shared timeline scale, so every bar is comparable across the page. */
function scale(works: WorkSummary[]) {
  const min = Math.min(...works.map(w => w.earliest));
  const max = Math.max(...works.map(w => w.latest));
  const range = Math.max(1, max - min);
  return {
    min,
    max,
    left: (w: WorkSummary) => ((w.earliest - min) / range) * 100,
    width: (w: WorkSummary) => Math.max(0.8, ((w.latest - w.earliest) / range) * 100),
  };
}

export default async function WorksPage() {
  const works = await fetchWorksIndex();

  if (works.length === 0) {
    return (
      <ContentPageLayout header={<ContentHeader title="Works" subtitle={DESCRIPTION} />} bg="bg-cream">
        <p className="text-stone-500">No multi-edition works are available right now.</p>
      </ContentPageLayout>
    );
  }

  const s = scale(works);
  const longRange = works.filter(w => w.span > 500).length;

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Works"
          subtitle={`${works.length} works held in three or more editions, from ${formatYear(s.min)} to ${formatYear(s.max)}.`}
        />
      }
      bg="bg-cream"
    >
      {/* Composed in JS, not interpolated into JSX: a `{expr}` mid-sentence loses
          the space next to it once the line wraps, which shipped as "32of them". */}
      <p className="text-sm text-stone-500 mb-10 max-w-2xl">
        {`A printed edition is one moment in a text’s life. These are the works we hold enough of to watch travel: ${longRange} of them span more than five centuries, as manuscript, early printing and modern edition together. The bar shows each work’s range against the whole collection.`}
      </p>

      <ol className="divide-y divide-border-light">
        {works.map((w) => (
          <li key={w.workId}>
            <Link
              href={`/work/${w.slug}`}
              className="group grid grid-cols-1 gap-2 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:items-center sm:gap-8"
            >
              <div className="min-w-0">
                <h2 className="font-serif text-lg leading-snug text-stone-800 group-hover:text-stone-950">
                  {w.title}
                </h2>
                <p className="mt-1 truncate text-sm text-stone-500">
                  {w.author ? `${w.author} · ` : ''}
                  {w.witnesses} {w.witnesses === 1 ? 'witness' : 'witnesses'}
                  {w.languages.length > 0 ? ` · ${w.languages.slice(0, 3).join(', ')}` : ''}
                  {w.libraries.length > 1 ? ` · ${w.libraries.length} libraries` : ''}
                </p>
              </div>

              <div>
                <div className="flex items-baseline justify-between text-xs text-stone-500">
                  <span>{formatYear(w.earliest)}</span>
                  <span className="text-stone-400">
                    {w.span > 0 ? `${w.span} years` : 'one year'}
                  </span>
                  <span>{formatYear(w.latest)}</span>
                </div>
                {/* Span on a shared scale — the point of the page is the gap. */}
                <div
                  className="relative mt-1.5 h-1 w-full rounded-full bg-stone-200"
                  role="presentation"
                >
                  <div
                    className="absolute inset-y-0 rounded-full bg-stone-500 transition-colors group-hover:bg-stone-700"
                    style={{ left: `${s.left(w)}%`, width: `${s.width(w)}%` }}
                  />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </ContentPageLayout>
  );
}
