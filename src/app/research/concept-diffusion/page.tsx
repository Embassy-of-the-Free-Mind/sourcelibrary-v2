import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ConceptDiffusionViz from '@/components/research/ConceptDiffusionViz';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Concept Diffusion — Source Library Research',
  description:
    'Tracking how alchemical, philosophical, and esoteric concepts spread across languages and centuries in 2,400 pre-modern texts. A Google Ngrams for specialist historical literature.',
  alternates: { canonical: '/research/concept-diffusion' },
};

// Curated concept groups
const CONCEPT_GROUPS: Record<string, string[]> = {
  'Alchemical Processes': [
    'Calcination', 'Putrefaction', 'Sublimation', 'Distillation',
    'Coagulation', 'Fermentation', 'Projection', 'Fixation', 'Decoction',
  ],
  'Alchemical Goals': [
    "Philosopher's Stone", 'Transmutation', 'Tincture', 'Elixir',
    'Potable Gold', 'Universal Medicine', 'Quintessence', 'First Matter',
  ],
  'Esoteric Traditions': [
    'Kabbalah', 'Hermetic Philosophy', 'Natural Magic', 'Alchemy',
    'Necromancy', 'Tree of Life', 'Astrology',
  ],
  'Natural Philosophy': [
    'Microcosm', 'Natural Law', 'Monad', 'Melancholy',
    'Physiognomy', 'Free Will', 'Providence',
  ],
};

const ALL_CONCEPTS = Object.values(CONCEPT_GROUPS).flat();

interface ConceptPeriod {
  concept: string;
  period: number;
  count: number;
  normalized: number; // count / total books in period
  languages: string[];
}

interface ConceptSummary {
  concept: string;
  total: number;
  earliest: number;
  latest: number;
  langCount: number;
  peak: number; // period with highest normalized frequency
  peakValue: number;
}

interface PeriodTotal {
  period: number;
  count: number;
}

