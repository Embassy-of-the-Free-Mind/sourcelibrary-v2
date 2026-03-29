import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import TranslationLagViz from '@/components/research/TranslationLagViz';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Translation Lag — Source Library Research',
  description:
    'How long did it take for key works to reach English readers? Visualizing the gap between composition and publication across 1,700 years of knowledge transmission.',
  alternates: { canonical: '/research/translation-lag' },
};

interface LagDataPoint {
  title: string;
  author: string;
  slug: string;
  year: number;
  language: string;
  composed: number;
  composed_display: string;
  lag: number;
  is_first_translation: boolean;
  categories: string[];
}

async function fetchLagData(): Promise<LagDataPoint[]> {
  const db = await getDb();
  const books = await db.collection('books').find(
    {
      hidden: { $ne: true },
      deleted: { $ne: true },
      source_work_dates: { $elemMatch: { type: 'composition' } },
      year: { $exists: true, $ne: null },
    },
    {
      projection: {
        title: 1, display_title: 1, year: 1, language: 1, slug: 1,
        source_work_dates: 1, author: 1, categories: 1, is_first_translation: 1,
      },
    },
  ).toArray();

  const results: LagDataPoint[] = [];
  for (const b of books) {
    const comp = (b.source_work_dates as { type: string; date: unknown; date_display?: string; author?: string }[])
      .find((d) => d.type === 'composition');
    if (!comp || !comp.date) continue;

    let compDate = comp.date;
    if (typeof compDate === 'string') {
      const match = compDate.match(/-?\d+/);
      if (match) compDate = parseInt(match[0]);
      else continue;
    }
    if (typeof compDate !== 'number' || isNaN(compDate)) continue;

    const lag = b.year - compDate;
    if (lag < 0 || lag > 3000) continue;

    results.push({
      title: b.display_title || b.title,
      author: b.author || 'Unknown',
      slug: b.slug,
      year: b.year,
      language: b.language || 'Unknown',
      composed: compDate,
      composed_display: comp.date_display || String(compDate),
      lag,
      is_first_translation: b.is_first_translation || false,
      categories: b.categories || [],
    });
  }

  return results.sort((a, b) => b.lag - a.lag);
}

