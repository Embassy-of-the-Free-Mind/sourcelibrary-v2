import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'What Does a Library of 3,400 Rare Books Look Like? - Blog - Source Library',
  description: 'We embedded 3,400 historical book summaries, clustered them with UMAP and HDBSCAN, and discovered 48 natural groupings spanning six intellectual traditions — from early modern alchemy to Sanskrit astronomy to Chinese military encyclopedias.',
  openGraph: {
    title: 'What Does a Library of 3,400 Rare Books Look Like?',
    description: 'Embedding-based clustering reveals 48 natural groupings across six intellectual traditions in one of the largest digitized rare book collections.',
  },
  alternates: {
    canonical: '/blog/clustering',
  },
};

export default function ClusteringPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="What Does a Library of 3,400 Rare Books Look Like?"
          subtitle="Embedding-based clustering reveals the hidden structure of a historical collection"
        >
          <p className="text-stone-400 text-sm mt-4">14 March 2026 &middot; 10 min read</p>
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

        {/* --- Lead --- */}
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library holds over 5,000 digitized rare books &mdash; alchemy, Hermetica, natural philosophy, Kabbalah, Chinese medicine, Sanskrit astrology, early modern theology. The collection grew organically over months of curation. What structure does it actually have? We embedded 3,424 book summaries with a neural language model, projected them into a shared vector space, and let a density-based clustering algorithm find the answer.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          The result: 48 natural clusters across six broad intellectual traditions. Not the categories we assigned &mdash; the categories the books assigned themselves.
        </p>

        {/* --- Interactive visualization --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Map
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Each dot is a book. Position reflects semantic similarity &mdash; books near each other have similar content. Colors represent the 48 discovered clusters. Hover over any point to see the title, author, year, and language. Click a cluster name in the legend to isolate it.
        </p>

        <div className="mb-8 -mx-4 md:-mx-8 lg:-mx-12">
          <iframe
            src="/blog/clustering/viz.html"
            className="w-full border border-border-light rounded-lg bg-white"
            style={{ height: '680px' }}
            title="Interactive cluster visualization of 3,424 rare books"
            loading="lazy"
          />
        </div>

        <p className="text-muted text-sm mb-12">
          2D UMAP projection of 768-dimensional sentence embeddings. Spatial proximity &asymp; semantic similarity. The projection preserves local neighborhoods but distorts global distances &mdash; clusters that appear far apart on screen may be closer in the original embedding space.
        </p>

        {/* --- What we did --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Method
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          We started with 10,083 non-hidden books in our MongoDB database. For each book, we extracted title, author, language, year, AI-generated summary, thematic tags, and the top 30 index terms (weighted by page frequency). Books without a substantial summary or at least some thematic tags were excluded, leaving 3,424 books with enough signal for meaningful embedding.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Each book&rsquo;s metadata was concatenated into a structured text representation:
        </p>

        <pre className="bg-warm rounded-lg p-4 text-sm text-secondary overflow-x-auto mb-6 border border-border-light"><code>{`Title: Traite de l'Harmonie Universelle
Author: Marin Mersenne
Language: French
Year: 1636
Summary: A comprehensive treatise on universal harmony...
Themes: music theory, Pythagorean harmony, acoustics
Key terms: harmonie, consonance, intervalles, proportion...`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          We embedded these using <strong>all-mpnet-base-v2</strong>, a 768-dimensional sentence transformer trained on over 1 billion text pairs. This runs locally &mdash; no API calls, fully reproducible. The model produces normalized vectors where cosine similarity reflects semantic relatedness.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          For clustering, we used <strong>UMAP</strong> (Uniform Manifold Approximation and Projection) to reduce the 768-dimensional embeddings to 10 dimensions, preserving local structure while making the space tractable for density estimation. Then <strong>HDBSCAN</strong> (Hierarchical Density-Based Spatial Clustering of Applications with Noise) identified clusters of varying density without requiring a pre-specified number of clusters. Unlike k-means, HDBSCAN doesn&rsquo;t force every point into a cluster &mdash; books that don&rsquo;t fit any group cleanly are classified as noise.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Finally, we sent each cluster&rsquo;s metadata (themes, terms, languages, sample titles) to Gemini Flash and asked it to generate a descriptive name, a one-sentence description, and tradition tags from a controlled vocabulary. The result is a taxonomy discovered from the data, not imposed on it.
        </p>

        {/* --- Findings --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What We Found: Six Intellectual Traditions
        </h2>

        <p className="text-secondary leading-relaxed mb-8">
          The 48 clusters organize naturally into roughly six macro-domains. This isn&rsquo;t a classification we designed &mdash; it&rsquo;s what the embedding space reveals about the collection&rsquo;s actual content.
        </p>

        {/* Macro-domain 1 */}
        <h3 className="text-xl text-primary mt-10 mb-3">
          Western Esotericism &amp; Occult Sciences
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          The largest domain by far, spanning 10+ clusters and over 800 books. <strong>Early Modern Alchemy</strong> is the single biggest cluster (350 books) &mdash; Latin and German texts on transmutation, Paracelsian medicine, and spagyric chemistry. Nearby: <strong>Hermetic and Neoplatonic Theurgy</strong> (79), <strong>Grimoires and Ceremonial Magic</strong> (59), <strong>Solomonic Grimoires</strong> (19), <strong>Rosicrucian Fraternity Defenses</strong> (38), and <strong>Christian Kabbalah</strong> (47). These form a dense archipelago in the visualization &mdash; closely related but distinguishable by period, language, and specificity.
        </p>

        {/* Macro-domain 2 */}
        <h3 className="text-xl text-primary mt-10 mb-3">
          Christian Theology &amp; Mysticism
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          Five clusters totaling ~350 books. <strong>Continental Christian Mysticism</strong> (185) is the second-largest cluster overall, mostly German and Latin texts from Bohme, Tauler, Eckhart, and their successors. <strong>Biblical Texts and Scholarship</strong> (85), <strong>Early Modern Eschatology</strong> (24), <strong>Syriac and Armenian Christian Texts</strong> (41), and <strong>Religious Persecution and Confession</strong> (30) round out the domain. The mystical tradition sits close to the Hermetic cluster in embedding space &mdash; correctly reflecting the historical intertwining of Christian mysticism and Hermeticism.
        </p>

        {/* Macro-domain 3 */}
        <h3 className="text-xl text-primary mt-10 mb-3">
          Classical &amp; Renaissance Philosophy
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          <strong>Classical Greek and Latin Texts</strong> (187 books) is the third-largest cluster: Aristotle, Plato, Cicero, Seneca, Plotinus, Proclus. <strong>Renaissance Philosophy and Theology</strong> (110) captures the Ficino-Pico-Bruno axis. <strong>Early Modern Moral Philosophy</strong> (38) and <strong>Baconian Natural Philosophy</strong> (25) extend into the Enlightenment. These clusters bridge the gap between the esoteric and the scientific.
        </p>

        {/* Macro-domain 4 */}
        <h3 className="text-xl text-primary mt-10 mb-3">
          Natural Philosophy &amp; Early Science
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          <strong>Astrology and Mathematical Astronomy</strong> (121), <strong>Early Botanical Texts</strong> (90), <strong>Renaissance Anatomy and Engineering</strong> (51), <strong>Early Optics</strong> (47), <strong>Ancient Mechanical Engineering</strong> (27), <strong>Early Music Theory</strong> (49). These clusters trace the pre-disciplinary history of science &mdash; before physics, chemistry, and biology separated from natural philosophy, alchemy, and music theory. Latin dominates, but the engineering cluster includes Hero of Alexandria in Greek and Arabic mechanical texts.
        </p>

        {/* Macro-domain 5 */}
        <h3 className="text-xl text-primary mt-10 mb-3">
          Chinese Traditions
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          Five clusters, ~350 books. <strong>Chinese Religious Systems</strong> (152) is the largest, covering Buddhism, Daoism, and folk religion. <strong>Chinese Military Encyclopedia Wubei Zhi</strong> (66) and <strong>Ming Dynasty Coastal Defense</strong> (18) reflect the military-strategic tradition. <strong>Chinese Materia Medica</strong> (60) captures the pharmacological tradition centered on the Bencao Gangmu. <strong>Hai Guo Tu Zhi</strong> (35) documents the 19th-century encounter with Western knowledge. These clusters sit in a completely separate region of the embedding space &mdash; Chinese-language content about Chinese knowledge systems, with little overlap.
        </p>

        {/* Macro-domain 6 */}
        <h3 className="text-xl text-primary mt-10 mb-3">
          South &amp; Central Asian Traditions
        </h3>
        <p className="text-secondary leading-relaxed mb-8">
          <strong>Sanskrit Jyotisha</strong> (137) and <strong>Sanskrit Astronomical Treatises</strong> (27) cover Vedic astrology and mathematical astronomy. <strong>Hinduism and Indology</strong> (68) captures the broader Indological corpus &mdash; Tantric texts, Vedantic philosophy, the Puranas. <strong>Sanskrit Astrological and Divinatory Texts</strong> (18) is a smaller specialized cluster. Like the Chinese clusters, these form an isolated region in the visualization.
        </p>

        {/* --- The noise --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Noise: 564 Unclassifiable Books
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          HDBSCAN classified 564 books (16%) as noise &mdash; points that don&rsquo;t belong to any cluster with sufficient density. These aren&rsquo;t bad data. They&rsquo;re the most <em>interdisciplinary</em> books in the collection: texts that draw on multiple traditions simultaneously and resist placement in any single cluster.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          This is actually useful information. A faceted taxonomy that allows multiple tags per book would classify these texts naturally, where a single-label system forces an arbitrary choice.
        </p>

        {/* --- Numbers --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          By the Numbers
        </h2>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-border-medium">
                <th className="py-3 pr-6 text-primary font-semibold">Metric</th>
                <th className="py-3 text-primary font-semibold text-right">Value</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Books in database</td>
                <td className="py-3 text-right font-mono">10,083</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Books with sufficient signal</td>
                <td className="py-3 text-right font-mono">3,424</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Clusters discovered</td>
                <td className="py-3 text-right font-mono">48</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Books clustered</td>
                <td className="py-3 text-right font-mono">2,860 (84%)</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Noise (unclustered)</td>
                <td className="py-3 text-right font-mono">564 (16%)</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Largest cluster</td>
                <td className="py-3 text-right font-mono">Early Modern Alchemy (350)</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Smallest cluster</td>
                <td className="py-3 text-right font-mono">Dionysian Corpus (15)</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Languages represented</td>
                <td className="py-3 text-right font-mono">20+</td>
              </tr>
              <tr>
                <td className="py-3 pr-6">Year range</td>
                <td className="py-3 text-right font-mono">~50 CE &ndash; 1994</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Language Distribution
        </h3>

        <div className="overflow-x-auto mb-12">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-border-medium">
                <th className="py-3 pr-6 text-primary font-semibold">Language</th>
                <th className="py-3 text-primary font-semibold text-right">Books</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Latin</td>
                <td className="py-3 text-right font-mono">683</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">English</td>
                <td className="py-3 text-right font-mono">452</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">German</td>
                <td className="py-3 text-right font-mono">407</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Chinese</td>
                <td className="py-3 text-right font-mono">341</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Sanskrit</td>
                <td className="py-3 text-right font-mono">213</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">French</td>
                <td className="py-3 text-right font-mono">165</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Greek</td>
                <td className="py-3 text-right font-mono">158</td>
              </tr>
              <tr>
                <td className="py-3 pr-6">Italian, Dutch, Arabic, Hebrew, &amp; others</td>
                <td className="py-3 text-right font-mono">~400</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* --- All 48 clusters --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          All 48 Clusters
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Sorted by size. Cluster names were generated by Gemini Flash from each cluster&rsquo;s thematic profile; tradition tags come from a controlled vocabulary of ~50 terms.
        </p>

        <div className="overflow-x-auto mb-12">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-border-medium">
                <th className="py-2 pr-4 text-primary font-semibold">Cluster</th>
                <th className="py-2 pr-4 text-primary font-semibold text-right">Books</th>
                <th className="py-2 pr-4 text-primary font-semibold">Period</th>
                <th className="py-2 text-primary font-semibold">Tradition Tags</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Early Modern Alchemy</td><td className="py-2 pr-4 text-right font-mono">350</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Western Alchemy, Hermeticism, Natural Philosophy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Classical Greek and Latin Texts</td><td className="py-2 pr-4 text-right font-mono">187</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Classical Philosophy, Philology, Textual Criticism</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Continental Christian Mysticism</td><td className="py-2 pr-4 text-right font-mono">185</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Christian Mysticism, Christian Theology</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Chinese Religious Systems</td><td className="py-2 pr-4 text-right font-mono">152</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Chinese Religion</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Sanskrit Jyotisha and Cataloging</td><td className="py-2 pr-4 text-right font-mono">137</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Vedic Astrology, Sanskrit Literature, Astrology</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Astrology and Mathematical Astronomy</td><td className="py-2 pr-4 text-right font-mono">121</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Astrology, Astronomy, Mathematics</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Renaissance Philosophy and Theology</td><td className="py-2 pr-4 text-right font-mono">110</td><td className="py-2 pr-4">Renaissance</td><td className="py-2">Neoplatonism, Christian Theology, Classical Philosophy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Early Botanical Texts</td><td className="py-2 pr-4 text-right font-mono">90</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Botany, Medicine, Natural Philosophy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Biblical Texts and Scholarship</td><td className="py-2 pr-4 text-right font-mono">85</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Textual Criticism, Philology, Christian Theology</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Hermetic and Neoplatonic Theurgy</td><td className="py-2 pr-4 text-right font-mono">79</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Hermeticism, Neoplatonism, Theurgy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Early Modern Demonology</td><td className="py-2 pr-4 text-right font-mono">74</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Witchcraft &amp; Demonology, Christian Theology</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Hinduism and Indology</td><td className="py-2 pr-4 text-right font-mono">68</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Hindu Philosophy, Sanskrit Literature, Tantra</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Chinese Military Encyclopedia (Wubei Zhi)</td><td className="py-2 pr-4 text-right font-mono">66</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Chinese Military Arts, Chinese Divination, Engineering</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Chinese Materia Medica</td><td className="py-2 pr-4 text-right font-mono">60</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Chinese Medicine, Botany</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Grimoires and Ceremonial Magic</td><td className="py-2 pr-4 text-right font-mono">59</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Ceremonial Magic, Divination, Occult Revival</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Melancholy, Medicine, and Longevity</td><td className="py-2 pr-4 text-right font-mono">52</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Medicine, Natural Philosophy, Neoplatonism</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Renaissance Anatomy and Engineering</td><td className="py-2 pr-4 text-right font-mono">51</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Engineering, Medicine, Natural Philosophy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Early Music Theory &amp; Harmony</td><td className="py-2 pr-4 text-right font-mono">49</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Mathematics, Philology, Pythagoreanism</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Christian Kabbalah and Universalism</td><td className="py-2 pr-4 text-right font-mono">47</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Kabbalah, Christian Mysticism, Christian Theology</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Freemasonry and Secret Societies</td><td className="py-2 pr-4 text-right font-mono">47</td><td className="py-2 pr-4">Enlightenment</td><td className="py-2">Freemasonry, Secret Societies</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Early Optics and Natural Philosophy</td><td className="py-2 pr-4 text-right font-mono">47</td><td className="py-2 pr-4">Enlightenment</td><td className="py-2">Natural Philosophy, Optics, Mathematics</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Islamic Mysticism and Folklore</td><td className="py-2 pr-4 text-right font-mono">41</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Islamic Mysticism, Islamic Philosophy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Syriac and Armenian Christian Texts</td><td className="py-2 pr-4 text-right font-mono">41</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Patristic Christianity, Christian Theology</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Rosicrucian Fraternity Defenses</td><td className="py-2 pr-4 text-right font-mono">38</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Rosicrucianism, Hermeticism</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Early Modern Moral Philosophy</td><td className="py-2 pr-4 text-right font-mono">38</td><td className="py-2 pr-4">Enlightenment</td><td className="py-2">Political Philosophy, Classical Philosophy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Early Modern Philosophy</td><td className="py-2 pr-4 text-right font-mono">36</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Classical Philosophy, Political Philosophy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Hai Guo Tu Zhi Studies</td><td className="py-2 pr-4 text-right font-mono">35</td><td className="py-2 pr-4">19th Century</td><td className="py-2">Chinese Military Arts, Economics</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">New Thought Self-Improvement</td><td className="py-2 pr-4 text-right font-mono">35</td><td className="py-2 pr-4">Modern</td><td className="py-2">Occult Revival, Mesmerism</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Chinese Celestial and Terrestrial Lore</td><td className="py-2 pr-4 text-right font-mono">31</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Chinese Divination, Chinese Philosophy, Astronomy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Religious Persecution and Confession</td><td className="py-2 pr-4 text-right font-mono">30</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Christian Theology, Political Philosophy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">West African Ethnographic Studies</td><td className="py-2 pr-4 text-right font-mono">29</td><td className="py-2 pr-4">Modern</td><td className="py-2">Philology, Textual Criticism</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Celtic &amp; Irish Legal Texts</td><td className="py-2 pr-4 text-right font-mono">29</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Philology, Textual Criticism</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Sanskrit Astronomical Treatises</td><td className="py-2 pr-4 text-right font-mono">27</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Vedic Astrology, Sanskrit Literature, Astronomy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Ancient Mechanical Engineering</td><td className="py-2 pr-4 text-right font-mono">27</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Engineering, Mathematics, Classical Philosophy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Early Christian History &amp; Apologetics</td><td className="py-2 pr-4 text-right font-mono">27</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Patristic Christianity, Christian Theology</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Chinese Medical Texts and Anatomy</td><td className="py-2 pr-4 text-right font-mono">26</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Chinese Medicine, Medicine</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Baconian Natural Philosophy</td><td className="py-2 pr-4 text-right font-mono">25</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Natural Philosophy, Optics, Classical Philosophy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Legal and Political Treatises</td><td className="py-2 pr-4 text-right font-mono">25</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Political Philosophy, Philology</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Early Modern Rosicrucianism</td><td className="py-2 pr-4 text-right font-mono">25</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Rosicrucianism, Hermeticism, Western Alchemy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Thirty Years&rsquo; War Politics</td><td className="py-2 pr-4 text-right font-mono">24</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Political Philosophy, Christian Theology</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Early Modern Eschatology</td><td className="py-2 pr-4 text-right font-mono">24</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Eschatology, Christian Theology</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Animal Magnetism and Mesmerism</td><td className="py-2 pr-4 text-right font-mono">23</td><td className="py-2 pr-4">19th Century</td><td className="py-2">Mesmerism, Occult Revival, Medicine</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Classical Political Economy</td><td className="py-2 pr-4 text-right font-mono">20</td><td className="py-2 pr-4">Enlightenment</td><td className="py-2">Economics, Political Philosophy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Solomonic Grimoires and Magic</td><td className="py-2 pr-4 text-right font-mono">19</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Ceremonial Magic, Kabbalah</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Ming Dynasty Coastal Defense</td><td className="py-2 pr-4 text-right font-mono">18</td><td className="py-2 pr-4">Early Modern</td><td className="py-2">Chinese Military Arts</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Sanskrit Astrological and Divinatory Texts</td><td className="py-2 pr-4 text-right font-mono">18</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Vedic Astrology, Hindu Philosophy</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Swedenborgian Theology</td><td className="py-2 pr-4 text-right font-mono">18</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Christian Theology, Christian Mysticism</td></tr>
              <tr><td className="py-2 pr-4">Dionysian Corpus and Interpreters</td><td className="py-2 pr-4 text-right font-mono">15</td><td className="py-2 pr-4">Mixed</td><td className="py-2">Neoplatonism, Christian Theology</td></tr>
            </tbody>
          </table>
        </div>

        {/* --- Implications --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What This Means for the Library
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Source Library currently uses 29 hand-coded categories, mostly focused on Western esotericism (Alchemy, Hermeticism, Kabbalah, Rosicrucianism). The clustering reveals that these categories cover only about a third of the collection. The remaining two-thirds &mdash; Chinese traditions, Sanskrit literature, natural philosophy, biblical scholarship, political economy &mdash; are invisible to the current taxonomy.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Worse, the current categories are flat and mutually exclusive. A book tagged &ldquo;Alchemy&rdquo; can&rsquo;t also be tagged &ldquo;Medicine&rdquo; or &ldquo;Natural Philosophy&rdquo; &mdash; but the clustering shows that these categories overlap heavily. The &ldquo;Melancholy, Medicine, and Longevity&rdquo; cluster (52 books) sits at the intersection of medicine, natural philosophy, and Neoplatonism. &ldquo;Christian Kabbalah&rdquo; bridges three traditions. Forcing these into a single category loses information.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The next step is to replace the flat categories with a <strong>faceted taxonomy</strong> &mdash; orthogonal dimensions like tradition, period, language, and form that can be combined freely. A book on Paracelsian medicine could be tagged as Western Alchemy + Medicine + Early Modern + German, allowing it to appear in any of those facets without forcing a single classification.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The 48 clusters and their tradition tags are the starting point for designing that taxonomy. They represent what the collection actually contains, discovered from the data rather than imposed by assumption.
        </p>

        <hr className="border-light my-12" />

        <p className="text-muted text-sm leading-relaxed">
          <strong>Technical details:</strong> Embeddings: all-mpnet-base-v2 (768d, local). Dimensionality reduction: UMAP (n_neighbors=30, min_dist=0.3, metric=cosine). Clustering: HDBSCAN (min_cluster_size=15, min_samples=5, cluster_selection_method=eom). Cluster labeling: Gemini 2.0 Flash with structured JSON output. Visualization: Plotly.js with UMAP 2D projection. Pipeline code and data available on request.
        </p>

      </article>

      <BlogComments slug="clustering" />
    </ContentPageLayout>
  );
}