async function fetchConceptData() {
  const db = await getDb();
  const baseFilter = {
    'index.generatedAt': { $exists: true },
    hidden: { $ne: true },
    deleted: { $ne: true },
    year: { $gte: 1200, $lte: 1930 },
  };

  const [rawData, totalsRaw, conceptTotalsRaw, topConceptsRaw] = await Promise.all([
    // Concept counts by 50-year period
    db.collection('books').aggregate([
      { $match: baseFilter },
      { $unwind: '$index.concepts' },
      { $match: { 'index.concepts.term': { $in: ALL_CONCEPTS } } },
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

    // Concept totals
    db.collection('books').aggregate([
      { $match: baseFilter },
      { $unwind: '$index.concepts' },
      { $match: { 'index.concepts.term': { $in: ALL_CONCEPTS } } },
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
    ]).toArray(),

    // Top 30 concepts overall (not just our curated set)
    db.collection('books').aggregate([
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
      { $limit: 30 },
    ]).toArray(),
  ]);

  const totals: PeriodTotal[] = totalsRaw.map((t) => ({ period: t._id, count: t.count }));
  const totalMap = new Map(totals.map((t) => [t.period, t.count]));

  const data: ConceptPeriod[] = rawData.map((d) => ({
    concept: d._id.concept,
    period: d._id.period,
    count: d.count,
    normalized: d.count / (totalMap.get(d._id.period) || 1),
    languages: d.languages,
  }));

  // Build concept summaries with peak period
  const conceptMap = new Map<string, ConceptPeriod[]>();
  for (const d of data) {
    if (!conceptMap.has(d.concept)) conceptMap.set(d.concept, []);
    conceptMap.get(d.concept)!.push(d);
  }

  const summaries: ConceptSummary[] = conceptTotalsRaw.map((c) => {
    const periods = conceptMap.get(c._id) || [];
    const peak = periods.reduce(
      (best, p) => (p.normalized > best.value ? { period: p.period, value: p.normalized } : best),
      { period: 0, value: 0 },
    );
    return {
      concept: c._id,
      total: c.total,
      earliest: c.earliest,
      latest: c.latest,
      langCount: c.languages.length,
      peak: peak.period,
      peakValue: peak.value,
    };
  });

  const topConcepts = topConceptsRaw.map((c) => ({
    concept: c._id,
    total: c.total,
    earliest: c.earliest,
    latest: c.latest,
    langCount: c.languages.length,
  }));

  return { data, totals, summaries, topConcepts };
}

export default async function ConceptDiffusionPage() {
  const { data, totals, summaries, topConcepts } = await fetchConceptData();

  const totalBooks = totals.reduce((s, t) => s + t.count, 0);
  const totalConcepts = summaries.length;
  const avgLanguages = Math.round(
    summaries.reduce((s, c) => s + c.langCount, 0) / summaries.length,
  );
  const dateRange = `${Math.min(...totals.map((t) => t.period))}–${Math.max(...totals.map((t) => t.period)) + 50}`;

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Concept Diffusion"
          subtitle="How did alchemical, philosophical, and esoteric ideas spread across languages and centuries? Tracking concept frequency in 2,400 pre-modern texts."
        />
      }
      maxWidth="wide"
    >
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label="Books indexed" value={totalBooks.toLocaleString()} />
        <StatCard label="Concepts tracked" value={String(totalConcepts)} />
        <StatCard label="Avg languages per concept" value={String(avgLanguages)} />
        <StatCard label="Date range" value={dateRange} />
      </div>

      {/* Main visualization */}
      <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6 mb-8">
        <h2 className="font-serif text-xl mb-1">Concept Frequency Over Time</h2>
        <p className="text-[var(--text-muted)] text-sm mb-4">
          Each line shows how often a concept appears in books from that period, normalized by the
          total number of books. Select concepts to compare their trajectories. Toggle between raw
          counts and normalized frequency.
        </p>
        <ConceptDiffusionViz
          data={data}
          totals={totals}
          groups={CONCEPT_GROUPS}
        />
      </div>

      {/* Top concepts table */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6">
          <h2 className="font-serif text-xl mb-4">Most Discussed Concepts</h2>
          <p className="text-[var(--text-muted)] text-sm mb-4">
            Top concepts by number of books in which they appear, from the full corpus (not limited to the curated set above).
          </p>
          <div className="space-y-2">
            {topConcepts.slice(0, 15).map((c) => (
              <ConceptBar
                key={c.concept}
                label={c.concept}
                value={c.total}
                max={topConcepts[0].total}
                detail={`${c.earliest}–${c.latest}, ${c.langCount} languages`}
              />
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6">
          <h2 className="font-serif text-xl mb-4">Peak Periods</h2>
          <p className="text-[var(--text-muted)] text-sm mb-4">
            When did each tracked concept reach its highest relative frequency?
          </p>
          <div className="space-y-2">
            {summaries
              .sort((a, b) => a.peak - b.peak)
              .map((c) => (
                <div key={c.concept} className="flex items-center gap-3 text-sm">
                  <div className="w-40 text-[var(--text-secondary)] truncate" title={c.concept}>
                    {c.concept}
                  </div>
                  <div className="flex-1 text-[var(--text-muted)]">
                    {c.peak}–{c.peak + 50}
                  </div>
                  <div className="text-right text-[var(--text-muted)]">
                    {Math.round(c.peakValue * 100)}% of books
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
          &ldquo;Normalized frequency&rdquo; divides the number of books mentioning a concept by the total
          number of indexed books in that period, controlling for the uneven distribution of the corpus
          (which is densest in the 1600s). Raw counts show absolute presence.
        </p>
        <p>
          This is analogous to Google Ngrams but for specialist pre-modern literature — covering
          alchemical, Hermetic, Kabbalistic, and natural philosophical texts that are underrepresented
          in general book corpora. {totalBooks.toLocaleString()} of the corpus&apos;s ~2,400 visible books
          have AI-generated indexes with concept terms.
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
