import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ConceptDiffusionViz from '@/components/research/ConceptDiffusionViz';
import dataRaw from '@/data/concept-diffusion.json';

export const metadata: Metadata = {
  title: 'Concept Diffusion — Source Library Research',
  description:
    'Tracking how concepts and vocabulary spread across languages and centuries in 2,400 pre-modern texts. A Google Ngrams for specialist historical literature.',
  alternates: { canonical: '/research/concept-diffusion' },
};

interface Term {
  term: string;
  n: number;
  cat: string;
  cv: number;
  peak: number;
  periods: Record<string, number>;
  lang?: string;
}

interface ConceptData {
  corpus: {
    totalBooks: number;
    periodTotals: Record<string, number>;
    periods: number[];
    categories: Record<string, number>;
  };
  keywords: Term[];
  vocab: Term[];
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

// Top languages for vocab grouping (by number of terms in the dataset)
const TOP_LANGUAGES = [
  'Latin',
  'German',
  'Greek',
  'French',
  'Sanskrit',
  'Italian',
  'Dutch',
  'Hebrew',
  'Chinese',
];

export default function ConceptDiffusionPage() {
  const data = dataRaw as ConceptData;
  const { corpus, keywords, vocab } = data;

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

  // Build language groups: top N vocab per language
  const vocabGroups: Record<string, string[]> = {};
  for (const lang of TOP_LANGUAGES) {
    const langVocab = vocab
      .filter((v) => v.lang === lang)
      .slice(0, 15)
      .map((v) => v.term);
    if (langVocab.length > 0) {
      vocabGroups[lang] = langVocab;
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
        <StatCard label="English keywords" value={keywords.length.toLocaleString()} />
        <StatCard label="Original vocabulary" value={vocab.length.toLocaleString()} />
        <StatCard label="Date range" value={dateRange} />
      </div>

      {/* Main visualization */}
      <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6 mb-8">
        <h2 className="font-serif text-xl mb-1">Term Frequency Over Time</h2>
        <p className="text-[var(--text-muted)] text-sm mb-4">
          Search {keywords.length.toLocaleString()} English keywords or{' '}
          {vocab.length.toLocaleString()} original-language vocabulary terms. Each line shows how
          often a term appears across 50-year periods. Toggle between keywords (from AI translations)
          and vocabulary (from OCR of original texts).
        </p>
        <ConceptDiffusionViz
          keywords={keywords}
          vocab={vocab}
          corpus={corpus}
          groups={groups}
          vocabGroups={vocabGroups}
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

      {/* Download section */}
      <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6 mb-8">
        <h2 className="font-serif text-xl mb-2">Download the Dataset</h2>
        <p className="text-[var(--text-muted)] text-sm mb-4">
          The full research dataset is available for download under a CC-BY-4.0 license. It includes
          34,000+ English keywords and 42,000+ original-language vocabulary terms (10+ book
          threshold), with full time series, corpus metadata, and schema documentation.
        </p>
        <a
          href="/api/research/concept-diffusion-download"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-violet)] text-white text-sm hover:opacity-90 transition-opacity"
        >
          Download Research Dataset (JSON, ~23 MB)
        </a>
        <p className="text-xs text-[var(--text-faint)] mt-2">
          Citation: Source Library (2026). Concept Diffusion Dataset v2.0.
          https://sourcelibrary.org/research/concept-diffusion
        </p>
      </div>

      {/* Methodology */}
      <div className="bg-[var(--bg-warm)] rounded-lg p-4 sm:p-6 text-sm text-[var(--text-secondary)]">
        <h3 className="font-serif text-lg mb-2">Methodology</h3>
        <p className="mb-2">
          This dataset draws on two complementary extraction methods applied to{' '}
          {corpus.totalBooks.toLocaleString()} pre-modern texts from {corpus.periods[0]} to{' '}
          {corpus.periods[corpus.periods.length - 1] + 50}:
        </p>
        <p className="mb-2">
          <strong>English keywords</strong> are extracted by AI (Gemini) from each page&apos;s
          translated text. Every page produces a set of &lt;keywords&gt; tags identifying the key
          concepts discussed on that page. The {keywords.length.toLocaleString()} keywords shown here
          each appear in 50 or more books. Keywords are grouped by subject category based on which
          category of books most frequently produces each keyword.
        </p>
        <p className="mb-2">
          <strong>Original vocabulary</strong> is extracted from OCR output of the original texts —
          Latin, German, Greek, French, Sanskrit, and other languages. These{' '}
          {vocab.length.toLocaleString()} terms (each appearing in 20+ books) are grouped by primary
          language. This preserves the actual terminology used by historical authors, complementing
          the standardized English keywords.
        </p>
        <p className="mb-2">
          Case variants (e.g. &ldquo;Mercury&rdquo; and &ldquo;mercury&rdquo;) are merged.
          Bibliographic noise (shelfmarks, binding terms, digitization artifacts) is filtered.
          &ldquo;Normalized frequency&rdquo; divides the number of books containing a term by the
          total books in that period, controlling for the uneven corpus distribution (densest in the
          1600s). The coefficient of variation (CV) measures temporal concentration — higher values
          indicate terms that surge and decline, while low values indicate persistent concepts.
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
