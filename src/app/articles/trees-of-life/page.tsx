import { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';

const LEAD_IMAGE = 'https://images.sourcelibrary.org/artwork/art-tree-of-life-fludd-1.jpg';
// Crops cut from the library's page images and artworks for this post.
const IMG = '/articles/trees-of-life';

export const metadata: Metadata = withArticleMeta('trees-of-life', {
  title: 'Trees of Life Across the Traditions - Articles - Source Library',
  description:
    'World trees, sacred trees and tree diagrams from Kabbalah, Norse and Prussian myth, Assyria, Mesoamerica, Christianity, Islam, Java, Tibet, alchemy, logic and Darwin, shown in the plates and pages Source Library holds.',
  openGraph: {
    title: 'Trees of Life Across the Traditions',
    description:
      'World trees, sacred trees and tree diagrams from twelve traditions, shown in the plates and pages Source Library holds.',
    images: [{ url: LEAD_IMAGE, width: 600, height: 1024 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: LEAD_IMAGE }],
  },
  alternates: {
    canonical: '/articles/trees-of-life',
  },
});

const linkClass = 'text-accent-rust hover:text-accent-rust underline';
const captionLinkClass = 'text-accent-rust hover:text-accent-rust';

function Plate({
  src,
  alt,
  href,
  width,
  height,
  wide = false,
  small = false,
  source,
  children,
}: {
  src: string;
  alt: string;
  href: string;
  width: number;
  height: number;
  // Tall plates are capped so one picture does not fill several screens.
  wide?: boolean;
  // Low-resolution sources stay near their natural size instead of being blown up.
  small?: boolean;
  // Set for pictures from outside the library: names where the link goes.
  source?: string;
  children: React.ReactNode;
}) {
  return (
    <figure className={wide ? 'mb-10' : small ? 'mb-10 max-w-xs mx-auto w-full' : 'mb-10 max-w-md mx-auto w-full'}>
      <div className="rounded-xl overflow-hidden border border-accent-gold/10 shadow-md bg-stone-100">
        <Link href={href}>
          <Image src={src} alt={alt} width={width} height={height} className="w-full h-auto" unoptimized />
        </Link>
      </div>
      <figcaption className="text-xs text-muted mt-2 text-center">
        {children}{' '}
        <Link href={href} className={captionLinkClass}>
          {source ? `View at ${source} →` : 'View in collection →'}
        </Link>
      </figcaption>
    </figure>
  );
}

function Pair({ children }: { children: React.ReactNode }) {
  return <div className="grid sm:grid-cols-2 gap-6 items-start">{children}</div>;
}

function Section({ children }: { children: React.ReactNode }) {
  return <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">{children}</h2>;
}

export default function TreesOfLifePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title="Trees of Life Across the Traditions"
          subtitle="World trees, sacred trees and tree diagrams from Kabbalah to Darwin, in the library’s own plates and pages"
          image={LEAD_IMAGE}
          imageAlt="Robert Fludd’s inverted sefirotic tree, 1621: roots in a crowned light above, branches spreading below"
        >
          <p className="text-stone-400 text-sm mt-4">15 October 2026 &middot; 20 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Many traditions place a tree at the centre of the world. It does one of three jobs. It is an axis joining
          heaven, earth and the underworld. It is a diagram of how the divine branches out into creation. Or it bears a
          fruit that gives life or knowledge. Later the tree became a way of drawing any order that branches: kinship,
          logic, the sciences, and in 1859 the descent of species. This note collects the versions Source Library holds
          as plates, woodcuts, manuscript pages and paintings, with links to the books they come from.
        </p>

        <Section>Kabbalah: the ten sefirot</Section>

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

        <Pair>
          <Plate
            src={`${IMG}/evoli-sefirot.jpg`}
            alt="Woodcut tree of the ten sefirot with planetary signs, Venice 1573"
            href="/book/69c71c28da9771c716316924?page=91"
            width={640}
            height={1290}
          >
            Cesare Evoli, <em>De divinis attributis, quae Sephirot ab Hebraeis nuncupata</em> (Venice, 1573), with a
            planetary sign in each sefirah.
          </Plate>
          <Plate
            src={`${IMG}/hackspan-arbor-cabbalistica.jpg`}
            alt="Arbor Cabbalistica: the ten sefirot labelled in Hebrew"
            href="/book/698255f1ca3a4ca551f8e747?page=504"
            width={701}
            height={1400}
          >
            <em>Arbor Cabbalistica</em>, in Theodor Hackspan’s treatise on the Jewish Kabbalah (Altdorf, 1660),
            labelled only in Hebrew.
          </Plate>
        </Pair>

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

        <Section>The inverted tree</Section>

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

        <Section>Norse: Yggdrasil</Section>

        <p className="text-secondary leading-relaxed mb-6">
          In the Eddas, Yggdrasil is an ash that holds the worlds together. An eagle sits in its crown, the serpent
          Níðhöggr gnaws one of its three roots, a squirrel runs messages between them, and the Norns water it from
          the well of Urðr. In the <em>Hávamál</em> Odin says he hung on “the windy tree” for nine nights, wounded with
          a spear, and took up the runes.
        </p>

        <Pair>
          <Plate
            src={`${IMG}/bray-odin.jpg`}
            alt="Odin among the branches of a tree, holding a spear, beneath the heading The Sayings of the High One"
            href="/book/699249aca2d53df4853be568?page=149"
            width={1092}
            height={1400}
          >
            Odin on the tree, heading the <em>Hávamál</em> in Olive Bray’s <em>Elder or Poetic Edda</em> (1908).
          </Plate>
          <Plate
            src={`${IMG}/hall-yggdrasil.jpg`}
            alt="Painted plate of Yggdrasil: deer in the crown, Midgard in the middle, a red serpent around the trunk, roots in darkness"
            href="/book/69c874af6c6f3cc53c857cd4?page=147"
            width={914}
            height={1400}
          >
            “The Yggdrasil Tree,” colour plate in Manly P. Hall’s <em>Secret Teachings of All Ages</em> (1928).
          </Plate>
        </Pair>

        <Section>Siberia: the shaman’s tree</Section>

        <p className="text-secondary leading-relaxed mb-6">
          Among the peoples of Siberia the world tree was something a shaman climbed. The Finnish scholar Uno
          Holmberg, writing in 1927, gathered the evidence: the Yakuts set up rows of trees for the storeys of
          heaven, one for each level the shaman passes, and the Dolgans raised a pole with crosspieces topped by a
          two-headed bird, the Lord of the Birds, at the summit of the world.
        </p>

        <Pair>
          <Plate
            src={`${IMG}/holmberg-yakut-trees.jpg`}
            alt="Engraving of a row of young trees joined by a cord hung with rags on open grassland"
            href="https://archive.org/details/finnougricsiberi0000unoh/page/n608/mode/1up"
            width={1400}
            height={924}
            source="Internet Archive"
          >
            “Yakut trees representing the storeys of heaven.” Uno Holmberg, <em>Finno-Ugric, Siberian</em>,{' '}
            <em>The Mythology of All Races</em> vol. IV (1927), plate XLVI.
          </Plate>
          <Plate
            src={`${IMG}/holmberg-dolgan-world-tree.jpg`}
            alt="Line drawing: carved wooden animals and fish beside a tall pole with crosspieces and a bird at the top"
            href="https://archive.org/details/finnougricsiberi0000unoh/page/n776/mode/1up"
            width={961}
            height={1400}
            source="Internet Archive"
          >
            “Dolgan shaman-attributes and the world-tree with the two-headed Lord of the Birds,” Holmberg (1927), fig.
            20.
          </Plate>
        </Pair>

        <Section>Prussia: the oak at Romowe</Section>

        <p className="text-secondary leading-relaxed mb-6">
          The pagan Prussians and Lithuanians kept sacred groves into the thirteenth and fourteenth centuries. Early modern historians
          described their chief sanctuary, Romowe, as an evergreen oak holding the images of three gods, with a fire
          kept burning before it. Christoph Hartknoch engraved the scene in 1684. His source was the
          sixteenth-century chronicler Simon Grunau, whose account historians treat as largely invented, so the
          picture records what Prussian scholars believed rather than what the sanctuary looked like.
        </p>

        <Plate
          src={`${IMG}/hartknoch-romowe.jpg`}
          alt="Engraving of a great oak behind a wooden screen with three idols in niches, a fire burning before it, a village around"
          href="/book/6a209d5c89e8715c5947a6ac?page=87"
          width={1400}
          height={1198}
          wide
        >
          The oak of Romowe with its three idols. Christoph Hartknoch, <em>Alt und Neues Preussen</em> (1684).
        </Plate>

        <p className="text-secondary leading-relaxed mb-8">
          The picture travelled. A German translation of the Edda printed in 1777, now in the Bibliotheca
          Philosophica Hermetica in Amsterdam, reprints the oak of Romowe among its plates of northern religion:{' '}
          <Link href="/book/69c820ca6c6f3cc53c84a904" className={linkClass}>
            <em>Die isländische Edda</em>
          </Link>
          .
        </p>

        <Section>Assyria: the sacred tree</Section>

        <p className="text-secondary leading-relaxed mb-6">
          A stylised palm flanked by winged figures or rearing animals is among the commonest motifs in the reliefs of
          the Assyrian palaces. What it meant is still argued: the king, the god Ashur, or the order of the world.
          Austen Henry Layard, who excavated Nimrud, wrote in 1849 that “this tree, evidently a sacred symbol, is
          elaborately and tastefully formed; and is one of the most conspicuous ornaments of Assyrian sculpture.”
        </p>

        <Pair>
          <Plate
            src={`${IMG}/layard-sacred-tree.jpg`}
            alt="Line drawing of the Assyrian sacred tree: a trunk bound with bands, palmettes on every branch"
            href="/book/69b632c766ab51b501d93dfd?page=329"
            width={638}
            height={1400}
          >
            The sacred tree, North-West Palace, Nimrud. Layard, <em>Nineveh and Its Remains</em> (1849).
          </Plate>
          <Plate
            src={`${IMG}/layard-ibexes.jpg`}
            alt="Two ibexes kneeling on either side of a stylised sacred tree"
            href="/book/69b632c766ab51b501d93dfd?page=328"
            width={1026}
            height={534}
          >
            Ibexes flanking the tree, from the same palace. See also J. G. R. Forlong’s{' '}
            <Link href="/book/69c887606c6f3cc53c85a05c?page=403" className={captionLinkClass}>
              <em>Rivers of Life</em>
            </Link>{' '}
            (1883).
          </Plate>
        </Pair>

        <Section>Egypt: the goddess in the sycamore</Section>

        <p className="text-secondary leading-relaxed mb-6">
          In the Egyptian Book of the Dead a goddess, Nut or Hathor, stands in a sycamore fig and gives the dead
          water and bread, so that they need not go thirsty in the next world. The Papyrus of Ani, written around
          1250 BCE, paints her among the fruit, pouring water for Ani as he kneels below.
        </p>

        <Plate
          src={`${IMG}/ani-sycamore.jpg`}
          alt="Egyptian painting: a goddess standing in a sycamore heavy with red fruit pours water for a kneeling man"
          href="/book/699209afbed8f4b5ff5b23f8?page=386"
          width={250}
          height={310}
          small
        >
          The goddess in the sycamore, Papyrus of Ani. From E. A. Wallis Budge’s facsimile,{' '}
          <em>The Book of the Dead</em> (1895).
        </Plate>

        <p className="text-secondary leading-relaxed mb-6">
          A second Egyptian tree recorded time. On the <em>ished</em> or persea tree of Heliopolis, Thoth and the
          goddess of writing, Seshat, wrote the king’s name on the leaves and fruit, one for each year of his reign.
          The Ramesseum at Thebes shows Ramesses II seated before the tree while Atum, Seshat and Thoth write. John
          Gardner Wilkinson drew the relief in 1841.
        </p>

        <Plate
          src={`${IMG}/wilkinson-persea-54a.jpg`}
          alt="Line drawing of an Egyptian relief: a seated king before a leafy tree, a goddess and ibis-headed Thoth writing on its fruit"
          href="https://archive.org/details/secondseriesofma03wilk/page/n107/mode/1up"
          width={1400}
          height={1358}
          wide
          source="Internet Archive"
        >
          “Atmoo, Thoth, and the goddess of letters writing the name of Remeses on the fruit of the persea,”
          Memnonium, Thebes. Wilkinson, <em>A Second Series of the Manners and Customs of the Ancient Egyptians</em>{' '}
          (1841), plate 54a.
        </Plate>

        <Section>China: the sun tree and the money tree</Section>

        <p className="text-secondary leading-relaxed mb-6">
          Chinese myth places Fusang, a giant mulberry, at the eastern edge of the world. Ten suns rested in it,
          and one at a time rode out across the sky. The bronze trees buried at Sanxingdui in Sichuan around 1200
          BCE, with birds perched on their branches, have been read as this sun tree. Over a thousand years later,
          tombs in the same province held bronze “money trees” hung with coins and immortals, set on ceramic bases
          shaped like mountains.
        </p>

        <Pair>
          <Plate
            src={`${IMG}/sanxingdui-tree.jpg`}
            alt="Tall bronze tree in a museum case, branches ending in fruit and perched birds"
            href="https://commons.wikimedia.org/wiki/File:Bronze_Tree,_Sanxingdui_1a.jpg"
            width={933}
            height={1400}
            source="Wikimedia Commons"
          >
            Bronze tree from Sanxingdui, c. 1200 BCE, Sanxingdui Museum. Photo: Gary Todd, CC0.
          </Plate>
          <Plate
            src={`${IMG}/han-money-tree.jpg`}
            alt="Bronze tree with openwork branches of coins and figures on a pale ceramic mountain base"
            href="https://commons.wikimedia.org/wiki/File:Eastern_Han_Bronze_Money_Tree,_Sichuan_1a.jpg"
            width={933}
            height={1400}
            source="Wikimedia Commons"
          >
            Money tree, Eastern Han dynasty (25–220 CE), Sichuan. Tokyo National Museum. Photo: Gary Todd, CC0.
          </Plate>
        </Pair>

        <p className="text-secondary leading-relaxed mb-6">
          Han dynasty painters drew Fusang itself. On the silk banner laid over the coffin of the Lady of Dai at
          Mawangdui (before 168 BCE), the sun with its crow sits at the top right, and smaller red suns hang among
          the twisting branches below it. On the Wu Liang shrines in Shandong (mid-second century CE) the archer Yi
          aims at the sun-crows perched in the tree; in the myth he shot down nine of the ten suns when they all rose
          at once.
        </p>

        <Plate
          src={`${IMG}/mawangdui-fusang.jpg`}
          alt="Painted silk: a crescent moon at left, a red sun with a black crow at right, red suns among dark branches below"
          href="https://commons.wikimedia.org/wiki/File:T-shaped_Painting_on_Silk_-_Google_Art_Project.jpg"
          width={1400}
          height={1052}
          wide
          source="Wikimedia Commons"
        >
          The heavens of the Mawangdui banner, with the sun-crow and the suns of Fusang at right. Tomb 1, Mawangdui,
          Western Han. Hunan Museum (detail).
        </Plate>

        <Plate
          src={`${IMG}/wuliang-fusang.jpg`}
          alt="Stone rubbing: a tree with interlaced branches full of birds, an archer and a chariot below"
          href="https://commons.wikimedia.org/wiki/File:Wu_liang_shrine_relief_depicting_xihe,_yi,_and_fusang_tree.jpg"
          width={498}
          height={406}
          small
          source="Wikimedia Commons"
        >
          The Fusang tree with Yi the archer and Xihe readying the sun chariot. Rubbing from the Wu Liang shrines (mid-2nd
          century CE).
        </Plate>

        <Section>Mesoamerica: trees in the Codex Laud</Section>

        <p className="text-secondary leading-relaxed mb-6">
          Across Mesoamerica a tree stood at the centre of the world and one at each of the four directions, holding up
          the sky. For the Maya the central tree was the ceiba. The Codex Laud, a pre-conquest divinatory screenfold
          now in the Bodleian Library, sets a deity before a tree above a row of day signs from the 260-day count.
          Which of these trees are direction trees is a question for the codex’s commentators; the scene of a seated
          deity before a tree recurs across the codices of the Borgia group.
        </p>

        <Pair>
          <Plate
            src={`${IMG}/codex-laud-25.jpg`}
            alt="A deity seated before a blue tree with flowering branches, day signs below"
            href="/book/69b3e684abb796bfd9de428e?page=25"
            width={454}
            height={433}
          >
            Codex Laud: a deity before a flowering tree.
          </Plate>
          <Plate
            src={`${IMG}/codex-laud-24.jpg`}
            alt="A deity enthroned before a brown tree, with a parrot and day signs below"
            href="/book/69b3e684abb796bfd9de428e?page=24"
            width={416}
            height={433}
          >
            Codex Laud: a deity enthroned before a tree, with a parrot.
          </Plate>
        </Pair>

        <Section>Eden, the Cross and the Tree of Jesse</Section>

        <p className="text-secondary leading-relaxed mb-6">
          Genesis puts two trees in the garden, the tree of life and the tree of the knowledge of good and evil.
          Medieval artists often gave the serpent a woman’s face. Legend held that the wood of the Cross came from the
          tree of life, and Revelation 22 returns it to the end of the Bible, beside the river of the heavenly city.
        </p>

        <Pair>
          <Plate
            src={`${IMG}/speculum-fall.jpg`}
            alt="Woodcut: Adam and Eve holding fruit on either side of a tree whose trunk is a serpent with a woman’s head"
            href="/book/69dbcc131040d1d5e20bc94f?page=9"
            width={1216}
            height={1004}
          >
            The Fall, with a woman-headed serpent for a trunk. <em>Spiegel menschlicher Behaltnuss</em> (1476).
          </Plate>
          <Plate
            src={`${IMG}/saenredam-adam-eve.jpg`}
            alt="Engraving: Adam and Eve standing beside the tree of knowledge, Eve pointing upward"
            href="/artwork/saenredam-adam-and-eve-before-the-tree-of-knowledge"
            width={1069}
            height={1400}
          >
            Jan Saenredam, <em>Adam and Eve before the Tree of Knowledge</em>, engraving.
          </Plate>
        </Pair>

        <p className="text-secondary leading-relaxed mb-6">
          The Tree of Jesse makes a family tree out of Isaiah 11:1, “a rod out of the stem of Jesse”: a vine rises
          from the sleeping Jesse through the kings of Israel to the Virgin and Child. The religious orders borrowed
          the form to draw their own descent from a founder.
        </p>

        <Plate
          src="https://images.sourcelibrary.org/artwork/nga-israhel-van-meckenem-ornament-with-the-tree-of-jesse.jpg"
          alt="Engraving of the Tree of Jesse: Jesse asleep below, crowned kings in the scrolling vine, the Virgin and Child at the top"
          href="/artwork/nga-israhel-van-meckenem-ornament-with-the-tree-of-jesse"
          width={2000}
          height={903}
          wide
        >
          Israhel van Meckenem, <em>Ornament with the Tree of Jesse</em>, engraving, late fifteenth century. David
          plays the harp at the centre.
        </Plate>

        <Pair>
          <Plate
            src={`${IMG}/speculum-jesse-coloured.jpg`}
            alt="Hand-coloured woodcut: Jesse asleep, a flowering stem with birds rising from him"
            href="/book/69dbcc190f8c5edf20f4589f?page=54"
            width={1318}
            height={840}
          >
            The rod of Jesse, hand-coloured woodcut. <em>Speculum humanae salvationis</em> (Augsburg, 1473).
          </Plate>
          <Plate
            src={`${IMG}/callot-st-francis.jpg`}
            alt="Etching: a great tree spreading over a crowd of friars, the Trinity in the clouds above"
            href="/artwork/callot-de-boom-van-de-heilige-franciscus"
            width={1369}
            height={1400}
          >
            Jacques Callot, <em>The Tree of Saint Francis</em> (1621): the Franciscan order as a tree.
          </Plate>
        </Pair>

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

        <Section>Islam: the Waqwaq tree</Section>

        <p className="text-secondary leading-relaxed mb-6">
          Arabic and Persian geographers placed the island of Waqwaq at the eastern edge of the world. On it grew a
          tree whose fruit were human figures, said to call out “waq waq” before they fell. The <em>Kitāb al-Bulhān</em>,
          a book of divination and wonders compiled in Baghdad around 1400, paints the tree hung with its human
          fruit, and a copy of Zakariyā al-Qazwīnī’s cosmography, <em>The Wonders of Creation</em>, paints it twice.
        </p>

        <Plate
          src={`${IMG}/kitab-al-bulhan-waqwaq.jpg`}
          alt="Manuscript painting of a tree whose fruit are small human figures"
          href="/book/6953b56577f38f6761bd979d?page=88"
          width={1012}
          height={1400}
        >
          The Waqwaq tree. <em>Kitāb al-Bulhān</em>, Bodleian Library MS. Bodl. Or. 133 (c. 1400).
        </Plate>

        <Pair>
          <Plate
            src={`${IMG}/qazwini-waqwaq-1.jpg`}
            alt="Persian painting: a red-trunked tree on a rocky island, small human figures in its branches, animals below"
            href="/book/69907bdc5f855ec553e7177b?page=111"
            width={570}
            height={716}
          >
            The Waqwaq tree in al-Qazwīnī, <em>ʿAjāʾib al-makhlūqāt</em>, Cambridge University Library MS Nn.3.74.
          </Plate>
          <Plate
            src={`${IMG}/qazwini-waqwaq-2.jpg`}
            alt="Persian painting: a tree whose branches bear human figures, rocks around its foot"
            href="/book/69907bdc5f855ec553e7177b?page=114"
            width={522}
            height={948}
          >
            A second Waqwaq tree from the same manuscript.
          </Plate>
        </Pair>

        <p className="text-secondary leading-relaxed mb-6">
          The Qur’an (53:14) names a tree at the edge of the seventh heaven, the lote tree of the boundary
          (<em>Sidrat al-Muntahā</em>), which the Prophet passed on the night of his ascension. The books that
          illustrate the ascension (<em>Miʿrājnāma</em>) paint it. In this fourteenth-century page the tree is
          the great gold trunk on the right.
        </p>

        <Plate
          src={`${IMG}/lote-tree-bilal.jpg`}
          alt="Worn Persian painting: figures in a pavilion of paradise, a gold tree trunk filling the right side"
          href="https://commons.wikimedia.org/wiki/File:Bilal_before_the_Lote_Tree_of_the_Limit.jpg"
          width={1344}
          height={856}
          wide
          source="Wikimedia Commons"
        >
          Bilal before the lote tree, <em>Miʿrājnāma</em>, c. 1317–35. Topkapı Palace Library, H. 2154, fol. 61r
          (detail).
        </Plate>

        <p className="text-secondary leading-relaxed mb-6">
          Paradise has its own tree in the hadith, Ṭūbā, so large that a rider could travel in its shade for a hundred
          years. The Timurid <em>Miʿrājnāma</em> made at Herat in 1436 paints the Prophet’s visit to the gardens of
          paradise, where houris on camels greet each other among flowering trees. The painting does not label any of
          them as Ṭūbā.
        </p>

        <Plate
          src={`${IMG}/miraj-paradise.jpg`}
          alt="Persian painting: Gabriel and the Prophet above a turquoise garden of flowering trees, women on camels below"
          href="https://commons.wikimedia.org/wiki/File:Mohammed_visiting_Paradise.jpg"
          width={648}
          height={622}
          source="Wikimedia Commons"
        >
          The Prophet visits paradise. <em>Miʿrājnāma</em>, Herat, 1436. Bibliothèque nationale de France, Suppl.
          turc 190.
        </Plate>

        <Section>Java: the kayon</Section>

        <p className="text-secondary leading-relaxed mb-6">
          In the Javanese shadow play (<em>wayang kulit</em>) the first and last figure on the screen is not a
          character but a tree. The <em>kayon</em> or <em>gunungan</em> (“mountain”), a leaf-shaped puppet carved with
          a tree, animals and often a gateway, is planted in the centre before the play begins, waved to mark a change
          of scene, and planted again at the end. It stands for the world in which the story takes place.
        </p>

        <Plate
          src={`${IMG}/kayon.jpg`}
          alt="Leaf-shaped shadow puppet: a tree trunk rising above a gated house with steps"
          href="/book/69e75aefa953ec232ce8d610?page=154"
          width={590}
          height={946}
        >
          A <em>kayon</em>, from <em>Kilatbuwana</em>, the text of a Javanese wayang kulit performance (1984).
        </Plate>

        <Section>Tibet: the refuge tree</Section>

        <p className="text-secondary leading-relaxed mb-6">
          Tibetan Buddhist schools paint their whole lineage as a tree. A single trunk rises from a lake; on its
          branches sit the teachers of the lineage, the buddhas, the meditational deities, the protectors and the
          scriptures. Practitioners visualise this assembly when they recite the refuge prayer at the start of
          practice.
        </p>

        <Plate
          src={`${IMG}/kagyu-refuge-tree.jpg`}
          alt="Thangka: a tree rising from a lake, its branches crowded with seated teachers and deities"
          href="/artwork/kagyurefugetree"
          width={800}
          height={1134}
        >
          Refuge tree of the Kagyu lineage, Tibetan thangka.
        </Plate>

        <Section>Alchemy: the philosophical tree</Section>

        <p className="text-secondary leading-relaxed mb-6">
          Alchemists described the growth of metals as the growth of a tree, the <em>arbor philosophica</em>. One
          picture shows how the images travelled. The <em>Buch der heiligen Dreifaltigkeit</em>, a German manuscript
          of the early fifteenth century, paints a crowned woman with a fruiting tree growing from her head between
          the Sun and Moon. The printed <em>Pandora</em> of 1588 cut the same composition in wood.
        </p>

        <Pair>
          <Plate
            src={`${IMG}/dreifaltigkeit-tree.jpg`}
            alt="Manuscript painting: a crowned woman with a red-fruited tree growing from her head, Sun and Moon beside her, furnaces below"
            href="/book/6991c5853074a1745a41199b?page=10"
            width={900}
            height={1026}
          >
            <em>Buch der heiligen Dreifaltigkeit</em>, John Rylands Library, German MS 1 (fifteenth century).
          </Plate>
          <Plate
            src={`${IMG}/pandora-246.jpg`}
            alt="Woodcut of the same composition: a crowned woman on the furnaces beneath a fruiting tree with an eagle"
            href="/book/69bd9d4a6120d54bd0374b10?page=246"
            width={758}
            height={990}
          >
            The same image in Hieronymus Reusner’s <em>Pandora</em> (Basel, 1588).
          </Plate>
        </Pair>

        <p className="text-secondary leading-relaxed mb-6">
          <em>Pandora</em> also sets a tree of the Sun and a tree of the Moon, gold and silver, on either side of the
          Rebis, the two-headed figure of the united opposites; their blossoms are suns and moons with faces. A
          German compilation of 1667, the <em>Dreyfaches hermetisches Kleeblat</em>, turned the tree into a chart:
          each band on the trunk is a named operation of the work, from putrefaction to the Stone.
        </p>

        <Pair>
          <Plate
            src={`${IMG}/pandora-260.jpg`}
            alt="Woodcut: a winged two-headed figure on a dragon between a tree of suns and a tree of moons"
            href="/book/69bd9d4a6120d54bd0374b10?page=260"
            width={1014}
            height={1400}
          >
            The Rebis between the trees of the Sun and Moon. <em>Pandora</em> (1588).
          </Plate>
          <Plate
            src={`${IMG}/nuysement-313.jpg`}
            alt="Engraving of a tree whose trunk carries labelled bands for each alchemical operation, the Stone in a circle at the top"
            href="/book/697b079957403b932c4a76b3?page=313"
            width={751}
            height={1400}
          >
            A branch of the philosophical tree, from <em>Dreyfaches hermetisches Kleeblat</em> (Nuremberg, 1667).
          </Plate>
        </Pair>

        <Pair>
          <Plate
            src={`${IMG}/aureum-vellus.jpg`}
            alt="Hand-coloured woodcut: a tree growing from the neck of a glass flask, figures bathing inside it, the Sun beside"
            href="/book/69bd9d7b6120d54bd0376fac?page=1067"
            width={668}
            height={940}
          >
            A tree growing out of the flask. Salomon Trismosin, <em>Aureum vellus</em> (Rorschach, 1598).
          </Plate>
          <Plate
            src="https://images.sourcelibrary.org/artwork/art-azoth-the-alchemical-mandala.jpg"
            alt="Title page of Azoth, 1659: a tree bearing the planetary stars between the sun and moon, two men below"
            href="/book/art-azoth-the-alchemical-mandala"
            width={548}
            height={850}
          >
            Title page of Basil Valentine’s <em>Azoth</em> (Paris, 1659): the tree carries the signs of the planets.
          </Plate>
        </Pair>

        <Section>Böhme’s trees, in the Embassy of the Free Mind</Section>

        <p className="text-secondary leading-relaxed mb-6">
          Jacob Böhme (1575–1624), a shoemaker of Görlitz, opened his first book, <em>Aurora</em> (1612), by
          likening the whole of philosophy and theology to a great tree. His followers drew the soul as a tree
          growing out of the dark world, through fire, into light. The pictures in this section all belong to the
          Bibliotheca Philosophica Hermetica, the library of the Embassy of the Free Mind in Amsterdam.
        </p>

        <Pair>
          <Plate
            src={`${IMG}/law-tree-of-the-soul.jpg`}
            alt="Hand-coloured engraving: a palm tree rising from a dark globe through the fire world and paradise to a triangle of light"
            href="/book/69c6f72ada9771c71631512e?page=655"
            width={622}
            height={1400}
          >
            “The Tree of the Soul,” rooted in the dark world and reaching the Light of Majesty.{' '}
            <em>The Works of Jacob Behmen</em> (London, 1764–81).
          </Plate>
          <Plate
            src={`${IMG}/bohme-russian-ms-paradise.jpg`}
            alt="Drawing: Adam and Eve on either side of a tree in a circle marked Paradise, the abyss below, an eye in a triangle above"
            href="/book/69b418ca2b0edf3eaa2dde61?page=4"
            width={1152}
            height={1400}
          >
            Adam and Eve at the tree, between Paradise (Рай) and the abyss, in an eighteenth-century Russian
            manuscript of Böhme’s figures.
          </Plate>
        </Pair>

        <p className="text-secondary leading-relaxed mb-6">
          One Böhmist figure of the tree of the knowledge of good and evil had a long life. A hand from a cloud holds
          a tree whose branches end in hands, with the sun among its leaves and its roots in three globes. It appears
          as the frontispiece of a pietist devotional book of 1700 and again, hand-coloured, in the{' '}
          <em>Geheime Figuren der Rosenkreuzer</em> printed at Altona in 1785–88.
        </p>

        <Pair>
          <Plate
            src={`${IMG}/arnold-1700-tree.jpg`}
            alt="Engraving: a tree held by a hand from a cloud, its branches ending in hands, the sun among its leaves, roots in three globes"
            href="/book/69c833fa6c6f3cc53c84e3bf"
            width={876}
            height={1400}
          >
            Frontispiece of <em>Der richtigste Weg durch Christum zu Gott</em> (1700).
          </Plate>
          <Plate
            src={`${IMG}/geheime-figuren-baum.jpg`}
            alt="Hand-coloured engraving of the same tree: fruiting branches, a radiant sun, roots in three coloured globes"
            href="/book/697c8e0fbaa544415f85b6c6?page=132"
            width={946}
            height={1400}
          >
            The tree of the knowledge of good and evil, <em>Geheime Figuren der Rosenkreuzer</em> (1785–88).
          </Plate>
        </Pair>

        <Plate
          src={`${IMG}/freher-una-vitis.jpg`}
          alt="Pen drawing in a circle: a vine heavy with grapes climbing a cross, with a Latin motto around the rim"
          href="/book/69b4194bddff1f043992a157?page=49"
          width={732}
          height={726}
        >
          “From this stock rises one vine: many branches, but the many are nothing without the one.” Dionysius
          Andreas Freher, emblem manuscript (c. 1720).
        </Plate>

        <Section>Trees of knowledge, logic and kinship</Section>

        <p className="text-secondary leading-relaxed mb-6">
          The tree also became a way to draw an argument. Porphyry’s <em>Isagoge</em> (third century) divides
          substance step by step, body, living thing, animal, rational animal, down to a single man. Medieval scribes
          drew the division as a tree, and the figure travelled wherever Aristotle’s logic was taught. An Arabic
          logic manuscript in the library runs it from substance (<em>al-jawhar</em>) through body, living thing and
          animal to man (<em>al-insān</em>), and at the root one man, Buṭrus: Peter.
        </p>

        <Pair>
          <Plate
            src={`${IMG}/arabic-porphyrian-tree.jpg`}
            alt="Red-ink tree of circles in Arabic, from substance at the top to the individual Butrus at the bottom"
            href="/book/69c1b8c68522835be844b1b3?page=112"
            width={611}
            height={1400}
          >
            The Porphyrian tree in Arabic, <em>Kitāb al-Manṭiq</em> (Arabic MS 829).
          </Plate>
          <Plate
            src={`${IMG}/porphyry-greek.jpg`}
            alt="Branching division diagrams in brown ink with Greek labels"
            href="/book/69b4c09f86a5921d5bc44c9f?page=13"
            width={1264}
            height={1400}
          >
            Division diagrams in a Greek manuscript of Porphyry and Ammonius on Aristotle’s <em>Categories</em>.
          </Plate>
        </Pair>

        <p className="text-secondary leading-relaxed mb-6">
          Ramon Llull’s <em>Arbor scientiae</em> (1295–96) arranges all knowledge as a forest of sixteen trees, from
          the elemental to the divine, each with roots, trunk, branches, leaves, flowers and fruit. Isidore of
          Seville’s <em>Etymologies</em> carries the <em>arbor consanguinitatis</em>, a tree for counting degrees of
          kinship, which canon lawyers later used to decide who might marry whom.
        </p>

        <Pair>
          <Plate
            src={`${IMG}/llull-arbor-scientiae.jpg`}
            alt="Woodcut of a tree with round fruit, a monk and Raymundus holding scrolls at its foot, Gloria and Poena at the top"
            href="/book/69522ff2ab34727b1f044362?page=13"
            width={1123}
            height={1400}
          >
            The opening woodcut of Llull’s <em>Arbor scientiae</em> (Lyon, 1515): Llull and a monk at the foot of the
            tree. See also its{' '}
            <Link href="/book/69522ff2ab34727b1f044362?page=137" className={captionLinkClass}>
              Moral Tree
            </Link>
            .
          </Plate>
          <Plate
            src={`${IMG}/isidore-consanguinity.jpg`}
            alt="Woodcut tree of consanguinity: labelled compartments for each degree of kinship, roots and banners below"
            href="/book/699065dc726f64800c10c3f8?page=108"
            width={941}
            height={1400}
          >
            The tree of consanguinity, Isidore of Seville, <em>Etymologiae</em> (1483).
          </Plate>
        </Pair>

        <p className="text-secondary leading-relaxed mb-6">
          The only illustration in Darwin’s <em>On the Origin of Species</em> is a branching diagram. In chapter four
          he wrote: “The affinities of all the beings of the same class have sometimes been represented by a great
          tree. I believe this simile largely speaks the truth.”
        </p>

        <Plate
          src={`${IMG}/darwin-diagram.jpg`}
          alt="Darwin’s diagram: lines branching upward from eleven species A to L through fourteen horizontal levels"
          href="/book/69e8b1842ff2a8dc09e76141?page=141"
          width={1400}
          height={949}
          wide
        >
          Charles Darwin, <em>On the Origin of Species</em> (1859), the diagram of divergence (contrast raised for
          legibility).
        </Plate>

        <Section>Living sacred trees</Section>

        <p className="text-secondary leading-relaxed mb-6">
          Some sacred trees are living trees. In India shrines are built under the banyan and the pipal, the
          aśvattha of the Gita. Bernard Picart’s plate of 1723 sets temples, offerings and ascetics beneath “le grand
          Arbre des Banians,” the first item in its key.
        </p>

        <Plate
          src={`${IMG}/picart-banyan.jpg`}
          alt="Engraving: a great banyan spreading over domed shrines, worshippers and ascetics in a forest clearing"
          href="/book/6a100a94f71729295097066f?page=18"
          width={1400}
          height={1013}
          wide
        >
          “Diverses pagodes et pénitences des faquirs,” under the great banyan. Bernard Picart,{' '}
          <em>Cérémonies et coutumes religieuses des peuples idolâtres</em> (1723).
        </Plate>

        <p className="text-secondary leading-relaxed mb-6">
          The gods’ paradise has its own tree, the wish-granting <em>kalpavṛkṣa</em> or <em>kalpataru</em>, which
          yields whatever is asked of it. On the temples of central Java it is carved again and again: a stylised
          tree under a parasol, birds in its crown, guarded by kinnaras, half-bird musicians of heaven.
        </p>

        <Plate
          src={`${IMG}/prambanan-kalpataru.jpg`}
          alt="Stone relief: a stylised tree under a parasol with birds above and two bird-bodied figures at its foot"
          href="https://commons.wikimedia.org/wiki/File:Candi_Prambanan_-_041_Kalpataru_and_Kinnara_(12041745124).jpg"
          width={1050}
          height={1400}
          source="Wikimedia Commons"
        >
          Kalpataru with kinnaras, Prambanan, ninth century. Photo: Photo Dharma, CC BY 2.0.
        </Plate>

        <p className="text-secondary leading-relaxed mb-6">
          The Buddha reached enlightenment under a pipal at Bodh Gaya, and the earliest Buddhist sculpture shows the
          tree, an empty seat or a pair of footprints in his place. In West Africa, R. E. Dennett photographed a tree
          planted over a grave, which then became sacred.
        </p>

        <Pair>
          <Plate
            src={`${IMG}/kanheri-bodhi.jpg`}
            alt="Engraving of a pillar capital: worshippers before the Bodhi tree and the Buddha’s footprints"
            href="/book/69907d035f855ec553e78b49?page=14"
            width={800}
            height={1400}
          >
            Worship of the Buddha’s footprints and the Bodhi tree, pillar capital from the Kanheri caves. Albert
            Grünwedel, <em>Buddhist Art in India</em> (1901).
          </Plate>
          <Plate
            src={`${IMG}/yoruba-grave-tree.jpg`}
            alt="Photograph: a young tree in a village compound, a figure and stones at its foot"
            href="/book/69907c5a5f855ec553e74a1c?page=59"
            width={1091}
            height={1400}
          >
            “Tree planted over grave which then becomes sacred.” R. E. Dennett, <em>Nigerian Studies</em> (1910).
          </Plate>
        </Pair>

        <Section>Trees the library does not yet show</Section>

        <p className="text-secondary leading-relaxed mb-6">
          A search of the library’s images, the Internet Archive and Wikimedia Commons on 16 October 2026 found no
          usable public-domain picture of these:
        </p>

        <ul className="list-disc pl-6 text-secondary leading-relaxed mb-8 space-y-2">
          <li>
            <strong>China:</strong> Jianmu, the tree by which the gods climb between heaven and earth. The illustrated{' '}
            <Link href="/book/69ea51b2e0662c881fb5c71d?page=129" className={linkClass}>
              <em>Shanhai jing</em>
            </Link>{' '}
            in the library draws the fish-bodied people who live west of it, but not the tree.
          </li>
          <li>
            <strong>Iran:</strong> Gaokerena, the white haoma tree of immortality growing in the cosmic sea.
          </li>
          <li>
            <strong>Islam:</strong> Ṭūbā named as such.
          </li>
          <li>
            <strong>The Baltic:</strong> the Latvian sun tree (<em>Austras koks</em>) of the folk songs.
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
