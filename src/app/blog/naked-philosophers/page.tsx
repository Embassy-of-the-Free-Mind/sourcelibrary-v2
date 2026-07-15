import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'The Naked Philosophers: How Alexander’s India Became the Rosicrucians’ Ancestor - Source Library',
  description:
    'In 327 BCE Alexander’s fleet-captain was sent to sit before fifteen naked, motionless sages who would not come when the king summoned them. Nineteen centuries later a Rosicrucian alchemist enrolled those same "gymnosophists" as ancestors of his Brotherhood. A story told through eight books in the library.',
  openGraph: {
    images: [{ url: 'https://images.sourcelibrary.org/gallery/69c1bd308522835be8468096/69c1bd308522835be8468180-0.jpg', alt: 'Alexander the Great, crowned and haloed, gesturing toward three naked bearded philosophers among flowering plants — labelled in the manuscript\'s Armenian as \'the Brahmans who speak.\' A 1544 Armenian Romance of Alexander miniature' }],
    title: 'The Naked Philosophers: How Alexander’s India Became the Rosicrucians’ Ancestor',
    description:
      'Power summons wisdom, and wisdom declines to come. The gymnosophists from Strabo and the Aldine Philostratus to Michael Maier’s College of the Rosy Cross.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/gallery/69c1bd308522835be8468096/69c1bd308522835be8468180-0.jpg', alt: 'Alexander the Great, crowned and haloed, gesturing toward three naked bearded philosophers among flowering plants — labelled in the manuscript\'s Armenian as \'the Brahmans who speak.\' A 1544 Armenian Romance of Alexander miniature' }],
  },
  alternates: {
    canonical: '/blog/naked-philosophers',
  },
};

