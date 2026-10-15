import { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

const LEAD_IMAGE = 'https://images.sourcelibrary.org/artwork/art-tree-of-life-fludd-1.jpg';

export const metadata: Metadata = {
  title: 'Trees of Life Across the Traditions - Research Notes - Source Library',
  description:
    'The world tree in Kabbalah, Norse myth, Assyria, Mesoamerica, Christianity, alchemy, Llull and Buddhism, shown in the plates and pages Source Library holds.',
  openGraph: {
    title: 'Trees of Life Across the Traditions',
    description:
      'The world tree in Kabbalah, Norse myth, Assyria, Mesoamerica, Christianity, alchemy, Llull and Buddhism, shown in the plates and pages Source Library holds.',
    images: [{ url: LEAD_IMAGE, width: 600, height: 1024 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: LEAD_IMAGE }],
  },
  alternates: {
    canonical: '/blog/trees-of-life',
  },
};

const linkClass = 'text-accent-rust hover:text-accent-rust underline';

function Plate({
  src,
  alt,
  href,
  width,
  height,
  children,
}: {
  src: string;
  alt: string;
  href: string;
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  return (
    <figure className="mb-10">
      <div className="rounded-xl overflow-hidden border border-accent-gold/10 shadow-md bg-stone-100">
        <Link href={href}>
          <Image src={src} alt={alt} width={width} height={height} className="w-full h-auto" unoptimized />
        </Link>
      </div>
      <figcaption className="text-xs text-muted mt-2 text-center">
        {children}{' '}
        <Link href={href} className="text-accent-rust hover:text-accent-rust">
          View in collection →
        </Link>
      </figcaption>
    </figure>
  );
}

export default function TreesOfLifePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Trees of Life Across the Traditions"
          subtitle="Kabbalah, Yggdrasil, the Assyrian sacred tree, Mesoamerican codices, the Tree of Jesse, the alchemists’ tree, Llull and the Bodhi tree, in the library’s own plates"
          image={LEAD_IMAGE}
          imageAlt="Robert Fludd’s inverted sefirotic tree, 1621: roots in a crowned light above, branches spreading below"
        >
          <p className="text-stone-400 text-sm mt-4">15 October 2026 &middot; 9 min read</p>
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
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Many traditions place a tree at the centre of the world. It does one of three jobs. It is an axis joining
          heaven, earth and the underworld. It is a diagram of how the divine branches out into creation. Or it bears a
          fruit that gives life or knowledge. This note collects the versions Source Library holds as plates, woodcuts
          and manuscript pages, with links to the books they come from.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Kabbalah: the ten sefirot</h2>

        <p className="text-secondary leading-relaxed mb-6">
          In Kabbalah the Tree of Life (<em>Etz Chaim</em>) is a figure of ten <em>sefirot</em>, the attributes
          through which the infinite (<em>Ein Sof</em>) becomes knowable, joined by twenty-two paths, one for each
          letter of the Hebrew alphabet. Christian Hebraists of the sixteenth and seventeenth centuries printed it
          again and again, usually with Hebrew and Latin labels side by side.
        </p>

        <Plate
          src="https://images.sourcelibrary.org/artwork/art-kircher-tree-of-life.jpg"
          alt="Kircher’s Systema Sephiroticum: ten circles of divine names, with the tablets of the Law, a menorah and an altar between them"
          href="/artwork/kircher-tree-of-life"
          width={1128}
          height={1668}
        >
          Athanasius Kircher, <em>Systema Sephiroticum</em>, from <em>Oedipus Aegyptiacus</em> (1652–54). Each
          sefirah is a wheel of divine names; the side panels count the 613 commandments.
        </Plate>

        <div className="grid sm:grid-cols-2 gap-6">
          <Plate
            src="https://images.sourcelibrary.org/archived/69c71c28da9771c716316924/91.jpg"
            alt="Woodcut tree of the ten sefirot with planetary signs, Venice 1573"
            href="/book/69c71c28da9771c716316924?page=91"
            width={1200}
            height={1660}
          >
            Cesare Evoli, <em>De divinis attributis, quae Sephirot ab Hebraeis nuncupata</em> (Venice, 1573), with a
            planetary sign in each sefirah.
          </Plate>
          <Plate
            src="https://images.sourcelibrary.org/pages/698255f1ca3a4ca551f8e747/0504-full.jpg"
            alt="Arbor Cabbalistica: the ten sefirot labelled in Hebrew"
            href="/book/698255f1ca3a4ca551f8e747?page=504"
            width={1466}
            height={2000}
          >
            <em>Arbor Cabbalistica</em>, in Theodor Hackspan’s treatise on the Jewish Kabbalah (Altdorf, 1660),
            labelled only in Hebrew.
          </Plate>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Older still is the hand-drawn tree in a fifteenth-century copy of Isaac of Acre’s{' '}
          <Link href="/book/69c1bb138522835be845ca86?page=5" className={linkClass}>
            <em>Me’irat Einayim</em>
          </Link>
          , and the library holds the Latin compendium that carried these figures into Christian Europe, Knorr von
          Rosenroth’s{' '}
          <Link href="/book/69bd9f4bf6d63c91974800b0?page=1064" className={linkClass}>
            <em>Kabbala denudata</em>
          </Link>{' '}
          (1677).
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The inverted tree</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Robert Fludd drew the same ten sefirot as a tree growing downwards: the root is the crown, Keter, set in
          light, and the branches reach down through the orders of angels to the world. The image at the head of this
          note is his. The idea is older than Fludd and is not only Jewish. The Katha Upanishad and the Bhagavad Gita
          (15.1) describe an eternal <em>aśvattha</em>, a sacred fig, “with roots above and branches below,” whose
          leaves are the Vedic hymns.
        </p>

        <Plate
          src="https://images.sourcelibrary.org/artwork/art-tree-of-life-fludd-1.jpg"
          alt="Fludd’s inverted tree: the Tetragrammaton along the trunk, the sefirot as branches, the angelic orders as roots"
          href="/artwork/tree-of-life-fludd-1"
          width={600}
          height={1024}
        >
          Robert Fludd, <em>Utriusque Cosmi Historia</em> (1621). The four letters of the divine name run down the
          trunk.
        </Plate>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Norse: Yggdrasil</h2>

        <p className="text-secondary leading-relaxed mb-6">
          In the Eddas, Yggdrasil is an ash that holds the worlds together. An eagle sits in its crown, the serpent
          Níðhöggr gnaws one of its three roots, a squirrel runs messages between them, and the Norns water it from
          the well of Urðr. In the <em>Hávamál</em> Odin says he hung on “the windy tree” for nine nights, wounded with
          a spear, and took up the runes.
        </p>

        <div className="grid sm:grid-cols-2 gap-6">
          <Plate
            src="https://images.sourcelibrary.org/archived/699249aca2d53df4853be568/149.jpg"
            alt="Odin among the branches of a tree, holding a spear, beneath the heading The Sayings of the High One"
            href="/book/699249aca2d53df4853be568?page=149"
            width={1449}
            height={2000}
          >
            Odin on the tree, heading the <em>Hávamál</em> in Olive Bray’s <em>Elder or Poetic Edda</em> (1908).
          </Plate>
          <Plate
            src="https://images.sourcelibrary.org/cropped/69c874af6c6f3cc53c857cd4/69f6a1722d87bc4548d51b21.jpg"
            alt="Painted plate of Yggdrasil: deer in the crown, Midgard in the middle, a red serpent around the trunk, roots in darkness"
            href="/book/69c874af6c6f3cc53c857cd4?page=147"
            width={730}
            height={900}
          >
            “The Yggdrasil Tree,” colour plate in Manly P. Hall’s <em>Secret Teachings of All Ages</em> (1928).
          </Plate>
        </div>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Assyria: the sacred tree</h2>

        <p className="text-secondary leading-relaxed mb-6">
          A stylised palm flanked by winged figures or rearing animals is among the commonest motifs in the reliefs of
          the Assyrian palaces. What it meant is still argued: the king, the god Ashur, or the order of the world.
          Austen Henry Layard, who excavated Nimrud, wrote in 1849 that “this tree, evidently a sacred symbol, is
          elaborately and tastefully formed; and is one of the most conspicuous ornaments of Assyrian sculpture.”
        </p>

        <Plate
          src="https://images.sourcelibrary.org/archived/69b632c766ab51b501d93dfd/328.jpg"
          alt="Two ibexes kneeling on either side of a stylised sacred tree, from the North-West Palace at Nimrud"
          href="/book/69b632c766ab51b501d93dfd?page=328"
          width={1199}
          height={2000}
        >
          Ibexes flanking the sacred tree, North-West Palace, Nimrud. Layard, <em>Nineveh and Its Remains</em> (1849).
          More examples on{' '}
          <Link href="/book/69b632c766ab51b501d93dfd?page=329" className="text-accent-rust hover:text-accent-rust">
            the next page
          </Link>{' '}
          and in J. G. R. Forlong’s{' '}
          <Link href="/book/69c887606c6f3cc53c85a05c?page=403" className="text-accent-rust hover:text-accent-rust">
            <em>Rivers of Life</em>
          </Link>{' '}
          (1883).
        </Plate>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Mesoamerica: trees in the Codex Laud</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Across Mesoamerica a tree stood at the centre of the world and one at each of the four directions, holding up
          the sky. For the Maya the central tree was the ceiba. The Codex Laud, a pre-conquest divinatory screenfold
          now in the Bodleian Library, sets a deity before a tree above a row of day signs from the 260-day count.
          Which of these trees are direction trees is a question for the codex’s commentators; the scene of a seated
          deity before a tree recurs across the codices of the Borgia group.
        </p>

        <div className="grid sm:grid-cols-2 gap-6">
          <Plate
            src="https://images.sourcelibrary.org/archived/69b3e684abb796bfd9de428e/25.jpg"
            alt="A deity seated before a blue tree with flowering branches, day signs below"
            href="/book/69b3e684abb796bfd9de428e?page=25"
            width={510}
            height={644}
          >
            Codex Laud, a deity before a flowering tree.
          </Plate>
          <Plate
            src="https://images.sourcelibrary.org/archived/69b3e684abb796bfd9de428e/24.jpg"
            alt="A deity enthroned before a brown tree, with a parrot and day signs below"
            href="/book/69b3e684abb796bfd9de428e?page=24"
            width={510}
            height={644}
          >
            Codex Laud, a deity enthroned before a tree, with a parrot.
          </Plate>
        </div>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Eden, the Cross and the Tree of Jesse</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Genesis puts two trees in the garden, the tree of life and the tree of the knowledge of good and evil.
          Medieval legend held that the wood of the Cross came from the tree of life, and Revelation 22 returns it to
          the end of the Bible, beside the river of the heavenly city. The Tree of Jesse makes a family tree out of
          Isaiah 11:1, “a rod out of the stem of Jesse”: a vine rises from the sleeping Jesse through the kings of
          Israel to the Virgin and Child.
        </p>

        <Plate
          src="https://images.sourcelibrary.org/artwork/nga-israhel-van-meckenem-ornament-with-the-tree-of-jesse.jpg"
          alt="Engraving of the Tree of Jesse: Jesse asleep below, crowned kings in the scrolling vine, the Virgin and Child at the top"
          href="/artwork/nga-israhel-van-meckenem-ornament-with-the-tree-of-jesse"
          width={2000}
          height={903}
        >
          Israhel van Meckenem, <em>Ornament with the Tree of Jesse</em>, engraving, late fifteenth century. David
          plays the harp at the centre.
        </Plate>

        <p className="text-secondary leading-relaxed mb-8">
          See also the river and tree of life in a{' '}
          <Link href="/book/697718b37e1d5a07ae945888?page=633" className={linkClass}>
            1702 history of the Old and New Testaments
          </Link>
          , and the woodcut of Christ on the tree of life that Jung reproduced in{' '}
          <Link href="/book/6990541238e1fdee57b36a6e?page=244" className={linkClass}>
            <em>Psychology of the Unconscious</em>
          </Link>
          .
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Alchemy: the philosophical tree</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Alchemists described the growth of metals as the growth of a tree, the <em>arbor philosophica</em>. In the
          German <em>Pandora</em> of 1588, a tree of the Sun and a tree of the Moon, gold and silver, stand on either
          side of the Rebis, the two-headed figure of the united opposites; their blossoms are suns and moons with
          faces.
        </p>

        <div className="grid sm:grid-cols-2 gap-6">
          <Plate
            src="https://images.sourcelibrary.org/archived/69bd9d4a6120d54bd0374b10/260.jpg"
            alt="Woodcut: a winged two-headed figure on a dragon between a tree of suns and a tree of moons"
            href="/book/69bd9d4a6120d54bd0374b10?page=260"
            width={1363}
            height={2000}
          >
            The Rebis between the trees of the Sun and Moon. Hieronymus Reusner, <em>Pandora</em> (Basel, 1588).
          </Plate>
          <Plate
            src="https://images.sourcelibrary.org/archived/69bd9d4a6120d54bd0374b10/246.jpg"
            alt="Woodcut: a crowned woman standing on furnaces beneath a fruiting tree with an eagle, between sun and moon"
            href="/book/69bd9d4a6120d54bd0374b10?page=246"
            width={1350}
            height={2000}
          >
            A crowned woman on the furnaces beneath a fruiting tree, the eagle in its branches. Same book.
          </Plate>
        </div>

        <Plate
          src="https://images.sourcelibrary.org/artwork/art-azoth-the-alchemical-mandala.jpg"
          alt="Title page of Azoth, 1659: a tree bearing the planetary stars between the sun and moon, two men below"
          href="/book/art-azoth-the-alchemical-mandala"
          width={548}
          height={850}
        >
          Title page of Basil Valentine’s <em>Azoth</em> (Paris, 1659): the tree carries the signs of the planets,
          with the Sun and Moon at the ends of its branches.
        </Plate>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Llull: the tree of knowledge as a diagram</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Ramon Llull’s <em>Arbor scientiae</em> (1295–96) arranges all knowledge as a forest of sixteen trees, from
          the elemental to the divine, each with roots, trunk, branches, leaves, flowers and fruit. It is one of the
          ancestors of the tree diagram used for classification today.
        </p>

        <Plate
          src="https://images.sourcelibrary.org/archived/69522ff2ab34727b1f044362/13.jpg"
          alt="Woodcut of a tree with round fruit, a monk and Raymundus holding scrolls at its foot, Gloria and Poena at the top"
          href="/book/69522ff2ab34727b1f044362?page=13"
          width={648}
          height={900}
        >
          The opening woodcut of the Lyon edition of 1515: Llull (“Raymundus”) and a monk at the foot of the tree. The
          library also holds its{' '}
          <Link href="/book/69522ff2ab34727b1f044362?page=137" className="text-accent-rust hover:text-accent-rust">
            Moral Tree
          </Link>
          .
        </Plate>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Buddhism: the Bodhi tree</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The Buddha reached enlightenment under a fig tree at Bodh Gaya. The earliest Buddhist sculpture does not
          show him in human form; the tree, an empty seat or a pair of footprints stands in his place.
        </p>

        <Plate
          src="https://images.sourcelibrary.org/archived/69907d035f855ec553e78b49/14.jpg"
          alt="Engraving of a pillar capital: worshippers before the Bodhi tree and the Buddha’s footprints"
          href="/book/69907d035f855ec553e78b49?page=14"
          width={1092}
          height={2000}
        >
          “Early worship of Buddha’s footprints and the Bodhi tree,” pillar capital from the Kanheri caves, in Albert
          Grünwedel’s <em>Buddhist Art in India</em> (English edition, 1901).
        </Plate>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Trees the library does not yet show</h2>

        <p className="text-secondary leading-relaxed mb-6">
          A search of the library’s images on 15 October 2026 found no usable picture of these:
        </p>

        <ul className="list-disc pl-6 text-secondary leading-relaxed mb-8 space-y-2">
          <li>
            <strong>India:</strong> the aśvattha of the Upanishads and the Gita, and the wish-granting{' '}
            <em>kalpavṛkṣa</em>.
          </li>
          <li>
            <strong>Egypt:</strong> the sycamore from which the sky goddess Nut or Hathor pours water for the dead, and
            the <em>ished</em> tree on whose leaves Thoth writes the years of the king’s reign.
          </li>
          <li>
            <strong>China:</strong> Fusang, the mulberry in the east where the ten suns rest, and Jianmu, the tree by
            which the gods climb between heaven and earth. The bronze trees from Sanxingdui (c. 1200 BCE) have been
            read as Fusang.
          </li>
          <li>
            <strong>Iran:</strong> Gaokerena, the white haoma tree of immortality growing in the cosmic sea.
          </li>
          <li>
            <strong>Islam:</strong> the lote tree of the boundary (<em>Sidrat al-Muntahā</em>) in the seventh heaven,
            and Ṭūbā, the tree of paradise.
          </li>
          <li>
            <strong>Siberia and Central Asia:</strong> the notched birch the shaman climbs to reach the upper world.
          </li>
        </ul>

        <p className="text-secondary leading-relaxed mb-8">
          More trees from the collection are in the{' '}
          <Link href="/gallery?q=tree%20of%20life" className={linkClass}>
            image gallery
          </Link>
          .
        </p>
      </article>
    </ContentPageLayout>
  );
}