export default async function TranslationLagPage() {
  const data = await fetchLagData();

  // Compute summary stats
  const firstTranslations = data.filter((d) => d.is_first_translation);
  const avgLag = Math.round(data.reduce((sum, d) => sum + d.lag, 0) / data.length);
  const medianLag = data.sort((a, b) => a.lag - b.lag)[Math.floor(data.length / 2)]?.lag || 0;

  // Language stats (min 5 books)
  const byLang: Record<string, number[]> = {};
  for (const d of data) {
    if (!byLang[d.language]) byLang[d.language] = [];
    byLang[d.language].push(d.lag);
  }
  const langStats = Object.entries(byLang)
    .map(([lang, lags]) => ({
      lang,
      avg: Math.round(lags.reduce((a, b) => a + b, 0) / lags.length),
      median: lags.sort((a, b) => a - b)[Math.floor(lags.length / 2)],
      count: lags.length,
    }))
    .filter((l) => l.count >= 5)
    .sort((a, b) => b.median - a.median);

  // Category stats (min 10 books)
  const byCat: Record<string, number[]> = {};
  for (const d of data) {
    for (const cat of d.categories) {
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(d.lag);
    }
  }
  const catStats = Object.entries(byCat)
    .map(([cat, lags]) => ({
      cat,
      avg: Math.round(lags.reduce((a, b) => a + b, 0) / lags.length),
      median: lags.sort((a, b) => a - b)[Math.floor(lags.length / 2)],
      count: lags.length,
    }))
    .filter((c) => c.count >= 10)
    .sort((a, b) => b.median - a.median);

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Translation Lag"
          subtitle="How long did it take for key works to reach readers in other languages? Mapping the gap between composition and publication across 1,700 years."
        />
      }
      maxWidth="wide"
    >
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label="Books analyzed" value={data.length.toLocaleString()} />
        <StatCard label="First translations" value={firstTranslations.length.toLocaleString()} />
        <StatCard label="Average lag" value={`${avgLag} years`} />
        <StatCard label="Median lag" value={`${medianLag} years`} />
      </div>

      {/* Main scatter plot */}
      <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6 mb-8">
        <h2 className="font-serif text-xl mb-1">Composition Date vs. Publication Date</h2>
        <p className="text-[var(--text-muted)] text-sm mb-4">
          Each dot is a book. Distance from the diagonal line = how long the work waited.
          Hover for details. Click to visit.
        </p>
        <TranslationLagViz data={data} />
      </div>

      {/* Two-column breakdown */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* By language */}
        <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6">
          <h2 className="font-serif text-xl mb-4">Median Lag by Source Language</h2>
          <div className="space-y-2">
            {langStats.map((l) => (
              <LagBar key={l.lang} label={l.lang} value={l.median} max={Math.max(...langStats.map((s) => s.median))} count={l.count} />
            ))}
          </div>
        </div>

        {/* By category */}
        <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6">
          <h2 className="font-serif text-xl mb-4">Median Lag by Subject</h2>
          <div className="space-y-2">
            {catStats.slice(0, 16).map((c) => (
              <LagBar key={c.cat} label={c.cat} value={c.median} max={Math.max(...catStats.map((s) => s.median))} count={c.count} />
            ))}
          </div>
        </div>
      </div>

      {/* Top longest lags table */}
      <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6 mb-8">
        <h2 className="font-serif text-xl mb-4">Longest Waiting Works</h2>
        <p className="text-[var(--text-muted)] text-sm mb-4">
          Works that waited the longest between original composition and this edition.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-light)] text-left text-[var(--text-muted)]">
                <th className="pb-2 pr-4">Work</th>
                <th className="pb-2 pr-4">Composed</th>
                <th className="pb-2 pr-4">Published</th>
                <th className="pb-2 pr-4">Language</th>
                <th className="pb-2 pr-4 text-right">Lag</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 25).map((d) => (
                <tr key={d.slug} className="border-b border-[var(--border-light)]/50 hover:bg-[var(--bg-warm)]">
                  <td className="py-2 pr-4">
                    <a href={`/book/${d.slug}`} className="text-[var(--accent-rust)] hover:underline">
                      {d.title}
                    </a>
                    {d.is_first_translation && (
                      <span className="ml-2 text-xs bg-[var(--accent-gold)]/15 text-[var(--accent-gold-dark)] px-1.5 py-0.5 rounded">
                        First translation
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-[var(--text-muted)]">{d.composed_display}</td>
                  <td className="py-2 pr-4">{d.year}</td>
                  <td className="py-2 pr-4">{d.language}</td>
                  <td className="py-2 pr-4 text-right font-medium">{d.lag.toLocaleString()}y</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Methodology note */}
      <div className="bg-[var(--bg-warm)] rounded-lg p-4 sm:p-6 text-sm text-[var(--text-secondary)]">
        <h3 className="font-serif text-lg mb-2">Methodology</h3>
        <p className="mb-2">
          Translation lag is computed as the difference between a work&apos;s original composition date
          and the publication date of the edition in Source Library. Composition dates come from AI metadata
          enrichment that analyzes each book&apos;s title page, content, and scholarly context to determine
          when the underlying text was first written.
        </p>
        <p>
          For translations and later editions, the &ldquo;lag&rdquo; represents how long it took for the text to reach
          this particular linguistic community — not necessarily the total time before any printed edition existed.
          Works with estimated composition dates (e.g., &ldquo;c. 3rd century CE&rdquo;) use the midpoint of the estimated range.
          {data.length.toLocaleString()} of {'>'}2,400 visible books have computable composition dates.
        </p>
      </div>
    </ContentPageLayout>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 text-center">
      <div className="text-2xl font-serif text-[var(--text-primary)]">{value}</div>
      <div className="text-sm text-[var(--text-muted)]">{label}</div>
    </div>
  );
}

function LagBar({ label, value, max, count }: { label: string; value: number; max: number; count: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-sm text-[var(--text-secondary)] truncate" title={label}>{label}</div>
      <div className="flex-1 h-5 bg-[var(--bg-warm)] rounded overflow-hidden">
        <div
          className="h-full bg-[var(--accent-rust)]/20 rounded"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-20 text-sm text-right text-[var(--text-muted)]">
        {value.toLocaleString()}y <span className="text-xs">({count})</span>
      </div>
    </div>
  );
}
