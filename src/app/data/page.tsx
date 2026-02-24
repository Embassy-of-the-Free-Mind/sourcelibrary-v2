import { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@/lib/mongodb';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { CenturyChart } from './DataCharts';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const metadata: Metadata = {
  title: 'The Collection — Source Library',
  description:
    'Live data on the Source Library collection: books, languages, centuries, topics, and source institutions.',
  openGraph: {
    title: 'The Collection — Source Library',
    description:
      'Live data on the Source Library collection: books, languages, centuries, topics, and source institutions.',
  },
};

/* ── provider URLs (external institutions) ── */

const PROVIDER_URLS: Record<string, string> = {
  'Internet Archive': 'https://archive.org',
  'Embassy of the Free Mind': 'https://embassyofthefreemind.com',
  'Gallica (Bibliothèque nationale de France)': 'https://gallica.bnf.fr',
  'Münchener DigitalisierungsZentrum (Bavarian State Library)': 'https://www.digitale-sammlungen.de',
  'Bodleian Library, University of Oxford': 'https://digital.bodleian.ox.ac.uk',
  'Cambridge Digital Library': 'https://cudl.lib.cam.ac.uk',
  'Wellcome Collection': 'https://wellcomecollection.org',
  'Biblioteca Apostolica Vaticana': 'https://digi.vatlib.it',
  'Library of Congress': 'https://www.loc.gov',
  'e-rara (Swiss rare books)': 'https://www.e-rara.ch',
  'Vatican Library': 'https://digi.vatlib.it',
  'Victoria and Albert Museum': 'https://www.vam.ac.uk',
  'British Library': 'https://www.bl.uk',
  'John Rylands Library, Manchester': 'https://www.library.manchester.ac.uk',
  'IRHT (CNRS)': 'https://www.irht.cnrs.fr',
};

/* ── helpers ── */

function formatCentury(yearBucket: number): string {
  if (yearBucket <= 0) return '1st c.';
  const c = Math.floor(yearBucket / 100) + 1;
  const mod10 = c % 10;
  const mod100 = c % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? 'th' : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th';
  return `${c}${suffix} c.`;
}

