import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'Ten Thousand Years of Tagging: A History of How Humans Organize Knowledge - Blog - Source Library',
  description: 'From Callimachus at Alexandria to LLM-assigned faceted tags, the history of classification runs through books we actually have. Porphyry\'s tree, Llull\'s combinatorial wheels, Bacon\'s cognitive grounding, and the system we built from all of them.',
  openGraph: {
    title: 'Ten Thousand Years of Tagging',
    description: 'The history of knowledge classification, told through the books that invented it — most of which are in our collection.',
  },
  alternates: {
    canonical: '/blog/history-of-classification',
  },
};

export default function HistoryOfClassificationPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Ten Thousand Years of Tagging"
          subtitle="A history of how humans organize knowledge — told through the books that invented it"
        >
          <p className="text-stone-400 text-sm mt-4">16 March 2026 &middot; 14 min read</p>
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
          We recently built a new classification system for Source Library &mdash; six independent facets
          that tag every book by tradition, domain, form, cultural sphere, era, and epistemic mode.
          While designing it, we realized something: most of the key documents in the history
          of knowledge classification are books we already have. The thinkers who invented taxonomy
          are in our collection. So we read them.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          What follows is a history of how humans have organized knowledge, told through primary
          sources you can read here. It starts in Alexandria, passes through a 13th-century
          Majorcan mystic whose combinatorial logic anticipated modern faceted search, and ends
          with an LLM reading 13,000 book titles.
        </p>

        {/* --- Phase 1: The Catalog --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          1. The Catalog: Callimachus at Alexandria (3rd c. BCE)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The first known library catalog was the <em>Pinakes</em>, compiled by the poet Callimachus
          at the Library of Alexandria around 245 BCE. It organized roughly 500,000 scrolls into six
          classes: rhetoric, law, epic, tragedy, comedy, and lyric poetry. Within each class, authors
          were listed alphabetically, with biographical notes and a list of works.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          This was a <strong>single-axis system</strong>: one scroll, one category, filed by genre.
          The categories were literary forms, not subjects. If you wanted to find everything about
          astronomy, you had to already know that Eudoxus wrote about astronomy and look him up
          by name. The catalog served the librarian, not the reader.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          The <em>Pinakes</em> itself is lost. But its organizational logic &mdash; sort by type, then by
          author &mdash; persisted for two thousand years and is still the default in most bookshops.
        </p>

        {/* --- Phase 2: The Tree --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          2. The Tree: Porphyry&rsquo;s <em>Isagoge</em> (3rd c. CE)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Around 270 CE, the Neoplatonist philosopher Porphyry wrote a short introduction to
          Aristotle&rsquo;s <em>Categories</em> called the <em>Isagoge</em>. In it, he demonstrated
          a method of classifying anything through binary branching: start with the most general
          category (Substance), then split it with a <em>differentia</em> &mdash; a distinguishing property.
          Corporeal or incorporeal? Living or non-living? Sentient or non-sentient? Rational or irrational?
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The result is the <strong>Tree of Porphyry</strong>, the first hierarchical classification diagram.
          Every node is a genus, every split is a differentia, every leaf is a species. It became
          THE model for Western classification for over a millennium. Every medieval library,
          every scholastic disputation, every encyclopedia organized knowledge as a descending tree.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We have Porphyry&rsquo;s <em>Isagoge</em> in a{' '}
          <Link href="/book/porphyrii-introductio-ammonii-procli-diadochi-commentarii-porphyry" className="text-accent-rust hover:underline">
            1000 CE Latin manuscript with Ammonius&rsquo;s commentary
          </Link>.
          The key insight for modern tagging: Porphyry didn&rsquo;t just give things names &mdash; he
          recorded <em>why</em> each split happens. The differentia is as important as the label.
          When we designed our vocabulary, we gave every tag value a one-sentence differentia
          explaining what distinguishes it from its neighbors.
        </p>

        <blockquote className="border-l-2 border-accent-rust/30 pl-6 my-8 text-secondary italic">
          The problem with trees: they force false choices. A book on Paracelsian medicine is both
          alchemy and medicine, but a tree makes you pick one branch.
        </blockquote>

        {/* --- Phase 3: The Emanation --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          3. The Emanation: Pseudo-Dionysius (5th c. CE)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          While Porphyry classified by <em>type</em>, an anonymous Syrian monk writing under the name
          Dionysius the Areopagite proposed a radically different model. In the{' '}
          <Link href="/book/pseudo-dionysius-areopagita-ficino-translation" className="text-accent-rust hover:underline">
            <em>Celestial Hierarchy</em>
          </Link>{' '}
          (which we have in Ficino&rsquo;s translation, 140 of 142 pages translated), knowledge is not a tree
          of types but a <strong>cascade of intensity</strong>.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The divine Good emanates outward, and each level of the hierarchy receives a diminished portion
          of the original light. The nine angelic orders form three triads by function: the contemplative
          (Seraphim, Cherubim, Thrones &mdash; love, knowledge, stability), the governing (Dominations,
          Virtues, Powers), and the ministerial (Principalities, Archangels, Angels). Hierarchy
          means <em>mediation</em>, not containment.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          From page 60: <em>&ldquo;Just as every specific order of things is traced back to its own single Head,
          so too must the universal order of all things be ultimately referred to one universal Head of all.&rdquo;</em>
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Dionysius suggests that not all labels serve the same purpose. Some tags are &ldquo;source&rdquo;
          tags close to the author&rsquo;s own terminology (like <em>spagyric medicine</em>). Some are
          &ldquo;bridge&rdquo; tags that connect traditions (like <em>mysticism</em>). Some are
          &ldquo;user-facing&rdquo; tags that help browsers (like <em>fully translated</em>). These
          are different ranks in a Dionysian hierarchy of tags.
        </p>

        {/* --- Phase 4: The Combinatorial Turn --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          4. The Combinatorial Turn: Ramon Llull (1305)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The most radical model came from a 13th-century Majorcan mystic. Ramon Llull&rsquo;s{' '}
          <Link href="/book/ars-brevis-cum-approbatione-lullus" className="text-accent-rust hover:underline">
            <em>Ars Brevis</em>
          </Link>{' '}
          proposed that knowledge is not a tree at all. Instead, it emerges from the <strong>combination
          of a small set of independent principles</strong>.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Llull defined nine Absolute Principles (Goodness, Magnitude, Duration, Power, Wisdom, Will,
          Virtue, Truth, Glory) and nine Relative Principles (Difference, Concordance, Contrariety,
          Beginning, Middle, End, Majority, Equality, Minority). Each letter in his alphabet carries
          meanings across multiple domains simultaneously. From page 11: <em>&ldquo;Each principle taken by
          itself is entirely general... when one principle is contracted to another, then it is
          subalternated, as when one says &lsquo;great goodness.&rsquo;&rdquo;</em>
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          A combinatorial table of 36 cells generates all possible pairwise combinations. A book isn&rsquo;t
          <em>in</em> a category &mdash; it <em>combines</em> attributes. This is exactly faceted classification:
          multiple independent dimensions whose intersection locates the object.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Llull needed only nine principles because he understood something profound: <strong>the number of
          categories should be small enough to hold in mind simultaneously</strong>. Nine is suspiciously close
          to Miller&rsquo;s 7&plusmn;2 working memory limit, discovered 650 years later. The power comes from
          combination, not enumeration. Nine principles give 36 pairs, 84 triples, 126 quadruples &mdash;
          far more distinctions than 126 flat categories could make.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Athanasius Kircher expanded Llull&rsquo;s system in his{' '}
          <Link href="/book/kircher-ars-magna-sciendi-1669" className="text-accent-rust hover:underline">
            <em>Ars Magna Sciendi</em>
          </Link>{' '}
          (1669, 93 of 532 pages translated), adding a question dimension: each letter maps to a type
          of question &mdash; Whether? What? Of what? Why? How much? When? Where? How? Tags organized
          by the question they answer.
        </p>

        {/* --- Phase 5: The Universal Catalog --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          5. The Universal Catalog: Conrad Gessner (1545)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          In 1545, the Swiss naturalist Conrad Gessner published the{' '}
          <Link href="/book/bibliotheca-universalis-gessner" className="text-accent-rust hover:underline">
            <em>Bibliotheca Universalis</em>
          </Link>{' '}
          &mdash; the first attempt to catalog every book ever printed. It listed approximately 12,000 works,
          organized alphabetically by author (first name, as was convention).
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Three years later, the companion volume <em>Pandectae</em> reclassified the same entries by subject
          into 21 divisions: Grammar, Dialectics, Rhetoric, Poetics, Arithmetic, Geometry, Music, Astronomy,
          Astrology, Divination, Geography, History, Mechanics, Natural Philosophy, Metaphysics, Moral
          Philosophy, Economics, Politics, Jurisprudence, Medicine, Theology.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Gessner&rsquo;s key innovation: <strong>multiple access points to the same content</strong>. The same
          book appears under its author in the <em>Bibliotheca</em> and under its subject in the <em>Pandectae</em>.
          One user searches by author, another by subject, another by date. A tagging system should support all
          of these as first-class dimensions. Our faceted system has six.
        </p>

        {/* --- Phase 6: The Cognitive Tree --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          6. The Cognitive Tree: Francis Bacon (1623)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Francis Bacon&rsquo;s{' '}
          <Link href="/book/de-augmentis-scientiarum-bacon" className="text-accent-rust hover:underline">
            <em>De Augmentis Scientiarum</em>
          </Link>{' '}
          (fully translated, 696 pages) proposed something nobody had tried: grounding classification not in
          the objects of knowledge but in <strong>the cognitive operations of the knower</strong>.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          From page 126: <em>&ldquo;The truest division of human doctrine is that which is taken from the threefold
          Faculty of the Rational Soul, which is the seat of knowledge. History is referred to Memory, Poesy
          to Imagination, Philosophy to Reason.&rdquo;</em>
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          History (Memory) &rarr; Natural, Civil, Sacred, Literary.<br />
          Poetry (Imagination) &rarr; Narrative, Dramatic, Parabolic.<br />
          Philosophy (Reason) &rarr; Theology, Natural Philosophy, Human Philosophy, Mathematics.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          This tree became the skeleton of Diderot and d&rsquo;Alembert&rsquo;s <em>Encyclop&eacute;die</em>
          and, through it, shaped the Enlightenment&rsquo;s organization of all knowledge. It suggests a
          tagging dimension that library science has mostly ignored: not just <em>what</em> a book is about,
          but <em>what kind of thinking it requires</em>. We built this as the &ldquo;epistemic mode&rdquo;
          facet: empirical, speculative, revelatory, practical, or compilatory.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Bacon also invented the concept of <em>desiderata</em> &mdash; a systematic map of what knowledge
          is <em>missing</em>. A tagging system for gaps, not just for content. We use this: our 52-cluster
          embedding analysis reveals what the library doesn&rsquo;t have, and that drives curation.
        </p>

        {/* --- Phase 7: The Pedagogical Ladder --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          7. The Pedagogical Ladder: Comenius (1651)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Jan Amos Comenius, the Moravian educator, argued in{' '}
          <Link href="/book/naturall-philosophie-reformed" className="text-accent-rust hover:underline">
            <em>Naturall Philosophie Reformed by Divine Light</em>
          </Link>{' '}
          (308 pages, fully translated) that classification is <strong>curriculum</strong>. You learn simple things
          before complex ones, and the classification system itself is a learning path.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          His ascending scale: Matter &rarr; Spirit &rarr; Light &rarr; Motion &rarr; Quality &rarr; Mutation &rarr;
          Elements &rarr; Compounds &rarr; Plants &rarr; Animals &rarr; Man &rarr; Angels &rarr; God. From page 15:
          <em>&ldquo;They must be used in this order: that we begin with sense, and end in revelation.&rdquo;</em>
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Comenius also proposed three sources of knowledge &mdash; Sense, Reason, and Scripture &mdash; which
          maps loosely to our epistemic mode facet. His deeper point is that tags could carry
          a <em>prerequisite</em> dimension: this text makes sense only after you&rsquo;ve read something more basic.
        </p>

        {/* --- Phase 8: Modern Library Classification --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          8. The Decimal System: Melvil Dewey (1876)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Melvil Dewey published his Decimal Classification in 1876: 10 top-level classes, 100 divisions,
          1,000 sections. Every book gets <strong>one number</strong>. It&rsquo;s Porphyry&rsquo;s tree
          with decimal notation and a shelf address attached.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The Dewey system is still used by most public libraries in the English-speaking world.
          The Library of Congress Classification (1897) followed a similar logic with 21 top-level
          classes and roughly 100,000 leaf categories. Both are <em>enumerative</em>: they try to
          list every possible subject as a separate entry. A book on &ldquo;Islamic alchemy&rdquo;
          goes in 540 (Chemistry) or 297 (Islam), not both.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          This is the fundamental limitation: enumerative systems scale by adding more categories.
          The Library of Congress has over 100,000. But the more categories you have, the harder it
          is for anyone &mdash; human or machine &mdash; to pick the right one.
        </p>

        {/* --- Phase 9: Faceted Classification --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          9. The Faceted Revolution: S.R. Ranganathan (1933)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The breakthrough came from an Indian mathematician-librarian. Shiyali Ramamrita Ranganathan
          invented <strong>Colon Classification</strong> &mdash; the first truly faceted system.
          Instead of one category per book, every book gets one tag from each of five fundamental facets:
          Personality (the main subject), Matter (the material), Energy (the process), Space (the place),
          and Time (the period). Tags are separated by colons.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          &ldquo;History of Indian medicine in the 18th century&rdquo; becomes L:2:f:44:N, where L=Medicine,
          2=India, f=History, 44=18th century, N=monograph. The same book now lives at the intersection
          of five independent dimensions rather than in one box.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Ranganathan explicitly credited Indian philosophical traditions as his inspiration &mdash;
          specifically the <em>padarthas</em> (categories of reality) from Vaisheshika philosophy.
          He was Llull&rsquo;s intellectual heir, though he may not have known it: both understood
          that a small number of independent axes, freely combined, generates more distinctions than
          a large flat list.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Ranganathan&rsquo;s system was too complex for general adoption. Most librarians stuck with Dewey.
          But his insight &mdash; that classification is fundamentally <em>multi-dimensional</em> &mdash;
          is now standard in information science, product filtering, and search interfaces everywhere.
          Every time you filter by price + brand + rating + color on Amazon, you&rsquo;re using
          Ranganathan&rsquo;s idea.
        </p>

        {/* --- Phase 10: Embeddings --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          10. The Embedding: Vector Clustering (2020s)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The digital era introduced a completely different approach. Instead of humans choosing categories,
          neural language models embed texts as points in high-dimensional vector space. Texts with
          similar meaning end up near each other. Clustering algorithms (like HDBSCAN) then find
          the natural groupings.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We did this with Source Library last year &mdash; embedding 5,993 book summaries and discovering{' '}
          <Link href="/blog/clustering" className="text-accent-rust hover:underline">48 clusters</Link>.
          The algorithm found groupings no human would have proposed: a &ldquo;Thirty Years&rsquo; War
          Pamphlets&rdquo; cluster that connected Frankfurt book fair catalogs with Rosicrucian texts and
          alchemical allegories. The embedding caught the historical-sociological connection &mdash; the
          Rosicrucian panic, the Frankfurt book trade, and the war are entangled in print culture.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          But embeddings have no labels, no explanations, no stability. Re-run the algorithm and you
          get different clusters. They discover connections but can&rsquo;t describe them. Blavatsky&rsquo;s{' '}
          <em>Isis Unveiled</em> ended up in &ldquo;Christian Kabbalah&rdquo; &mdash; wrong as a label,
          but revealing as a neighborhood.
        </p>

        {/* --- Phase 11: LLM Faceted Tags --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          11. The Synthesis: LLM-Assigned Faceted Tags (2026)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Which brings us to what we just built. Source Library&rsquo;s new classification system combines
          all of these ancestors:
        </p>

        <ul className="text-secondary leading-relaxed mb-6 space-y-2 ml-4">
          <li><strong>Llull&rsquo;s combinatorial logic:</strong> six independent facets, freely combined. 65 tag values produce roughly a million unique intersections.</li>
          <li><strong>Porphyry&rsquo;s differentia:</strong> every tag value has a one-sentence boundary definition explaining what distinguishes it from its neighbors.</li>
          <li><strong>Bacon&rsquo;s cognitive grounding:</strong> the &ldquo;epistemic mode&rdquo; facet records <em>how</em> a text generates knowledge (empirical, speculative, revelatory, practical, compilatory).</li>
          <li><strong>Gessner&rsquo;s multiple access points:</strong> no single facet is primary. Browse by tradition, by domain, by form, by cultural sphere, by era, or by epistemic mode.</li>
          <li><strong>Ranganathan&rsquo;s PMEST:</strong> the same structural idea &mdash; a small set of orthogonal facets whose intersection uniquely locates any text.</li>
          <li><strong>Embedding discovery:</strong> the 48 clusters remain as a &ldquo;surprise me&rdquo; feature &mdash; semantic neighborhoods that reveal connections no controlled vocabulary would produce.</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6">
          The assignment is done by a large language model (Gemini) reading each book&rsquo;s title, author,
          year, language, and summary, then selecting tags from the controlled vocabulary. The cost to
          classify 13,000 books: about 70 cents.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          The six facets are:
        </p>

        <div className="overflow-x-auto mb-12">
          <table className="w-full text-sm text-secondary border-collapse">
            <thead>
              <tr className="border-b border-border-light">
                <th className="text-left py-3 pr-4 font-medium text-primary">Facet</th>
                <th className="text-left py-3 pr-4 font-medium text-primary">Question</th>
                <th className="text-left py-3 pr-4 font-medium text-primary">Values</th>
                <th className="text-left py-3 font-medium text-primary">Ancestor</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border-light/50">
                <td className="py-3 pr-4 font-medium">Tradition</td>
                <td className="py-3 pr-4">What intellectual lineage?</td>
                <td className="py-3 pr-4">17</td>
                <td className="py-3">Porphyry (genus)</td>
              </tr>
              <tr className="border-b border-border-light/50">
                <td className="py-3 pr-4 font-medium">Domain</td>
                <td className="py-3 pr-4">What subject matter?</td>
                <td className="py-3 pr-4">15</td>
                <td className="py-3">Gessner (21 classes)</td>
              </tr>
              <tr className="border-b border-border-light/50">
                <td className="py-3 pr-4 font-medium">Form</td>
                <td className="py-3 pr-4">What kind of text?</td>
                <td className="py-3 pr-4">13</td>
                <td className="py-3">Callimachus (genre)</td>
              </tr>
              <tr className="border-b border-border-light/50">
                <td className="py-3 pr-4 font-medium">Cultural Sphere</td>
                <td className="py-3 pr-4">What linguistic-cultural world?</td>
                <td className="py-3 pr-4">11</td>
                <td className="py-3">Ranganathan (Space)</td>
              </tr>
              <tr className="border-b border-border-light/50">
                <td className="py-3 pr-4 font-medium">Era</td>
                <td className="py-3 pr-4">When composed?</td>
                <td className="py-3 pr-4">7</td>
                <td className="py-3">Ranganathan (Time)</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-medium">Epistemic Mode</td>
                <td className="py-3 pr-4">How does it generate knowledge?</td>
                <td className="py-3 pr-4">5</td>
                <td className="py-3">Bacon (cognitive faculty)</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* --- The Loop --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Loop
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Alexandria &rarr; Porphyry &rarr; Dionysius &rarr; Llull &rarr; Gessner &rarr; Bacon &rarr;
          Comenius &rarr; Dewey &rarr; Ranganathan &rarr; embeddings &rarr; LLM facets.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          What strikes us about this sequence is how slow the real breakthroughs were. The tree model
          lasted 1,200 years (Porphyry to Bacon). The enumerative model lasted 140 years (Dewey to
          embeddings). Llull&rsquo;s combinatorial insight was 700 years ahead of Ranganathan. The ideas
          were there in the primary sources all along &mdash; they just took centuries to be heard.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          There&rsquo;s something fitting about a library that contains Porphyry, Llull, Bacon, Gessner,
          Comenius, and Kircher using their ideas to organize itself. The books taught us how to
          classify the books.
        </p>

        {/* --- CTA --- */}
        <div className="border border-border-light rounded-lg p-8 bg-white mb-12">
          <h3 className="text-lg font-medium text-primary mb-3">Explore the Sources</h3>
          <p className="text-secondary text-sm leading-relaxed mb-4">
            Every text mentioned in this post is available in Source Library. Many are partially or fully
            translated from Latin, Greek, Syriac, and other languages.
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/book/porphyrii-introductio-ammonii-procli-diadochi-commentarii-porphyry" className="text-accent-rust hover:underline">Porphyry, Isagoge</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/pseudo-dionysius-areopagita-ficino-translation" className="text-accent-rust hover:underline">Pseudo-Dionysius, Celestial Hierarchy</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/ars-brevis-cum-approbatione-lullus" className="text-accent-rust hover:underline">Llull, Ars Brevis</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/bibliotheca-universalis-gessner" className="text-accent-rust hover:underline">Gessner, Bibliotheca Universalis</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/de-augmentis-scientiarum-bacon" className="text-accent-rust hover:underline">Bacon, De Augmentis Scientiarum</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/naturall-philosophie-reformed" className="text-accent-rust hover:underline">Comenius, Naturall Philosophie Reformed</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/kircher-ars-magna-sciendi-1669" className="text-accent-rust hover:underline">Kircher, Ars Magna Sciendi</Link>
          </div>
        </div>

      </article>

      <BlogComments slug="history-of-classification" />
    </ContentPageLayout>
  );
}
