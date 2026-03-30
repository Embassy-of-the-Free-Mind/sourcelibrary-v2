import { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@/lib/mongodb';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { CenturyChart } from './DataCharts';

// ISR: rebuild every 6 hours. Allow 60s for first-hit generation.
export const revalidate = 600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'The Collection — Source Library',
  description:
    'Live data on the Source Library collection: books, languages, centuries, topics, and source institutions.',
  alternates: { canonical: '/data' },
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

function pct(part: number, whole: number): string {
  if (whole === 0) return '0%';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/* ── pipeline status labels and ordering ── */

const PIPELINE_STATUS_ORDER = [
  'queued', 'archiving', 'archive_complete', 'ocr_submitted', 'ocr_complete',
  'metadata_enriched', 'translate_submitted', 'translate_complete',
  'enriching', 'enriched', 'chapters', 'chapters_complete',
  'images_submitted', 'images_complete', 'complete', 'needs_attention', 'failed',
] as const;

const PIPELINE_STATUS_COLORS: Record<string, string> = {
  queued: 'bg-stone-200', archiving: 'bg-amber-200', archive_complete: 'bg-amber-300',
  ocr_submitted: 'bg-sky-200', ocr_complete: 'bg-sky-300', metadata_enriched: 'bg-sky-400',
  translate_submitted: 'bg-violet-200', translate_complete: 'bg-violet-300',
  enriching: 'bg-violet-400', enriched: 'bg-violet-500',
  chapters: 'bg-emerald-200', chapters_complete: 'bg-emerald-300',
  images_submitted: 'bg-amber-400', images_complete: 'bg-amber-500',
  complete: 'bg-emerald-500', needs_attention: 'bg-orange-400', failed: 'bg-red-400',
  'no pipeline': 'bg-stone-300',
};

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
  // Admin-only fields (only populated when showAdmin=true)
  hiddenCount?: number;
  totalOcr?: number;
  pipelineStatuses?: Array<{ status: string; count: number }>;
  hasSummary?: number;
  hasIndex?: number;
  hasChapters?: number;
  hasSourceDates?: number;
  hasEditions?: number;
  ocrTiers?: Array<{ tier: string; count: number }>;
  translationTiers?: Array<{ tier: string; count: number }>;
  emptyShells?: number;
}

function buildCoverageTiers(field: string) {
  return [
    {
      $facet: {
        zero: [
          { $match: { pages_count: { $gt: 0 }, [field]: { $in: [0, null, undefined] } } },
          { $count: 'n' },
        ],
        low: [
          {
            $match: {
              pages_count: { $gt: 0 },
              [field]: { $gt: 0 },
              $expr: { $lt: [{ $divide: [`$${field}`, '$pages_count'] }, 0.5] },
            },
          },
          { $count: 'n' },
        ],
        mid: [
          {
            $match: {
              pages_count: { $gt: 0 },
              $expr: {
                $and: [
                  { $gte: [{ $divide: [`$${field}`, '$pages_count'] }, 0.5] },
                  { $lt: [{ $divide: [`$${field}`, '$pages_count'] }, 1] },
                ],
              },
            },
          },
          { $count: 'n' },
        ],
        full: [
          {
            $match: {
              pages_count: { $gt: 0 },
              $expr: { $gte: [{ $divide: [`$${field}`, '$pages_count'] }, 1] },
            },
          },
          { $count: 'n' },
        ],
      },
    },
  ];
}

function extractTiers(
  result: Array<{
    zero: Array<{ n: number }>;
    low: Array<{ n: number }>;
    mid: Array<{ n: number }>;
    full: Array<{ n: number }>;
  }>
): Array<{ tier: string; count: number }> {
  const r = result[0] ?? { zero: [], low: [], mid: [], full: [] };
  return [
    { tier: '0%', count: r.zero[0]?.n ?? 0 },
    { tier: '1–49%', count: r.low[0]?.n ?? 0 },
    { tier: '50–99%', count: r.mid[0]?.n ?? 0 },
    { tier: '100%', count: r.full[0]?.n ?? 0 },
  ];
}

async function fetchLibraryData(showAdmin: boolean): Promise<LibraryData> {
  const db = await getDb();
  const books = db.collection('books');
  const visible = { visible: true };
  const filter = showAdmin ? {} : visible;

  const maxTimeMS = 45000;

  // Base queries (always run)
  const baseQueries = [
    books.countDocuments(filter, { maxTimeMS }),
    books.countDocuments({ ...filter, is_first_translation: true }, { maxTimeMS }),
    books
      .aggregate<{ _id: string; count: number }>([
        { $match: filter },
        { $group: { _id: '$language', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ], { maxTimeMS })
      .toArray(),
    books
      .aggregate<{ _id: number; count: number }>([
        { $match: { ...filter, year: { $exists: true, $type: 'number' } } },
        {
          $addFields: {
            century: { $multiply: [{ $floor: { $divide: ['$year', 100] } }, 100] },
          },
        },
        { $group: { _id: '$century', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ], { maxTimeMS })
      .toArray(),
    books
      .aggregate<{ _id: string; count: number }>([
        { $match: { ...filter, categories: { $exists: true } } },
        { $unwind: '$categories' },
        { $group: { _id: '$categories', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        ...(showAdmin ? [] : [{ $limit: 20 }]),
      ], { maxTimeMS })
      .toArray(),
    books
      .aggregate<{ _id: string; count: number }>([
        { $match: { ...filter, 'image_source.provider_name': { $exists: true } } },
        { $group: { _id: '$image_source.provider_name', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ], { maxTimeMS })
      .toArray(),
    books
      .aggregate<{ _id: null; pages: number; ocr: number; translated: number }>([
        { $match: filter },
        {
          $group: {
            _id: null,
            pages: { $sum: { $ifNull: ['$pages_count', 0] } },
            ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
            translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
          },
        },
      ], { maxTimeMS })
      .toArray(),
    db.collection('gallery_images').estimatedDocumentCount(),
    db
      .collection('collections')
      .find({})
      .sort({ order: 1 })
      .project({ slug: 1, name: 1, book_count: 1, _id: 0 })
      .toArray(),
  ] as const;

  if (!showAdmin) {
    const [totalBooks, firstTranslations, languagesAgg, centuriesAgg, categoriesAgg, providersAgg, pageTotalsAgg, pagesWithIllustrations, collectionsAgg] = await Promise.all(baseQueries);
    const pageTotals = pageTotalsAgg[0] ?? { pages: 0, ocr: 0, translated: 0 };

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

  // Admin mode: run extra queries
  const [totalBooks, firstTranslations, languagesAgg, centuriesAgg, categoriesAgg, providersAgg, pageTotalsAgg, pagesWithIllustrations, collectionsAgg, hiddenCount, pipelineAgg, hasSummary, hasIndex, hasChapters, hasSourceDates, hasEditions, ocrTiersAgg, translationTiersAgg, emptyShells] = await Promise.all([
    ...baseQueries,
    books.countDocuments({ hidden: true }, { maxTimeMS }),
    books
      .aggregate<{ _id: string | null; count: number }>([
        { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ], { maxTimeMS })
      .toArray(),
    books.countDocuments({ 'reading_summary.overview': { $exists: true } }, { maxTimeMS }),
    books.countDocuments({ 'index.generatedAt': { $exists: true } }, { maxTimeMS }),
    books.countDocuments({ 'chapters.0': { $exists: true } }, { maxTimeMS }),
    books.countDocuments({ 'source_work_dates.0': { $exists: true } }, { maxTimeMS }),
    db.collection('editions').estimatedDocumentCount(),
    books.aggregate(buildCoverageTiers('pages_ocr'), { maxTimeMS: 45000 }).toArray(),
    books.aggregate(buildCoverageTiers('pages_translated'), { maxTimeMS: 45000 }).toArray(),
    books.countDocuments({ $or: [{ pages_count: 0 }, { pages_count: { $exists: false } }] }, { maxTimeMS }),
  ]);

  const pageTotals = pageTotalsAgg[0] ?? { pages: 0, ocr: 0, translated: 0 };

  // Build pipeline status array in canonical order
  const pipelineMap = new Map<string, number>();
  for (const p of pipelineAgg) {
    pipelineMap.set(p._id ?? 'no pipeline', p.count);
  }
  const pipelineStatuses: Array<{ status: string; count: number }> = [];
  for (const s of PIPELINE_STATUS_ORDER) {
    const count = pipelineMap.get(s);
    if (count) pipelineStatuses.push({ status: s, count });
  }
  const noPipeline = pipelineMap.get('no pipeline');
  if (noPipeline) pipelineStatuses.push({ status: 'no pipeline', count: noPipeline });

  return {
    totalBooks,
    hiddenCount,
    totalPages: pageTotals.pages,
    totalOcr: pageTotals.ocr,
    totalTranslated: pageTotals.translated,
    totalIllustrations: pagesWithIllustrations,
    firstTranslations,
    pipelineStatuses,
    hasSummary,
    hasIndex,
    hasChapters,
    hasSourceDates,
    hasEditions,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ocrTiers: extractTiers(ocrTiersAgg as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    translationTiers: extractTiers(translationTiersAgg as any),
    emptyShells,
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

export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const showAdmin = params.admin === 'true';
  let data: LibraryData;
  try {
    data = await fetchLibraryData(showAdmin);
  } catch {
    // Fallback on DB timeout
    data = {
      totalBooks: 0, totalPages: 0, totalTranslated: 0,
      totalIllustrations: 0, firstTranslations: 0,
      languages: [], centuries: [], categories: [],
      providers: [], collections: [],
    };
  }

  const uniqueLanguages = data.languages.length;
  const earliestCentury = data.centuries[0]?.label ?? '';
  const latestCentury = data.centuries[data.centuries.length - 1]?.label ?? '';

  const centuryChartData = data.centuries.map((c) => ({
    x: c.label,
    y: c.count,
  }));

  const topLanguages = showAdmin ? data.languages : data.languages.slice(0, 15);
  const remainingLanguages = showAdmin ? 0 : data.languages.length - 15;
  const maxLangCount = topLanguages[0]?.count ?? 1;

  const stats = showAdmin
    ? [
        { value: formatNumber(data.totalBooks), label: 'Total books', sub: `${formatNumber(data.hiddenCount ?? 0)} hidden` },
        { value: formatNumber(data.totalPages), label: 'Total pages' },
        { value: formatNumber(data.totalOcr ?? 0), label: 'Pages with OCR', sub: pct(data.totalOcr ?? 0, data.totalPages) },
        { value: formatNumber(data.totalTranslated), label: 'Pages translated', sub: pct(data.totalTranslated, data.totalPages) },
        { value: formatNumber(data.totalIllustrations), label: 'Illustrations catalogued' },
        { value: formatNumber(data.firstTranslations), label: 'First-ever translations' },
      ]
    : [
        { value: formatNumber(data.totalBooks), label: 'Rare books' },
        { value: formatNumber(data.totalPages), label: 'Digitised pages' },
        { value: formatNumber(data.totalTranslated), label: 'Pages translated' },
        { value: String(uniqueLanguages), label: 'Languages' },
        { value: formatNumber(data.totalIllustrations), label: 'Illustrations catalogued' },
        { value: formatNumber(data.firstTranslations), label: 'First-ever translations' },
      ];

  const TIER_COLORS = ['var(--status-error)', 'var(--status-warning)', 'var(--accent-gold)', 'var(--status-success)'];

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title={showAdmin ? 'The Full Collection' : 'The Collection'}
          subtitle={
            showAdmin
              ? `${formatNumber(data.totalBooks)} books (${formatNumber(data.hiddenCount ?? 0)} hidden) across ${uniqueLanguages} languages, from the ${earliestCentury} to the ${latestCentury}`
              : `${formatNumber(data.totalBooks)} books across ${uniqueLanguages} languages, from the ${earliestCentury} to the ${latestCentury}`
          }
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
              {'sub' in s && s.sub && <div className="text-faint text-xs mt-0.5">{s.sub}</div>}
            </div>
          ))}
        </div>
      </section>

      {/* ── Pipeline Status (admin only) ── */}
      {showAdmin && data.pipelineStatuses && (() => {
        const maxPipelineCount = Math.max(...data.pipelineStatuses.map((p) => p.count), 1);
        return (
          <section className="mb-16">
            <h2 className="font-serif text-2xl text-primary mb-6">Pipeline Status</h2>
            <div className="bg-white rounded-xl p-6 border border-border-light">
              <div className="space-y-2">
                {data.pipelineStatuses.map((p) => (
                  <div key={p.status} className="flex items-center gap-3">
                    <span className="text-xs text-secondary w-40 shrink-0 text-right font-mono">
                      {p.status}
                    </span>
                    <div className="flex-1 bg-stone-100 rounded-full h-5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${PIPELINE_STATUS_COLORS[p.status] ?? 'bg-stone-400'}`}
                        style={{
                          width: `${Math.max(2, (p.count / maxPipelineCount) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm text-muted w-12 shrink-0 tabular-nums text-right">
                      {p.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      })()}

      {/* ── Enrichment Coverage (admin only) ── */}
      {showAdmin && (
        <section className="mb-16">
          <h2 className="font-serif text-2xl text-primary mb-6">Enrichment Coverage</h2>
          <div className="bg-white rounded-xl p-6 border border-border-light">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: 'Reading summary', count: data.hasSummary ?? 0 },
                { label: 'AI index', count: data.hasIndex ?? 0 },
                { label: 'Chapters', count: data.hasChapters ?? 0 },
                { label: 'Original source dates', count: data.hasSourceDates ?? 0 },
                { label: 'Published editions', count: data.hasEditions ?? 0 },
              ].map((e) => (
                <div
                  key={e.label}
                  className="flex items-baseline justify-between gap-2 py-2 px-3 rounded-lg bg-stone-50"
                >
                  <span className="text-sm text-secondary">{e.label}</span>
                  <span className="text-sm font-medium tabular-nums">
                    {formatNumber(e.count)}{' '}
                    <span className="text-faint">/ {formatNumber(data.totalBooks)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Coverage Tiers (admin only) ── */}
      {showAdmin && data.ocrTiers && data.translationTiers && (
        <section className="mb-16">
          <h2 className="font-serif text-2xl text-primary mb-6">Coverage Tiers</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl p-6 border border-border-light">
              <h3 className="text-sm font-medium text-secondary mb-4">OCR Coverage (by book)</h3>
              <div className="space-y-3">
                {data.ocrTiers.map((t, i) => (
                  <div key={t.tier} className="flex items-center gap-3">
                    <span className="text-sm text-muted w-14 shrink-0 text-right">{t.tier}</span>
                    <div className="flex-1 bg-stone-100 rounded-full h-5 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, (t.count / data.totalBooks) * 100)}%`,
                          backgroundColor: TIER_COLORS[i],
                        }}
                      />
                    </div>
                    <span className="text-sm text-muted w-12 shrink-0 tabular-nums text-right">
                      {t.count}
                    </span>
                  </div>
                ))}
              </div>
              {(data.emptyShells ?? 0) > 0 && (
                <p className="text-xs text-faint mt-3">
                  {data.emptyShells} books with 0 pages (empty shells)
                </p>
              )}
            </div>
            <div className="bg-white rounded-xl p-6 border border-border-light">
              <h3 className="text-sm font-medium text-secondary mb-4">Translation Coverage (by book)</h3>
              <div className="space-y-3">
                {data.translationTiers.map((t, i) => (
                  <div key={t.tier} className="flex items-center gap-3">
                    <span className="text-sm text-muted w-14 shrink-0 text-right">{t.tier}</span>
                    <div className="flex-1 bg-stone-100 rounded-full h-5 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, (t.count / data.totalBooks) * 100)}%`,
                          backgroundColor: TIER_COLORS[i],
                        }}
                      />
                    </div>
                    <span className="text-sm text-muted w-12 shrink-0 tabular-nums text-right">
                      {t.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

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
