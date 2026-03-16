import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'Visualizing 20,000 Books Across Six Dimensions - Source Library',
  description: 'Interactive visualizations of Source Library\'s faceted classification: scatter plot, heatmap, Sankey flow, and chord diagram — showing how 17 traditions flow into 15 domains across 11 cultural spheres.',
  openGraph: {
    title: 'Visualizing 20,000 Books Across Six Dimensions',
    description: 'Four interactive D3 visualizations of a faceted library classification system.',
  },
  alternates: {
    canonical: '/blog/visualizing-classification',
  },
};

export default function VisualizingClassificationPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Visualizing 20,000 Books Across Six Dimensions"
          subtitle="What does a faceted classification look like? Four views of the same library."
        >
          <p className="text-stone-400 text-sm mt-4">16 March 2026 &middot; 6 min read &middot; Interactive</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All posts
        </Link>
      </div>

      <article className="prose-content max-w-none">

        <p className="text-xl text-secondary leading-relaxed mb-8">
          We tagged every book in Source Library with six independent facets &mdash; tradition, domain,
          form, cultural sphere, era, and epistemic mode. That created a rich dataset: 20,000 books,
          each with 6&ndash;12 tags from a controlled vocabulary of 68 values.
          Here are four ways to see the structure that emerged.
        </p>

        <p className="text-sm text-muted mb-8">
          These visualizations were generated collaboratively: Derek directed the analysis and design;
          Claude built the code and data pipeline. The faceted classification system itself is described
          in{' '}
          <Link href="/blog/history-of-classification" className="text-accent-rust hover:underline">
            Ten Thousand Years of Tagging
          </Link>.
        </p>

        {/* --- Interactive viz --- */}
        <div className="mb-8 -mx-4 md:-mx-8 lg:-mx-12">
          <iframe
            src="/blog/visualizing-classification/viz.html"
            className="w-full border border-border-light rounded-lg bg-white"
            style={{ height: '760px' }}
            title="Interactive faceted classification visualizations"
            loading="lazy"
          />
        </div>

        {/* --- Reading guide --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-6">
          What Each View Shows
        </h2>

        <h3 className="text-lg font-display font-semibold text-primary mt-8 mb-3">
          Map: Semantic Similarity, Colored by Facet
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          Each dot is a book, positioned by semantic similarity (UMAP projection of text embeddings).
          Books with similar content are near each other. The toggle buttons let you recolor the
          same map by any facet: tradition, domain, form, sphere, era, or mode. Watch how the
          structure shifts &mdash; the alchemical texts (gold) cluster together when colored by
          tradition, but scatter across natural-philosophy and medicine when colored by domain.
        </p>

        <h3 className="text-lg font-display font-semibold text-primary mt-8 mb-3">
          Heatmap: Tradition &times; Domain (Bacon&rsquo;s Desiderata)
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          The dark cells are where the collection is deep. The white cells are where it&rsquo;s thin.
          This is Francis Bacon&rsquo;s <em>desiderata</em> made visible &mdash; a map of what knowledge
          is <em>missing</em>. Alchemy &times; natural-philosophy is dark (hundreds of books).
          Sufi &times; music is white (a known gap). Every white cell is a curation opportunity.
        </p>

        <h3 className="text-lg font-display font-semibold text-primary mt-8 mb-3">
          Flow: How Traditions Feed into Domains
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          A Sankey diagram showing how intellectual traditions flow into subject domains.
          Some traditions are narrow &mdash; masonic texts flow almost entirely into theology.
          Others are broad &mdash; classical Greek and Roman thought feeds into history, ethics,
          natural philosophy, theology, and art. The width of each ribbon is the number of books
          at that intersection.
        </p>

        <h3 className="text-lg font-display font-semibold text-primary mt-8 mb-3">
          Connections: When Traditions Overlap
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          A chord diagram showing tradition co-occurrence. When two traditions appear as tags on the
          same book, they share a ribbon. Hermetic and alchemical are tightly linked (many books
          carry both tags). Classical and neoplatonic overlap heavily. But vedic and rosicrucian
          never appear together &mdash; they are intellectually isolated from each other in this collection.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-6">
          What Surprised Us
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>The collection is 60% treatises.</strong> The form distribution is dominated by
          sustained arguments on a single subject. Anthologies, manuals, and poetry are a distant
          second. Source Library is overwhelmingly a collection of <em>thinkers thinking</em>.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Christian mystical is the second-largest tradition</strong> after classical Greek &amp; Roman.
          We thought of the library as primarily &ldquo;esoteric&rdquo; &mdash; alchemy, Hermeticism,
          Kabbalah. But the data says it&rsquo;s as much a library of Christian contemplative theology
          as it is of Western esotericism.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>The Latin West dominates.</strong> Despite hundreds of Chinese, Sanskrit, and Arabic texts,
          the cultural sphere distribution is heavily Latin + Vernacular European. The non-Western
          traditions are present but thin. The heatmap makes this painfully clear.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          <strong>Speculative mode is everywhere.</strong> Over half the books are tagged &ldquo;speculative&rdquo;
          &mdash; reasoning from principles rather than from observation. This is a library of
          metaphysics, not of experiment. Bacon would have been disappointed.
        </p>

        <div className="border border-border-light rounded-lg p-8 bg-white mb-12">
          <h3 className="text-lg font-medium text-primary mb-3">About This Report</h3>
          <p className="text-secondary text-sm leading-relaxed">
            This analysis was produced collaboratively by Derek Lomas and Claude (Anthropic).
            Derek directed the research questions, classification design, and editorial choices.
            Claude built the faceted vocabulary, ran the Gemini-powered tagger, generated the
            D3 visualizations, and drafted the text. The data covers {'>'}20,000 books classified
            across 6 facets with 68 tag values. Classification cost: $0.70.
          </p>
        </div>

      </article>

      <BlogComments slug="visualizing-classification" />
    </ContentPageLayout>
  );
}