export default function NakedPhilosophersPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Naked Philosophers"
          subtitle="How Alexander&rsquo;s India became the Rosicrucians&rsquo; ancestor"
          image="https://images.sourcelibrary.org/gallery/69c1bd308522835be8468096/69c1bd308522835be8468180-0.jpg"
          imageAlt="Alexander the Great, crowned and haloed, gesturing toward three naked bearded philosophers among flowering plants — labelled in the manuscript's Armenian as 'the Brahmans who speak.' A 1544 Armenian Romance of Alexander miniature"
        >
          <p className="text-stone-400 text-sm mt-4">21 June 2026 &middot; 8 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        {/* Lede */}
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          One of the most beautiful books in the library is a slim Latin folio printed in Venice in 1504 by
          Aldus Manutius &mdash; the{' '}
          <Link href="/book/philostratus-life-of-apollonius-of-tyana-aldine-press-philostratus" className="text-accent-rust hover:text-accent-rust underline">
            Aldine <em>Life of Apollonius of Tyana</em>
          </Link>
          , Philostratus&rsquo; third-century biography of a wandering Greek sage. Its preface defends Apollonius
          against the charge of magic with a single, telling itinerary: he was suspected only because{' '}
          <Link href="https://sourcelibrary.org/q/BhIhSXR1gTZEprAy9fX" className="text-accent-rust hover:text-accent-rust underline">
            &ldquo;he had spent time in Babylonia with the Magi, in India with the Brahmins, and in Egypt with the
            Gymnosophists.&rdquo;
          </Link>{' '}
          To study with the <em>gymnosophists</em> &mdash; the &ldquo;naked philosophers&rdquo; &mdash; was, by 1504,
          shorthand for wisdom drawn from the very edge of the world. This is the story of where that idea came
          from, and how far it travelled, told through the books that carried it.
        </p>

        <h2 className="text-2xl font-semibold text-primary mt-12 mb-4 font-display">The word, and the men</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          <em>Gymnosophist</em> is a Greek coinage &mdash; <em>gymnós</em> (&ldquo;naked&rdquo;) plus{' '}
          <em>sophistḗs</em> (&ldquo;wise man&rdquo;) &mdash; and it was always an outsider&rsquo;s word, never a
          self-description. The Renaissance dictionaries glossed it with pedantic care: Reuchlin&rsquo;s 1478{' '}
          <Link href="https://sourcelibrary.org/q/BhPS2Tp6l4XUxVQ1H0Y" className="text-accent-rust hover:text-accent-rust underline">
            <em>Vocabularius</em>
          </Link>{' '}
          derives it &ldquo;from gymnos naked and sophista wise man.&rdquo; Behind the word were real ascetics
          &mdash; the forest-dwelling Brahmins, the &ldquo;sky-clad&rdquo; Jain monks, and other renunciants of the
          Indus valley for whom nakedness and endurance were a discipline, not a deprivation.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          They enter Western literature with Alexander&rsquo;s invasion of the Punjab in 327 BCE, and they enter it
          on their own terms. The library holds the founding eyewitness directly:{' '}
          <Link href="/book/the-geography-of-strabo-vol-vii-loeb-jones-1917-jones" className="text-accent-rust hover:text-accent-rust underline">
            Strabo&rsquo;s <em>Geography</em>
          </Link>{' '}
          preserves the first-person report of Onesicritus, a helmsman in Alexander&rsquo;s fleet and a student of
          Diogenes the Cynic, who was sent to interview the sages precisely because they would not come when the
          king called. What he found became the founding image of the whole tradition:
        </p>

        <blockquote className="border-l-2 border-accent-rust/40 pl-6 my-8 text-secondary italic leading-relaxed font-body">
          &ldquo;Alexander had heard that the people always went naked and devoted themselves to endurance, and
          that they were held in very great honor, and that they did not visit other people when invited, but
          commanded them to visit them if they wished to participate in anything they did or said&hellip; he found
          fifteen men at a distance of twenty stadia from the city, who were in different postures, standing or
          sitting or lying naked and motionless until evening&hellip; and that it was very hard to endure the
          sun.&rdquo;
          <span className="block mt-3 text-sm not-italic text-muted">
            &mdash; Strabo, <em>Geography</em> 15.1.63.{' '}
            <Link href="https://sourcelibrary.org/q/BhF59r2QG7PMITdyyfj" className="text-accent-rust hover:text-accent-rust">Read the page &rarr;</Link>
          </span>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Power summons wisdom, and wisdom declines to come. It is hard to overstate how durable that scene proved.
          For two thousand years the gymnosophist would stand for the philosopher stripped &mdash; literally &mdash; of
          everything inessential, the living rebuke to a world-conqueror who owned everything and understood little.
        </p>

        <h2 className="text-2xl font-semibold text-primary mt-12 mb-4 font-display">The one who burned, and the one who refused</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Two sages became a moral diptych the tradition never tired of. The first was{' '}
          <strong className="font-semibold text-primary">Calanus</strong>, the gymnosophist who <em>did</em> follow
          Alexander west &mdash; and who, falling ill in Persia, had himself burned alive on a pyre rather than live
          diminished. Robert Estienne&rsquo;s 1512 dictionary of names gives the capsule life:{' '}
          <Link href="https://sourcelibrary.org/q/BhK4Rcp3gDiaq8Azlrk" className="text-accent-rust hover:text-accent-rust underline">
            &ldquo;Calanus, an Indian Gymnosophist who spoke with Alexander the Great, and having followed him,
            ordered himself to be burned alive on a constructed pyre.&rdquo;
          </Link>{' '}
          His self-immolation gave the West its first vivid image of Indian fearlessness before death.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          His foil was <strong className="font-semibold text-primary">Dandamis</strong>, the elder who refused the
          summons outright. The reply preserved in{' '}
          <Link href="/book/ancient-india-as-described-by-megasthenes-and-arrian-mccrindle" className="text-accent-rust hover:text-accent-rust underline">
            McCrindle&rsquo;s reconstruction of Megasthenes and Arrian
          </Link>{' '}
          has lost none of its edge. Threatened with beheading if he would not come, Dandamis{' '}
          <Link href="https://sourcelibrary.org/q/BimWWAmlmChATPLXahm" className="text-accent-rust hover:text-accent-rust underline">
            &ldquo;rose not from his leaves whereon he lay, but reclining and smiling he replied&hellip; The
            greatest God&hellip; can do injury to no one.&rdquo;
          </Link>{' '}
          The sage who went over to power and burned, against the one who stayed in the forest and won: it is the
          tradition&rsquo;s central argument about what wisdom is worth.
        </p>

        <h2 className="text-2xl font-semibold text-primary mt-12 mb-4 font-display">The sages in their own voice</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The encounter did not stay in the Greek libraries. All through the Middle Ages the{' '}
          <Link href="/book/romance-of-alexander-anonymous/page/69c1bd308522835be8468180" className="text-accent-rust hover:text-accent-rust underline">
            <em>Romance of Alexander</em>
          </Link>{' '}
          &mdash; the wildly embroidered legend of the conqueror, copied in every language from Latin to Armenian &mdash;
          kept retelling the meeting with the naked philosophers, and illustrating it. The miniature at the head of
          this essay comes from a 1544 Armenian copy in the library: Alexander, crowned and haloed, faces three naked
          sages among flowering stalks, captioned in the margin in Armenian &mdash; &ldquo;the Brahmans who speak,&rdquo;
          &ldquo;they are naked philosophers.&rdquo; Here, uniquely, the gymnosophists are given their own lines:
        </p>

        <blockquote className="border-l-2 border-accent-rust/40 pl-6 my-8 text-secondary italic leading-relaxed font-body">
          &ldquo;We were born naked philosophers and we remain naked in this world. We enter the earth as naked members;
          we have no great needs in this world. If we die tomorrow or the day after, we are invited to our own
          earth.&rdquo;
          <span className="block mt-3 text-sm not-italic text-muted">
            &mdash; <em>Romance of Alexander</em>, Armenian manuscript, 1544.{' '}
            <Link href="/book/romance-of-alexander-anonymous/page/69c1bd308522835be8468180" className="text-accent-rust hover:text-accent-rust">Read the page &rarr;</Link>
          </span>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          It is the same ethic Onesicritus had watched in silence &mdash; endurance, indifference to the body, freedom
          from need &mdash; now put in the sages&rsquo; own mouths and bound into a book that Christian Armenian scribes
          were still copying fourteen centuries after the meeting it describes.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          And the manuscript keeps the exchange the legend was really about. Having conquered Porus and reached the
          gymnosophists in their tents, Alexander offers to grant them anything they ask &mdash; and they ask for the
          one thing he cannot give:
        </p>

        <blockquote className="border-l-2 border-accent-rust/40 pl-6 my-8 text-secondary italic leading-relaxed font-body">
          &ldquo;They all praised him and said, &lsquo;Give us immortality so that we do not die.&rsquo; And Alexander said,
          &lsquo;I do not possess that power, for I am but a mortal man.&rsquo; They said, &lsquo;Then, being a mortal man,
          why do you wage so many wars and suffer so much, spilling so much blood, so that you may take the possessions
          of all by your will? And where will you take these, since you cannot leave them behind for others to
          keep?&rsquo;&rdquo;
          <span className="block mt-3 text-sm not-italic text-muted">
            &mdash; <em>Romance of Alexander</em>, Armenian manuscript, 1544.{' '}
            <Link href="/book/romance-of-alexander-anonymous/page/69c1bd308522835be8468182" className="text-accent-rust hover:text-accent-rust">Read the page &rarr;</Link>
          </span>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          It is Dandamis&rsquo;s refusal turned into a question, and it is the whole tradition in miniature: power offers
          the naked philosophers everything it owns, and the philosophers ask it why it bothers. No wonder Europe could
          not stop retelling them.
        </p>

        <h2 className="text-2xl font-semibold text-primary mt-12 mb-4 font-display">The Renaissance meets India again</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          For most of European history the gymnosophists were a literary memory &mdash; sages glimpsed only through
          ancient texts. Then, in the sixteenth century, Europe sailed back to India and met their descendants in
          the flesh. The pivotal book is{' '}
          <Link href="/book/aromatum-et-simplicium-aliquot-medicamentorum-apud-indos-trans" className="text-accent-rust hover:text-accent-rust underline">
            García de Orta&rsquo;s <em>Aromatum&hellip; Historia</em>
          </Link>{' '}
          &mdash; the first European study of Indian medicinal plants, written by a Portuguese physician living in
          Goa and printed across Europe in Carolus Clusius&rsquo;s 1567 Latin. Describing the vegetarian, ahimsa-keeping
          merchant-ascetics he calls the Banians, de Orta reaches instinctively for the ancient category:
        </p>

        <figure className="my-12">
          <Link href="/book/aromatum-et-simplicium-aliquot-medicamentorum-apud-indos-trans/page/69ef285385daccce30f2c783">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.sourcelibrary.org/gallery/69ef285385daccce30f2c71d/69ef285385daccce30f2c783-0.jpg"
              alt="Sixteenth-century woodcut of the Indian aromatic plant Tamalapatra (Malabathrum) from García de Orta's Aromatum Historia, 1567"
              className="w-full max-w-md mx-auto rounded-lg shadow-md"
            />
          </Link>
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            India, observed first-hand: a woodcut of <em>Tamalapatra</em> (malabathrum) from García de Orta&rsquo;s{' '}
            <em>Aromatum&hellip; Historia</em>, 1567.{' '}
            <Link href="/book/aromatum-et-simplicium-aliquot-medicamentorum-apud-indos-trans/page/69ef285385daccce30f2c783" className="text-accent-rust hover:text-accent-rust not-italic">View in Source Library &rarr;</Link>
          </figcaption>
        </figure>

        <blockquote className="border-l-2 border-accent-rust/40 pl-6 my-8 text-secondary italic leading-relaxed font-body">
          &ldquo;They are clothed in the same style of garments that the Gymnosophists are said to have worn, and
          rumor has it that they believe in the transmigration of souls into other bodies.&rdquo;
          <span className="block mt-3 text-sm not-italic text-muted">
            &mdash; García de Orta, <em>History of Aromatics</em>, 1567.{' '}
            <Link href="/book/aromatum-et-simplicium-aliquot-medicamentorum-apud-indos-trans/page/69ef285385daccce30f2c740" className="text-accent-rust hover:text-accent-rust">Read the page &rarr;</Link>
          </span>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          A physician cataloguing cinnamon and cardamom in a Goan harbour reaches across eighteen centuries to
          Onesicritus&rsquo; naked sages, and slots the living Banians into the same slot. The ancient word had become
          a lens: to see India at all was to see gymnosophists.
        </p>

        <h2 className="text-2xl font-semibold text-primary mt-12 mb-4 font-display">A chain of ancient wisdom</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          By then the naked philosophers had acquired a second career, deep inside Renaissance esotericism. Hermetic
          and Christian-cabalist writers imagined a single ancient wisdom &mdash; a <em>prisca sapientia</em> &mdash;
          handed down through a relay of priestly castes, each nation guarding the same secret under a different
          name. The library holds the genealogy verbatim in the 1584{' '}
          <Link href="/book/pymander-mercvrii-trismegisti-cum-commento-fratris-hermes-3" className="text-accent-rust hover:text-accent-rust underline">
            <em>Pymander</em> of Hermes Trismegistus
          </Link>{' '}
          with Hannibal Rosseli&rsquo;s commentary:
        </p>

        <blockquote className="border-l-2 border-accent-rust/40 pl-6 my-8 text-secondary italic leading-relaxed font-body">
          &ldquo;&hellip;just as among the Hebrews they are called Prophets, among the Persians the Magi, among the
          Indians the Brahmins, among the Egyptians the Priests, among the Ethiopians the Gymnosophists, among the
          Greeks the most ancient Poets, and among the Romans the Orators.&rdquo;
          <span className="block mt-3 text-sm not-italic text-muted">
            &mdash; <em>Pymander</em> with Rosseli&rsquo;s commentary, 1584.{' '}
            <Link href="https://sourcelibrary.org/q/BhNfDu5bYWXNtkxverd" className="text-accent-rust hover:text-accent-rust">Read the page &rarr;</Link>
          </span>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Notice the slip in the chain: the gymnosophists have migrated from India to <em>Ethiopia</em>. This was no
          error so much as a habit &mdash; Greek geography had long imagined &ldquo;the Indians&rdquo; and &ldquo;the
          Ethiopians&rdquo; as twin peoples at the rim of the world, and Philostratus had sent Apollonius from the
          Indian Brahmins on to a parallel college of Ethiopian sages, fixing the African address in every later
          reader&rsquo;s mind. In these books &ldquo;gymnosophist&rdquo; is less an ethnicity than a <em>role</em>: the
          naked sage of the distant East, wherever the East happened to be drawn.
        </p>

        <h2 className="text-2xl font-semibold text-primary mt-12 mb-4 font-display">Ancestors of the Rosy Cross</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The figure&rsquo;s last great transformation belongs to{' '}
          <strong className="font-semibold text-primary">Michael Maier</strong>, the physician-alchemist who became
          the most eloquent apologist for the Rosicrucian movement. In his 1617{' '}
          <Link href="/book/symbols-of-the-golden-table-of-the-twelve-nations-maier" className="text-accent-rust hover:text-accent-rust underline">
            <em>Symbola Aureae Mensae</em> (Symbols of the Golden Table)
          </Link>{' '}
          Maier gave the gymnosophists their own founding chapter &mdash; &ldquo;The College of the Gymnosophists among
          the Ethiopians&rdquo; &mdash; and chartered it with mock precision to the year 60 AD, when Apollonius of Tyana,
        </p>

        <blockquote className="border-l-2 border-accent-rust/40 pl-6 my-8 text-secondary italic leading-relaxed font-body">
          &ldquo;a philosopher of admirable life and learning, after he had returned from his travels in India, also
          crossed over to the Ethiopian Gymnosophists&hellip; He came to a rather high hill where Thespion, the eldest
          of the Gymnosophists, presided, sitting under an elm tree. This tree greeted Apollonius by his own name in a
          thin and articulate voice.&rdquo;
          <span className="block mt-3 text-sm not-italic text-muted">
            &mdash; Michael Maier, <em>Symbola Aureae Mensae</em>, 1617.{' '}
            <Link href="/book/symbols-of-the-golden-table-of-the-twelve-nations-maier/page/6959068695a91542b28bd793" className="text-accent-rust hover:text-accent-rust">Read the page &rarr;</Link>
          </span>
        </blockquote>

        <figure className="my-12">
          <Link href="/book/symbols-of-the-golden-table-of-the-twelve-nations-maier/page/6959068695a91542b28bd75a">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.sourcelibrary.org/gallery/6952587bab34727b1f045546/6959068695a91542b28bd75a-0.jpg"
              alt="The engraved frontispiece of Michael Maier's Symbola Aureae Mensae, 1617, depicting twelve philosophers of the nations around a golden table"
              className="w-full max-w-lg mx-auto rounded-lg shadow-md"
            />
          </Link>
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            The twelve sages of the nations gathered at the golden table &mdash; the engraved frontispiece to Maier&rsquo;s{' '}
            <em>Symbola Aureae Mensae</em>, 1617.{' '}
            <Link href="/book/symbols-of-the-golden-table-of-the-twelve-nations-maier/page/6959068695a91542b28bd75a" className="text-accent-rust hover:text-accent-rust not-italic">View in Source Library &rarr;</Link>
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          A talking elm in Ethiopia, a college of naked sages dated to the reign of Nero &mdash; this is myth-making
          in full flight. But it had a purpose. By installing the gymnosophists at the head of a lineage that ran
          through Egypt and Greece down to his own Brotherhood, Maier was making the Rosicrucian project look not
          like a novelty but like the latest link in the oldest chain on earth. The same itinerary that opened
          Philostratus&rsquo; <em>Life</em> &mdash; Magi, Brahmins, Gymnosophists &mdash; had become the Rosicrucians&rsquo;
          family tree.
        </p>

        <h2 className="text-2xl font-semibold text-primary mt-12 mb-4 font-display">One idea, three thousand miles, nineteen centuries</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Follow the gymnosophists across the library and you watch a single image mutate without ever quite
          breaking. It begins as eyewitness ethnography &mdash; a Cynic-trained Greek with a notebook, sweating in
          front of motionless men. It becomes a moral exemplar &mdash; Calanus on his pyre, Dandamis on his leaves,
          the perfect proof that virtue needs no possessions. It is verified anew when Renaissance Europe sails to
          Goa and recognises the old sages in living Banians. And it ends as sacred genealogy &mdash; the naked
          philosopher enthroned as an ancestor of the Rosy Cross.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          What makes the story tellable is that the library holds every stage of it at once: the primary witness
          (Strabo), the fragment-base (McCrindle&rsquo;s Megasthenes), the first-hand Renaissance encounter (García de
          Orta), the Hermetic genealogy (the <em>Pymander</em>), and the esoteric payoff (Maier) &mdash; with the
          Aldine Philostratus as the hinge between the ancient and the early-modern halves. The naked philosophers
          never wrote a word that survives. Everything we know about them is a story other people told. The marvel
          is how few of those stories ever really changed.
        </p>

        <section className="mt-14 pt-8 border-t border-border-light">
          <h2 className="text-xl font-semibold text-primary mb-4 font-display">The books</h2>
          <ul className="space-y-2 text-secondary text-sm leading-relaxed">
            <li>
              Philostratus, <em>Life of Apollonius of Tyana</em> (Aldine, Venice 1504).{' '}
              <Link href="/book/philostratus-life-of-apollonius-of-tyana-aldine-press-philostratus" className="text-accent-rust hover:text-accent-rust">Read &rarr;</Link>
            </li>
            <li>
              Strabo, <em>Geography</em>, Vol. VII (Loeb, 1917) &mdash; Onesicritus&rsquo; embassy.{' '}
              <Link href="/book/the-geography-of-strabo-vol-vii-loeb-jones-1917-jones" className="text-accent-rust hover:text-accent-rust">Read &rarr;</Link>
            </li>
            <li>
              J. W. McCrindle, <em>Ancient India as Described by Megasthenes and Arrian</em> (1877) &mdash; Calanus &amp; Dandamis.{' '}
              <Link href="/book/ancient-india-as-described-by-megasthenes-and-arrian-mccrindle" className="text-accent-rust hover:text-accent-rust">Read &rarr;</Link>
            </li>
            <li>
              <em>Romance of Alexander</em> (Armenian manuscript, 1544) &mdash; the medieval legend; source of the header miniature of Alexander and the three naked philosophers.{' '}
              <Link href="/book/romance-of-alexander-anonymous/page/69c1bd308522835be8468180" className="text-accent-rust hover:text-accent-rust">Read &rarr;</Link>
            </li>
            <li>
              García de Orta, <em>History of Aromatics&hellip; of the Indies</em> (Clusius, 1567).{' '}
              <Link href="/book/aromatum-et-simplicium-aliquot-medicamentorum-apud-indos-trans" className="text-accent-rust hover:text-accent-rust">Read &rarr;</Link>
            </li>
            <li>
              <em>Pymander</em> of Hermes Trismegistus, with Hannibal Rosseli&rsquo;s commentary (1584).{' '}
              <Link href="/book/pymander-mercvrii-trismegisti-cum-commento-fratris-hermes-3" className="text-accent-rust hover:text-accent-rust">Read &rarr;</Link>
            </li>
            <li>
              Michael Maier, <em>Symbola Aureae Mensae Duodecim Nationum</em> (1617).{' '}
              <Link href="/book/symbols-of-the-golden-table-of-the-twelve-nations-maier" className="text-accent-rust hover:text-accent-rust">Read &rarr;</Link>
            </li>
          </ul>
          <p className="text-xs text-muted mt-4 italic">
            Every quotation above is verbatim from Source Library&rsquo;s translation of the named edition, linked to
            its exact page. Translations CC-BY-SA-4.0.
          </p>
        </section>

      </article>
    </ContentPageLayout>
  );
}
