import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BookConstellationViz from '@/components/research/BookConstellationViz';
import dataRaw from '@/data/book-constellation.json';

export const metadata: Metadata = {
  title: 'Book Atlas — Source Library Research',
  description:
    'Explore 3,500 pre-modern texts as a navigable constellation, clustered by content similarity using AI embeddings and UMAP dimensionality reduction.',
  alternates: { canonical: '/research/atlas' },
};

export default function BookAtlasPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = dataRaw as any;

  const topCategories = Object.entries(
    data.books.reduce(
      (acc: Record<string, number>, b: { category: string }) => {
        acc[b.category] = (acc[b.category] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
  )
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 8);

  const topLanguages = Object.entries(
    data.books.reduce(
      (acc: Record<string, number>, b: { language: string }) => {
        acc[b.language] = (acc[b.language] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
  )
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 6);

  const firstTranslations = data.books.filter((b: { first_translation: boolean }) => b.first_translation).length;

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Book Atlas"
          subtitle="Explore 3,500 pre-modern texts as a navigable constellation. Books that discuss similar concepts cluster together, revealing the hidden structure of the Western esoteric tradition."
        />
      }
      maxWidth="wide"
    >
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label="Books mapped" value={data.meta.total_books.toLocaleString()} />
        <StatCard label="Topic clusters" value={String(data.meta.n_clusters)} />
        <StatCard
          label="Languages"
          value={String(
            new Set(data.books.map((b: { language: string }) => b.language)).size,
          )}
        />
        <StatCard label="First translations" value={String(firstTranslations)} />
      </div>

      {/* Main visualization */}
      <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6 mb-8">
        <h2 className="font-serif text-xl mb-1">Content Constellation</h2>
        <p className="text-[var(--text-muted)] text-sm mb-4">
          Each point is a book. Position is determined by AI analysis of each book&apos;s
          content — summaries, themes, index terms, and subject keywords are embedded into
          a 384-dimensional vector space, then projected to 2D using UMAP. Hover for
          details, click to read.
        </p>
        <BookConstellationViz data={data} />
      </div>

      {/* Two-column breakdown */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6">
          <h2 className="font-serif text-xl mb-4">By Subject</h2>
          <div className="space-y-2">
            {topCategories.map(([cat, count]) => (
              <CategoryBar
                key={cat}
                label={formatCategory(cat as string)}
                value={count as number}
                max={topCategories[0][1] as number}
              />
            ))}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-[var(--border-light)] p-4 sm:p-6">
          <h2 className="font-serif text-xl mb-4">By Language</h2>
          <div className="space-y-2">
            {topLanguages.map(([lang, count]) => (
              <CategoryBar
                key={lang}
                label={lang as string}
                value={count as number}
                max={topLanguages[0][1] as number}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Methodology */}
      <div className="bg-[var(--bg-warm)] rounded-lg p-4 sm:p-6 text-sm text-[var(--text-secondary)]">
        <h3 className="font-serif text-lg mb-2">Methodology</h3>
        <p className="mb-2">
          Each book&apos;s content is represented as a text string combining its title,
          author, AI-generated description, reading summary, thematic analysis, and index
          terms (concepts, people, places, key terms). This text is embedded using the{' '}
          <code className="text-xs bg-[var(--bg-cream)] px-1 py-0.5 rounded">
            paraphrase-multilingual-MiniLM-L12-v2
          </code>{' '}
          sentence-transformer model, producing a 384-dimensional vector for each book.
        </p>
        <p className="mb-2">
          The 384-dimensional embeddings are projected to 2D using{' '}
          <strong>UMAP</strong> (Uniform Manifold Approximation and Projection) with cosine
          distance, n_neighbors=15, and min_dist=0.1. UMAP preserves both local and global
          structure — books that are semantically similar in the high-dimensional space
          remain close in the 2D projection.
        </p>
        <p className="mb-2">
          <strong>K-Means clustering</strong> (k={data.meta.n_clusters}) is applied to the
          original 384-dimensional embeddings (not the 2D projection) to identify coherent
          topic groups. Cluster labels are derived from the most common keywords within
          each cluster.
        </p>
        <p>
          The multilingual model handles the corpus&apos;s language diversity — Latin,
          German, Chinese, Sanskrit, Arabic, Hebrew, and other texts are mapped into the
          same semantic space alongside English translations. This enables cross-linguistic
          clustering: a Latin alchemical treatise will cluster near German alchemical works,
          not near Latin theology.
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

function formatCategory(cat: string): string {
  return cat
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function CategoryBar({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-32 text-sm text-[var(--text-secondary)] truncate"
        title={label}
      >
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
  );
}