function formatCategory(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/* ── data fetching ── */

interface LibraryData {
  totalBooks: number;
  totalPages: number;
  totalTranslated: number;
  totalIllustrations: number;
  firstTranslations: number;
  languages: Array<{ language: string; count: number }>;
  centuries: Array<{ century: number; label: string; count: number }>;
  categories: Array<{ slug: string; name: string; count: number }>;
  providers: Array<{ name: string; count: number }>;
  collections: Array<{ slug: string; name: string; book_count: number }>;
}

async function fetchLibraryData(): Promise<LibraryData> {
  const db = await getDb();
  const books = db.collection('books');
  const visible = { hidden: { $ne: true } };

  const [
    totalBooks,
    firstTranslations,
    languagesAgg,
    centuriesAgg,
    categoriesAgg,
    providersAgg,
    pageTotalsAgg,
    pagesWithIllustrations,
    collectionsAgg,
  ] = await Promise.all([
    books.countDocuments(visible),
    books.countDocuments({ ...visible, is_first_translation: true }),
    books
      .aggregate<{ _id: string; count: number }>([
        { $match: visible },
        { $group: { _id: '$language', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray(),
    books
      .aggregate<{ _id: number; count: number }>([
        { $match: { ...visible, year: { $exists: true, $type: 'number' } } },
        {
          $addFields: {
            century: { $multiply: [{ $floor: { $divide: ['$year', 100] } }, 100] },
          },
        },
        { $group: { _id: '$century', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    books
      .aggregate<{ _id: string; count: number }>([
        { $match: { ...visible, categories: { $exists: true } } },
        { $unwind: '$categories' },
        { $group: { _id: '$categories', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ])
      .toArray(),
    books
      .aggregate<{ _id: string; count: number }>([
        { $match: { ...visible, 'image_source.provider_name': { $exists: true } } },
        { $group: { _id: '$image_source.provider_name', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray(),
    books
      .aggregate<{ _id: null; pages: number; translated: number }>([
        { $match: visible },
        {
          $group: {
            _id: null,
            pages: { $sum: '$pages_count' },
            translated: { $sum: '$pages_translated' },
          },
        },
      ])
      .toArray(),
    db.collection('gallery_images').estimatedDocumentCount(),
    db
      .collection('collections')
      .find({})
      .sort({ order: 1 })
      .project({ slug: 1, name: 1, book_count: 1, _id: 0 })
      .toArray(),
  ]);

  const pageTotals = pageTotalsAgg[0] ?? { pages: 0, translated: 0 };

  return {
    totalBooks,
    totalPages: pageTotals.pages,
    totalTranslated: pageTotals.translated,
    totalIllustrations: pagesWithIllustrations,
    firstTranslations,
    languages: languagesAgg
      .filter((l) => l._id && l._id !== 'Unknown')
      .map((l) => ({ language: l._id, count: l.count })),
    centuries: centuriesAgg.map((c) => ({
      century: c._id,
      label: formatCentury(c._id),
      count: c.count,
    })),
    categories: categoriesAgg.map((c) => ({
      slug: c._id,
      name: formatCategory(c._id),
      count: c.count,
    })),
    providers: providersAgg
      .filter((p) => p._id)
      .map((p) => ({ name: p._id, count: p.count })),
    collections: collectionsAgg as Array<{ slug: string; name: string; book_count: number }>,
  };
}

/* ── page ── */

export default async function DataPage() {
  const data = await fetchLibraryData();

  const uniqueLanguages = data.languages.length;
  const earliestCentury = data.centuries[0]?.label ?? '';
  const latestCentury = data.centuries[data.centuries.length - 1]?.label ?? '';

  const centuryChartData = data.centuries.map((c) => ({
    x: c.label,
    y: c.count,
  }));

  const topLanguages = data.languages.slice(0, 15);
  const remainingLanguages = data.languages.length - 15;
  const maxLangCount = topLanguages[0]?.count ?? 1;

  const stats = [
    { value: formatNumber(data.totalBooks), label: 'Rare books' },
    { value: formatNumber(data.totalPages), label: 'Digitised pages' },
    { value: formatNumber(data.totalTranslated), label: 'Pages translated' },
    { value: String(uniqueLanguages), label: 'Languages' },
    { value: formatNumber(data.totalIllustrations), label: 'Illustrations catalogued' },
    { value: formatNumber(data.firstTranslations), label: 'First-ever translations' },
  ];

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Collection"
          subtitle={`${formatNumber(data.totalBooks)} books across ${uniqueLanguages} languages, from the ${earliestCentury} to the ${latestCentury}`}
        />
      }
      maxWidth="wide"
    >
      {/* ── Headline stats ── */}
      <section className="mb-16">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
          {stats.map((s) => (
            <div
              key={s.label}
              className="bg-white rounded-xl p-5 border border-border-light"
            >
              <div
                className="text-3xl text-accent-rust mb-1"
                style={{ fontWeight: 300 }}
              >
                {s.value}
              </div>
              <div className="text-muted text-sm">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── By Century ── */}
      <section className="mb-16">
        <h2 className="font-serif text-2xl text-primary mb-6">By Century</h2>
        <div className="bg-white rounded-xl p-6 border border-border-light">
          <CenturyChart centuries={centuryChartData} />
        </div>
      </section>

      {/* ── By Language ── */}
      <section className="mb-16">
        <h2 className="font-serif text-2xl text-primary mb-6">By Language</h2>
        <div className="bg-white rounded-xl p-6 border border-border-light">
          <div className="space-y-3">
            {topLanguages.map((l) => (
              <div key={l.language} className="flex items-center gap-3">
                <span className="text-sm text-secondary w-28 shrink-0 text-right">
                  {l.language}
                </span>
                <div className="flex-1 bg-stone-100 rounded-full h-6 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(2, (l.count / maxLangCount) * 100)}%`,
                      backgroundColor: 'var(--accent-sage)',
                    }}
                  />
                </div>
                <span className="text-sm text-muted w-10 shrink-0">
                  {l.count}
                </span>
              </div>
            ))}
          </div>
          {remainingLanguages > 0 && (
            <p className="text-sm text-muted mt-4">
              and {remainingLanguages} more languages
            </p>
          )}
        </div>
      </section>

      {/* ── By Topic ── */}
      <section className="mb-16">
        <h2 className="font-serif text-2xl text-primary mb-6">By Topic</h2>
        <div className="bg-white rounded-xl p-6 border border-border-light">
          <div className="flex flex-wrap gap-2">
            {data.categories.map((c) => (
              <Link
                key={c.slug}
                href={`/search?category=${c.slug}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm
                  bg-accent-violet/8 text-accent-violet hover:bg-accent-violet/15 transition-colors"
              >
                {c.name}
                <span className="text-accent-violet/60 text-xs">{c.count}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── By Source Library ── */}
      <section className="mb-16">
        <h2 className="font-serif text-2xl text-primary mb-6">Source Libraries</h2>
        <div className="bg-white rounded-xl p-6 border border-border-light">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            {data.providers.map((p) => {
              const url = PROVIDER_URLS[p.name];
              return (
                <div key={p.name} className="flex items-baseline justify-between gap-2 py-1">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-secondary hover:text-accent-rust transition-colors truncate"
                    >
                      {p.name}
                    </a>
                  ) : (
                    <span className="text-sm text-secondary truncate">{p.name}</span>
                  )}
                  <span className="text-sm text-muted tabular-nums shrink-0">
                    {p.count} {p.count === 1 ? 'book' : 'books'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Collections ── */}
      <section className="mb-16">
        <h2 className="font-serif text-2xl text-primary mb-6">Collections</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.collections.map((c) => (
            <Link
              key={c.slug}
              href={`/collections/${c.slug}`}
              className="flex items-baseline justify-between gap-2 bg-white rounded-xl px-5 py-4
                border border-border-light hover:border-accent-rust/30 transition-colors"
            >
              <span className="text-secondary font-medium">{c.name}</span>
              <span className="text-sm text-muted tabular-nums shrink-0">
                {formatNumber(c.book_count)} books
              </span>
            </Link>
          ))}
        </div>
      </section>
    </ContentPageLayout>
  );
}
