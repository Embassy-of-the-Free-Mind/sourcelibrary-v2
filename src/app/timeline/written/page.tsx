import Link from 'next/link';
import type { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ExploreTabBar from '@/components/explore/ExploreTabBar';
import { getReadDb } from '@/lib/mongodb';
import { siteOgImage } from '@/lib/og-locale';
import { fetchCenturyOverview } from '@/lib/work-timeline';
import { centuryLabel, centurySlug } from '@/lib/work-dates';

// ISR, a real number and no try/catch (rendering-and-seo.md): if the read
// fails, ISR keeps serving the last good page and src/app/error.tsx covers a
// cold failure. The read is every live dated book, ~2 s, so never per request.
export const revalidate = 21600;
export const maxDuration = 60;

const TITLE = 'Works by century | Source Library';
const DESCRIPTION =
  'The works in the library, placed in the century they were written: from Sumerian hymns to the nineteenth century, each linked to the edition you can read.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: 'https://sourcelibrary.org/timeline/written',
    siteName: 'Source Library',
    type: 'website',
    images: [siteOgImage('en')],
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [siteOgImage('en')] },
};

const nf = new Intl.NumberFormat('en-US');

export default async function WorksByCenturyPage() {
  const { centuries, totals } = await fetchCenturyOverview(await getReadDb());
  const max = Math.max(1, ...centuries.map((c) => c.works));
  const sourcedPct = totals.works > 0 ? Math.round((totals.sourcedWorks / totals.works) * 100) : 0;

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          maxWidth="wide"
          title="Works by century"
          subtitle={`${nf.format(totals.works)} works, each placed in the century it was written.`}
        >
          <div className="mt-5">
            <ExploreTabBar />
          </div>
        </ContentHeader>
      }
      maxWidth="wide"
      bg="bg-cream"
    >
      {/* Composed in JS, not interpolated mid-sentence: a `{expr}` loses the
          space beside it when the line wraps (see src/app/works/page.tsx). */}
      <div className="max-w-2xl space-y-3 text-[15px] leading-relaxed text-stone-600 mb-10">
        <p>
          {'A work sits in the century it was written, not the century of the copy we hold: the Herodotus printed in Venice in 1502 is listed in the 5th century BCE. For when the books themselves were printed or copied, see the '}
          <Link href="/timeline" className="text-accent-rust hover:underline">printing timeline</Link>.
        </p>
        <p>
          {`${sourcedPct}% of these dates come from a record: Wikidata, the author’s recorded dates, or the book’s own colophon or title page. They are marked “sourced”. The rest are estimates, marked “estimated”, and nearly all give a one-line reason. An estimate can be a wide range, and the range is shown beside each work.`}
        </p>
      </div>

      <ol className="divide-y divide-border-light">
        {centuries.map((c) => (
          <li key={c.century}>
            <Link
              href={`/timeline/written/${centurySlug(c.century)}`}
              className="group grid grid-cols-[8.5rem_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)_16rem] items-center gap-x-4 gap-y-1 py-3"
            >
              <span className="font-serif text-[17px] text-stone-800 group-hover:text-stone-950">
                {centuryLabel(c.century)}
              </span>
              <span className="relative h-2 rounded-full bg-stone-200" role="presentation">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-stone-500 group-hover:bg-stone-700"
                  style={{ width: `${Math.max(0.6, (c.works / max) * 100)}%` }}
                />
              </span>
              <span className="col-start-2 sm:col-start-auto text-sm text-stone-500">
                {`${nf.format(c.works)} ${c.works === 1 ? 'work' : 'works'}`}
                {c.readableWorks > 0 ? ` · ${nf.format(c.readableWorks)} in English` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </ContentPageLayout>
  );
}
