import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ConceptDiffusionViz from '@/components/research/ConceptDiffusionViz';
import dataRaw from '@/data/concept-diffusion.json';

export const metadata: Metadata = {
  title: 'Concept Diffusion — Source Library Research',
  description:
    'Tracking how concepts spread across languages and centuries in 2,400 pre-modern texts. A Google Ngrams for specialist historical literature.',
  alternates: { canonical: '/research/concept-diffusion' },
};

interface Keyword {
  term: string;
  n: number;
  cat: string;
  cv: number;
  peak: number;
  periods: Record<string, number>;
}

interface ConceptData {
  corpus: {
    totalBooks: number;
    periodTotals: Record<string, number>;
    periods: number[];
    categories: Record<string, number>;
  };
  keywords: Keyword[];
}

const CATEGORY_LABELS: Record<string, string> = {
  alchemy: 'Alchemy',
  theology: 'Theology',
  philosophy: 'Philosophy',
  'natural-philosophy': 'Natural Philosophy',
  hermeticism: 'Hermeticism',
  history: 'History',
  mysticism: 'Mysticism',
  astrology: 'Astrology',
  medicine: 'Medicine',
  kabbalah: 'Kabbalah',
  magic: 'Magic',
  mathematics: 'Mathematics',
  rosicrucianism: 'Rosicrucianism',
  freemasonry: 'Freemasonry',
  science: 'Science',
  occultism: 'Occultism',
  astronomy: 'Astronomy',
  literature: 'Literature',
  'ritual-magic': 'Ritual Magic',
  music: 'Music',
  'christian-mysticism': 'Christian Mysticism',
  'jewish-kabbalah': 'Jewish Kabbalah',
  art: 'Art',
  botany: 'Botany',
  military: 'Military',
};

function formatCategory(cat: string): string {
  return (
    CATEGORY_LABELS[cat] ||
    cat
      .split('-')
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ')
  );
}

// Top categories for grouping keywords (those with 10+ keywords)
const TOP_CATEGORIES = [
  'theology',
  'hermeticism',
  'alchemy',
  'philosophy',
  'natural-philosophy',
  'history',
  'medicine',
  'astrology',
  'mysticism',
  'astronomy',
];

export default function ConceptDiffusionPage() {
  const data = dataRaw as ConceptData;
  const { corpus, keywords } = data;

  // Build category groups: top N keywords per category
  const groups: Record<string, string[]> = {};
  for (const cat of TOP_CATEGORIES) {
    const catKeywords = keywords
      .filter((k) => k.cat === cat)
      .slice(0, 15)
      .map((k) => k.term);
    if (catKeywords.length > 0) {
      groups[formatCategory(cat)] = catKeywords;
    }
  }

  // Suggestions: temporally interesting keywords
  const rising = keywords
    .filter((k) => k.peak >= 1750 && k.cv > 0.8 && k.n >= 80)
    .slice(0, 8)
    .map((k) => k.term);

  const earlyPeakers = keywords
    .filter((k) => k.peak <= 1400 && k.cv > 0.6 && k.n >= 80)
    .slice(0, 8)
    .map((k) => k.term);

  const persistent = keywords
    .filter((k) => k.cv < 0.4 && k.n >= 200)
    .sort((a, b) => a.cv - b.cv)
    .slice(0, 8)
    .map((k) => k.term);

  // Default selection: keywords with interesting temporal stories
  const defaultSelected = ['alchemy', 'Astrology', 'Soul', 'natural philosophy'];

  // Stats
  const dateRange = `${corpus.periods[0]}–${corpus.periods[corpus.periods.length - 1] + 50}`;
  const highCV = keywords.filter((k) => k.cv > 0.5).length;

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
        <StatCard label="Books indexed" value={corpus.totalBooks.toLocaleString()} />
        <StatCard label="Keywords tracked" value={keywords.length.toLocaleString()} />
        <StatCard label="Temporally variable" value={highCV.toLocaleString()} />
        <StatCard label="Date range" value={dateRange} />
      </div>

      {/* Main visualization */}
      <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6 mb-8">
        <h2 className="font-serif text-xl mb-1">Keyword Frequency Over Time</h2>
        <p className="text-[var(--text-muted)] text-sm mb-4">
          Search 5,000+ keywords extracted from translated page text. Each line shows how often a
          keyword appears across 50-year periods. Toggle normalized frequency to control for uneven
          corpus distribution. Select up to 10 to compare.
        </p>
        <ConceptDiffusionViz
          keywords={keywords}
          corpus={corpus}
          groups={groups}
          defaultSelected={defaultSelected}
          suggestions={{ rising, earlyPeakers, persistent }}
        />
      </div>

      {/* Two-column breakdown */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6">
          <h2 className="font-serif text-xl mb-4">Most Frequent Keywords</h2>
          <p className="text-[var(--text-muted)] text-sm mb-4">
            Top keywords by number of books in which they appear.
          </p>
          <div className="space-y-2">
            {keywords.slice(0, 15).map((k) => (
              <ConceptBar
                key={k.term}
                label={k.term}
                value={k.n}
                max={keywords[0].n}
                detail={`cv=${k.cv.toFixed(2)}, peak ${k.peak}–${k.peak + 50}, ${formatCategory(k.cat)}`}
              />
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6">
          <h2 className="font-serif text-xl mb-4">Most Temporally Variable</h2>
          <p className="text-[var(--text-muted)] text-sm mb-4">
            Keywords with the highest coefficient of variation — concentrated in specific eras rather
            than evenly distributed.
          </p>
          <div className="space-y-2">
            {keywords
              .filter((k) => k.n >= 80)
              .sort((a, b) => b.cv - a.cv)
              .slice(0, 15)
              .map((k) => (
                <div key={k.term} className="flex items-center gap-3 text-sm">
                  <div
                    className="w-40 text-[var(--text-secondary)] truncate"
                    title={k.term}
                  >
                    {k.term}
                  </div>
                  <div className="flex-1 text-[var(--text-muted)]">
                    peak {k.peak}–{k.peak + 50}
                  </div>
                  <div className="text-right text-[var(--text-muted)] text-xs">
                    cv={k.cv.toFixed(2)} · {k.n} books · {formatCategory(k.cat)}
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
          Keywords are extracted by AI (Gemini) from each page&apos;s translated text during
          processing. Every page produces a set of &lt;keywords&gt; tags identifying the key terms
          discussed on that page. This analysis aggregates keyword presence across 50-year periods
          from {corpus.periods[0]} to {corpus.periods[corpus.periods.length - 1] + 50}, covering{' '}
          {corpus.totalBooks.toLocaleString()} indexed books.
        </p>
        <p className="mb-2">
          Keywords are grouped by subject category based on which category of books most frequently
          uses each keyword. Case variants (e.g. &ldquo;Mercury&rdquo; and &ldquo;mercury&rdquo;)
          are merged. The {keywords.length.toLocaleString()} keywords shown here each appear in 50
          or more books.
        </p>
        <p className="mb-2">
          &ldquo;Normalized frequency&rdquo; divides the number of books containing a keyword by the
          total number of indexed books in that period, controlling for the uneven distribution of
          the corpus (which is densest in the 1600s). The coefficient of variation (CV) measures how
          concentrated a keyword is in specific time periods — higher values indicate terms that
          surge and decline, while low values indicate persistent, omnipresent concepts.
        </p>
        <p>
          This is analogous to Google Ngrams but for specialist pre-modern literature — covering
          alchemical, Hermetic, Kabbalistic, theological, philosophical, and natural philosophical
          texts that are underrepresented in general book corpora.
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
