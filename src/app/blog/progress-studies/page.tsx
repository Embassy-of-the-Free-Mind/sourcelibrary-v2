import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'The Deeper Roots: Progress Studies and the Pre-Industrial Evidence Base - Source Library',
  description:
    'Progress studies predicted that useful knowledge drove innovation long before the Industrial Revolution. 5,000 newly translated books in Latin, German, Arabic, and Hebrew confirm it — with steam engines, laboratory equipment, and experimental science embedded in alchemy and natural magic.',
  openGraph: {
    title: 'The Deeper Roots: Progress Studies and the Pre-Industrial Evidence Base',
    description: 'Mokyr\'s "useful knowledge," Howes\'s "improving mentality," and Crawford\'s techno-humanism all predicted what 5,000 newly translated pre-industrial books confirm: innovation has deeper roots than anyone could read.',
    images: [{ url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/695230c6ab34727b1f044784/9.jpg', width: 1200, height: 630 }],
  },
  alternates: {
    canonical: '/blog/progress-studies',
  },
};

export default function ProgressStudiesPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Deeper Roots"
          subtitle="How 5,000 newly translated books confirm what progress studies predicted &mdash; innovation didn&rsquo;t begin with the Industrial Revolution"
        >
          <p className="text-stone-400 text-sm mt-4">8 March 2026 &middot; 15 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All posts
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          In October 2025, Joel Mokyr shared the Nobel Prize in Economics with Philippe Aghion
          and Peter Howitt for work on the &ldquo;prerequisites for sustained growth through
          technological progress.&rdquo; The committee cited Mokyr&rsquo;s insight that the
          Industrial Revolution depended not just on incentives or institutions, but on a culture
          that valued &ldquo;useful knowledge&rdquo; &mdash; propositional knowledge about nature
          that could be turned into prescriptive knowledge about technique.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          Mokyr&rsquo;s framework raises an obvious question: how far back does that culture go?
          He traces it from the Enlightenment forward, through the Republic of Letters and the
          Industrial Enlightenment. But he has always acknowledged that the evidence gets thin
          before 1700, not because the knowledge didn&rsquo;t exist, but because most pre-modern
          texts on natural philosophy, alchemy, mechanics, and experimental method were written
          in Latin, German, Arabic, and Hebrew &mdash; and have never been translated into English.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          That gap is now closing. Source Library has translated over 5,000 books from
          the 2nd to 19th centuries, drawn from thirteen digital library collections. Over 700,000
          pages have been translated into English, and 1,873 of these books are{' '}
          <Link href="/blog/first-translations" className="text-accent-rust hover:underline">
            first-ever English translations</Link>{' '}
          &mdash; texts that have existed for centuries but had no prior English version. What
          they contain confirms and extends the central insights of progress studies: the
          culture of useful knowledge has deeper roots than anyone could previously read.
        </p>

        <hr className="border-border-light my-12" />

        {/* I. What the Frameworks Predicted */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            I. What the Frameworks Predicted
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The remarkable thing about progress studies is how well its frameworks predict what
            we found in the pre-1750 sources &mdash; sources that were unavailable when the
            frameworks were built.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Mokyr argued that sustained growth requires a culture that produces &ldquo;useful
            knowledge&rdquo; &mdash; systematic understanding of natural phenomena that practitioners
            can turn into working techniques. He built this case from Enlightenment-era evidence.
            But the pre-1750 texts show exactly this dynamic: alchemists systematically studying
            the properties of matter, natural philosophers developing theories of pneumatics and
            hydraulics, instrument-makers accumulating practical knowledge about furnaces,
            distillation, and metallurgy &mdash; all producing propositional knowledge and
            turning it into prescriptive technique.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Anton Howes argued that innovation is driven by the spread of an &ldquo;improving
            mentality&rdquo; &mdash; a learned cultural disposition, spreading person to person,
            characterized by &ldquo;a belief in the acceptability of contesting tradition&rdquo;
            and &ldquo;a vision of the benefits of progress.&rdquo; He traced it through British
            inventor networks starting in the 1540s. The translated texts show that this mentality
            existed centuries earlier &mdash; it just lived under different names and in different
            languages. Howes was right about the mechanism. The timeline goes back further than
            he could see.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Jason Crawford has been building the case for a{' '}
            <a href="https://rootsofprogress.org/techno-humanist-manifesto" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
              &ldquo;techno-humanist&rdquo;</a>{' '}
            philosophy &mdash; the view that technological progress and human flourishing are
            connected, not opposed. The pre-industrial texts are full of this conviction.
            Renaissance natural philosophers believed that understanding nature&rsquo;s secrets
            was a path to human improvement. The alchemist&rsquo;s project was explicitly
            about perfecting nature through knowledge. They were techno-humanists before the
            term existed.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* II. What's in the Books */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            II. What&rsquo;s in the Books
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Source Library holds over 5,000 books from the{' '}
            <a href="https://www.embassyofthefreemind.com/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
              Embassy of the Free Mind</a>{' '}
            and twelve other digital library collections, spanning the 2nd to 19th centuries.
            Most are in Latin, German, Dutch, French, Italian, Arabic, and Hebrew.
            Nearly two million pages have been digitized, and over 700,000 have been translated
            into English.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The collection was assembled for the study of Western esotericism &mdash; alchemy,
            Hermeticism, Kabbalah, astrology, natural magic. But when you actually read these
            texts, the boundary between &ldquo;esotericism&rdquo; and &ldquo;proto-science&rdquo;
            dissolves. The same books that describe the{' '}
            <Link href="/book/theatrum-chemicum-volumen-primum-ed?page=14" className="text-accent-rust hover:underline">
              philosopher&rsquo;s stone</Link>{' '}
            also describe how to{' '}
            <Link href="/book/theatrum-chemicum-volumen-primum-ed?page=213" className="text-accent-rust hover:underline">
              build furnaces</Link>. The same author who writes about divine illumination also
            gives specifications for a kite. The same manuscript that contains Hermes
            Trismegistus also contains Hero of Alexandria&rsquo;s steam engines.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            We documented this in detail in{' '}
            <Link href="/blog/hidden-engineers" className="text-accent-rust hover:underline">
              &ldquo;The Hidden Engineers&rdquo;</Link> &mdash;
            every claim linked to the original translated page. Here is a summary of the evidence.
          </p>

          <h3 className="font-serif text-2xl text-primary mt-10 mb-4">
            Steam engines in a spell book
          </h3>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            A manuscript copied for King Francis I of France around 1545 binds two works in
            the same volume: Hero of Alexandria&rsquo;s <em>Pneumatica</em> &mdash; describing
            steam-powered rotating spheres, automatic temple doors, and singing bird automata
            &mdash; and the <em>Corpus Hermeticum</em>, the foundational text of Western
            mystical philosophy. The same scribe, the same royal binding.{' '}
            <Link href="/book/695230c6ab34727b1f044784?page=93" className="text-accent-rust hover:underline">
              The aeolipile diagram</Link>{' '}
            is sixty pages from the vision of divine light.
          </p>

          <h3 className="font-serif text-2xl text-primary mt-10 mb-4">
            Pneumatics as &ldquo;natural magic&rdquo;
          </h3>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Giambattista della Porta&rsquo;s <em>Magia Naturalis</em> (1589) promises
            &ldquo;natural magic&rdquo; and delivers a pneumatics textbook. Book XIX is a
            systematic treatment of hydraulics and air-pressure devices, citing Hero by name.
            Book XX gives{' '}
            <Link href="/book/694fe5f9f844de8615417df4?page=706" className="text-accent-rust hover:underline">
              exact specifications for building a kite</Link>{' '}
            &mdash; frame proportions, covering materials, wind conditions &mdash; and concludes
            that &ldquo;the ingenious man will be able to foresee the principles by which even
            a man might be able to fly.&rdquo;
          </p>

          <h3 className="font-serif text-2xl text-primary mt-10 mb-4">
            The alchemist&rsquo;s laboratory equipment
          </h3>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Alchemists were the best-equipped experimental chemists in Europe for over a
            thousand years. They invented the <em>athanor</em> &mdash; a self-feeding furnace
            that maintains constant temperature for days, solving a real thermodynamics problem
            before thermostats existed. The <em>bain-marie</em>, attributed to{' '}
            <Link href="/book/69751588a88d83c830d99e17?page=6" className="text-accent-rust hover:underline">
              Maria the Prophetess</Link>{' '}
            in late antiquity, survives in every chemistry laboratory and restaurant kitchen
            in the world. The{' '}
            <Link href="/book/694fe601f844de8615417e21?page=2" className="text-accent-rust hover:underline">
              <em>Theatrum Chemicum</em></Link>{' '}
            (1659) &mdash; six folio volumes, over two hundred treatises &mdash; scatters
            precise technical instructions for building laboratory equipment among its
            alchemical allegories.
          </p>

          <h3 className="font-serif text-2xl text-primary mt-10 mb-4">
            A literal steam engine schematic in a Rosicrucian manuscript
          </h3>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Pages 58&ndash;59 of <em>Die Lehren der Rosenkreuzer</em> contain what may be
            the most unexpected document in the collection: a{' '}
            <Link href="/book/690c27e6e0787282ad593282?page=58" className="text-accent-rust hover:underline">
              construction plan for a steam-powered device</Link>,
            labeled &ldquo;Elijah&rsquo;s Chariot.&rdquo; It includes materials (red brick,
            iron plate, angle iron bands), measurements (scale of three-quarters of an inch
            to the foot), and functional components (exhaust flue, water/steam chamber). The
            Rosicrucian author took a biblical image of divine ascension and solved it as an
            engineering problem.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* III. The Improving Mentality Goes Back Further */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            III. The Improving Mentality Goes Back Further
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Howes&rsquo;s thesis is elegant: innovation spreads like a cultural disposition,
            person to person, through networks of people who believe that things can be made
            better and that making them better is worthwhile. His evidence starts in 1547.
            But the mechanism he describes is visible centuries earlier in the translated texts
            &mdash; it just hadn&rsquo;t been readable in English before.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Alchemy was, at its core, an explicit program for improving nature. The
            transmutation of base metals into gold was not just a metaphor for spiritual
            perfection &mdash; it was a technological ambition. Alchemists believed that
            nature&rsquo;s processes could be accelerated, perfected, and surpassed through
            systematic investigation and experiment. The philosopher&rsquo;s stone was imagined
            as a technology: a substance that would perfect any material it touched.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            This is not a retrospective interpretation. The texts say so explicitly. Roger
            Bacon (13th century) argued that &ldquo;experimental science&rdquo; was the
            highest form of knowledge. Ramon Llull developed a combinatorial logic machine
            in the 1270s. The Arabic alchemist J&#x101;bir ibn Hayy&#x101;n (8th century)
            described a systematic program for understanding and manipulating the properties
            of matter. These figures had Howes&rsquo;s two characteristics &mdash; they
            contested tradition and they envisioned benefits from doing so &mdash; centuries
            before the British improving networks he documents.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The reason this wasn&rsquo;t visible is the language barrier. The improving mentality
            before 1547 lived in Latin, German, and Arabic texts that had never been translated.
            You cannot trace person-to-person diffusion of a cultural disposition through texts
            you cannot read. Now you can.
          </p>

          <div className="bg-warm rounded-xl p-6 border border-border-light my-8">
            <p className="text-secondary italic font-body leading-relaxed mb-3">
              &ldquo;In the mechanical arts, the first inventor falls shortest, and time
              adds to and perfects the work; but in the sciences, the first author goes
              furthest, and time degrades and corrupts.&rdquo;
            </p>
            <p className="text-sm text-muted">
              <Link
                href="/book/695294d8b184004c526a23f1?page=51"
                className="text-accent-rust hover:underline"
              >
                Francis Bacon, <em>The Advancement of Learning</em>, 1605
              </Link>
            </p>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Francis Bacon &mdash; writing in 1605, within Howes&rsquo;s time frame &mdash;
            described what had already been true for centuries. The &ldquo;mechanical
            arts&rdquo; were cumulative: each generation improved on the last. The blacksmith
            improves while the philosopher declines. Bacon was not inventing this observation.
            He was naming something that alchemists, instrument-makers, and natural
            philosophers had been doing for generations &mdash; in Latin, German, and Arabic
            texts that are now, for the first time, readable in English.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* IV. Newton, Boyle, and the Source Code */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            IV. Newton, Boyle, and the Source Code
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Progress studies has long grappled with the question of why the Scientific Revolution
            happened where and when it did. The answer, increasingly, involves what the
            revolutionaries were reading &mdash; and most of it was in the esoteric tradition.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Isaac Newton spent more time on alchemy than on physics. His alchemical manuscripts
            &mdash; over a million words &mdash; were hidden for centuries, dismissed as an
            embarrassment. They are now recognized by historians (William Newman, Lawrence
            Principe) as central to his intellectual development. Newton&rsquo;s concept of
            gravity as action at a distance &mdash; the idea that Leibniz mocked as &ldquo;occult
            qualities&rdquo; &mdash; drew on traditions of sympathetic action that were
            commonplace in alchemical and Hermetic texts.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Robert Boyle, whose <em>The Sceptical Chymist</em> (1661) is often treated as the
            founding document of modern chemistry, was an active alchemist. His experimental
            method grew directly from alchemical practice. Boyle believed that laboratory
            experiments &ldquo;in search of a way to transform base metals into gold&hellip;
            often had value in themselves as exercises in investigation.&rdquo;
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Johannes Kepler believed that planets were alive. His <em>Astronomia Nova</em> (1609)
            &mdash; in which he discovered that planetary orbits are elliptical, not circular
            &mdash; was driven by a conviction that the cosmos had a harmonic structure. He
            described gravity as a &ldquo;mutual material tendency between related bodies&rdquo;
            eighty years before Newton, but also wrote that planets had an &ldquo;animal
            faculty&rdquo; guiding their motion. The elliptical orbit and the living planet
            came from the same intellectual framework.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The intellectual tradition out of which modern science emerged is preserved in the
            texts that Source Library holds. The{' '}
            <Link href="/book/694fe601f844de8615417e21" className="text-accent-rust hover:underline">
              <em>Theatrum Chemicum</em></Link>,
            the{' '}
            <Link href="/book/69751588a88d83c830d99e17" className="text-accent-rust hover:underline">
              <em>Artis Auriferae</em></Link>,
            the Hermetic and Neoplatonic texts that Ficino translated, the Kabbalistic works
            that shaped Renaissance natural philosophy &mdash; these are the source code of the
            Scientific Revolution. Understanding why progress happened means reading what the
            people who made it happen were reading.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* V. The Theatre of Machines */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            V. The Theatre of Machines
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Beyond the esoteric tradition, Source Library holds a growing collection of
            explicitly technical works &mdash; the &ldquo;theatre of machines&rdquo; genre
            that flourished from the 15th to 17th centuries. These are the handbooks that
            Howes&rsquo;s improvers were learning from.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Agostino Ramelli&rsquo;s <em>Le diverse et artificiose machine</em> (1588) is
            the most famous: 195 copperplate engravings of water-lifting devices, mills,
            bridges, and military machines, each with detailed technical descriptions. Georgius
            Agricola&rsquo;s <em>De re metallica</em> (1556) is a 600-page treatise on mining
            and metallurgy &mdash; the most comprehensive technical manual of the 16th century.
            Vannoccio Biringuccio&rsquo;s <em>De la pirotechnia</em> (1540) is the first
            systematic treatment of metallurgy, pyrotechnics, smelting, and gunpowder.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Konrad Kyeser&rsquo;s <em>Bellifortis</em> (c. 1430) &mdash; the most important
            medieval military technology manuscript &mdash; catalogs siege engines, early
            firearms, diving equipment, and incendiary devices. Niccol&ograve; Tartaglia&rsquo;s
            <em>Nova scientia</em> (1537) founded the science of ballistics by applying
            mathematics to projectile trajectories. Simon Stevin&rsquo;s <em>Geometrie</em>
            (1586) introduced decimal fractions to Europe and laid the foundations of statics
            and hydrostatics.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Brian Potter&rsquo;s <em>The Origins of Efficiency</em> (2025) traces how modern
            engineering emerged from accumulated craft knowledge. These machine theatres are the
            missing early chapters of that story. Some have partial English translations from
            the 19th or 20th century; many have never been fully translated. All are now
            searchable and readable in Source Library.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* VI. Translation as Innovation Infrastructure */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            VI. Translation as Innovation Infrastructure
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Progress studies already knows that translation is infrastructure. The most
            frequently cited example is the 12th-century Toledo School of Translators, where
            scholars translated Arabic texts on mathematics, astronomy, medicine, and philosophy
            into Latin. This transfer &mdash; from Arabic to Latin, from Islamic civilization
            to medieval Europe &mdash; provided the foundation for the European scientific
            tradition. Euclid, Ptolemy, Aristotle, Galen &mdash; much of the Greek corpus
            reached Europe through Arabic intermediaries and Latin translation.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Mokyr&rsquo;s &ldquo;Republic of Letters&rdquo; is another translation story:
            a network of scholars sharing knowledge across national boundaries, made possible
            by a common language (Latin, then French and English) and a culture of open
            correspondence. The diffusion of useful knowledge depended on people being able
            to read it.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The same bottleneck exists today, in reverse. Thousands of pre-1800 texts in
            Latin, German, Arabic, and Hebrew have been digitized and sit in open-access
            library collections. They are &ldquo;available&rdquo; in the sense that anyone
            can view the page images. They are unavailable in the sense that almost no one
            alive can read them.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            AI removes this bottleneck. The full pipeline &mdash; digitization, OCR, translation,
            indexing &mdash; costs approximately $1.90 per book and takes minutes. Source
            Library processed its first thousand books in December 2025. It passed 5,000 in
            March 2026. Of these, 1,873 are{' '}
            <Link href="/blog/first-translations" className="text-accent-rust hover:underline">
              first-ever English translations</Link>{' '}
            &mdash; texts that have existed for centuries but have never been accessible to
            anglophone researchers. The{' '}
            <Link href="/blog/first-translation-methodology" className="text-accent-rust hover:underline">
              methodology</Link>{' '}
            is documented and verifiable.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            This is itself a progress studies case study. The bottleneck was not knowledge
            of the texts&rsquo; existence, or lack of interest, or insufficient funding for
            conventional translation. The bottleneck was that the cost of translation exceeded
            the economic value of any individual text. No publisher would commission a
            scholarly translation of an obscure 1572 Latin alchemical treatise for a market
            of perhaps two hundred readers. But when the marginal cost of translation
            approaches zero, the calculus changes. You translate everything and let readers
            find what matters.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The parallel to Collison and Cowen&rsquo;s framework is direct. They argue that
            we need to understand the mechanisms of progress well enough to produce more of
            it. One mechanism &mdash; perhaps the oldest one &mdash; is making existing
            knowledge readable. The Toledo translators did it in the 12th century by moving
            Arabic to Latin. Gutenberg did it in the 15th by reducing the cost of copying.
            We are doing it in the 21st by reducing the cost of translation.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* VII. The Corpus Is Open */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            VII. The Corpus Is Open
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The scale of the translated corpus changes what questions are possible. With a
            handful of translated texts, you can write a case study. With thousands, you can
            do statistical analysis. How often do alchemical treatises include technical
            specifications for laboratory equipment? How does the vocabulary of
            &ldquo;experiment&rdquo; evolve across centuries and languages? Where do mechanical
            and mystical descriptions co-occur, and where do they separate? These are questions
            that require a corpus, not a monograph &mdash; and the corpus now exists.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            For progress studies specifically, the opportunity is to extend the evidence base
            backward. Howes&rsquo;s improving mentality did not appear from nowhere in the
            1540s. It had precursors in the alchemical tradition, in the theatre of machines,
            in the natural magic that was really experimental physics. Mokyr&rsquo;s useful
            knowledge circulated in Latin and Arabic centuries before the Republic of Letters
            made it available in vernacular languages. Source Library makes those precursors
            legible.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The full collection is{' '}
            <Link href="/library" className="text-accent-rust hover:underline">
              searchable and free</Link>.
            Every translation links back to the original page image. The{' '}
            <Link href="/blog/first-translations" className="text-accent-rust hover:underline">
              first translations</Link>{' '}
            are flagged. The{' '}
            <Link href="/blog/hidden-engineers" className="text-accent-rust hover:underline">
              engineering evidence</Link>{' '}
            is documented with primary source citations. The{' '}
            <Link href="/developers" className="text-accent-rust hover:underline">
              API is open</Link>{' '}
            for researchers who want to work with the texts programmatically.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Collison and Cowen ended their{' '}
            <a href="https://www.theatlantic.com/science/archive/2019/07/we-need-new-science-progress/594946/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
              2019 essay</a>{' '}
            by asking: &ldquo;How do we improve our ability to generate useful progress?&rdquo;
            One answer, at least, is straightforward: read what the improvers were reading.
            The books are open.
          </p>
        </section>

        {/* Further Reading */}
        <div className="mt-16 pt-8 border-t border-border-light">
          <h3 className="font-serif text-2xl text-primary mb-6">Further Reading</h3>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              {
                href: '/blog/hidden-engineers',
                title: 'The Hidden Engineers',
                detail: 'Steam engines in spell books, automata in alchemy, kites in natural magic',
                internal: true,
              },
              {
                href: '/blog/first-translations',
                title: 'First English Translations',
                detail: '1,873 texts translated into English for the first time',
                internal: true,
              },
              {
                href: '/blog/first-translation-methodology',
                title: 'First Translation Methodology',
                detail: 'How we identify and verify first-ever English translations',
                internal: true,
              },
              {
                href: '/press/origins-of-science',
                title: 'The Mystic Who Discovered Planetary Motion',
                detail: 'How Kepler\'s occult beliefs led to modern astronomy',
                internal: true,
              },
              {
                href: 'https://www.theatlantic.com/science/archive/2019/07/we-need-new-science-progress/594946/',
                title: 'We Need a New Science of Progress',
                detail: 'Patrick Collison and Tyler Cowen, The Atlantic (2019)',
                internal: false,
              },
              {
                href: 'https://www.ageofinvention.xyz/',
                title: 'Age of Invention',
                detail: 'Anton Howes\'s newsletter on the history of innovation',
                internal: false,
              },
              {
                href: 'https://rootsofprogress.org/techno-humanist-manifesto',
                title: 'The Techno-Humanist Manifesto',
                detail: 'Jason Crawford\'s vision for progress and human flourishing',
                internal: false,
              },
            ].map((source) => (
              <Link
                key={source.href}
                href={source.href}
                {...(!source.internal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="flex items-start gap-3 p-4 rounded-lg bg-warm border border-border-light hover:border-accent-gold/20 hover:shadow-sm transition-all group"
              >
                <svg
                  className="w-4 h-4 text-muted mt-0.5 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  {source.internal ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  )}
                </svg>
                <div>
                  <p className="text-sm font-medium text-primary group-hover:text-accent-gold-dark transition-colors">
                    {source.title}
                  </p>
                  <p className="text-xs text-muted mt-0.5">{source.detail}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </article>

      <BlogComments slug="progress-studies" />
    </ContentPageLayout>
  );
}
