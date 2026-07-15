import { Metadata } from 'next';
import Link from 'next/link';
import { getReadDb } from '@/lib/mongodb';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { CenturyChart } from './DataCharts';

// ISR: rebuild every 10 minutes. The page reads from a pre-computed snapshot
// so rendering is fast — no heavy Atlas aggregations at request time.
// Must be a finite number — `false` would cache a bad-render fallback forever.
export const revalidate = 600;
export const maxDuration = 15;

export const metadata: Metadata = {
  title: 'The Collection — Source Library',
  description:
    'Live data on the Source Library collection: books, languages, centuries, topics, and source institutions.',
  alternates: { canonical: '/data' },
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
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

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function pct(part: number, whole: number): string {
  if (whole === 0) return '0%';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/* ── pipeline status colors ── */

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

/* ── data fetching from pre-computed snapshot ── */

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

const EMPTY_DATA: LibraryData = {
  totalBooks: 0, totalPages: 0, totalTranslated: 0,
  totalIllustrations: 0, firstTranslations: 0,
  languages: [], centuries: [], categories: [],
  providers: [], collections: [],
};

/**
 * Read pre-computed stats from system_config.data_page_snapshot.
 * Falls back to dashboard_snapshot for core numbers if dedicated snapshot is missing.
 * Never runs heavy aggregations inline — that's done by POST /api/admin/data-snapshot.
 */
async function fetchLibraryData(): Promise<LibraryData> {
  const db = await getReadDb();
  const config = db.collection('system_config');

  // Try dedicated data page snapshot first
  const snapshot = await config.findOne({ _id: 'data_page_snapshot' as any });
  if (snapshot?.data) {
    return snapshot.data as LibraryData;
  }

  // Fall back to dashboard_snapshot for core numbers
  const dashboard = await config.findOne({ _id: 'dashboard_snapshot' as any });
  if (dashboard?.data) {
    const d = dashboard.data as any;
    return {
      totalBooks: d.canon?.total_books ?? 0,
      totalPages: d.canon?.total_pages ?? 0,
      totalOcr: d.coverage?.ocr_pages ?? 0,
      totalTranslated: d.coverage?.translated_pages ?? 0,
      totalIllustrations: 0,
      firstTranslations: d.canon?.first_translations ?? 0,
      hiddenCount: d.invisible?.total_books ?? 0,
      hasSummary: d.enrichment?.with_summary ?? 0,
      hasIndex: d.enrichment?.with_index ?? 0,
      hasChapters: 0,
      hasSourceDates: 0,
      hasEditions: 0,
      emptyShells: 0,
      languages: [],
      centuries: [],
      categories: [],
      providers: [],
      collections: [],
      pipelineStatuses: [],
      ocrTiers: [],
      translationTiers: [],
    };
  }

  return EMPTY_DATA;
}

/* ── page ── */

export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const showAdmin = params.admin === 'true';
  // No try/catch: a thrown error during ISR revalidation keeps serving the
  // last good page, while catching it here would render (and cache) an
  // all-zero stats page for the full revalidate window. Cold failures land
  // on src/app/error.tsx.
  const data = await fetchLibraryData();

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
        <ContentHeader maxWidth="wide"
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
                {formatNumber(c.book_count ?? 0)} books
              </span>
            </Link>
          ))}
        </div>
      </section>
    </ContentPageLayout>
  );
}
