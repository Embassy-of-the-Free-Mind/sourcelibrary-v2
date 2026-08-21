import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Ten Thousand Years of Tagging: A History of How Humans Organize Knowledge - Research Notes - Source Library',
  description: 'From Callimachus at Alexandria to LLM-assigned faceted tags, the history of classification runs through books we actually have. Aristotle, Porphyry, Llull, Leibniz, Linnaeus, Ranganathan, and the system we built from all of them.',
  openGraph: {
    images: [{ url: 'https://images.sourcelibrary.org/pages/69773e18094afd77cbd39c0a/0021-full.jpg', alt: 'Minerva in a library with putti studying a globe, from Chemical Library, 1727' }],
    title: 'Ten Thousand Years of Tagging',
    description: 'The history of knowledge classification, told through the books that invented it — most of which are in our collection.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/pages/69773e18094afd77cbd39c0a/0021-full.jpg', alt: 'Minerva in a library with putti studying a globe, from Chemical Library, 1727' }],
  },
  alternates: {
    canonical: '/blog/history-of-classification',
  },
};

/* External link helper — opens in new tab */
function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>;
}

export default function HistoryOfClassificationPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Ten Thousand Years of Tagging"
          subtitle="A history of how humans organize knowledge — told through the books that invented it"
          image="https://images.sourcelibrary.org/pages/69773e18094afd77cbd39c0a/0021-full.jpg"
          imageAlt="Minerva in a library with putti studying a globe, from Chemical Library, 1727"
        >
          <p className="text-stone-400 text-sm mt-4">16 March 2026 &middot; 20 min read</p>
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
          We recently built a new classification system for Source Library &mdash; six independent facets
          that tag every book by tradition, domain, form, cultural sphere, era, and epistemic mode.
          While designing it, we realized something: most of the key documents in the history
          of knowledge classification are books we already have. So we read them.
        </p>

        {/* ═══════ QUICK READ ═══════ */}
        <div className="border border-border-light rounded-lg p-6 md:p-8 bg-white mb-12">
          <h2 className="text-lg font-medium text-primary mb-4">The Timeline (2-minute version)</h2>
          <div className="space-y-3 text-sm text-secondary">
            <p><strong>~245 BCE</strong> &mdash; <strong>Callimachus</strong> at Alexandria: first library catalog. One scroll, one genre, filed by author.</p>
            <p><strong>~350 BCE / 270 CE</strong> &mdash; <strong>Aristotle&rsquo;s <em>Categories</em></strong>, then <strong>Porphyry&rsquo;s <em>Isagoge</em></strong>: the hierarchical tree. Everything descends from Substance through binary splits.</p>
            <p><strong>~500 CE</strong> &mdash; <strong>Pseudo-Dionysius</strong>: hierarchy as emanation, not containment. Three ranks of tags (source, bridge, browse).</p>
            <p><strong>3rd&ndash;10th c.</strong> &mdash; <strong>Chinese Sibu</strong> (four divisions) and <strong>Ibn al-Nadim&rsquo;s <em>Fihrist</em></strong>: independent non-Western systems classifying hundreds of thousands of works.</p>
            <p><strong>1305</strong> &mdash; <strong>Llull&rsquo;s <em>Ars Brevis</em></strong>: the combinatorial turn. Nine principles freely combined &mdash; the ancestor of faceted classification.</p>
            <p><strong>1543&ndash;1545</strong> &mdash; <strong>Ramus</strong> (dichotomous tables) and <strong>Gessner</strong> (first universal catalog, multiple access points).</p>
            <p><strong>1623&ndash;1705</strong> &mdash; <strong>Bacon</strong> (cognitive tree: Memory/Imagination/Reason), <strong>Leibniz</strong> (universal symbolic language from Llull), <strong>Hooke</strong> (classification by method/instrument).</p>
            <p><strong>1651&ndash;1752</strong> &mdash; <strong>Comenius</strong> (classification as curriculum) and <strong>Samuel Johnson</strong> (Ramist method reaches Yale, shapes the founding generation).</p>
            <p><strong>1735&ndash;1751</strong> &mdash; <strong>Linnaeus</strong> (binomial nomenclature &mdash; the most successful classification ever) and <strong>Diderot&rsquo;s <em>Encyclop&eacute;die</em></strong> (Bacon&rsquo;s tree realized at scale).</p>
            <p><strong>1876&ndash;1934</strong> &mdash; <strong>Dewey</strong> (decimal system), <strong>Otlet</strong> (proto-internet from index cards), <strong>Ranganathan</strong> (faceted classification &mdash; multiple independent dimensions).</p>
            <p><strong>1945&ndash;2004</strong> &mdash; <strong>Vannevar Bush</strong> (associative trails), the internet, <strong>folksonomy</strong> (user tagging: Delicious, Flickr, hashtags).</p>
            <p><strong>2012&ndash;2024</strong> &mdash; <strong>Knowledge graphs</strong> (Wikidata, Google KG) and <strong>vector embeddings</strong> (clustering by semantic similarity).</p>
            <p><strong>2024&ndash;2026</strong> &mdash; <strong>LLM-assigned faceted tags</strong>: controlled vocabulary + machine understanding. What we just built.</p>
          </div>
        </div>

        <p className="text-secondary leading-relaxed mb-12">
          What follows is the deep dive. Every text marked with a link is available in Source Library.
        </p>

        {/* ═══════ 1. CALLIMACHUS ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          1. The Catalog: Callimachus at Alexandria (~245 BCE)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The first known library catalog was the <em>Pinakes</em>, compiled by the poet Callimachus
          at the Library of Alexandria. It organized roughly 500,000 scrolls into six
          classes: rhetoric, law, epic, tragedy, comedy, and lyric poetry. Within each class, authors
          were listed alphabetically, with biographical notes and a list of works.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          This was a <strong>single-axis system</strong>: one scroll, one category, filed by genre.
          The categories were literary forms, not subjects. If you wanted to find everything about
          astronomy, you had to already know that Eudoxus wrote about astronomy and look him up
          by name. The <em>Pinakes</em> is lost, but its logic &mdash; sort by type, then by
          author &mdash; persisted for two thousand years.
        </p>

        {/* ═══════ 2. ARISTOTLE ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          2. The Ten Categories: Aristotle (~350 BCE)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Before anyone classified <em>books</em>, Aristotle classified <em>reality</em>. His{' '}
          <Link href="/book/aristotelis-opera-vol-1-organon-aristotle" className="text-accent-rust hover:underline">
            <em>Categories</em>
          </Link>{' '}
          (part of the <Link href="/book/aristotelis-opera-omnia-greek-aristotle" className="text-accent-rust hover:underline"><em>Organon</em></Link>,
          which we have in Greek manuscript and the Oxford translation) proposed that everything that
          can be said about anything falls into one of ten categories: Substance, Quantity, Quality,
          Relation, Place, Time, Position, State, Action, and Passion.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          These aren&rsquo;t library categories &mdash; they&rsquo;re the grammar of existence. But they set the
          template for all Western classification: there exists a finite set of fundamental types,
          and everything in the world can be assigned to one. Every classification system since
          is either extending Aristotle or rebelling against him.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          We hold multiple Aristotle editions including a{' '}
          <Link href="/book/vat-gr-244-aristotle" className="text-accent-rust hover:underline">Vatican Greek manuscript (Vat.gr.244)</Link>,
          a{' '}
          <Link href="/book/bodleian-library-ms-barocci-87-aristotle" className="text-accent-rust hover:underline">Bodleian manuscript (MS Barocci 87)</Link>,
          and the{' '}
          <Link href="/book/the-rhetoric-poetic-and-nicomachean-ethics-of-aristotle-aristotle" className="text-accent-rust hover:underline">
            <em>Rhetoric</em>, <em>Poetic</em>, and <em>Nicomachean Ethics</em>
          </Link>{' '}(399 of 407 pages translated).
        </p>

        {/* ═══════ 3. PORPHYRY ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          3. The Tree: Porphyry&rsquo;s <em>Isagoge</em> (270 CE)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Six centuries later, the Neoplatonist Porphyry wrote a short introduction to Aristotle&rsquo;s
          <em>Categories</em> that became more influential than the original. The{' '}
          <Link href="/book/porphyry-isagoge-neoplatonic-commentaries-proclus-ammonius-ammonius" className="text-accent-rust hover:underline">
            <em>Isagoge</em>
          </Link>{' '}
          (which we have in a Greek manuscript with the commentaries of Proclus and Ammonius)
          demonstrated classification through binary branching: start with the most general
          category (Substance), then split with a <em>differentia</em>. Corporeal or incorporeal?
          Living or non-living? Rational or irrational?
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The result is the <strong>Tree of Porphyry</strong> &mdash; the first hierarchical
          classification diagram. It became THE model for over a millennium.
          When we designed our faceted vocabulary, we borrowed Porphyry&rsquo;s key insight:
          every tag value carries a one-sentence <em>differentia</em> explaining what distinguishes
          it from its neighbors.
        </p>

        <blockquote className="border-l-2 border-accent-rust/30 pl-6 my-8 text-secondary italic">
          The problem with trees: they force false choices. A book on Paracelsian medicine is both
          alchemy and medicine, but a tree makes you pick one branch.
        </blockquote>

        {/* ═══════ 4. DIONYSIUS ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          4. The Emanation: Pseudo-Dionysius (~500 CE)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          While Porphyry classified by <em>type</em>, an anonymous Syrian monk proposed a different
          model. In the{' '}
          <Link href="/book/celestial-hierarchy-divine-names-ficino-ficino" className="text-accent-rust hover:underline">
            <em>Celestial Hierarchy</em>
          </Link>{' '}
          (Ficino&rsquo;s translation, 140 of 142 pages translated), knowledge is not a tree
          of types but a <strong>cascade of intensity</strong>. The divine Good emanates outward,
          each level receiving a diminished portion.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          From page 60: <em>&ldquo;Just as every specific order of things is traced back to its own single Head,
          so too must the universal order of all things be ultimately referred to one universal Head of all.&rdquo;</em>
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Dionysius suggests not all labels serve the same purpose. Some tags are &ldquo;source&rdquo;
          tags close to the author&rsquo;s own terminology. Some are &ldquo;bridge&rdquo; tags that connect
          traditions. Some are &ldquo;user-facing&rdquo; tags that help browsers. These are different
          ranks in a Dionysian hierarchy of tags.
        </p>

        {/* ═══════ 5. NON-WESTERN ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          5. Beyond the West: Chinese Sibu, Islamic Fihrist, Indian Padarthas
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The Western story from Aristotle to Porphyry was not the only game. Three other
          civilizations independently invented comprehensive classification systems &mdash;
          and two of them predate most European innovations.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>The Chinese Four Divisions (<em>Sibu</em>)</strong>, formalized during the
          Jin dynasty (3rd c. CE), organizes all written knowledge into four classes:
          Classics (<em>jing</em>), History (<em>shi</em>), Philosophy (<em>zi</em>), and
          Literature (<em>ji</em>). The{' '}
          <ExtLink href="https://en.wikipedia.org/wiki/Siku_Quanshu"><em>Siku Quanshu</em></ExtLink>{' '}
          (1782), the largest collection of books in Chinese history at 36,000 volumes, was organized
          using this system. It&rsquo;s still the basis of Chinese library classification today. Our collection
          includes the{' '}
          <Link href="/book/sancai-tuhui-illustrated-encyclopedia-of-the-three-realms" className="text-accent-rust hover:underline">
            <em>Sancai Tuhui</em> (Illustrated Encyclopedia of the Three Realms)
          </Link>{' '}
          (96 pages, fully translated) &mdash; a Ming dynasty encyclopedia that organizes
          heaven, earth, and humanity into systematic visual catalogs.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Ibn al-Nadim&rsquo;s{' '}
          <ExtLink href="https://en.wikipedia.org/wiki/Kitab_al-Fihrist"><em>Kitab al-Fihrist</em></ExtLink>
          </strong> (987 CE) is the Islamic world&rsquo;s Gessner &mdash; 550 years earlier. It catalogs
          every Arabic book known to a Baghdad bookseller, organized into ten sections: Holy Scriptures,
          Grammar, History, Poetry, Theology, Jurisprudence, Philosophy, Legends, Doctrines of
          non-Muslims, and Alchemy. Each section has subsections and author biographies. It covers
          roughly 10,000 works &mdash; an astonishing scope for the 10th century.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          <strong>The Indian <em>padarthas</em></strong> (categories of reality) from{' '}
          <ExtLink href="https://en.wikipedia.org/wiki/Vaisheshika">Vaisheshika philosophy</ExtLink>{' '}
          proposed six fundamental categories: Substance, Quality, Action, Generality, Particularity,
          and Inherence. S.R. Ranganathan, who invented faceted classification in 1933, explicitly
          credited the <em>padarthas</em> as his inspiration. The categories of Indian philosophy became
          the structural logic of modern library science.
        </p>

        {/* ═══════ 6. LLULL ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          6. The Combinatorial Turn: Ramon Llull (1305)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The most radical model came from a 13th-century Majorcan mystic. Llull&rsquo;s{' '}
          <Link href="/book/the-short-art-ars-brevis-lull" className="text-accent-rust hover:underline">
            <em>Ars Brevis</em>
          </Link>{' '}
          proposed that knowledge is not a tree at all. Instead, it emerges from the <strong>combination
          of a small set of independent principles</strong>.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Nine Absolute Principles (Goodness, Magnitude, Duration, Power, Wisdom, Will,
          Virtue, Truth, Glory) combined pairwise in a 36-cell table. From page 11:
          <em>&ldquo;Each principle taken by itself is entirely general... when one principle is contracted
          to another, then it is subalternated, as when one says &lsquo;great goodness.&rsquo;&rdquo;</em>
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          A book isn&rsquo;t <em>in</em> a category &mdash; it <em>combines</em> attributes. Nine principles
          give 36 pairs, 84 triples, 126 quadruples &mdash; far more distinctions than 126 flat categories.
          Llull needed only nine because he understood: <strong>the number of categories should be small
          enough to hold in mind simultaneously</strong>. The power comes from combination, not enumeration.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Athanasius Kircher expanded this in{' '}
          <Link href="/book/kircher-ars-magna-sciendi-1669-kircher" className="text-accent-rust hover:underline">
            <em>Ars Magna Sciendi</em>
          </Link>{' '}
          (1669, 532 pages, fully translated), adding a question dimension: each letter maps to
          Whether? What? Of what? Why? How much? When? Where? How?
        </p>

        {/* ═══════ 7. RAMUS & GESSNER ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          7. The Reformers: Ramus (1543) and Gessner (1545)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Peter Ramus&rsquo;s <em>Dialecticae Institutiones</em>{' '}
          (1543) proposed replacing Aristotelian logic with <strong>dichotomous
          division</strong>: take any subject, split it into two, split each part into two, repeat.
          Where Porphyry&rsquo;s tree was metaphysical, Ramus&rsquo;s was pedagogical &mdash; not classifying
          reality but organizing <em>how to teach</em> it. These &ldquo;Ramist tables&rdquo; conquered
          Protestant education across Europe and, crucially, crossed the Atlantic.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Two years later, Conrad Gessner published the{' '}
          <Link href="/book/bibliotheca-universalis-gessner" className="text-accent-rust hover:underline">
            <em>Bibliotheca Universalis</em>
          </Link>{' '}
          &mdash; the first attempt to catalog every book ever printed (~12,000 works). Alphabetical by author,
          then reclassified by 21 subject divisions in the companion <em>Pandectae</em>. Gessner&rsquo;s
          innovation: <strong>multiple access points to the same content</strong>. Author, subject, date
          &mdash; all first-class entry points. Our faceted system has six.
        </p>

        {/* ═══════ 8. BACON & LEIBNIZ ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          8. The Cognitive Tree and the Universal Language: Bacon (1623) and Leibniz (1666)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Francis Bacon&rsquo;s{' '}
          <Link href="/book/the-advancement-of-learning-bacon" className="text-accent-rust hover:underline">
            <em>De Augmentis Scientiarum</em>
          </Link>{' '}
          (fully translated, 696 pages) grounded classification in <strong>the cognitive operations
          of the knower</strong>. From page 126: <em>&ldquo;The truest division of human doctrine is that
          which is taken from the threefold Faculty of the Rational Soul. History is referred to Memory,
          Poesy to Imagination, Philosophy to Reason.&rdquo;</em>
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          This suggests a tagging dimension library science mostly ignored: not just <em>what</em> a book
          is about, but <em>what kind of thinking it requires</em>. We built this as the &ldquo;epistemic
          mode&rdquo; facet. Bacon also invented <em>desiderata</em> &mdash; mapping what knowledge is
          <em>missing</em> &mdash; a tagging system for gaps.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Gottfried Wilhelm Leibniz took Llull&rsquo;s combinatorial vision further. In his <em>Dissertatio
          de Arte Combinatoria</em> (1666) and the lifelong project of a <em>characteristica universalis</em>,
          Leibniz imagined a universal symbolic language where all knowledge could be represented as
          combinations of primitive concepts &mdash; and <em>reasoned about</em> mechanically. He explicitly
          built on Llull. We hold multiple volumes of{' '}
          <Link href="/book/die-philosophischen-schriften-vol-7-leibniz" className="text-accent-rust hover:underline">
            Leibniz&rsquo;s philosophical writings
          </Link>{' '}
          and his{' '}
          <Link href="/book/mathematische-schriften-vol-iv-leibniz" className="text-accent-rust hover:underline">
            mathematical writings
          </Link>. His dream of a <em>calculus ratiocinator</em> &mdash; a machine that could
          compute with categories &mdash; anticipated both Ranganathan&rsquo;s faceted classification
          and modern knowledge graphs.
        </p>

        {/* ═══════ 9. HOOKE ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          9. The Empirical Superstructure: Robert Hooke (1705)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Bacon drew the tree. Robert Hooke tried to fill it in. His{' '}
          <Link href="/book/the-posthumous-works-of-robert-hooke-hooke" className="text-accent-rust hover:underline">
            <em>Posthumous Works</em>
          </Link>{' '}
          (594 pages, 10 translated) included &ldquo;A General Scheme, or Idea of the Present
          State of Natural Philosophy&rdquo; &mdash; the &ldquo;superstructure&rdquo; on Bacon&rsquo;s foundation.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Where Bacon organized knowledge by cognitive faculty, Hooke organized nature by
          <strong> observational method</strong>: what instruments you need, what senses are involved,
          what scale of phenomena. Light, sound, motion, gravity, magnetism &mdash; each domain broken
          down by the type of experiment needed to investigate it. This is a different axis: not
          <em> what</em> knowledge is about, not <em>what the mind does</em>, but <em>what tools you need</em>.
          The &ldquo;General Scheme&rdquo; is mostly untranslated &mdash; a priority for our OCR pipeline.
        </p>

        {/* ═══════ 10. COMENIUS & SAMUEL JOHNSON ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          10. Classification as Curriculum: Comenius (1651) and Samuel Johnson of Yale (1752)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Comenius argued in{' '}
          <Link href="/book/naturall-philosophie-reformed-by-divine-light-1651-comenius" className="text-accent-rust hover:underline">
            <em>Naturall Philosophie Reformed by Divine Light</em>
          </Link>{' '}
          (308 pages, fully translated) that classification <strong>is</strong> curriculum. You learn
          simple before complex, and the classification system itself is a learning path.
          From page 15: <em>&ldquo;They must be used in this order: that we begin with sense,
          and end in revelation.&rdquo;</em>
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          A century later, this idea crossed the Atlantic. Samuel Johnson (1696&ndash;1772) &mdash;
          not the English lexicographer, but the first president of King&rsquo;s College (now Columbia) &mdash;
          created an <em>Encyclopaedia of Philosophy</em> that organized all knowledge into Ramist-style
          dichotomous trees blended with Lockean empiricism. Published in his collected
          <em> Career and Writings</em>, it became a textbook at King&rsquo;s College and shaped how the
          colonial generation organized knowledge.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          The connection to the founding of the republic is not metaphorical. The men who wrote
          the Constitution were products of this educational system. Separate powers, enumerated rights,
          hierarchical jurisdiction &mdash; these reflect the Ramist habit of dividing any complex subject
          into a branching structure of named parts. The chain: Ramus (1543) &rarr; Protestant universities &rarr;
          Samuel Johnson at Yale/King&rsquo;s (1752) &rarr; colonial curriculum &rarr; the founding
          generation&rsquo;s mental models.
        </p>

        {/* ═══════ 11. LINNAEUS & DIDEROT ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          11. The Great Classifiers: Linnaeus (1735) and Diderot (1751)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Carl Linnaeus published the{' '}
          <Link href="/book/carl-linnaeus-systema-naturae-1735-linnaeus" className="text-accent-rust hover:underline">
            <em>Systema Naturae</em>
          </Link>{' '}
          in 1735 &mdash; just 21 pages in the first edition, but it contained the most successful
          classification system ever created. <strong>Binomial nomenclature</strong> (Kingdom &rarr;
          Phylum &rarr; Class &rarr; Order &rarr; Family &rarr; Genus &rarr; Species) is Porphyry&rsquo;s
          tree made operational for biology. It&rsquo;s still in use 290 years later. We hold the
          1735 first edition and several companion works, including Linnaeus&rsquo;s{' '}
          <Link href="/book/carl-linnaeus-hortus-cliffortianus-1737-linnaeus" className="text-accent-rust hover:underline">
            <em>Hortus Cliffortianus</em>
          </Link>{' '}
          (1737).
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          In 1751, Diderot and d&rsquo;Alembert published the first volume of the{' '}
          <em>Encyclop&eacute;die</em>. Its famous &ldquo;Syst&egrave;me Figur&eacute; des
          Connaissances Humaines&rdquo; diagram &mdash; viewable in the{' '}
          <ExtLink href="https://encyclopedie.uchicago.edu/content/syst%C3%A8me-figur%C3%A9-des-connaissances-humaines">
            ARTFL Encyclop&eacute;die Project
          </ExtLink>{' '}
          &mdash; is Bacon&rsquo;s cognitive tree (Memory/Imagination/Reason) realized at
          industrial scale. 72,000 articles, 17 volumes of text, 11 volumes of plates.
          The Enlightenment&rsquo;s operating system for knowledge.
        </p>

        {/* ═══════ 12. DEWEY, OTLET, RANGANATHAN ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          12. The Library Scientists: Dewey (1876), Otlet (1905), Ranganathan (1933)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Melvil Dewey published his Decimal Classification in 1876: 10 top-level classes, 100 divisions,
          1,000 sections. Every book gets <strong>one number</strong>. It&rsquo;s Porphyry&rsquo;s tree
          with decimal notation. Still used by most public libraries.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The Belgian bibliographer{' '}
          <ExtLink href="https://en.wikipedia.org/wiki/Paul_Otlet">Paul Otlet</ExtLink>{' '}
          took Dewey further. Starting in 1905, he and Henri La Fontaine created the{' '}
          <ExtLink href="https://en.wikipedia.org/wiki/Mundaneum">Mundaneum</ExtLink>{' '}
          &mdash; a vast paper-based knowledge system in Brussels containing over 12 million
          index cards cross-referenced by subject. Otlet expanded Dewey into the{' '}
          <ExtLink href="https://en.wikipedia.org/wiki/Universal_Decimal_Classification">Universal Decimal Classification</ExtLink>,
          adding a notation for combining subjects (a book on &ldquo;chemistry of food in France&rdquo;
          could be expressed as a compound number). In 1934, he described a &ldquo;r&eacute;seau mondial&rdquo;
          (world network) that would connect all knowledge through electric signals &mdash;
          essentially imagining the internet.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The real breakthrough came from India. S.R. Ranganathan invented <strong>Colon Classification</strong>
          (1933) &mdash; the first truly faceted system. Instead of one category per book, every book gets
          one tag from each of five fundamental facets: Personality, Matter, Energy, Space, and Time.
          &ldquo;History of Indian medicine in the 18th century&rdquo; becomes L:2:f:44:N.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Ranganathan explicitly credited the <em>padarthas</em> of Vaisheshika philosophy as his
          inspiration. He was Llull&rsquo;s intellectual heir: both understood that a small number of
          independent axes, freely combined, generates more distinctions than any flat list.
          Every time you filter by price + brand + rating + color on Amazon, you&rsquo;re using
          Ranganathan&rsquo;s idea.
        </p>

        {/* ═══════ 13. DIGITAL ERA ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          13. The Digital Revolutions: Bush (1945), Folksonomy (2004), Knowledge Graphs (2012)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          In 1945, Vannevar Bush published{' '}
          <ExtLink href="https://www.theatlantic.com/magazine/archive/1945/07/as-we-may-think/303881/">
            &ldquo;As We May Think&rdquo;
          </ExtLink>{' '}
          in <em>The Atlantic</em>, describing the <em>memex</em> &mdash; a desk-sized device that stores
          all of a person&rsquo;s books and records, accessed through <strong>associative trails</strong>
          rather than hierarchical filing. &ldquo;The human mind operates by association,&rdquo; Bush wrote.
          &ldquo;It should be possible to beat the speed and permanency of the brain.&rdquo; The memex never
          got built, but it directly inspired Ted Nelson&rsquo;s hypertext and, through him, the World Wide Web.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The Web brought a classification revolution nobody expected: <strong>folksonomy</strong>.
          Starting with{' '}
          <ExtLink href="https://en.wikipedia.org/wiki/Delicious_(website)">Delicious</ExtLink>{' '}
          (2003) and Flickr (2004), users tagged content freely with no controlled vocabulary.
          The &ldquo;tag cloud&rdquo; era. Twitter hashtags (2007) extended this to real-time discourse.
          The power: anyone can tag anything. The weakness: synonyms, typos, no structure.
          &ldquo;Alchemy,&rdquo; &ldquo;alchemy,&rdquo; &ldquo;alchemia,&rdquo; and &ldquo;transmutation&rdquo;
          become four unrelated tags.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          <strong>Knowledge graphs</strong> emerged as a structured alternative. Google&rsquo;s{' '}
          <ExtLink href="https://blog.google/products/search/introducing-knowledge-graph-things-not/">
            Knowledge Graph
          </ExtLink>{' '}
          (2012) and{' '}
          <ExtLink href="https://www.wikidata.org/">Wikidata</ExtLink>{' '}
          (2012) model knowledge not as categories but as <strong>entities and relationships</strong>.
          Aristotle isn&rsquo;t &ldquo;filed under Philosophy&rdquo; &mdash; he&rsquo;s an entity with
          properties (born: Stagira, teacher of: Alexander, student of: Plato) connected to other entities.
          This is fundamentally different from all tree and facet models: there are no categories at
          all, only a web of typed links. It&rsquo;s closer to Bush&rsquo;s associative trails than to
          Porphyry&rsquo;s branching tree.
        </p>

        {/* ═══════ 14. EMBEDDINGS ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          14. The Embedding: Vector Clustering (2020s)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Neural language models introduced a completely different approach. Instead of humans choosing
          categories, models embed texts as points in high-dimensional vector space. Texts with
          similar meaning end up near each other. Clustering algorithms find the groupings.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          We did this with Source Library &mdash; embedding 5,993 book summaries and discovering{' '}
          <Link href="/blog/clustering" className="text-accent-rust hover:underline">48 clusters</Link>.
          The algorithm found groupings no human would have proposed: a &ldquo;Thirty Years&rsquo; War
          Pamphlets&rdquo; cluster connecting Frankfurt book fair catalogs with Rosicrucian texts.
          But embeddings have no labels, no explanations, no stability. Blavatsky&rsquo;s{' '}
          <em>Isis Unveiled</em> ended up in &ldquo;Christian Kabbalah&rdquo; &mdash; wrong as a label,
          but revealing as a neighborhood.
        </p>

        {/* ═══════ 15. LLM ERA ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          15. LLMs as Classifiers (2024&ndash;2026)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Large language models changed what&rsquo;s possible. They can read a book&rsquo;s title,
          author, year, language, and summary, <em>understand</em> what kind of text it is, and assign
          tags from a controlled vocabulary &mdash; with the judgment of a specialist librarian and
          the speed of a database.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          This is new. Previous automated approaches were either statistical (keyword matching,
          embeddings) or rule-based (Dewey&rsquo;s ten classes). LLMs combine the flexibility of
          human judgment with the scale of automation. The{' '}
          <ExtLink href="https://www.loc.gov/programs/of-the-people/news/ai-and-loc-labs/">
            Library of Congress
          </ExtLink>{' '}
          has been experimenting with AI-assisted subject heading assignment.{' '}
          <ExtLink href="https://www.oclc.org/">OCLC</ExtLink> (the organization behind WorldCat) is
          exploring LLM-powered cataloging. Academic libraries are testing{' '}
          <ExtLink href="https://arxiv.org/abs/2305.14483">GPT-based classification</ExtLink>{' '}
          against human catalogers and finding competitive accuracy.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          What none of these projects have done, as far as we know, is combine LLM classification
          with a <em>philosophically grounded</em> faceted vocabulary. Most AI cataloging projects bolt
          an LLM onto existing systems (Dewey, LCSH). We designed the vocabulary itself from first
          principles, using the classification theories of Llull, Bacon, Porphyry, Gessner, and
          Ranganathan. Which brings us to what we built.
        </p>

        {/* ═══════ 16. OUR SYSTEM ═══════ */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          16. The Synthesis: Source Library&rsquo;s Faceted Tags (2026)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Our new system combines all of these ancestors:
        </p>

        <ul className="text-secondary leading-relaxed mb-6 space-y-2 ml-4">
          <li><strong>Llull&rsquo;s combinatorial logic:</strong> six independent facets, freely combined. 68 tag values produce roughly a million unique intersections.</li>
          <li><strong>Porphyry&rsquo;s differentia:</strong> every tag value has a one-sentence boundary definition.</li>
          <li><strong>Bacon&rsquo;s cognitive grounding:</strong> the &ldquo;epistemic mode&rdquo; facet records <em>how</em> a text generates knowledge.</li>
          <li><strong>Gessner&rsquo;s multiple access points:</strong> no single facet is primary.</li>
          <li><strong>Ranganathan&rsquo;s PMEST:</strong> orthogonal facets whose intersection uniquely locates any text.</li>
          <li><strong>Folksonomy&rsquo;s lesson:</strong> controlled vocabulary matters. We didn&rsquo;t let the model invent tags.</li>
          <li><strong>Knowledge graph thinking:</strong> books connect to other books through shared facet values, not just shared categories.</li>
          <li><strong>Embedding discovery:</strong> the 48 clusters remain as a &ldquo;surprise me&rdquo; feature.</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6">
          A Gemini model reads each book&rsquo;s metadata and selects tags. The cost to
          classify 13,000 books: about 70 cents.
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
                <td className="py-3">Aristotle (genus), Porphyry (differentia)</td>
              </tr>
              <tr className="border-b border-border-light/50">
                <td className="py-3 pr-4 font-medium">Domain</td>
                <td className="py-3 pr-4">What subject matter?</td>
                <td className="py-3 pr-4">15</td>
                <td className="py-3">Gessner (21 classes), Ibn al-Nadim (10 sections)</td>
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
                <td className="py-3">Ranganathan (Space), Chinese Sibu</td>
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
                <td className="py-3">Bacon (cognitive faculty), Hooke (method)</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* --- The Loop --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Loop
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Aristotle &rarr; Porphyry &rarr; Dionysius &rarr; Chinese Sibu &rarr; Ibn al-Nadim &rarr;
          Llull &rarr; Ramus &rarr; Gessner &rarr; Bacon &rarr; Leibniz &rarr; Hooke &rarr;
          Comenius &rarr; Samuel Johnson &rarr; Linnaeus &rarr; Diderot &rarr; Dewey &rarr;
          Otlet &rarr; Ranganathan &rarr; Bush &rarr; folksonomy &rarr; knowledge graphs &rarr;
          embeddings &rarr; LLM facets.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          What strikes us is how slow the real breakthroughs were. The tree model
          lasted 1,200 years (Porphyry to Bacon). The enumerative model lasted 140 years (Dewey to
          embeddings). Llull&rsquo;s combinatorial insight was 700 years ahead of Ranganathan.
          Ramus&rsquo;s pedagogical trees shaped how a nation organized its government, and nobody in
          library science seems to have noticed. The Chinese Sibu system and the Islamic <em>Fihrist</em>
          both predate European innovations by centuries. The ideas were there all along &mdash;
          they just took time to be heard across traditions.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          There&rsquo;s something fitting about a library that contains Aristotle, Porphyry, Llull, Ramus,
          Gessner, Bacon, Leibniz, Hooke, Comenius, Kircher, Samuel Johnson, Linnaeus, and Diderot
          using their ideas to organize itself. The books taught us how to classify the books.
        </p>

        {/* --- Sources CTA --- */}
        <div className="border border-border-light rounded-lg p-8 bg-white mb-12">
          <h3 className="text-lg font-medium text-primary mb-3">Explore the Sources</h3>
          <p className="text-secondary text-sm leading-relaxed mb-4">
            Most texts mentioned in this post are available in Source Library. Many are partially or fully
            translated. External links point to the best available digital editions.
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <Link href="/book/aristotelis-opera-vol-1-organon-aristotle" className="text-accent-rust hover:underline">Aristotle, Categories</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/porphyry-isagoge-neoplatonic-commentaries-proclus-ammonius-ammonius" className="text-accent-rust hover:underline">Porphyry, Isagoge</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/celestial-hierarchy-divine-names-ficino-ficino" className="text-accent-rust hover:underline">Pseudo-Dionysius, Celestial Hierarchy</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/sancai-tuhui-illustrated-encyclopedia-of-the-three-realms" className="text-accent-rust hover:underline">Sancai Tuhui (Chinese Encyclopedia)</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/the-short-art-ars-brevis-lull" className="text-accent-rust hover:underline">Llull, Ars Brevis</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/kircher-ars-magna-sciendi-1669-kircher" className="text-accent-rust hover:underline">Kircher, Ars Magna Sciendi</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/bibliotheca-universalis-gessner" className="text-accent-rust hover:underline">Gessner, Bibliotheca Universalis</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/the-advancement-of-learning-bacon" className="text-accent-rust hover:underline">Bacon, De Augmentis Scientiarum</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/die-philosophischen-schriften-vol-7-leibniz" className="text-accent-rust hover:underline">Leibniz, Philosophical Writings VII</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/the-posthumous-works-of-robert-hooke-hooke" className="text-accent-rust hover:underline">Hooke, Posthumous Works</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/naturall-philosophie-reformed-by-divine-light-1651-comenius" className="text-accent-rust hover:underline">Comenius, Naturall Philosophie Reformed</Link>
            <span className="text-stone-300">&middot;</span>
            <Link href="/book/carl-linnaeus-systema-naturae-1735-linnaeus" className="text-accent-rust hover:underline">Linnaeus, Systema Naturae (1735)</Link>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm mt-3">
            <span className="text-stone-400 text-xs">External:</span>
            <ExtLink href="https://en.wikipedia.org/wiki/Kitab_al-Fihrist">Ibn al-Nadim, Fihrist</ExtLink>
            <span className="text-stone-300">&middot;</span>
            <ExtLink href="https://en.wikipedia.org/wiki/Mundaneum">Otlet, Mundaneum</ExtLink>
            <span className="text-stone-300">&middot;</span>
            <ExtLink href="https://www.theatlantic.com/magazine/archive/1945/07/as-we-may-think/303881/">Bush, &ldquo;As We May Think&rdquo;</ExtLink>
            <span className="text-stone-300">&middot;</span>
            <ExtLink href="https://encyclopedie.uchicago.edu/content/syst%C3%A8me-figur%C3%A9-des-connaissances-humaines">Encyclopedie Tree of Knowledge</ExtLink>
          </div>
        </div>

      </article>

    </ContentPageLayout>
  );
}
