import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'What Does a Library of 3,400 Rare Books Look Like? - Research Notes - Source Library',
  description: 'We embedded 3,400 historical book summaries, clustered them with UMAP and HDBSCAN, and discovered 34 curated groupings spanning seven intellectual traditions — from early modern alchemy to Sanskrit astronomy to Chinese military encyclopedias.',
  openGraph: {
    title: 'What Does a Library of 3,400 Rare Books Look Like?',
    description: 'Embedding-based clustering reveals 34 curated groupings across seven intellectual traditions in one of the largest digitized rare book collections.',
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
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">

        {/* --- Lead --- */}
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library holds over 5,000 digitized rare books &mdash; alchemy, Hermetica, natural philosophy, Kabbalah, Chinese medicine, Sanskrit astrology, early modern theology. The collection grew organically over months of curation. What structure does it actually have? We embedded 3,424 book summaries with a neural language model, projected them into a shared vector space, and let a density-based clustering algorithm find the answer.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          The algorithm found 48 raw clusters. After editorial review &mdash; merging redundant splits, renaming opaque labels, and organizing into macro-domains &mdash; we arrived at <strong>34 curated clusters across seven intellectual traditions</strong>. Not the categories we assigned &mdash; the categories the books assigned themselves, refined by human judgment.
        </p>

        {/* --- Interactive visualization --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Map
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Each dot is a book. Position reflects semantic similarity &mdash; books near each other have similar content. Colors are grouped by macro-domain: warm reds for Western esotericism, purples for Christian traditions, blues for classical &amp; Renaissance, greens for natural philosophy, ambers for Chinese traditions, teals for South Asian traditions. Hover to see the title, author, year, and cluster name. Use the search box to find specific books or clusters.
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

        {/* --- Curation --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          From 48 Raw Clusters to 34 Curated Labels
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Algorithmic clustering is a starting point, not an end. Reviewing the 48 raw clusters revealed four categories of issues:
        </p>

        <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 space-y-2">
          <li><strong>Artificial splits:</strong> HDBSCAN found multiple density peaks within what is really one intellectual tradition. Three separate Sanskrit astrology clusters, two Rosicrucian clusters, two grimoire clusters, two natural philosophy clusters. These were merged.</li>
          <li><strong>Single-work clusters:</strong> The Wubei Zhi (66 books), Bencao Gangmu (60 books), and Hai Guo Tu Zhi (35 books) each formed their own cluster because Source Library holds many volumes of these multi-volume Chinese encyclopedias. These are real density peaks but represent a single work, not a category.</li>
          <li><strong>Language artifacts:</strong> Celtic/Irish texts (29 books) and African/Indigenous studies (29 books) clustered by language and regional origin rather than by subject matter. These are genuine clusters in embedding space, but they reflect linguistic distance more than intellectual affinity.</li>
          <li><strong>Facets masquerading as categories:</strong> &ldquo;Thirty Years&rsquo; War Politics&rdquo; is a historical period, not a subject. &ldquo;Classical Political Economy&rdquo; is real but tangential to the library&rsquo;s focus. These were kept but noted.</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-12">
          After merging 10 groups of redundant clusters and renaming 24 others for clarity, we arrived at 34 curated clusters organized into seven macro-domains.
        </p>

        {/* --- Findings --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Seven Intellectual Traditions
        </h2>

        <p className="text-secondary leading-relaxed mb-8">
          The curated clusters organize into seven macro-domains. This isn&rsquo;t a classification we designed &mdash; it&rsquo;s what the embedding space reveals about the collection&rsquo;s actual content, refined by editorial judgment.
        </p>

        {/* Macro-domain 1 */}
        <h3 className="text-xl text-primary mt-10 mb-3">
          Western Esotericism
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          The largest domain, spanning 8 clusters and over 750 books. <strong>Western Alchemy</strong> is the single biggest cluster (350 books) &mdash; Latin and German texts on transmutation, Paracelsian medicine, and spagyric chemistry. It&rsquo;s arguably too broad, mixing 16th-century Paracelsians with 18th-century chrysopoeia. Nearby: <strong>Hermeticism &amp; Theurgy</strong> (79), <strong>Grimoires &amp; Ritual Magic</strong> (78, merged from two raw clusters), <strong>Rosicrucianism</strong> (63, merged from two), <strong>Mesmerism &amp; New Thought</strong> (58, merged from animal magnetism and self-improvement), <strong>Christian Kabbalah</strong> (47), <strong>Freemasonry &amp; Secret Societies</strong> (47), and <strong>Demonology &amp; Witchcraft</strong> (74).
        </p>

        {/* Macro-domain 2 */}
        <h3 className="text-xl text-primary mt-10 mb-3">
          Christian Traditions
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          Six clusters, ~430 books. <strong>Continental Christian Mysticism</strong> (185) is the second-largest cluster overall &mdash; German and Latin texts from Bohme, Tauler, Eckhart, and their successors. <strong>Biblical Scholarship</strong> (85), <strong>Patristic &amp; Eastern Christianity</strong> (68, merged from Syriac/Armenian and early apologetics), <strong>Swedenborgian Theology</strong> (18, a single-author cluster), <strong>Religious Persecution &amp; Toleration</strong> (30), and <strong>Apocalypticism &amp; Prophecy</strong> (24). The mystical tradition sits close to the Hermetic cluster in embedding space &mdash; correctly reflecting the historical intertwining of these traditions.
        </p>

        {/* Macro-domain 3 */}
        <h3 className="text-xl text-primary mt-10 mb-3">
          Classical &amp; Renaissance
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          Three clusters. <strong>Classical Texts &amp; Philology</strong> (187 books) is very broad &mdash; Aristotle, Plato, Cicero, Plotinus, plus philological editions. It could arguably be split by period or language. <strong>Renaissance Philosophy</strong> (110) captures the Ficino-Pico-Bruno axis. <strong>German &amp; Dutch Mysticism</strong> (47) is a language-specific subset of late-medieval mysticism that the algorithm correctly separated from the broader Christian mysticism cluster.
        </p>

        {/* Macro-domain 4 */}
        <h3 className="text-xl text-primary mt-10 mb-3">
          Natural Philosophy &amp; Science
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          Six clusters tracing the pre-disciplinary history of science. <strong>Astrology &amp; Astronomy</strong> (121), <strong>Botany &amp; Herbals</strong> (90), <strong>Natural Philosophy &amp; Optics</strong> (72, merged from two raw clusters), <strong>Engineering &amp; Mechanical Arts</strong> (78, merged from Renaissance and ancient engineering), <strong>Music Theory &amp; Harmony</strong> (49), and <strong>Medical Philosophy</strong> (52). These clusters capture the era before physics, chemistry, and biology separated from natural philosophy, alchemy, and Pythagorean harmony.
        </p>

        {/* Macro-domain 5 */}
        <h3 className="text-xl text-primary mt-10 mb-3">
          Chinese Traditions
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          Four clusters, ~350 books. <strong>Chinese Religion &amp; Cosmology</strong> (152) covers Buddhism, Daoism, and folk religion. <strong>Chinese Military &amp; Strategic Texts</strong> (119, merged from Wubei Zhi, coastal defense, and Hai Guo Tu Zhi) &mdash; though note this merges multi-volume encyclopedias with independent strategic works. <strong>Chinese Medicine</strong> (86, merged from materia medica and medical anatomy), and <strong>Chinese Celestial &amp; Terrestrial Lore</strong> (31). These clusters sit in a completely separate region of the embedding space &mdash; Chinese-language content clusters by linguistic distance as much as by subject.
        </p>

        {/* Macro-domain 6 */}
        <h3 className="text-xl text-primary mt-10 mb-3">
          South &amp; Central Asian Traditions
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          Three clusters. <strong>Sanskrit Astrology &amp; Astronomy</strong> (182, merged from three raw clusters covering Jyotisha, astronomical treatises, and divinatory texts), <strong>Hindu Philosophy &amp; Indology</strong> (68), and <strong>Islamic Mysticism &amp; Philosophy</strong> (41). As with the Chinese clusters, Sanskrit content forms its own island in embedding space &mdash; a genuine structural feature, but one driven partly by linguistic distance rather than pure subject matter.
        </p>

        {/* Macro-domain 7 */}
        <h3 className="text-xl text-primary mt-10 mb-3">
          Other
        </h3>
        <p className="text-secondary leading-relaxed mb-8">
          Four clusters that don&rsquo;t fit neatly into the macro-domains above. <strong>Political &amp; Moral Philosophy</strong> (123, merged from four small raw clusters including Thirty Years&rsquo; War politics, classical economics, legal treatises, and moral philosophy), <strong>African &amp; Indigenous Studies</strong> (29, a language artifact), <strong>Celtic &amp; Irish Traditions</strong> (29, also a language artifact), and <strong>Pseudo-Dionysius &amp; Commentators</strong> (15, a very specific but genuine intellectual cluster around a single late-antique corpus).
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
                <td className="py-3 pr-6">Raw clusters (HDBSCAN)</td>
                <td className="py-3 text-right font-mono">48</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Curated clusters (after merges)</td>
                <td className="py-3 text-right font-mono">34</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Macro-domains</td>
                <td className="py-3 text-right font-mono">7</td>
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
                <td className="py-3 text-right font-mono">Western Alchemy (350)</td>
              </tr>
              <tr>
                <td className="py-3 pr-6">Smallest cluster</td>
                <td className="py-3 text-right font-mono">Pseudo-Dionysius (15)</td>
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

        {/* --- All 34 clusters by domain --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          All 34 Curated Clusters
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Organized by macro-domain. &ldquo;Raw&rdquo; shows how many algorithmic clusters were merged. &ldquo;Notes&rdquo; flags known issues: language artifacts, single-work collections, overly broad groupings.
        </p>

        <div className="overflow-x-auto mb-12">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-border-medium">
                <th className="py-2 pr-4 text-primary font-semibold">Cluster</th>
                <th className="py-2 pr-4 text-primary font-semibold text-right">Books</th>
                <th className="py-2 pr-4 text-primary font-semibold text-right">Raw</th>
                <th className="py-2 text-primary font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              {/* Western Esotericism */}
              <tr className="border-b border-border-medium bg-warm">
                <td className="py-2 pr-4 font-semibold text-primary" colSpan={4}>Western Esotericism</td>
              </tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Western Alchemy</td><td className="py-2 pr-4 text-right font-mono">350</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs">Too broad &mdash; mixes Paracelsians with chrysopoeia</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Hermeticism &amp; Theurgy</td><td className="py-2 pr-4 text-right font-mono">79</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs"></td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Grimoires &amp; Ritual Magic</td><td className="py-2 pr-4 text-right font-mono">78</td><td className="py-2 pr-4 text-right font-mono">2</td><td className="py-2 text-muted text-xs">Merged: ceremonial + Solomonic</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Demonology &amp; Witchcraft</td><td className="py-2 pr-4 text-right font-mono">74</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs"></td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Rosicrucianism</td><td className="py-2 pr-4 text-right font-mono">63</td><td className="py-2 pr-4 text-right font-mono">2</td><td className="py-2 text-muted text-xs">Merged: fraternity defenses + early modern</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Mesmerism &amp; New Thought</td><td className="py-2 pr-4 text-right font-mono">58</td><td className="py-2 pr-4 text-right font-mono">2</td><td className="py-2 text-muted text-xs">Merged: animal magnetism + self-improvement</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Christian Kabbalah</td><td className="py-2 pr-4 text-right font-mono">47</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs"></td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Freemasonry &amp; Secret Societies</td><td className="py-2 pr-4 text-right font-mono">47</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs"></td></tr>

              {/* Christian Traditions */}
              <tr className="border-b border-border-medium bg-warm">
                <td className="py-2 pr-4 font-semibold text-primary" colSpan={4}>Christian Traditions</td>
              </tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Continental Christian Mysticism</td><td className="py-2 pr-4 text-right font-mono">185</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs"></td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Biblical Scholarship</td><td className="py-2 pr-4 text-right font-mono">85</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs"></td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Patristic &amp; Eastern Christianity</td><td className="py-2 pr-4 text-right font-mono">68</td><td className="py-2 pr-4 text-right font-mono">2</td><td className="py-2 text-muted text-xs">Merged: Syriac/Armenian + apologetics</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Religious Persecution &amp; Toleration</td><td className="py-2 pr-4 text-right font-mono">30</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs">More of a theme than a tradition</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Apocalypticism &amp; Prophecy</td><td className="py-2 pr-4 text-right font-mono">24</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs"></td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Swedenborgian Theology</td><td className="py-2 pr-4 text-right font-mono">18</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs">Single-author cluster</td></tr>

              {/* Classical & Renaissance */}
              <tr className="border-b border-border-medium bg-warm">
                <td className="py-2 pr-4 font-semibold text-primary" colSpan={4}>Classical &amp; Renaissance</td>
              </tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Classical Texts &amp; Philology</td><td className="py-2 pr-4 text-right font-mono">187</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs">Too broad &mdash; Aristotle to Proclus in one bucket</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Renaissance Philosophy</td><td className="py-2 pr-4 text-right font-mono">110</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs"></td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">German &amp; Dutch Mysticism</td><td className="py-2 pr-4 text-right font-mono">47</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs">Language-specific split from Christian mysticism</td></tr>

              {/* Natural Philosophy & Science */}
              <tr className="border-b border-border-medium bg-warm">
                <td className="py-2 pr-4 font-semibold text-primary" colSpan={4}>Natural Philosophy &amp; Science</td>
              </tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Astrology &amp; Astronomy</td><td className="py-2 pr-4 text-right font-mono">121</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs"></td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Botany &amp; Herbals</td><td className="py-2 pr-4 text-right font-mono">90</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs"></td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Engineering &amp; Mechanical Arts</td><td className="py-2 pr-4 text-right font-mono">78</td><td className="py-2 pr-4 text-right font-mono">2</td><td className="py-2 text-muted text-xs">Merged: Renaissance + ancient engineering</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Natural Philosophy &amp; Optics</td><td className="py-2 pr-4 text-right font-mono">72</td><td className="py-2 pr-4 text-right font-mono">2</td><td className="py-2 text-muted text-xs">Merged: Baconian + early optics</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Medical Philosophy</td><td className="py-2 pr-4 text-right font-mono">52</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs"></td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Music Theory &amp; Harmony</td><td className="py-2 pr-4 text-right font-mono">49</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs"></td></tr>

              {/* Chinese Traditions */}
              <tr className="border-b border-border-medium bg-warm">
                <td className="py-2 pr-4 font-semibold text-primary" colSpan={4}>Chinese Traditions</td>
              </tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Chinese Religion &amp; Cosmology</td><td className="py-2 pr-4 text-right font-mono">152</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs">Very broad &mdash; Buddhism, Daoism, folk religion</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Chinese Military &amp; Strategic Texts</td><td className="py-2 pr-4 text-right font-mono">119</td><td className="py-2 pr-4 text-right font-mono">3</td><td className="py-2 text-muted text-xs">Merged: Wubei Zhi + coastal defense + Hai Guo Tu Zhi. Includes single-work volumes.</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Chinese Medicine</td><td className="py-2 pr-4 text-right font-mono">86</td><td className="py-2 pr-4 text-right font-mono">2</td><td className="py-2 text-muted text-xs">Merged: materia medica + anatomy. Includes Bencao Gangmu volumes.</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Chinese Celestial &amp; Terrestrial Lore</td><td className="py-2 pr-4 text-right font-mono">31</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs"></td></tr>

              {/* South & Central Asian */}
              <tr className="border-b border-border-medium bg-warm">
                <td className="py-2 pr-4 font-semibold text-primary" colSpan={4}>South &amp; Central Asian</td>
              </tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Sanskrit Astrology &amp; Astronomy</td><td className="py-2 pr-4 text-right font-mono">182</td><td className="py-2 pr-4 text-right font-mono">3</td><td className="py-2 text-muted text-xs">Merged: Jyotisha + astronomical treatises + divinatory texts</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Hindu Philosophy &amp; Indology</td><td className="py-2 pr-4 text-right font-mono">68</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs"></td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Islamic Mysticism &amp; Philosophy</td><td className="py-2 pr-4 text-right font-mono">41</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs"></td></tr>

              {/* Other */}
              <tr className="border-b border-border-medium bg-warm">
                <td className="py-2 pr-4 font-semibold text-primary" colSpan={4}>Other</td>
              </tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Political &amp; Moral Philosophy</td><td className="py-2 pr-4 text-right font-mono">123</td><td className="py-2 pr-4 text-right font-mono">4</td><td className="py-2 text-muted text-xs">Merged: 4 small clusters. Includes period artifacts (Thirty Years&rsquo; War).</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">African &amp; Indigenous Studies</td><td className="py-2 pr-4 text-right font-mono">29</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs">Language artifact</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Celtic &amp; Irish Traditions</td><td className="py-2 pr-4 text-right font-mono">29</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs">Language artifact</td></tr>
              <tr><td className="py-2 pr-4">Pseudo-Dionysius &amp; Commentators</td><td className="py-2 pr-4 text-right font-mono">15</td><td className="py-2 pr-4 text-right font-mono">1</td><td className="py-2 text-muted text-xs">Very specific but genuine</td></tr>
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
          Worse, the current categories are flat and mutually exclusive. A book tagged &ldquo;Alchemy&rdquo; can&rsquo;t also be tagged &ldquo;Medicine&rdquo; or &ldquo;Natural Philosophy&rdquo; &mdash; but the clustering shows that these categories overlap heavily. The &ldquo;Medical Philosophy&rdquo; cluster (52 books) sits at the intersection of medicine, natural philosophy, and Neoplatonism. &ldquo;Christian Kabbalah&rdquo; bridges three traditions. Forcing these into a single category loses information.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The next step is to replace the flat categories with a <strong>faceted taxonomy</strong> &mdash; orthogonal dimensions like tradition, period, language, and form that can be combined freely. A book on Paracelsian medicine could be tagged as Western Alchemy + Medicine + Early Modern + German, allowing it to appear in any of those facets without forcing a single classification.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The 34 curated clusters and their macro-domains are the starting point for designing that taxonomy. They represent what the collection actually contains &mdash; discovered from the data, refined by judgment, and honest about where the algorithm sees structure that isn&rsquo;t really there.
        </p>

        <hr className="border-light my-12" />

        <p className="text-muted text-sm leading-relaxed">
          <strong>Technical details:</strong> Embeddings: all-mpnet-base-v2 (768d, local). Dimensionality reduction: UMAP (n_neighbors=30, min_dist=0.3, metric=cosine). Clustering: HDBSCAN (min_cluster_size=15, min_samples=5, cluster_selection_method=eom). Cluster labeling: Gemini 2.0 Flash with structured JSON output. Visualization: Plotly.js with UMAP 2D projection. 48 raw clusters → 34 curated (10 merge groups, 24 renames). Pipeline code and data available on request.
        </p>

      </article>

      <BlogComments slug="clustering" />
    </ContentPageLayout>
  );
}
