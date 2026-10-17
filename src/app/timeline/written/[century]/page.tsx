import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { getReadDb } from '@/lib/mongodb';
import { siteOgImage } from '@/lib/og-locale';
import { bookUrl } from '@/lib/slugify';
import { fetchCenturyWorks, type CenturyWork } from '@/lib/work-timeline';
import { TIER_IMAGES_ONLY, TIER_PARTLY_TRANSLATED, TIER_READABLE, TIER_TEXT_ONLY } from '@/lib/search/readable-edition';
import { centuryLabel, centuryRange, centurySlug, parseCenturySlug } from '@/lib/work-dates';

// ISR per century, a real number and no try/catch (rendering-and-seo.md).
// No loading.tsx in this segment, so notFound() below is a real 404.
export const revalidate = 21600;
export const maxDuration = 60;

/** Per section. The 16th century alone holds ~4,000 works; the rest are one click away in /search. */
const SHOWN = 300;
/**
 * A work dated only to a window wider than this sits in the century of the
 * window's middle (a Bible estimated "c. 1000 BCE–100 CE" lands in the 5th
 * century BCE). Listed apart, so a reader does not take the placement for a date.
 */
const BROAD_SPAN = 300;

type Params = { century: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const century = parseCenturySlug((await params).century);
  if (century === null) return {};
  const label = centuryLabel(century);
  const title = `Works written in the ${label} | Source Library`;
  const description = `Works in the library written in the ${label}, each linked to the edition you can read, with where its date comes from.`;
  return {
    title,
    description,
    openGraph: {
      title, description, type: 'website', siteName: 'Source Library',
      url: `https://sourcelibrary.org/timeline/written/${centurySlug(century)}`,
      images: [siteOgImage('en')],
    },
    twitter: { card: 'summary_large_image', title, description, images: [siteOgImage('en')] },
  };
}

const nf = new Intl.NumberFormat('en-US');

const STATUS: Record<number, string> = {
  [TIER_READABLE]: 'Readable in English',
  [TIER_PARTLY_TRANSLATED]: 'Partly translated',
  [TIER_TEXT_ONLY]: 'Original text, not yet translated',
  [TIER_IMAGES_ONLY]: 'Page images only',
};

function WorkRow({ w }: { w: CenturyWork }) {
  const meta = [w.book.author, w.book.language].filter(Boolean).join(' · ');
  const copy = w.book.year ? `this copy ${w.book.year}` : w.book.published ? `this copy ${w.book.published}` : '';
  return (
    <li className="py-4">
      <Link href={bookUrl(w.book)} className="font-serif text-[17px] leading-snug text-stone-800 hover:text-stone-950 hover:underline">
        {w.book.title}
      </Link>
      {meta && <p className="mt-0.5 text-sm text-stone-500 truncate">{meta}</p>}
      <p className="mt-1 text-sm text-stone-600">
        <span>{`Written ${w.display}`}</span>
        <span
          className={`ml-2 rounded px-1.5 py-0.5 text-xs ${w.basis.sourced ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}
        >
          {w.basis.sourced ? 'sourced' : 'estimated'}
        </span>
      </p>
      {w.basis.note && <p className="mt-0.5 text-[13px] text-stone-500">{w.basis.note}</p>}
      <p className="mt-1 text-[13px] text-stone-500">
        {[
          STATUS[w.tier] ?? '',
          copy,
          w.editions > 1 ? `${w.editions} editions held` : '',
        ].filter(Boolean).join(' · ')}
      </p>
    </li>
  );
}

export default async function CenturyPage({ params }: { params: Promise<Params> }) {
  const century = parseCenturySlug((await params).century);
  if (century === null) notFound();

  const { works, books } = await fetchCenturyWorks(await getReadDb(), century);
  if (works.length === 0) notFound();

  const label = centuryLabel(century);
  const { from, to } = centuryRange(century);
  const broad = works.filter((w) => (w.span ?? 0) > BROAD_SPAN);
  const dated = works.filter((w) => (w.span ?? 0) <= BROAD_SPAN);
  const readable = dated.filter((w) => w.tier === TIER_READABLE);
  const rest = dated.filter((w) => w.tier !== TIER_READABLE);
  const readableTotal = works.filter((w) => w.tier === TIER_READABLE).length;
  const sourced = works.filter((w) => w.basis.sourced).length;
  const searchHref = `/search?work_from=${from}&work_to=${to}`;

  const prev = century === 1 ? -1 : century - 1;
  const next = century === -1 ? 1 : century + 1;

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          maxWidth="standard"
          title={`Written in the ${label}`}
          subtitle={`${nf.format(works.length)} ${works.length === 1 ? 'work' : 'works'} in ${nf.format(books)} ${books === 1 ? 'book' : 'books'}, ${nf.format(readableTotal)} readable in English.`}
        />
      }
      bg="bg-cream"
    >
      <nav className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <Link href="/timeline/written" className="text-accent-rust hover:underline">All centuries</Link>
        <Link href={`/timeline/written/${centurySlug(prev)}`} className="text-stone-500 hover:text-stone-800">{`← ${centuryLabel(prev)}`}</Link>
        <Link href={`/timeline/written/${centurySlug(next)}`} className="text-stone-500 hover:text-stone-800">{`${centuryLabel(next)} →`}</Link>
      </nav>

      <p className="max-w-2xl text-[15px] leading-relaxed text-stone-600 mb-10">
        {`Each work is listed once and links to the edition you can read most of. ${nf.format(sourced)} of these ${nf.format(works.length)} dates come from a record and are marked “sourced”; the rest are estimates, marked “estimated”.`}
      </p>

      {readable.length > 0 && (
        <section className="mb-12">
          <h2 className="font-serif text-2xl text-stone-800 mb-1">Readable in English</h2>
          <ol className="divide-y divide-border-light">
            {readable.slice(0, SHOWN).map((w) => <WorkRow key={w.key} w={w} />)}
          </ol>
          {readable.length > SHOWN && (
            <p className="mt-4 text-sm">
              <Link href={`${searchHref}&has_translation=true`} className="text-accent-rust hover:underline">
                {`See every readable book of the ${label} in the library`}
              </Link>
            </p>
          )}
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <h2 className="font-serif text-2xl text-stone-800 mb-1">Not yet in English</h2>
          <p className="text-sm text-stone-500 mb-2">Original text or page images, with any translation in progress.</p>
          <ol className="divide-y divide-border-light">
            {rest.slice(0, SHOWN).map((w) => <WorkRow key={w.key} w={w} />)}
          </ol>
          {rest.length > SHOWN && (
            <p className="mt-4 text-sm">
              <Link href={searchHref} className="text-accent-rust hover:underline">
                {`See all ${nf.format(books)} books of the ${label} in the library`}
              </Link>
            </p>
          )}
        </section>
      )}

      {broad.length > 0 && (
        <section className="mt-12">
          <h2 className="font-serif text-2xl text-stone-800 mb-1">Dated only broadly</h2>
          <p className="text-sm text-stone-500 mb-2">
            {`These works are dated to a range of more than ${BROAD_SPAN} years, and are listed here because the middle of the range falls in the ${label}.`}
          </p>
          <ol className="divide-y divide-border-light">
            {broad.slice(0, SHOWN).map((w) => <WorkRow key={w.key} w={w} />)}
          </ol>
        </section>
      )}
    </ContentPageLayout>
  );
}
