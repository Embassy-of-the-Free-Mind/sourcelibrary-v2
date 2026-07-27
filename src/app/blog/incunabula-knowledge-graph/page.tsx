import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Mapping the Incunabula: A Knowledge Graph of the First Printed Books - Research Notes - Source Library',
  description: 'An interactive force-directed graph connecting nearly 1,000 incunabula by author, printer, place, and subject — revealing the networks behind the printing revolution.',
  openGraph: {
    images: [{ url: 'https://images.sourcelibrary.org/archived/6909d654cf28baa1b4cb0269/4.jpg', alt: 'Allegorical printing press vignette from Zimmermann, 1751' }],
    title: 'Mapping the Incunabula: A Knowledge Graph of the First Printed Books',
    description: 'An interactive force-directed graph connecting nearly 1,000 incunabula by author, printer, place, and subject.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/6909d654cf28baa1b4cb0269/4.jpg', alt: 'Allegorical printing press vignette from Zimmermann, 1751' }],
  },
  alternates: {
    canonical: '/blog/incunabula-knowledge-graph',
  },
};

export default function IncunabulaKnowledgeGraphPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Mapping the Incunabula"
          subtitle="A knowledge graph of the first printed books"
          image="https://images.sourcelibrary.org/archived/6909d654cf28baa1b4cb0269/4.jpg"
          imageAlt="Allegorical printing press vignette from Zimmermann, 1751"
        >
          <p className="text-stone-400 text-sm mt-4">22 April 2026 &middot; 8 min read</p>
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
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">

        {/* --- Lead --- */}
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Every book printed before 1501 is called an <em>incunabulum</em> &mdash; a &ldquo;cradle book,&rdquo; from the infancy of print. There are about 30,000 of them. The British Library&rsquo;s <em>Incunabula Short Title Catalogue</em> (ISTC) records each one: who wrote it, who printed it, where, when, and in how many surviving copies.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          These are not obscure facts. They are the data points of a revolution. Between 1450 and 1500, printing went from a single workshop in Mainz to hundreds of presses across Europe. Ideas that had circulated in a few dozen manuscript copies were suddenly available in editions of hundreds. The question is not just <em>what</em> was printed, but <em>who was connected to whom</em>, and <em>where did ideas cluster</em>.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          We built a knowledge graph to find out.
        </p>

        {/* --- The Graph --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Graph
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          <Link href="/" className="text-accent-rust hover:underline">Source Library</Link> now holds nearly a thousand ISTC-catalogued incunabula &mdash; scanned, OCR&rsquo;d, and many translated into English for the first time. We cross-referenced each book with its ISTC metadata: author, printer, place of publication, and subject classification. Then we rendered the connections as an interactive force-directed graph.
        </p>

        <div className="my-8 p-6 bg-stone-100 rounded-lg border border-stone-200">
          <p className="text-secondary mb-3">
            <strong>Try it:</strong>{' '}
            <Link href="/admin/knowledge-graph" className="text-accent-rust hover:underline" target="_blank">
              sourcelibrary.org/admin/knowledge-graph
            </Link>
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-4">Five kinds of nodes:</p>
        <ul className="text-secondary leading-relaxed mb-8 space-y-2">
          <li><span className="inline-block w-3 h-3 rounded-full bg-[#8B7355] mr-2 align-middle" /><strong>Books</strong> &mdash; sized by page count</li>
          <li><span className="inline-block w-3 h-3 rounded-full bg-[#C45B28] mr-2 align-middle" /><strong>Authors</strong> &mdash; Aquinas, Aristotle, Ficino, Galen, Albertus Magnus&hellip;</li>
          <li><span className="inline-block w-3 h-3 rounded-full bg-[#2E7D5B] mr-2 align-middle" /><strong>Printers</strong> &mdash; the workshops that brought these texts to market</li>
          <li><span className="inline-block w-3 h-3 rounded-full bg-[#4A6FA5] mr-2 align-middle" /><strong>Places</strong> &mdash; Venice, Nuremberg, Strasbourg, Cologne, Rome&hellip;</li>
          <li><span className="inline-block w-3 h-3 rounded-full bg-[#7B4F8A] mr-2 align-middle" /><strong>Subjects</strong> &mdash; philosophy, medicine, astrology, natural magic&hellip;</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-12">
          Every edge is a relationship: this author wrote this book, this printer produced it, this city housed the press. Click any node and its connections light up. Search for &ldquo;Ficino&rdquo; and watch the Florentine Neoplatonist network emerge from the noise.
        </p>

        {/* --- What the Graph Reveals --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What the Graph Reveals
        </h2>

        <h3 className="text-xl text-primary mt-10 mb-4">Venice was the center of everything</h3>

        <p className="text-secondary leading-relaxed mb-8">
          The single largest cluster in the graph is Venice. By the 1480s, Venice had more active printing presses than any other city in Europe. The reasons were commercial (a major trading port), legal (relatively tolerant censorship), and technical (access to paper from the Veneto mills). The graph shows Venice connected to nearly every major author in the collection &mdash; Aristotle, Galen, Aquinas, Avicenna &mdash; because Venetian printers like Aldus Manutius, Jenson, and the Locatelli workshop printed them all.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">Aristotle dominates, but not alone</h3>

        <p className="text-secondary leading-relaxed mb-8">
          Aristotle is the most-connected author node, which surprises no one familiar with the period. What the graph shows that a reading list cannot is <em>how</em> Aristotle dominates: through commentaries. Most of the Aristotle cluster consists not of Aristotle&rsquo;s own texts but of works <em>about</em> Aristotle &mdash; by Aquinas, Duns Scotus, Averroes, Albert the Great. The medieval university curriculum was built on these commentaries, and the printers served the universities.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">Medicine and philosophy are entangled</h3>

        <p className="text-secondary leading-relaxed mb-8">
          Galen and Hippocrates sit close to Aristotle in the graph, connected by shared printers and shared cities. This reflects the historical reality that medicine, natural philosophy, and what we would now call &ldquo;science&rdquo; were not separate disciplines. A printer who produced Aristotle&rsquo;s <em>Physics</em> also produced Galen&rsquo;s <em>Ars Parva</em>, because the same students bought both.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">The esoteric fringe is a fringe</h3>

        <p className="text-secondary leading-relaxed mb-12">
          Books on astrology, alchemy, and natural magic form a distinct but connected cluster at the periphery. They share printers with the mainstream philosophical works (esoteric texts were profitable) but have fewer cross-links to the university curriculum. Ficino bridges both worlds &mdash; his translations of Plato and the Hermetica connect the Neoplatonic network to the broader Aristotelian mainstream.
        </p>

        {/* --- Seeing the Bigger Picture --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Seeing the Bigger Picture
        </h2>

        <p className="text-secondary leading-relaxed mb-8">
          The ISTC knowledge graph is one of several data experiments we&rsquo;ve built to visualize the intellectual landscape of early modern Europe. Others, available at{' '}
          <a href="https://secondrenaissance.ai/lab" className="text-accent-rust hover:underline" target="_blank" rel="noreferrer">secondrenaissance.ai/lab</a>:
        </p>

        {/* --- Ficino's Network --- */}
        <h3 className="text-xl text-primary mt-10 mb-4">Ficino&rsquo;s Network: Mapping the Transmission</h3>

        <p className="text-secondary leading-relaxed mb-6">
          The most directly related experiment is{' '}
          <a href="https://secondrenaissance.ai/blog/ficino-network" className="text-accent-rust hover:underline" target="_blank" rel="noreferrer">Mapping the Transmission</a>{' '}
          &mdash; an interactive network visualization of 57 Renaissance scholars connected by 116 documented relationships, tracing how Neoplatonic ideas traveled from Ficino&rsquo;s Florentine academy to Copernicus&rsquo;s heliocentric model. Each scholar node links to actual publication records from the USTC.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The ISTC knowledge graph and Ficino&rsquo;s network are two views of the same revolution. The knowledge graph shows the <em>production</em> network &mdash; who printed what, where, for whom. Ficino&rsquo;s network shows the <em>intellectual</em> network &mdash; who taught whom, who corresponded with whom, who funded whom. Where they overlap is where the printing press met the Platonic Academy: Ficino&rsquo;s translations of Plato and the Hermetica were among the most influential incunabula ever produced, and they appear in both graphs, connecting the commercial world of Venetian and Florentine printers to the philosophical world of Neoplatonic transmission.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          One of the most striking findings from the Ficino network is the gap between intellectual influence and publication volume. Paracelsus leads with 326 editions; Copernicus has 5. Some of the most important nodes &mdash; Cosimo de&rsquo; Medici, Leonardo da Vinci, Domenico Maria Novara &mdash; published nothing at all. The ISTC knowledge graph, built on printed books, is blind to these unpublished influencers. The two visualizations together tell a fuller story.
        </p>

        {/* --- Other visualizations --- */}
        <h3 className="text-xl text-primary mt-10 mb-4">Rivers of Tradition</h3>

        <p className="text-secondary leading-relaxed mb-8">
          A{' '}
          <a href="https://secondrenaissance.vercel.app/rivers" className="text-accent-rust hover:underline" target="_blank" rel="noreferrer">Sankey flow diagram</a>{' '}
          mapping how nine occult and esoteric traditions &mdash; Hermetica, Alchemy, Mysticism, Kabbalah, Neoplatonism, and more &mdash; flow from 1469 to 1750. Where the ISTC knowledge graph shows <em>who printed what where</em>, the Rivers show <em>which ideas traveled together</em> across centuries.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">Printing Centers Map</h3>

        <p className="text-secondary leading-relaxed mb-8">
          An{' '}
          <a href="https://secondrenaissance.vercel.app/map" className="text-accent-rust hover:underline" target="_blank" rel="noreferrer">animated map</a>{' '}
          showing how Latin printing expanded from Mainz across 48 European cities between 1450 and 1700. Watch Gutenberg&rsquo;s invention ripple outward &mdash; first to Strasbourg and Cologne, then to Venice and Rome, then to the university towns. The knowledge graph gives you the network; the map gives you the geography.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">USTC Explorer</h3>

        <p className="text-secondary leading-relaxed mb-8">
          The{' '}
          <a href="https://secondrenaissance.vercel.app/explore" className="text-accent-rust hover:underline" target="_blank" rel="noreferrer">USTC Explorer</a>{' '}
          is a dashboard built on 556,000 records from the Universal Short Title Catalogue. It shows language trends, accessibility funnels, and subject breakdowns across 250 years of European printing. The ISTC covers only the first 50 years; the USTC carries the story forward.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">Book Atlas</h3>

        <p className="text-secondary leading-relaxed mb-8">
          A{' '}
          <Link href="/research/atlas" className="text-accent-rust hover:underline">3D constellation</Link>{' '}
          of 3,500+ texts clustered by AI embeddings and reduced to three dimensions via UMAP. Books that are semantically similar sit close together. Spin it, zoom in, click a star &mdash; it&rsquo;s the same data as the knowledge graph, but organized by <em>meaning</em> rather than <em>metadata</em>.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">Translation Lag</h3>

        <p className="text-secondary leading-relaxed mb-8">
          A{' '}
          <Link href="/research/translation-lag" className="text-accent-rust hover:underline">scatter plot</Link>{' '}
          revealing the gap between when a work was composed and when it was first translated into English. Some of the incunabula in the knowledge graph were written by authors who lived two thousand years earlier &mdash; Aristotle, Galen, Hippocrates. Their works waited centuries for Latin translation, then more centuries for English. The lag itself is a story about which ideas Europe was ready to hear.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">Image Deep Zoom</h3>

        <p className="text-secondary leading-relaxed mb-12">
          An{' '}
          <Link href="/research/image-atlas" className="text-accent-rust hover:underline">explorable canvas</Link>{' '}
          of 39,783 illustrations from historical books, clustered by visual similarity. Many of the woodcuts in incunabula &mdash; anatomical diagrams, astronomical charts, botanical illustrations &mdash; appear here, grouped not by book or date but by what they <em>look like</em>. Zoom in on a cluster of celestial diagrams and you&rsquo;ll find Sacrobosco&rsquo;s <em>Sphaera Mundi</em> next to Regiomontanus&rsquo;s <em>Calendarium</em>, connected by their shared visual vocabulary.
        </p>

        {/* --- What Comes Next --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What Comes Next
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The knowledge graph currently shows ~970 incunabula from Source Library&rsquo;s collection. We plan to:
        </p>

        <ol className="text-secondary leading-relaxed mb-12 space-y-3 list-decimal list-inside">
          <li><strong>Cross-reference ISTC with USTC</strong> to find additional digitized copies from libraries across Europe &mdash; Gallica, the Bodleian, HAB Wolfenb&uuml;ttel, the Vatican</li>
          <li><strong>Add entity co-occurrence edges</strong> &mdash; when two books mention the same person or concept in their text, link them</li>
          <li><strong>Add work-level grouping</strong> &mdash; many of these incunabula are different editions of the same text (there are at least four different printings of Albert the Great&rsquo;s <em>Secreta Mulierum</em> in the collection). Linking editions of the same work collapses the graph into a more meaningful shape</li>
          <li><strong>Make it public</strong> &mdash; the graph is currently an admin tool, but there&rsquo;s no reason it can&rsquo;t be a research interface</li>
        </ol>

        <p className="text-secondary leading-relaxed mb-12">
          The incunabula are the root system of modern knowledge. The knowledge graph is an attempt to see that root system whole.
        </p>

        <hr className="border-stone-300 my-12" />

        <p className="text-muted text-sm leading-relaxed mb-4">
          <em>Source Library is a digital library of primary sources in the Western esoteric tradition, classical antiquity, and early modern natural philosophy. All texts are scanned from original editions, OCR&rsquo;d, and translated into English using AI. Visit{' '}
          <Link href="/" className="text-accent-rust hover:underline">sourcelibrary.org</Link>.</em>
        </p>

        <p className="text-muted text-sm leading-relaxed">
          <em>The research lab at{' '}
          <a href="https://secondrenaissance.ai/lab" className="text-accent-rust hover:underline" target="_blank" rel="noreferrer">secondrenaissance.ai/lab</a>{' '}
          contains interactive data experiments exploring half a million Latin works printed between 1450 and 1700.</em>
        </p>

      </article>

    </ContentPageLayout>
  );
}
