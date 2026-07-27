import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'The Real Hogwarts Library - Source Library',
  description:
    'Nicolas Flamel was a real 14th-century Parisian scribe. Cornelius Agrippa, Paracelsus, Helena Blavatsky — all real, all on Chocolate Frog Cards, all in here. A reader\'s tour of the historical books behind the Hogwarts curriculum.',
  openGraph: {
    title: 'The Real Hogwarts Library',
    description:
      'Nicolas Flamel was real. So was Cornelius Agrippa. So was Paracelsus. The books behind the wizarding world — bestiaries, alchemy, grimoires, Kabbalah — read in modern English.',
    images: [{ url: 'https://upload.wikimedia.org/wikipedia/commons/9/9c/Joseph_Wright_of_Derby_The_Alchemist.jpg', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://upload.wikimedia.org/wikipedia/commons/9/9c/Joseph_Wright_of_Derby_The_Alchemist.jpg' }],
  },
  alternates: {
    canonical: '/blog/hogwarts-library',
  },
};

export default function HogwartsLibraryPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Real Hogwarts Library"
          subtitle="J.K. Rowling has said she &ldquo;learned a ridiculous amount about alchemy&rdquo; inventing the wizarding world. The books on Dumbledore&rsquo;s shelves are real &mdash; and most of them are here."
          image="https://upload.wikimedia.org/wikipedia/commons/9/9c/Joseph_Wright_of_Derby_The_Alchemist.jpg"
          imageAlt="Joseph Wright of Derby, The Alchymist, in Search of the Philosopher's Stone, Discovers Phosphorus, 1771. Derby Museum and Art Gallery."
        >
          <p className="text-stone-400 text-sm mt-4">17 May 2026 &middot; 16 min read</p>
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
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Nicolas Flamel was a real 14th-century Parisian scribe. So was Cornelius Agrippa &mdash; the
          wizard on Chocolate Frog Card #1 of Harry&rsquo;s collection. So was Paracelsus, Ptolemy, and a
          turn-of-the-century Russian theosophist named Helena Blavatsky, whom Rowling glances at in the
          name <em>Cassandra Vablatsky</em>, author of <em>Unfogging the Future</em>.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          The books on Dumbledore&rsquo;s shelves are real too. They sit in libraries from the British
          Library to the Bibliotheca Philosophica Hermetica in Amsterdam, and most of the important ones
          are here in Source Library, with modern English translations alongside the originals. We&rsquo;ve
          gathered them into a single collection:{' '}
          <Link href="/collections/hogwarts-library" className="text-accent-rust hover:underline">
            The Hogwarts Library
          </Link>.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          A hundred books, organised by the Hogwarts curriculum. Bestiaries with basilisks and phoenixes
          for Care of Magical Creatures; herbals with mandrakes for Herbology; alchemical emblem books on
          the Philosopher&rsquo;s Stone for Potions; grimoires of charms; demonologies for Defence Against
          the Dark Arts; Kabbalah and number-mysticism for Ancient Runes. This is the reader&rsquo;s tour.
        </p>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            I. The wizards who actually existed
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Rowling salts the Wizarding World with real historical figures. Most of them turn up first as{' '}
            <strong>Chocolate Frog Cards</strong> &mdash; the collectible cards inside the
            sweet-shop frogs that Ron empties his pockets of in the Hogwarts Express. Harry&rsquo;s
            very first card is{' '}
            <Link href="/book/three-books-of-occult-philosophy-1533-latin-agrippa" className="text-accent-rust hover:underline">
              <strong>Albus Dumbledore</strong>
            </Link>
            . His second is{' '}
            <strong>Cornelius Agrippa</strong> &mdash; described in the card as a &ldquo;celebrated wizard
            imprisoned by Muggles for his writing, because they thought his books were evil.&rdquo;
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Heinrich Cornelius Agrippa was a real Renaissance polymath who really did get into
            trouble for his writing. His <em>Three Books of Occult Philosophy</em> (1533) is the great
            synthesis of natural magic, celestial magic, and ceremonial magic in the European tradition
            &mdash; the textbook every later magus quotes. You can read the original Latin and an English
            translation here:{' '}
            <Link
              href="/book/three-books-of-occult-philosophy-1533-latin-agrippa"
              className="text-accent-rust hover:underline"
            >
              <em>De Occulta Philosophia</em>, 1533
            </Link>
            .
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Then there is{' '}
            <Link
              href="/book/archidoxae-philippi-theophrasti-paracelsi-magni-germani-paracelsus"
              className="text-accent-rust hover:underline"
            >
              <strong>Paracelsus</strong>
            </Link>{' '}
            &mdash; physician, magician, and the wizard credited in the books with discovering
            Parseltongue. (The historical Paracelsus, real name Theophrastus von Hohenheim, taught that
            knowledge of nature comes from observation rather than authority &mdash; less Slytherin than
            you&rsquo;d think.) <strong>Ptolemy</strong> appears on a Chocolate Frog Card too, and his
            actual{' '}
            <Link href="/book/almagest-ptolemy" className="text-accent-rust hover:underline">
              <em>Almagest</em>
            </Link>{' '}
            and{' '}
            <Link href="/book/tetrabiblos-ptolemy" className="text-accent-rust hover:underline">
              <em>Tetrabiblos</em>
            </Link>{' '}
            sit in the collection &mdash; one for Astronomy class, one for Divination.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The deepest cut is{' '}
            <strong>Cassandra Vablatsky</strong> &mdash; the textbook author for Trelawney&rsquo;s
            Divination class, whose name is a soft anagram of <strong>Helena Blavatsky</strong>, the
            Ukrainian-born co-founder of the Theosophical Society and the most influential occultist of
            the 19th century. Her actual books are here:{' '}
            <Link
              href="/book/isis-unveiled-a-master-key-to-the-mysteries-of-ancient-and-blavatsky"
              className="text-accent-rust hover:underline"
            >
              <em>Isis Unveiled</em> (1877)
            </Link>{' '}
            and{' '}
            <Link href="/book/the-secret-doctrine-vol-i-blavatsky" className="text-accent-rust hover:underline">
              <em>The Secret Doctrine</em>
            </Link>
            .
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            But the wizard you came for is{' '}
            <Link
              href="/book/flamel-book-of-hieroglyphic-figures-abraham-le-juif-flamel"
              className="text-accent-rust hover:underline"
            >
              <strong>Nicolas Flamel</strong>
            </Link>
            .
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            II. Potions: the man who really made the Philosopher&rsquo;s Stone
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Flamel lived in Paris from roughly 1330 to 1418. He was a successful manuscript copyist who
            ran two shops against the wall of Saint-Jacques-de-la-Boucherie. There is no contemporary
            evidence that he practised alchemy. The legend &mdash; that he translated a mysterious Hebrew
            book of figures, deciphered its secrets after a pilgrimage to Spain, and created the
            Philosopher&rsquo;s Stone in 1382 &mdash; first appears in print two centuries after his
            death.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            That legend is the basis for the book Harry holds in Chapter 13. And the book in which the
            legend is told is in Source Library:{' '}
            <Link
              href="/book/flamel-book-of-hieroglyphic-figures-abraham-le-juif-flamel"
              className="text-accent-rust hover:underline"
            >
              <em>Le Livre des Figures Hi&eacute;roglyphiques de Nicolas Flamel</em>
            </Link>{' '}
            &mdash; the 1750 edition of a text first printed in 1612, attributed to Flamel himself,
            describing the symbols he supposedly read on the walls of the Cimeti&egrave;re des Innocents.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            What did the Philosopher&rsquo;s Stone actually look like, in the alchemical tradition?
            Source Library has{' '}
            <Link
              href="/blog/philosophers-stone"
              className="text-accent-rust hover:underline"
            >
              a whole essay on the eight different answers
            </Link>{' '}
            the primary sources give. But the visual answer is unmistakable. Open the{' '}
            <Link
              href="/book/aureum-vellus-oder-guldin-schatz-und-kunstkammer-1-1-solis"
              className="text-accent-rust hover:underline"
            >
              <em>Splendor Solis</em>
            </Link>{' '}
            (1598) and you see twenty-two miniature paintings in jewel colours, narrating the Great Work
            from blackening to whitening to reddening. Open the{' '}
            <Link href="/book/mutus-liber-the-silent-book-saulat" className="text-accent-rust hover:underline">
              <em>Mutus Liber</em>
            </Link>{' '}
            (1677) and you find fifteen engravings with no text at all &mdash; the Stone communicated
            entirely in pictures. Open Michael Maier&rsquo;s{' '}
            <Link
              href="/book/atalanta-fugiens-hoc-est-emblemata-nova-de-secretis-naturae-maier"
              className="text-accent-rust hover:underline"
            >
              <em>Atalanta Fugiens</em>
            </Link>{' '}
            (1617) and you get emblems, epigrams, and fugues for three voices &mdash; alchemy as
            multimedia art.
          </p>

          <figure className="my-12">
            <Link href="/book/69526359ab34727b1f046d5a">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.sourcelibrary.org/gallery/69526359ab34727b1f046d5a/69568fa01479a63c1108cdb0-0.jpg"
                alt="Plate 4 of the Mutus Liber: alchemists collecting morning dew on linen sheets, with Sol and Luna above. 1677 engraving."
                className="w-full max-w-md mx-auto rounded-lg shadow-md"
              />
            </Link>
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              The <em>Mutus Liber</em>, Plate 4 (1677): alchemists collect morning dew on linen sheets stretched in a meadow, while Sol and Luna preside from above. The whole &ldquo;wordless book&rdquo; teaches the Stone in pictures alone.{' '}
              <Link href="/book/69526359ab34727b1f046d5a" className="text-accent-rust hover:text-accent-rust not-italic">
                View in Source Library &rarr;
              </Link>
            </figcaption>
          </figure>

          <figure className="my-12">
            <Link href="/book/699065973dc2ed39a49f1e71">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.sourcelibrary.org/gallery/699065973dc2ed39a49f1e71/699065983dc2ed39a49f1e72-0.jpg"
                alt="Opening of the Ripley Scroll showing Hermes Trismegistus holding an alchemical flask and a toad. c. 1450, Bodleian MS Bodl. Rolls 1."
                className="w-full max-w-md mx-auto rounded-lg shadow-md"
              />
            </Link>
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              The opening of the Ripley Scroll, c. 1450 &mdash; Hermes Trismegistus holding an alchemical flask and a toad. Six metres of illustrated alchemy, kept rolled.{' '}
              <Link href="/book/699065973dc2ed39a49f1e71" className="text-accent-rust hover:text-accent-rust not-italic">
                View in Source Library &rarr;
              </Link>
            </figcaption>
          </figure>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Books like these are not what most people picture when they hear &ldquo;alchemy.&rdquo; They
            are far stranger and more beautiful. Dumbledore would have been at home here.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            III. Herbology: mandrakes, wormwood, and the Garden of Health
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Professor Sprout&rsquo;s greenhouse is essentially the woodcuts of a 16th-century herbal. The
            mandrake screams when pulled from the ground in <em>Chamber of Secrets</em> &mdash; a detail
            Pliny records in his{' '}
            <Link href="/book/historia-naturalis-elder" className="text-accent-rust hover:underline">
              <em>Natural History</em>
            </Link>
            , Book XXV, and which the medieval herbal tradition develops with elaborate plates of plants
            with human faces being uprooted by dogs at the end of ropes.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The book that would have sat open on Professor Sprout&rsquo;s desk is the{' '}
            <Link href="/book/hortus-sanitatis-meydenbach" className="text-accent-rust hover:underline">
              <em>Hortus Sanitatis</em>
            </Link>{' '}
            (&ldquo;Garden of Health&rdquo;), Mainz, 1491 &mdash; a proto-encyclopaedia that catalogues
            every plant, animal, bird, fish, and stone known to its compiler, with woodcuts that read
            like the inventory of <em>Fantastic Beasts and Where to Find Them</em>. The first English
            herbal a working witch or wizard would reach for is{' '}
            <Link
              href="/book/the-herball-or-generall-historie-of-plantes-gerard"
              className="text-accent-rust hover:underline"
            >
              John Gerard&rsquo;s <em>Herball</em>
            </Link>{' '}
            (1597). Nicholas Culpeper&rsquo;s{' '}
            <Link href="/book/the-english-physitian-enlarged-culpeper" className="text-accent-rust hover:underline">
              <em>English Physitian</em>
            </Link>{' '}
            (1653) added astrological correspondences to every plant &mdash; the working manual of the
            cunning folk.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Behind all of these stands Dioscorides, whose{' '}
            <Link
              href="/book/de-materia-medica-greek-manuscript-grec-2179-dioscorides"
              className="text-accent-rust hover:underline"
            >
              <em>De Materia Medica</em>
            </Link>{' '}
            was the foundational European pharmacology for fifteen centuries. The illustrated medieval{' '}
            <Link
              href="/book/herbarium-of-apuleius-dioscorides-on-herbs-c-1000-ad-musa"
              className="text-accent-rust hover:underline"
            >
              Pseudo-Apuleius <em>Herbarium</em>
            </Link>{' '}
            (c. 1000 CE) contains the original mandrake plates &mdash; the source from which all later
            screaming-mandrake imagery descends.
          </p>

          <figure className="my-12">
            <Link href="/book/6957ef6bcbe1dcad7b76beff">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.sourcelibrary.org/gallery/6957ef6bcbe1dcad7b76beff/6957ef6bcbe1dcad7b76c099-0.jpg"
                alt="Hand-coloured woodcut from the Hortus Sanitatis, 1491: an apothecary's shop with two figures and shelves of medicinal jars."
                className="w-full max-w-md mx-auto rounded-lg shadow-md"
              />
            </Link>
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              The apothecary&rsquo;s shop, from the <em>Hortus Sanitatis</em> (1491) &mdash; the universal Garden of Health. Hand-coloured woodcut.{' '}
              <Link href="/book/6957ef6bcbe1dcad7b76beff" className="text-accent-rust hover:text-accent-rust not-italic">
                View in Source Library &rarr;
              </Link>
            </figcaption>
          </figure>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            IV. Care of Magical Creatures: real bestiaries
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            <em>Fantastic Beasts and Where to Find Them</em> is, generically, a bestiary. So is{' '}
            <Link href="/book/harley-ms-4751-anonymous" className="text-accent-rust hover:underline">
              British Library Harley MS 4751
            </Link>
            , a 13th-century illuminated manuscript with entries on the basilisk, the phoenix, the
            unicorn, the manticore, the parandrus, the cinnomolgus, the yale, and dozens of other
            creatures Newt Scamander would recognise. Source Library hosts the digitisation.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            What about specific Harry Potter monsters? The <strong>basilisk</strong> &mdash; the great
            serpent of the Chamber of Secrets &mdash; has its full natural history in Ulisse
            Aldrovandi&rsquo;s{' '}
            <Link
              href="/book/serpentum-et-draconum-historiae-libri-duo-aldrovandi"
              className="text-accent-rust hover:underline"
            >
              <em>Serpentum et Draconum Historiae</em>
            </Link>{' '}
            (1640), which devotes long passages to its lethal gaze and its vulnerability to weasels.
            Ambroise Par&eacute;, the great French surgeon, also wrote a chapter &ldquo;Of the
            Basilisk&rdquo; in his{' '}
            <Link href="/book/les-oeuvres-d-ambroise-pare-pare" className="text-accent-rust hover:underline">
              collected <em>Oeuvres</em>
            </Link>{' '}
            (1585).
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The <strong>phoenix</strong> &mdash; Dumbledore&rsquo;s Fawkes &mdash; has a foundational
            late-antique poem,{' '}
            <Link
              href="/book/opera-divinarum-institutionum-libri-vii-de-ira-dei-de-lactantius"
              className="text-accent-rust hover:underline"
            >
              Lactantius&rsquo;s <em>De Ave Phoenice</em>
            </Link>{' '}
            (c. 300 CE), and a chapter in Aldrovandi&rsquo;s{' '}
            <Link
              href="/book/ornithologiae-de-avibus-historiae-libri-xii-aldrovandi"
              className="text-accent-rust hover:underline"
            >
              <em>Ornithologiae</em>
            </Link>
            . The <strong>werewolf</strong> appears first in Petronius&rsquo;s{' '}
            <Link href="/book/satyricon" className="text-accent-rust hover:underline">
              <em>Satyricon</em>
            </Link>{' '}
            (the story of Niceros and the soldier at the tomb) and again, more soberly, in Olaus
            Magnus&rsquo;s{' '}
            <Link
              href="/book/historia-de-gentibus-septentrionalibus-magnus"
              className="text-accent-rust hover:underline"
            >
              <em>History of the Northern Peoples</em>
            </Link>{' '}
            (1555), Chapter XLV: &ldquo;Concerning the ferocity of men converted into wolves.&rdquo; And{' '}
            <strong>dragons</strong> permeate the alchemical literature as the ouroboros, the
            self-devouring serpent of cyclical transformation &mdash; visible in Michael Maier&rsquo;s{' '}
            <Link
              href="/book/secretioris-naturae-secretorum-scrutinium-chymicum-maier"
              className="text-accent-rust hover:underline"
            >
              <em>Scrutinium Chymicum</em>
            </Link>
            , Emblem XIV.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Hagrid would have read{' '}
            <Link
              href="/book/historiae-animalium-liber-i-de-quadrupedibus-viviparis-gessner"
              className="text-accent-rust hover:underline"
            >
              Conrad Gessner&rsquo;s <em>Historia Animalium</em>
            </Link>{' '}
            (1551) cover to cover &mdash; the founding text of modern zoology, in which unicorns and
            manticores sit alongside cats and goats with the same matter-of-fact tone.
          </p>

          <figure className="my-12">
            <Link href="/book/6958e968813ea03889c32a24">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.sourcelibrary.org/gallery/6958e968813ea03889c32a24/6958e968813ea03889c32bb1-0.jpg"
                alt="Woodcut of a seven-headed hydra with human-like faces, long scaly body, and clawed feet. From Aldrovandi's Serpentum et Draconum Historiae, 1640."
                className="w-full max-w-md mx-auto rounded-lg shadow-md"
              />
            </Link>
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              A seven-headed hydra, from Ulisse Aldrovandi&rsquo;s <em>Serpentum et Draconum Historiae</em> (1640). Aldrovandi catalogued these alongside actual snakes &mdash; the line between zoology and fantastic beasts was thinner than ours.{' '}
              <Link href="/book/6958e968813ea03889c32a24" className="text-accent-rust hover:text-accent-rust not-italic">
                View in Source Library &rarr;
              </Link>
            </figcaption>
          </figure>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            V. Defence Against the Dark Arts: the books you wouldn&rsquo;t want at home
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Some of these are difficult books. The{' '}
            <Link href="/book/the-hammer-of-witches-sprenger" className="text-accent-rust hover:underline">
              <em>Malleus Maleficarum</em>
            </Link>{' '}
            (1486) is the most notorious witch-hunters&rsquo; handbook in European history &mdash; the
            manual that prosecutors used for two centuries to send tens of thousands of people, mostly
            women, to the stake. Its symmetrical counterpart is Johann Weyer&rsquo;s{' '}
            <Link
              href="/book/de-praestigiis-daemonum-et-incantationibus-ac-veneficiis-weyer"
              className="text-accent-rust hover:underline"
            >
              <em>De Praestigiis Daemonum</em>
            </Link>{' '}
            (1563), a sceptical catalogue of demons whose argumentative purpose was to defend accused
            witches as melancholic and deluded rather than diabolical.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Reginald Scot&rsquo;s{' '}
            <Link href="/book/the-discovery-of-witchcraft-scot" className="text-accent-rust hover:underline">
              <em>Discovery of Witchcraft</em>
            </Link>{' '}
            went further, exposing stage-magic tricks and ridiculing the witch-trial process. King James
            I had it burned. (Shakespeare read it; the witches in <em>Macbeth</em> are Scot, not the{' '}
            <em>Malleus</em>.) Francesco Maria Guazzo&rsquo;s{' '}
            <Link
              href="/book/compendium-maleficarum-in-tres-libros-distinctum-guazzo"
              className="text-accent-rust hover:underline"
            >
              <em>Compendium Maleficarum</em>
            </Link>{' '}
            (1608) is the visual companion &mdash; the illustrated demonology, woodcut after woodcut of
            sabbaths, pacts, and possessions.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            For the historical wizarding student, the lesson of this shelf is something like: the
            wizarding world has always had to live carefully alongside Muggles who were prepared to kill
            it. Hermione&rsquo;s textbook on the persecution of medieval witches isn&rsquo;t a comic
            invention.
          </p>

          <figure className="my-12">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/9/93/Francisco_de_Goya_y_Lucientes_-_Witches%27_Sabbath_-_WGA10007.jpg"
              alt="Francisco de Goya, Witches' Sabbath (El Aquelarre), 1798. Oil on canvas, Museo Lázaro Galdiano, Madrid."
              className="w-full max-w-2xl mx-auto rounded-lg shadow-md"
            />
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              Francisco de Goya, <em>Witches&rsquo; Sabbath (El Aquelarre)</em>, 1798. Museo L&aacute;zaro Galdiano, Madrid. Goya paints the witch-trial imagination at its most baroque &mdash; a horned satyr-goat presides over a coven offering infants, two centuries after the <em>Malleus</em>.
            </figcaption>
          </figure>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            VI. Charms: real grimoires
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            A &ldquo;grimoire&rdquo; is a working spellbook. They were real, they survived in
            manuscript, and they form a small literature of their own. The most famous is the{' '}
            <Link href="/book/the-key-of-solomon-pseudo-solomon" className="text-accent-rust hover:underline">
              <em>Key of Solomon</em>
            </Link>{' '}
            (Clavicula Salomonis), attributed pseudonymously to King Solomon, transmitted through
            17th-century manuscripts. It contains exhaustive instructions for drawing magic circles,
            inscribing pentacles, consecrating ritual implements &mdash; including the magic wand.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Lower in the hierarchy is the{' '}
            <Link
              href="/book/elementa-magica-heptameron-cum-agrippa-liber-quartus-agrippa"
              className="text-accent-rust hover:underline"
            >
              <em>Heptameron</em>
            </Link>{' '}
            of Pietro d&rsquo;Abano, with its tables of planetary angels and their seals. Higher up is
            Agrippa&rsquo;s{' '}
            <Link
              href="/book/three-books-of-occult-philosophy-1533-latin-agrippa"
              className="text-accent-rust hover:underline"
            >
              <em>Three Books of Occult Philosophy</em>
            </Link>
            , which provides the theoretical scaffolding for everything else.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            And further east, drawing on Arabic sources, the{' '}
            <Link href="/book/picatrix-ghayat-al-hakim-attrib" className="text-accent-rust hover:underline">
              <em>Picatrix</em>
            </Link>{' '}
            (Ghāyat al-Ḥakīm) &mdash; the medieval handbook of talismanic and astral magic that fed
            into the Latin Renaissance. The Greek tradition behind all of them is preserved in the{' '}
            <Link
              href="/book/papyri-graecae-magicae-preisendanz-ed"
              className="text-accent-rust hover:underline"
            >
              Greek Magical Papyri
            </Link>{' '}
            &mdash; literal late-antique spell books recovered from the sands of Egypt, complete with
            love charms, curse tablets, and instructions for summoning a personal daemon.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            VII. Divination and Astronomy
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Trelawney&rsquo;s Divination class teaches palmistry, tea-leaves, dream interpretation,
            astrology, and crystal-gazing &mdash; an essentially Renaissance curriculum. For dreams,{' '}
            <Link href="/book/oneirocritica-daldianus" className="text-accent-rust hover:underline">
              Artemidorus&rsquo;s <em>Oneirocritica</em>
            </Link>{' '}
            (2nd century CE) was the standard ancient manual &mdash; quoted by Freud as a precursor. For
            astrology, the working professional&rsquo;s reference was{' '}
            <Link href="/book/christian-astrology-lilly" className="text-accent-rust hover:underline">
              William Lilly&rsquo;s <em>Christian Astrology</em>
            </Link>{' '}
            (1647), the great English horary textbook. For prophecy, naturally,{' '}
            <Link
              href="/book/les-propheties-de-m-michel-nostradamus-1605-nostradamus"
              className="text-accent-rust hover:underline"
            >
              Nostradamus
            </Link>
            .
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            And for the crystal ball &mdash; the Mirror of Erised&rsquo;s small cousin &mdash; we have
            something extraordinary:{' '}
            <Link
              href="/book/a-true-faithful-relation-of-dr-john-dee-and-some-spirits-casaubon"
              className="text-accent-rust hover:underline"
            >
              <em>A True &amp; Faithful Relation of What Passed Between Dr. John Dee and Some Spirits</em>
            </Link>{' '}
            (1659). John Dee was Queen Elizabeth I&rsquo;s court astrologer and the most learned man in
            sixteenth-century England. He spent fifteen years scrying in a black obsidian mirror and a
            crystal ball, recording the apparitions in his journals, which Meric Casaubon published
            posthumously. It is the strangest book in this entire collection.
          </p>

          <figure className="my-12">
            <Link href="/book/69593025a41e40e9146a4acd">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.sourcelibrary.org/gallery/69593025a41e40e9146a4acd/69593026a41e40e9146a4b2b-0.jpg"
                alt="The Holy Table from John Dee's Enochian system: a square diagram with letters and seals, used to summon and converse with angels."
                className="w-full max-w-md mx-auto rounded-lg shadow-md"
              />
            </Link>
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              The Holy Table from John Dee&rsquo;s Enochian system &mdash; the actual apparatus on which Dee and Edward Kelley conversed with what they took to be angels. Reproduced in Meric Casaubon&rsquo;s 1659 edition.{' '}
              <Link href="/book/69593025a41e40e9146a4acd" className="text-accent-rust hover:text-accent-rust not-italic">
                View in Source Library &rarr;
              </Link>
            </figcaption>
          </figure>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            For Astronomy &mdash; Professor Sinistra&rsquo;s class &mdash; the standard texts are still
            in print: Ptolemy&rsquo;s{' '}
            <Link href="/book/almagest-ptolemy" className="text-accent-rust hover:underline">
              <em>Almagest</em>
            </Link>
            , Sacrobosco&rsquo;s{' '}
            <Link
              href="/book/sphaera-mundi-1482-ratdolt-edition-sacrobosco"
              className="text-accent-rust hover:underline"
            >
              <em>Sphera Mundi</em>
            </Link>
            , Galileo&rsquo;s{' '}
            <Link href="/book/starry-messenger-galilei" className="text-accent-rust hover:underline">
              <em>Sidereus Nuncius</em>
            </Link>
            , Kepler&rsquo;s{' '}
            <Link
              href="/book/kepler-astronomia-nova-1609-prague-kepler"
              className="text-accent-rust hover:underline"
            >
              <em>Astronomia Nova</em>
            </Link>
            . Same curriculum, just without the points-for-Gryffindor.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            VIII. Ancient Runes &amp; Arithmancy: Kabbalah for beginners
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Hermione&rsquo;s favourite electives &mdash; Ancient Runes and Arithmancy &mdash; correspond
            to a real and deep Renaissance tradition: the marriage of Hebrew letter-mysticism with
            Pythagorean number theory, generally called <strong>Christian Kabbalah</strong>. The bridge
            text is{' '}
            <Link
              href="/book/de-arte-cabalistica-id-est-de-divinae-revelationis-ad-reuchlin"
              className="text-accent-rust hover:underline"
            >
              Johann Reuchlin&rsquo;s <em>De Arte Cabalistica</em>
            </Link>{' '}
            (1517), the first major Christian attempt to read Kabbalah as a universal symbolic system of
            letters and numbers.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Behind it stand the great Hebrew sources:{' '}
            <Link href="/book/hebrew-sefer-ha-bahir-hakana" className="text-accent-rust hover:underline">
              the <em>Sefer ha-Bahir</em>
            </Link>{' '}
            (the earliest Kabbalistic classic), the{' '}
            <Link
              href="/book/the-origin-of-letters-and-numerals-according-to-the-sefer-mordell"
              className="text-accent-rust hover:underline"
            >
              <em>Sefer Yetzirah</em>
            </Link>{' '}
            (the foundational text on the twenty-two letters and ten <em>sefirot</em> as cosmic
            principles), and the{' '}
            <Link
              href="/book/zohar-parashat-bereshit-with-moses-cordovero-commentary-or-cordovero"
              className="text-accent-rust hover:underline"
            >
              <em>Zohar</em>
            </Link>{' '}
            with Moses Cordovero&rsquo;s commentary. Athanasius Kircher&rsquo;s{' '}
            <Link
              href="/book/oedipus-aegyptiacus-volume-ii-1653-kircher"
              className="text-accent-rust hover:underline"
            >
              <em>Oedipus Aegyptiacus</em>
            </Link>{' '}
            (1653) tries to unify all of it &mdash; hieroglyphs, Kabbalah, music, magnetism &mdash; into
            a single map of reality. It is the wildest 17th-century book ever written, and exactly the
            sort of thing you can imagine on the Restricted Section shelf.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            IX. The Pensieve is a memory palace
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Dumbledore&rsquo;s Pensieve &mdash; the stone basin into which memories can be drawn,
            preserved, and revisited &mdash; is the wizarding-world cousin of a Renaissance art that was
            taken with deadly seriousness: the <strong>art of memory</strong>. Robert Fludd&rsquo;s{' '}
            <Link
              href="/book/utriusque-cosmi-historia-1617-fludd"
              className="text-accent-rust hover:underline"
            >
              <em>Utriusque Cosmi Historia</em>
            </Link>{' '}
            (1617) contains the most elaborate diagrams: the <em>Theatrum Orbi</em>, a literal theatre
            of memory in which the memorist stores ideas at fixed locations on a stage.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Giulio Camillo&rsquo;s actual{' '}
            <Link
              href="/book/giulio-camillo-tutte-le-opere-1555-delminio"
              className="text-accent-rust hover:underline"
            >
              <em>L&rsquo;Idea del Theatro</em>
            </Link>{' '}
            (1555) describes a wooden Theatre he built for the King of France &mdash; a memory cabinet
            with images arranged on seven gradines, representing the entire knowable cosmos. The system
            descends from Cicero&rsquo;s{' '}
            <Link href="/book/de-oratore-cicero-1" className="text-accent-rust hover:underline">
              <em>De Oratore</em>
            </Link>{' '}
            (45 BCE) and the anonymous{' '}
            <Link href="/book/rhetorica-ad-c-herennium-cicero" className="text-accent-rust hover:underline">
              <em>Rhetorica ad Herennium</em>
            </Link>{' '}
            (c. 80 BCE), which preserve the method of loci &mdash; the technique of remembering by
            placing ideas at fixed points in an imagined building. Giordano Bruno&rsquo;s{' '}
            <Link
              href="/book/giordano-bruno-de-umbris-idearum-1582-first-edition-bruno"
              className="text-accent-rust hover:underline"
            >
              <em>De Umbris Idearum</em>
            </Link>{' '}
            (1582) takes this to a metaphysical extreme: memory as participation in the divine intellect.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The Pensieve, in other words, is what a 17th-century reader would have called <em>ars
            memoriae</em> &mdash; the art of memory &mdash; with the magic dialled up but the
            architecture intact.
          </p>

          <figure className="my-12">
            <Link href="/book/69904dd67d19f3f2aac1d49d">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.sourcelibrary.org/gallery/69904dd67d19f3f2aac1d49d/69904dd77d19f3f2aac1d500-0.jpg"
                alt="Robert Fludd's Monochordum Mundanum: the divine hand reaching from a cloud to tune a cosmic monochord stretched across the spheres of the universe."
                className="w-full max-w-md mx-auto rounded-lg shadow-md"
              />
            </Link>
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              Robert Fludd, <em>Monochordum Mundanum</em> (the World Monochord), 1617. The divine hand reaches from a cloud to tune the universe like a musical instrument. Fludd&rsquo;s book contains the most elaborate memory diagrams in the European tradition.{' '}
              <Link href="/book/69904dd67d19f3f2aac1d49d" className="text-accent-rust hover:text-accent-rust not-italic">
                View in Source Library &rarr;
              </Link>
            </figcaption>
          </figure>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            X. The Tale of the Three Brothers is older than you think
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Beedle the Bard&rsquo;s most famous tale &mdash; the three brothers who meet Death on a
            bridge and receive the Elder Wand, the Resurrection Stone, and the Cloak of Invisibility
            &mdash; has an exact medieval ancestor. Chaucer&rsquo;s{' '}
            <Link
              href="/book/canterbury-tales-ellesmere-ms-chaucer"
              className="text-accent-rust hover:underline"
            >
              <em>Pardoner&rsquo;s Tale</em>
            </Link>{' '}
            (c. 1390) tells of three drunkards who meet Death on a road and end up killing each other
            over a pile of gold. The structure is identical: three brothers, an unexpected meeting, an
            irrevocable choice, Death wins.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            And the Cloak of Invisibility itself? That goes back to{' '}
            <Link href="/book/urb-gr-31-plato" className="text-accent-rust hover:underline">
              Plato&rsquo;s <em>Republic</em>
            </Link>{' '}
            (Book II), where Glaucon tells the story of Gyges &mdash; the shepherd who found a ring of
            invisibility on a corpse in a cave, used it to seduce the queen and kill the king, and so
            opens Plato&rsquo;s great question: would <em>you</em> behave well if you could not be seen?
            The Hallows are, in their deepest reading, this same question.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            XI. Patronus, polyjuice, horcrux
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            A few last connections. The <strong>Patronus charm</strong> &mdash; the protective spirit
            summoned to drive off Dementors &mdash; descends from the late-Platonic tradition of the
            personal <em>daimon</em>. Iamblichus, in his{' '}
            <Link
              href="/book/iamblichus-de-mysteriis-1497-aldine-ficino"
              className="text-accent-rust hover:underline"
            >
              <em>On the Mysteries of the Egyptians</em>
            </Link>{' '}
            (translated by Marsilio Ficino in 1497), describes the guardian daemon assigned to each soul
            at birth, a being summoned through theurgic prayer. Plutarch&rsquo;s <em>De Genio
            Socratis</em> in the{' '}
            <Link href="/book/moralia-opuscula-plutarch" className="text-accent-rust hover:underline">
              <em>Moralia</em>
            </Link>{' '}
            (1509 edition) gives the same idea its most famous philosophical defence.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            <strong>Polyjuice Potion</strong> &mdash; the brew that turns the drinker into another
            person &mdash; has a direct literary ancestor: Apuleius&rsquo;s{' '}
            <Link
              href="/book/apuleius-metamorphoses-the-golden-ass-with-asclepius-apuleius"
              className="text-accent-rust hover:underline"
            >
              <em>Golden Ass</em>
            </Link>{' '}
            (2nd century CE), in which the protagonist watches a witch transform herself with an
            ointment and then, taking the wrong jar, accidentally becomes a donkey. The novel ends with
            his initiation into the mysteries of Isis &mdash; transformation, in Apuleius, is always
            about something deeper than appearance.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            And <strong>horcruxes</strong> &mdash; soul-anchors that allow a wizard to fragment and hide
            parts of their own being &mdash; resonate with the Kabbalistic doctrine of the three souls:{' '}
            <em>nefesh</em> (the animal soul), <em>ruach</em> (the spirit), and <em>neshamah</em> (the
            higher soul). The{' '}
            <Link
              href="/book/cabalistic-disputation-on-the-soul-moses"
              className="text-accent-rust hover:underline"
            >
              <em>Cabalistic Disputation on the Soul</em>
            </Link>{' '}
            (Israel ben Moses, 1635, held by the Bibliotheca Philosophica Hermetica) is one of the
            classic treatments. Voldemort&rsquo;s sin, on this reading, is to do violently and for
            selfish reasons what the contemplative tradition does carefully and for sacred ones &mdash;
            distinguish the levels of the soul.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">Read them yourself</h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Rowling once said in an interview: <em>&ldquo;I&rsquo;ve never wanted to be a witch, but
            an alchemist, now that&rsquo;s a different matter. To invent this wizard world, I&rsquo;ve
            learned a ridiculous amount about alchemy.&rdquo;</em> The books she would have read, and
            the books her wizards would have read, are largely the same books. They are in this
            collection.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            What Source Library adds &mdash; and what no Harry Potter / alchemy article on the internet
            has ever offered &mdash; is the actual texts in modern English, end to end, alongside the
            originals, free, with every page searchable. The British Library can show you a manuscript
            page; we let you read the book.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            <Link
              href="/collections/hogwarts-library"
              className="text-accent-rust hover:underline font-medium"
            >
              Browse the full Hogwarts Library &rarr;
            </Link>
          </p>
        </section>

        {/* Reading list grid */}
        <div className="mt-16 pt-8 border-t border-border-light">
          <h3 className="font-serif text-2xl text-primary mb-6">Twelve highlights from the collection</h3>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { href: '/book/flamel-book-of-hieroglyphic-figures-abraham-le-juif-flamel', title: 'Nicolas Flamel, Hieroglyphic Figures', detail: '1750 (text from 1612) — the legend in his own attributed voice' },
              { href: '/book/mutus-liber-the-silent-book-saulat', title: 'Mutus Liber', detail: '1677 — fifteen wordless engravings of the Philosopher\'s Stone' },
              { href: '/book/aureum-vellus-oder-guldin-schatz-und-kunstkammer-1-1-solis', title: 'Splendor Solis', detail: '1598 — 22 illuminated miniatures of the Great Work' },
              { href: '/book/atalanta-fugiens-hoc-est-emblemata-nova-de-secretis-naturae-maier', title: 'Michael Maier, Atalanta Fugiens', detail: '1617 — alchemy as emblems, epigrams, and three-voice fugues' },
              { href: '/book/699065973dc2ed39a49f1e71', title: 'The Ripley Scroll', detail: 'c. 1450 — a 6-metre illustrated alchemical manuscript' },
              { href: '/book/hortus-sanitatis-meydenbach', title: 'Hortus Sanitatis', detail: '1491 — the proto-bestiary and herbal in one volume' },
              { href: '/book/harley-ms-4751-anonymous', title: 'British Library Harley MS 4751', detail: '13th c. — illuminated bestiary with basilisks, phoenixes, unicorns' },
              { href: '/book/the-key-of-solomon-pseudo-solomon', title: 'The Key of Solomon', detail: '17th c. — the working grimoire that consecrates the wand' },
              { href: '/book/three-books-of-occult-philosophy-1533-latin-agrippa', title: 'Cornelius Agrippa, De Occulta Philosophia', detail: '1533 — Chocolate Frog Card #2, real text' },
              { href: '/book/the-hammer-of-witches-sprenger', title: 'Malleus Maleficarum', detail: '1486 — the witch-hunters\' handbook' },
              { href: '/book/christian-astrology-lilly', title: 'William Lilly, Christian Astrology', detail: '1647 — the great English horary textbook' },
              { href: '/book/utriusque-cosmi-historia-1617-fludd', title: 'Robert Fludd, Utriusque Cosmi Historia', detail: '1617 — the Pensieve\'s ancestor: the art of memory' },
            ].map((source) => (
              <Link
                key={source.href}
                href={source.href}
                className="flex items-start gap-3 p-4 rounded-lg bg-warm border border-border-light hover:border-accent-gold/20 hover:shadow-sm transition-all group"
              >
                <svg className="w-4 h-4 text-muted mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-primary group-hover:text-accent-gold-dark transition-colors">{source.title}</p>
                  <p className="text-xs text-muted mt-0.5">{source.detail}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </article>

    </ContentPageLayout>
  );
}
