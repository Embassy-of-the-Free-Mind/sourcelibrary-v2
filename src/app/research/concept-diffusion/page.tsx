import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ConceptDiffusionViz from '@/components/research/ConceptDiffusionViz';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Concept Diffusion — Source Library Research',
  description:
    'Tracking how concepts spread across languages and centuries in 2,400 pre-modern texts. A Google Ngrams for specialist historical literature.',
  alternates: { canonical: '/research/concept-diffusion' },
};

const CATEGORY_LABELS: Record<string, string> = {
  'alchemy': 'Alchemy',
  'theology': 'Theology',
  'philosophy': 'Philosophy',
  'natural-philosophy': 'Natural Philosophy',
  'hermeticism': 'Hermeticism',
  'history': 'History',
  'mysticism': 'Mysticism',
  'astrology': 'Astrology',
  'medicine': 'Medicine',
  'kabbalah': 'Kabbalah',
  'magic': 'Magic',
  'mathematics': 'Mathematics',
  'rosicrucianism': 'Rosicrucianism',
  'freemasonry': 'Freemasonry',
  'science': 'Science',
  'occultism': 'Occultism',
};

function formatCategory(cat: string): string {
  return CATEGORY_LABELS[cat] || cat.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

interface ConceptPeriod {
  concept: string;
  period: number;
  count: number;
  normalized: number;
  languages: string[];
}

interface PeriodTotal {
  period: number;
  count: number;
}

interface ConceptInfo {
  concept: string;
  total: number;
  category: string;
  earliest: number;
  latest: number;
  langCount: number;
}

async function fetchConceptData() {
  const db = await getDb();
  const baseFilter = {
    'index.generatedAt': { $exists: true },
    hidden: { $ne: true },
    deleted: { $ne: true },
    year: { $gte: 1200, $lte: 1930 },
  };

  // Step 1: Get top 150 concepts by frequency — no hardcoded filter
  const topConceptsRaw = await db.collection('books').aggregate([
    { $match: baseFilter },
    { $unwind: '$index.concepts' },
    {
      $group: {
        _id: '$index.concepts.term',
        total: { $sum: 1 },
        earliest: { $min: '$year' },
        latest: { $max: '$year' },
        languages: { $addToSet: '$language' },
      },
    },
    { $sort: { total: -1 } },
    { $limit: 150 },
  ]).toArray();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topTerms = topConceptsRaw.map((c: any) => c._id as string);

  // Step 2-4: Run remaining queries in parallel
  const [rawData, totalsRaw, categoryRaw] = await Promise.all([
    // Time series for top concepts by 50-year period
    db.collection('books').aggregate([
      { $match: baseFilter },
      { $unwind: '$index.concepts' },
      { $match: { 'index.concepts.term': { $in: topTerms } } },
      {
        $group: {
          _id: {
            concept: '$index.concepts.term',
            period: { $multiply: [{ $floor: { $divide: ['$year', 50] } }, 50] },
          },
          count: { $sum: 1 },
          languages: { $addToSet: '$language' },
        },
      },
      { $sort: { '_id.period': 1 } },
    ]).toArray(),

    // Total books per period (for normalization)
    db.collection('books').aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id: { $multiply: [{ $floor: { $divide: ['$year', 50] } }, 50] },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray(),

    // Category mapping: primary category for each top concept
    db.collection('books').aggregate([
      { $match: baseFilter },
      { $unwind: '$index.concepts' },
      { $match: { 'index.concepts.term': { $in: topTerms } } },
      { $unwind: '$categories' },
      {
        $group: {
          _id: { concept: '$index.concepts.term', category: '$categories' },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      {
        $group: {
          _id: '$_id.concept',
          primaryCategory: { $first: '$_id.category' },
        },
      },
    ]).toArray(),
  ]);

  // Build category map
  const categoryMap = new Map<string, string>();
  for (const c of categoryRaw) {
    categoryMap.set(c._id, c.primaryCategory);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totals: PeriodTotal[] = totalsRaw.map((t: any) => ({
    period: t._id as number,
    count: t.count as number,
  }));
  const totalMap = new Map(totals.map((t) => [t.period, t.count]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: ConceptPeriod[] = rawData.map((d: any) => ({
    concept: d._id.concept as string,
    period: d._id.period as number,
    count: d.count as number,
    normalized: (d.count as number) / (totalMap.get(d._id.period as number) || 1),
    languages: d.languages as string[],
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const concepts: ConceptInfo[] = topConceptsRaw.map((c: any) => ({
    concept: c._id as string,
    total: c.total as number,
    category: formatCategory(categoryMap.get(c._id as string) || 'other'),
    earliest: c.earliest as number,
    latest: c.latest as number,
    langCount: (c.languages as string[]).length,
  }));

  // Build groups from data: category -> concepts (sorted by total)
  const groupMap = new Map<string, ConceptInfo[]>();
  for (const c of concepts) {
    if (!groupMap.has(c.category)) groupMap.set(c.category, []);
    groupMap.get(c.category)!.push(c);
  }

  // Sort groups by total mentions, take top 10
  const sortedGroups = [...groupMap.entries()]
    .sort((a, b) => {
      const sumA = a[1].reduce((s, ci) => s + ci.total, 0);
      const sumB = b[1].reduce((s, ci) => s + ci.total, 0);
      return sumB - sumA;
    })
    .slice(0, 10);

  const groups: Record<string, string[]> = {};
  for (const [cat, conceptInfos] of sortedGroups) {
    groups[cat] = conceptInfos.map((c) => c.concept);
  }

  // Default: top concept from each of the top 4 categories
  const defaultConcepts = sortedGroups.slice(0, 4).map(([, infos]) => infos[0].concept);

  // Build peak data from time series
  const conceptPeriodMap = new Map<string, ConceptPeriod[]>();
  for (const d of data) {
    if (!conceptPeriodMap.has(d.concept)) conceptPeriodMap.set(d.concept, []);
    conceptPeriodMap.get(d.concept)!.push(d);
  }

  const peakData = concepts.slice(0, 30).map((c) => {
    const periods = conceptPeriodMap.get(c.concept) || [];
    const peak = periods.reduce(
      (best, p) => (p.normalized > best.value ? { period: p.period, value: p.normalized } : best),
      { period: 0, value: 0 },
    );
    return { concept: c.concept, category: c.category, peak: peak.period, peakValue: peak.value };
  });

  return { data, totals, concepts, groups, defaultConcepts, peakData };
}

export default async function ConceptDiffusionPage() {
  const { data, totals, concepts, groups, defaultConcepts, peakData } = await fetchConceptData();

  const totalBooks = totals.reduce((s, t) => s + t.count, 0);
  const categoryCount = Object.keys(groups).length;
  const avgLanguages = Math.round(
    concepts.reduce((s, c) => s + c.langCount, 0) / concepts.length,
  );
  const dateRange = `${Math.min(...totals.map((t) => t.period))}–${Math.max(...totals.map((t) => t.period)) + 50}`;

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Concept Diffusion"
          subtitle="How did ideas spread across languages and centuries? Tracking concept frequency across theology, philosophy, alchemy, and more in 2,400 pre-modern texts."
        />
      }
      maxWidth="wide"
    >
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label="Books indexed" value={totalBooks.toLocaleString()} />
        <StatCard label="Top concepts tracked" value={String(concepts.length)} />
        <StatCard label="Subject categories" value={String(categoryCount)} />
        <StatCard label="Date range" value={dateRange} />
      </div>

      {/* Main visualization */}
      <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6 mb-8">
        <h2 className="font-serif text-xl mb-1">Concept Frequency Over Time</h2>
        <p className="text-[var(--text-muted)] text-sm mb-4">
          Each line shows how often a concept appears in books from that period. Concepts are grouped
          by their primary subject category, derived from the corpus. Select up to 10 concepts to
          compare. Toggle between raw counts and normalized frequency.
        </p>
        <ConceptDiffusionViz
          data={data}
          totals={totals}
          groups={groups}
          defaultSelected={defaultConcepts}
        />
      </div>

      {/* Two-column breakdown */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6">
          <h2 className="font-serif text-xl mb-4">Most Discussed Concepts</h2>
          <p className="text-[var(--text-muted)] text-sm mb-4">
            Top concepts by number of books in which they appear, from the full corpus across all subjects.
          </p>
          <div className="space-y-2">
            {concepts.slice(0, 15).map((c) => (
              <ConceptBar
                key={c.concept}
                label={c.concept}
                value={c.total}
                max={concepts[0].total}
                detail={`${c.earliest}–${c.latest}, ${c.langCount} lang, ${c.category}`}
              />
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6">
          <h2 className="font-serif text-xl mb-4">Peak Periods</h2>
          <p className="text-[var(--text-muted)] text-sm mb-4">
            When did each concept reach its highest relative frequency?
          </p>
          <div className="space-y-2">
            {peakData
              .sort((a, b) => a.peak - b.peak)
              .map((c) => (
                <div key={c.concept} className="flex items-center gap-3 text-sm">
                  <div className="w-40 text-[var(--text-secondary)] truncate" title={c.concept}>
                    {c.concept}
                  </div>
                  <div className="flex-1 text-[var(--text-muted)]">
                    {c.peak}–{c.peak + 50}
                  </div>
                  <div className="text-right text-[var(--text-muted)] text-xs">
                    {Math.round(c.peakValue * 100)}% · {c.category}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Methodology */}
      <div className="bg-[var(--bg-warm)] rounded-lg p-4 sm:p-6 text-sm text-[var(--text-secondary)]">
        <h3 className="font-serif text-lg mb-2">Methodology</h3>
        <p className="mb-2">
          Concept terms are extracted by AI (Gemini) from each book&apos;s full translated text during
          the indexing phase. Each book receives a list of key concepts with page references. This
          analysis aggregates concept presence across 50-year periods from 1200 to 1930.
        </p>
        <p className="mb-2">
          Concepts are grouped by subject category based on which category of books most frequently
          mentions each concept. For example, &ldquo;Transmutation&rdquo; appears primarily in alchemy books,
          while &ldquo;Divine Providence&rdquo; appears primarily in theology books. The top 150 concepts
          are selected purely by frequency — no editorial curation.
        </p>
        <p className="mb-2">
          &ldquo;Normalized frequency&rdquo; divides the number of books mentioning a concept by the total
          number of indexed books in that period, controlling for the uneven distribution of the corpus
          (which is densest in the 1600s). Raw counts show absolute presence.
        </p>
        <p>
          This is analogous to Google Ngrams but for specialist pre-modern literature — covering
          alchemical, Hermetic, Kabbalistic, theological, philosophical, and natural philosophical
          texts that are underrepresented in general book corpora. {totalBooks.toLocaleString()} of
          the corpus&apos;s ~2,400 visible books have AI-generated indexes with concept terms.
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

function ConceptBar({
  label,
  value,
  max,
  detail,
}: {
  label: string;
  value: number;
  max: number;
  detail: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="w-40 text-sm text-[var(--text-secondary)] truncate" title={label}>
          {label}
        </div>
        <div className="flex-1 h-5 bg-[var(--bg-warm)] rounded overflow-hidden">
          <div
            className="h-full bg-[var(--accent-violet)]/20 rounded"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="w-12 text-sm text-right text-[var(--text-muted)]">{value}</div>
      </div>
      <div className="text-xs text-[var(--text-faint)] ml-[10.5rem]">{detail}</div>
    </div>
  );
}
