import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import PageFigure from '@/components/articles/PageFigure';
import SourceQuote from '@/components/articles/SourceQuote';
import TreeTimeline from './TreeTimeline';

// Pictures: crops in public/articles/trees-of-life/ cut from the library's page scans, museum
// open-access prints mirrored as library artworks, and a few photographs and paintings from
// Wikimedia Commons and the Internet Archive, each with its licence in the credit line
// (licences checked on Commons and on the artwork records, 2026-10-18).
// The two quotations from library books were checked against the page scans they link to.

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

const p = 'text-secondary leading-relaxed mb-6';

// Tall pictures are held to a reading width; low-resolution ones stay near their natural size.
function Fig({ size = 'md', ...props }: React.ComponentProps<typeof PageFigure> & { size?: 'xs' | 'md' | 'lg' | 'full' }) {
  const width = { xs: 'max-w-xs', md: 'max-w-md', lg: 'max-w-lg', full: '' }[size];
  return (
    <div className={`mx-auto w-full ${width}`}>
      <PageFigure {...props} />
    </div>
  );
}

function Pair({ children }: { children: React.ReactNode }) {
  return <div className="grid sm:grid-cols-2 gap-x-6 items-start">{children}</div>;
}

function Section({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-2xl md:text-3xl text-primary mt-16 mb-6 scroll-mt-24">
      {children}
    </h2>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

const COMMONS = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;

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

        <TreeTimeline />

        <Section id="kabbalah">Kabbalah: the ten sefirot</Section>

        <p className={p}>
          In Kabbalah the Tree of Life (<em>Etz Chaim</em>) is a figure of ten <em>sefirot</em>, the attributes
          through which the infinite (<em>Ein Sof</em>) becomes knowable, joined by twenty-two paths, one for each
          letter of the Hebrew alphabet. Christian Hebraists of the sixteenth and seventeenth centuries printed it
          again and again, usually with Hebrew and Latin labels side by side.
        </p>

        <Fig
          src="https://images.sourcelibrary.org/artwork/art-kircher-tree-of-life.jpg"
          alt="Kircher’s Systema Sephiroticum: ten circles of divine names, with the tablets of the Law, a menorah and an altar between them"
          href="/artwork/kircher-tree-of-life"
          source={<>Athanasius Kircher, <em>Systema Sephiroticum</em>, from <em>Oedipus Aegyptiacus</em> (1652–54)</>}
          credit={<>Wikimedia Commons, public domain.</>}
        >
          Each sefirah is a wheel of divine names; the side panels count the 613 commandments.
        </Fig>

        <Pair>
          <PageFigure
            src={`${IMG}/evoli-sefirot.jpg`}
            alt="Woodcut tree of the ten sefirot with planetary signs, Venice 1573"
            href="/book/de-divinis-attributis-quae-sephirot-ab-hebraeis-nuncupata-aevolus?page=91"
            source={<>Cesare Evoli, <em>De divinis attributis, quae Sephirot ab Hebraeis nuncupata</em> (Venice, 1573)</>}
          >
            The ten sefirot with a planetary sign in each.
          </PageFigure>
          <PageFigure
            src={`${IMG}/hackspan-arbor-cabbalistica.jpg`}
            alt="Arbor Cabbalistica: the ten sefirot labelled in Hebrew"
            href="/book/two-books-of-sacred-miscellanies-hackspan?page=504"
            source={<>Theodor Hackspan’s treatise on the Jewish Kabbalah (Altdorf, 1660)</>}
          >
            <em>Arbor Cabbalistica</em>, labelled only in Hebrew.
          </PageFigure>
        </Pair>

        <p className="text-secondary leading-relaxed mb-8">
          Older still is the hand-drawn tree in a fifteenth-century copy of Isaac of Acre’s{' '}
          <Link href="/book/me-irat-enayim-isaac-ben-samuel?page=5">
            <em>Me’irat Einayim</em>
          </Link>
          , and the library holds the Latin compendium that carried these figures into Christian Europe, Knorr von
          Rosenroth’s{' '}
          <Link href="/book/kabbala-denudata-seu-doctrina-hebraeorum-transcendentalis-knorr-von-rosenroth-2?page=1064">
            <em>Kabbala denudata</em>
          </Link>{' '}
          (1677).
        </p>

        <Section id="inverted-tree">The inverted tree</Section>

        <p className={p}>
          Robert Fludd drew the same ten sefirot as a tree growing downwards: the root is the crown, Keter, set in
          light, and the branches reach down through the orders of angels to the world. The image at the head of this
          note is his. The idea is older than Fludd and is not only Jewish. The Katha Upanishad and the Bhagavad Gita
          (15.1) describe an eternal <em>aśvattha</em>, a sacred fig, “with roots above and branches below,” whose
          leaves are the Vedic hymns.
        </p>

        <Fig
          src="https://images.sourcelibrary.org/artwork/art-tree-of-life-fludd-1.jpg"
          alt="Fludd’s inverted tree: the Tetragrammaton along the trunk, the sefirot as branches, the angelic orders as roots"
          href="/artwork/tree-of-life-fludd-1"
          source={<>Robert Fludd, <em>Utriusque Cosmi Historia</em> (1621)</>}
          credit={<>Wikimedia Commons, public domain.</>}
        >
          The four letters of the divine name run down the trunk.
        </Fig>

        <Section id="norse">Norse: Yggdrasil</Section>

        <p className={p}>
          In the Eddas, Yggdrasil is an ash that holds the worlds together. An eagle sits in its crown, the serpent
          Níðhöggr gnaws one of its three roots, a squirrel runs messages between them, and the Norns water it from
          the well of Urðr. In the <em>Hávamál</em> Odin says he hung on “the windy tree” for nine nights, wounded with
          a spear, and took up the runes.
        </p>

        <Pair>
          <PageFigure
            src={`${IMG}/bray-odin.jpg`}
            alt="Odin among the branches of a tree, holding a spear, beneath the heading The Sayings of the High One"
            href="/book/the-elder-or-poetic-edda-bray?page=149"
            source={<>Olive Bray, <em>The Elder or Poetic Edda</em> (1908)</>}
          >
            Odin on the tree, heading the <em>Hávamál</em>.
          </PageFigure>
          <PageFigure
            src={`${IMG}/hall-yggdrasil.jpg`}
            alt="Painted plate of Yggdrasil: deer in the crown, Midgard in the middle, a red serpent around the trunk, roots in darkness"
            href="/book/an-encyclopedic-outline-of-masonic-hermetic-cabbalistic-and-hall?page=147"
            source={<>Manly P. Hall, <em>The Secret Teachings of All Ages</em> (1928)</>}
          >
            “The Yggdrasil Tree,” colour plate.
          </PageFigure>
        </Pair>

        <Section id="siberia">Siberia: the shaman’s tree</Section>

        <p className={p}>
          Among the peoples of Siberia the world tree was something a shaman climbed. The Finnish scholar Uno
          Holmberg, writing in 1927, gathered the evidence: the Yakuts set up rows of trees for the storeys of
          heaven, one for each level the shaman passes, and the Dolgans raised a pole with crosspieces topped by a
          two-headed bird, the Lord of the Birds, at the summit of the world.
        </p>

        <Pair>
          <PageFigure
            src={`${IMG}/holmberg-yakut-trees.jpg`}
            alt="Engraving of a row of young trees joined by a cord hung with rags on open grassland"
            credit={
              <>
                <Ext href="https://archive.org/details/finnougricsiberi0000unoh/page/n608/mode/1up">Internet Archive</Ext>
                ; public domain (published 1927).
              </>
            }
          >
            “Yakut trees representing the storeys of heaven.” Uno Holmberg, <em>Finno-Ugric, Siberian</em>,{' '}
            <em>The Mythology of All Races</em> vol. IV (1927), plate XLVI.
          </PageFigure>
          <PageFigure
            src={`${IMG}/holmberg-dolgan-world-tree.jpg`}
            alt="Line drawing: carved wooden animals and fish beside a tall pole with crosspieces and a bird at the top"
            credit={
              <>
                <Ext href="https://archive.org/details/finnougricsiberi0000unoh/page/n776/mode/1up">Internet Archive</Ext>
                ; public domain (published 1927).
              </>
            }
          >
            “Dolgan shaman-attributes and the world-tree with the two-headed Lord of the Birds,” Holmberg (1927), fig.
            20.
          </PageFigure>
        </Pair>

        <Section id="prussia">Prussia: the oak at Romowe</Section>

        <p className={p}>
          The pagan Prussians and Lithuanians kept sacred groves into the thirteenth and fourteenth centuries. Early modern historians
          described their chief sanctuary, Romowe, as an evergreen oak holding the images of three gods, with a fire
          kept burning before it. Christoph Hartknoch engraved the scene in 1684. His source was the
          sixteenth-century chronicler Simon Grunau, whose account historians treat as largely invented, so the
          picture records what Prussian scholars believed rather than what the sanctuary looked like.
        </p>

        <PageFigure
          src={`${IMG}/hartknoch-romowe.jpg`}
          alt="Engraving of a great oak behind a wooden screen with three idols in niches, a fire burning before it, a village around"
          href="/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch?page=87"
          source={<>Christoph Hartknoch, <em>Alt und Neues Preussen</em> (1684)</>}
        >
          The oak of Romowe with its three idols.
        </PageFigure>

        <p className="text-secondary leading-relaxed mb-8">
          The picture travelled. A German translation of the Edda printed in 1777, now in the Bibliotheca
          Philosophica Hermetica in Amsterdam, reprints the oak of Romowe among its plates of northern religion:{' '}
          <Link href="/book/die-islandische-edda">
            <em>Die isländische Edda</em>
          </Link>
          .
        </p>

        <Section id="assyria">Assyria: the sacred tree</Section>

        <p className={p}>
          A stylised palm flanked by winged figures or rearing animals is among the commonest motifs in the reliefs of
          the Assyrian palaces. What it meant is still argued: the king, the god Ashur, or the order of the world.
          Austen Henry Layard, who excavated Nimrud, described it in{' '}
          <Link href="/book/nineveh-and-its-remains-layard?page=328">
            <em>Nineveh and Its Remains</em>
          </Link>{' '}
          (1849):
        </p>

        <SourceQuote
          book="69b632c766ab51b501d93dfd"
          page={328}
          printedPage={296}
          src="https://images.sourcelibrary.org/archived/69b632c766ab51b501d93dfd/328.jpg"
          pageAlt="Page 296 of Layard’s Nineveh and Its Remains: an engraved border of two ibexes kneeling before a palmette, above the text on the sacred tree"
          source={<>Austen Henry Layard, <em>Nineveh and Its Remains</em> (1849)</>}
        >
          This tree, evidently a sacred symbol, is elaborately and tastefully formed; and is one of the most
          conspicuous ornaments of Assyrian sculpture.
        </SourceQuote>

        <Pair>
          <PageFigure
            src={`${IMG}/layard-sacred-tree.jpg`}
            alt="Line drawing of the Assyrian sacred tree: a trunk bound with bands, palmettes on every branch"
            href="/book/nineveh-and-its-remains-layard?page=329"
            source={<>Layard, <em>Nineveh and Its Remains</em> (1849), p. 297</>}
          >
            The sacred tree, North-West Palace, Nimrud.
          </PageFigure>
          <PageFigure
            src={`${IMG}/layard-ibexes.jpg`}
            alt="Two ibexes kneeling on either side of a stylised sacred tree"
            href="/book/nineveh-and-its-remains-layard?page=328"
            source={<>Layard (1849), p. 296</>}
          >
            Ibexes flanking the tree, from the same palace. See also J. G. R. Forlong’s{' '}
            <Link href="/book/rivers-of-life-or-sources-and-streams-of-the-faiths-of-man-forlong?page=403">
              <em>Rivers of Life</em>
            </Link>{' '}
            (1883).
          </PageFigure>
        </Pair>

        <Section id="egypt">Egypt: the goddess in the sycamore</Section>

        <p className={p}>
          In the Egyptian Book of the Dead a goddess, Nut or Hathor, stands in a sycamore fig and gives the dead
          water and bread, so that they need not go thirsty in the next world. The Papyrus of Ani, written around
          1250 BCE, paints her among the fruit, pouring water for Ani as he kneels below.
        </p>

        <Fig
          size="xs"
          src={`${IMG}/ani-sycamore.jpg`}
          alt="Egyptian painting: a goddess standing in a sycamore heavy with red fruit pours water for a kneeling man"
          href="/book/the-papyrus-of-ani-egyptian-book-of-the-dead-facsimile-budge?page=386"
          source={<>E. A. Wallis Budge’s facsimile, <em>The Book of the Dead</em> (1895)</>}
        >
          The goddess in the sycamore, Papyrus of Ani.
        </Fig>

        <p className={p}>
          A second Egyptian tree recorded time. On the <em>ished</em> or persea tree of Heliopolis, Thoth and the
          goddess of writing, Seshat, wrote the king’s name on the leaves and fruit, one for each year of his reign.
          The Ramesseum at Thebes shows Ramesses II seated before the tree while Atum, Seshat and Thoth write. John
          Gardner Wilkinson drew the relief in 1841.
        </p>

        <PageFigure
          src={`${IMG}/wilkinson-persea-54a.jpg`}
          alt="Line drawing of an Egyptian relief: a seated king before a leafy tree, a goddess and ibis-headed Thoth writing on its fruit"
          credit={
            <>
              <Ext href="https://archive.org/details/secondseriesofma03wilk/page/n107/mode/1up">Internet Archive</Ext>;
              public domain.
            </>
          }
        >
          “Atmoo, Thoth, and the goddess of letters writing the name of Remeses on the fruit of the persea,”
          Memnonium, Thebes. Wilkinson, <em>A Second Series of the Manners and Customs of the Ancient Egyptians</em>{' '}
          (1841), plate 54a.
        </PageFigure>

        <Section id="china">China: the sun tree and the money tree</Section>

        <p className={p}>
          Chinese myth places Fusang, a giant mulberry, at the eastern edge of the world. Ten suns rested in it,
          and one at a time rode out across the sky. The bronze trees buried at Sanxingdui in Sichuan around 1200
          BCE, with birds perched on their branches, have been read as this sun tree. Over a thousand years later,
          tombs in the same province held bronze “money trees” hung with coins and immortals, set on ceramic bases
          shaped like mountains.
        </p>

        <Pair>
          <PageFigure
            src={`${IMG}/sanxingdui-tree.jpg`}
            alt="Tall bronze tree in a museum case, branches ending in fruit and perched birds"
            credit={
              <>
                Photo: Gary Todd, CC0, via <Ext href={COMMONS('Bronze_Tree,_Sanxingdui_1a.jpg')}>Wikimedia Commons</Ext>.
              </>
            }
          >
            Bronze tree from Sanxingdui, c. 1200 BCE, Sanxingdui Museum.
          </PageFigure>
          <PageFigure
            src={`${IMG}/han-money-tree.jpg`}
            alt="Bronze tree with openwork branches of coins and figures on a pale ceramic mountain base"
            credit={
              <>
                Photo: Gary Todd, CC0, via{' '}
                <Ext href={COMMONS('Eastern_Han_Bronze_Money_Tree,_Sichuan_1a.jpg')}>Wikimedia Commons</Ext>.
              </>
            }
          >
            Money tree, Eastern Han dynasty (25–220 CE), Sichuan. Tokyo National Museum.
          </PageFigure>
        </Pair>

        <p className={p}>
          Han dynasty painters drew Fusang itself. On the silk banner laid over the coffin of the Lady of Dai at
          Mawangdui (before 168 BCE), the sun with its crow sits at the top right, and smaller red suns hang among
          the twisting branches below it. On the Wu Liang shrines in Shandong (mid-second century CE) the archer Yi
          aims at the sun-crows perched in the tree; in the myth he shot down nine of the ten suns when they all rose
          at once.
        </p>

        <PageFigure
          src={`${IMG}/mawangdui-fusang.jpg`}
          alt="Painted silk: a crescent moon at left, a red sun with a black crow at right, red suns among dark branches below"
          credit={
            <>
              Public domain, via{' '}
              <Ext href={COMMONS('T-shaped_Painting_on_Silk_-_Google_Art_Project.jpg')}>Wikimedia Commons</Ext> (Google
              Art Project).
            </>
          }
        >
          The heavens of the Mawangdui banner, with the sun-crow and the suns of Fusang at right. Tomb 1, Mawangdui,
          Western Han. Hunan Museum (detail).
        </PageFigure>

        <Fig
          size="xs"
          src={`${IMG}/wuliang-fusang.jpg`}
          alt="Stone rubbing: a tree with interlaced branches full of birds, an archer and a chariot below"
          credit={
            <>
              Rubbing published by Édouard Chavannes, <em>Mission archéologique dans la Chine septentrionale</em> (1909),
              plate LI. Public domain, via{' '}
              <Ext href={COMMONS('Wu_liang_shrine_relief_depicting_xihe,_yi,_and_fusang_tree.jpg')}>Wikimedia Commons</Ext>.
            </>
          }
        >
          The Fusang tree with Yi the archer and Xihe readying the sun chariot. Rubbing from the Wu Liang shrines (mid-2nd
          century CE).
        </Fig>

        <Section id="mesoamerica">Mesoamerica: trees in the Codex Laud</Section>

        <p className={p}>
          Across Mesoamerica a tree stood at the centre of the world and one at each of the four directions, holding up
          the sky. For the Maya the central tree was the ceiba. The{' '}
          <Link href="/book/codex-laud-260-day-tonalpohualli-cycle-with-ritual-mesoamerican?page=25">Codex Laud</Link>, a pre-conquest divinatory screenfold
          now in the Bodleian Library, sets a deity before a tree above a row of day signs from the 260-day count.
          Which of these trees are direction trees is a question for the codex’s commentators; the scene of a seated
          deity before a tree recurs across the codices of the Borgia group.
        </p>

        <Pair>
          <PageFigure
            src={`${IMG}/codex-laud-25.jpg`}
            alt="A deity seated before a blue tree with flowering branches, day signs below"
            href="/book/codex-laud-260-day-tonalpohualli-cycle-with-ritual-mesoamerican?page=25"
            source={<em>Codex Laud</em>}
          >
            A deity before a flowering tree.
          </PageFigure>
          <PageFigure
            src={`${IMG}/codex-laud-24.jpg`}
            alt="A deity enthroned before a brown tree, with a parrot and day signs below"
            href="/book/codex-laud-260-day-tonalpohualli-cycle-with-ritual-mesoamerican?page=24"
            source={<em>Codex Laud</em>}
          >
            A deity enthroned before a tree, with a parrot.
          </PageFigure>
        </Pair>

        <Section id="eden">Eden, the Cross and the Tree of Jesse</Section>

        <p className={p}>
          Genesis puts two trees in the garden, the tree of life and the tree of the knowledge of good and evil.
          Medieval artists often gave the serpent a woman’s face. Legend held that the wood of the Cross came from the
          tree of life, and Revelation 22 returns it to the end of the Bible, beside the river of the heavenly city.
        </p>

        <Pair>
          <PageFigure
            src={`${IMG}/speculum-fall.jpg`}
            alt="Woodcut: Adam and Eve holding fruit on either side of a tree whose trunk is a serpent with a woman’s head"
            href="/book/speculum-humanae-salvationis-german-spiegel-menschlicher-beh?page=9"
            source={<><em>Spiegel menschlicher Behaltnuss</em> (1476)</>}
          >
            The Fall, with a woman-headed serpent for a trunk.
          </PageFigure>
          <PageFigure
            src={`${IMG}/saenredam-adam-eve.jpg`}
            alt="Engraving: Adam and Eve standing beside the tree of knowledge, Eve pointing upward"
            href="/artwork/saenredam-adam-and-eve-before-the-tree-of-knowledge"
            source={<>Jan Saenredam after Abraham Bloemaert, <em>Adam and Eve before the Tree of Knowledge</em>, engraving</>}
            credit={<>National Gallery of Art, Washington, CC0.</>}
          />
        </Pair>

        <p className={p}>
          The Tree of Jesse makes a family tree out of Isaiah 11:1, “a rod out of the stem of Jesse”: a vine rises
          from the sleeping Jesse through the kings of Israel to the Virgin and Child. The religious orders borrowed
          the form to draw their own descent from a founder.
        </p>

        <PageFigure
          src="https://images.sourcelibrary.org/artwork/nga-israhel-van-meckenem-ornament-with-the-tree-of-jesse.jpg"
          alt="Engraving of the Tree of Jesse: Jesse asleep below, crowned kings in the scrolling vine, the Virgin and Child at the top"
          href="/artwork/nga-israhel-van-meckenem-ornament-with-the-tree-of-jesse"
          source={<>Israhel van Meckenem, <em>Ornament with the Tree of Jesse</em>, engraving, late fifteenth century</>}
          credit={<>National Gallery of Art, Washington, CC0.</>}
        >
          David plays the harp at the centre.
        </PageFigure>

        <Pair>
          <PageFigure
            src={`${IMG}/speculum-jesse-coloured.jpg`}
            alt="Hand-coloured woodcut: Jesse asleep, a flowering stem with birds rising from him"
            href="/book/speculum-humanae-salvationis-cum-speculo-s-mariae-virginis-l?page=54"
            source={<><em>Speculum humanae salvationis</em> (Augsburg, 1473)</>}
          >
            The rod of Jesse, hand-coloured woodcut.
          </PageFigure>
          <PageFigure
            src={`${IMG}/callot-st-francis.jpg`}
            alt="Etching: a great tree spreading over a crowd of friars, the Trinity in the clouds above"
            href="/artwork/callot-de-boom-van-de-heilige-franciscus"
            source={<>Jacques Callot, <em>The Tree of Saint Francis</em> (1621)</>}
            credit={<>Rijksmuseum, Amsterdam, CC0.</>}
          >
            The Franciscan order as a tree.
          </PageFigure>
        </Pair>

        <p className="text-secondary leading-relaxed mb-8">
          See also the river and tree of life in a{' '}
          <Link href="/book/history-of-the-old-and-new-testaments?page=633">
            1702 history of the Old and New Testaments
          </Link>
          , and the woodcut of Christ on the tree of life that Jung reproduced in{' '}
          <Link href="/book/wandlungen-und-symbole-der-libido-jung?page=244">
            <em>Psychology of the Unconscious</em>
          </Link>
          .
        </p>

        <Section id="islam">Islam: the Waqwaq tree</Section>

        <p className={p}>
          Arabic and Persian geographers placed the island of Waqwaq at the eastern edge of the world. On it grew a
          tree whose fruit were human figures, said to call out “waq waq” before they fell. The{' '}
          <Link href="/book/book-of-wonders-al-isfahani?page=88">
            <em>Kitāb al-Bulhān</em>
          </Link>
          , a book of divination and wonders compiled in Baghdad around 1400, paints the tree hung with its human
          fruit, and a copy of Zakariyā al-Qazwīnī’s cosmography,{' '}
          <Link href="/book/aja-ib-al-makhluqat-ms-nn-3-74-al-qazwini?page=111">
            <em>The Wonders of Creation</em>
          </Link>
          , paints it twice.
        </p>

        <Fig
          size="lg"
          src={`${IMG}/kitab-al-bulhan-waqwaq.jpg`}
          alt="Manuscript painting of a tree whose fruit are small human figures"
          href="/book/book-of-wonders-al-isfahani?page=88"
          source={<><em>Kitāb al-Bulhān</em>, Bodleian Library MS. Bodl. Or. 133 (c. 1400)</>}
        >
          The Waqwaq tree.
        </Fig>

        <Pair>
          <PageFigure
            src={`${IMG}/qazwini-waqwaq-1.jpg`}
            alt="Persian painting: a red-trunked tree on a rocky island, small human figures in its branches, animals below"
            href="/book/aja-ib-al-makhluqat-ms-nn-3-74-al-qazwini?page=111"
            source={<>al-Qazwīnī, <em>ʿAjāʾib al-makhlūqāt</em>, Cambridge University Library MS Nn.3.74</>}
          >
            The Waqwaq tree.
          </PageFigure>
          <PageFigure
            src={`${IMG}/qazwini-waqwaq-2.jpg`}
            alt="Persian painting: a tree whose branches bear human figures, rocks around its foot"
            href="/book/aja-ib-al-makhluqat-ms-nn-3-74-al-qazwini?page=114"
            source={<>al-Qazwīnī, <em>ʿAjāʾib al-makhlūqāt</em></>}
          >
            A second Waqwaq tree from the same manuscript.
          </PageFigure>
        </Pair>

        <p className={p}>
          The Qur’an (53:14) names a tree at the edge of the seventh heaven, the lote tree of the boundary
          (<em>Sidrat al-Muntahā</em>), which the Prophet passed on the night of his ascension. The books that
          illustrate the ascension (<em>Miʿrājnāma</em>) paint it. In this fourteenth-century page the tree is
          the great gold trunk on the right.
        </p>

        <PageFigure
          src={`${IMG}/lote-tree-bilal.jpg`}
          alt="Worn Persian painting: figures in a pavilion of paradise, a gold tree trunk filling the right side"
          credit={
            <>
              Public domain, via <Ext href={COMMONS('Bilal_before_the_Lote_Tree_of_the_Limit.jpg')}>Wikimedia Commons</Ext>.
            </>
          }
        >
          Bilal before the lote tree, <em>Miʿrājnāma</em>, c. 1317–35. Topkapı Palace Library, H. 2154, fol. 61r
          (detail).
        </PageFigure>

        <p className={p}>
          Paradise has its own tree in the hadith, Ṭūbā, so large that a rider could travel in its shade for a hundred
          years. The Timurid <em>Miʿrājnāma</em> made at Herat in 1436 paints the Prophet’s visit to the gardens of
          paradise, where houris on camels greet each other among flowering trees. The painting does not label any of
          them as Ṭūbā.
        </p>

        <Fig
          src={`${IMG}/miraj-paradise.jpg`}
          alt="Persian painting: Gabriel and the Prophet above a turquoise garden of flowering trees, women on camels below"
          credit={
            <>
              Public domain, via <Ext href={COMMONS('Mohammed_visiting_Paradise.jpg')}>Wikimedia Commons</Ext>.
            </>
          }
        >
          The Prophet visits paradise. <em>Miʿrājnāma</em>, Herat, 1436. Bibliothèque nationale de France, Suppl.
          turc 190.
        </Fig>

        <Section id="java">Java: the kayon</Section>

        <p className={p}>
          In the Javanese shadow play (<em>wayang kulit</em>) the first and last figure on the screen is not a
          character but a tree. The <em>kayon</em> or <em>gunungan</em> (“mountain”), a leaf-shaped puppet carved with
          a tree, animals and often a gateway, is planted in the centre before the play begins, waved to mark a change
          of scene, and planted again at the end. It stands for the world in which the story takes place.
        </p>

        <Fig
          src={`${IMG}/kayon.jpg`}
          alt="Leaf-shaped shadow puppet: a tree trunk rising above a gated house with steps"
          href="/book/kilatbuwana-a-javanese-wayang-kulit-performance-rachmadi?page=154"
          source={<><em>Kilatbuwana</em>, the text of a Javanese wayang kulit performance (1984)</>}
        >
          A <em>kayon</em>.
        </Fig>

        <Section id="tibet">Tibet: the refuge tree</Section>

        <p className={p}>
          Tibetan Buddhist schools paint their whole lineage as a tree. A single trunk rises from a lake; on its
          branches sit the teachers of the lineage, the buddhas, the meditational deities, the protectors and the
          scriptures. Practitioners visualise this assembly when they recite the refuge prayer at the start of
          practice.
        </p>

        <Fig
          src={`${IMG}/kagyu-refuge-tree.jpg`}
          alt="Thangka: a tree rising from a lake, its branches crowded with seated teachers and deities"
          href="/artwork/kagyurefugetree"
          source={<>Refuge tree of the Kagyu lineage, Tibetan thangka</>}
          credit={
            <>
              Barry Stott, CC BY-SA 3.0, via <Ext href={COMMONS('KagyuRefugeTree.jpg')}>Wikimedia Commons</Ext>.
            </>
          }
        />

        <Section id="alchemy">Alchemy: the philosophical tree</Section>

        <p className={p}>
          Alchemists described the growth of metals as the growth of a tree, the <em>arbor philosophica</em>. One
          picture shows how the images travelled. The{' '}
          <Link href="/book/alchemica-german-ms-1-anonymous?page=10">
            <em>Buch der heiligen Dreifaltigkeit</em>
          </Link>
          , a German manuscript of the early fifteenth century, paints a crowned woman with a fruiting tree growing
          from her head between the Sun and Moon. The printed{' '}
          <Link href="/book/pandora-das-ist-die-edlest-gab-gottes-oder-der-werde-und-reusner-3?page=246">
            <em>Pandora</em>
          </Link>{' '}
          of 1588 cut the same composition in wood.
        </p>

        <Pair>
          <PageFigure
            src={`${IMG}/dreifaltigkeit-tree.jpg`}
            alt="Manuscript painting: a crowned woman with a red-fruited tree growing from her head, Sun and Moon beside her, furnaces below"
            href="/book/alchemica-german-ms-1-anonymous?page=10"
            source={<><em>Buch der heiligen Dreifaltigkeit</em>, John Rylands Library, German MS 1 (fifteenth century)</>}
          />
          <PageFigure
            src={`${IMG}/pandora-246.jpg`}
            alt="Woodcut of the same composition: a crowned woman on the furnaces beneath a fruiting tree with an eagle"
            href="/book/pandora-das-ist-die-edlest-gab-gottes-oder-der-werde-und-reusner-3?page=246"
            source={<>Hieronymus Reusner, <em>Pandora</em> (Basel, 1588)</>}
          >
            The same image cut in wood.
          </PageFigure>
        </Pair>

        <p className={p}>
          <em>Pandora</em> also sets a tree of the Sun and a tree of the Moon, gold and silver, on either side of the
          Rebis, the two-headed figure of the united opposites; their blossoms are suns and moons with faces. A
          German compilation of 1667, the{' '}
          <Link href="/book/triple-hermetic-cloverleaf-nuysement?page=313">
            <em>Dreyfaches hermetisches Kleeblat</em>
          </Link>
          , turned the tree into a chart: each band on the trunk is a named operation of the work, from putrefaction to
          the Stone.
        </p>

        <Pair>
          <PageFigure
            src={`${IMG}/pandora-260.jpg`}
            alt="Woodcut: a winged two-headed figure on a dragon between a tree of suns and a tree of moons"
            href="/book/pandora-das-ist-die-edlest-gab-gottes-oder-der-werde-und-reusner-3?page=260"
            source={<><em>Pandora</em> (1588)</>}
          >
            The Rebis between the trees of the Sun and Moon.
          </PageFigure>
          <PageFigure
            src={`${IMG}/nuysement-313.jpg`}
            alt="Engraving of a tree whose trunk carries labelled bands for each alchemical operation, the Stone in a circle at the top"
            href="/book/triple-hermetic-cloverleaf-nuysement?page=313"
            source={<><em>Dreyfaches hermetisches Kleeblat</em> (Nuremberg, 1667)</>}
          >
            A branch of the philosophical tree.
          </PageFigure>
        </Pair>

        <Pair>
          <PageFigure
            src={`${IMG}/aureum-vellus.jpg`}
            alt="Hand-coloured woodcut: a tree growing from the neck of a glass flask, figures bathing inside it, the Sun beside"
            href="/book/aureum-vellus-oder-guldin-schatz-und-kunstkammer-darinnen-trismosin?page=1067"
            source={<>Salomon Trismosin, <em>Aureum vellus</em> (Rorschach, 1598)</>}
          >
            A tree growing out of the flask.
          </PageFigure>
          <PageFigure
            src="https://images.sourcelibrary.org/artwork/art-azoth-the-alchemical-mandala.jpg"
            alt="Title page of Azoth, 1659: a tree bearing the planetary stars between the sun and moon, two men below"
            href="/artwork/art-azoth-the-alchemical-mandala"
            source={<>Title page of Basil Valentine’s <em>Azoth</em> (Paris, 1659)</>}
            credit={<>Wikimedia Commons, public domain.</>}
          >
            The tree carries the signs of the planets.
          </PageFigure>
        </Pair>

        <Section id="bohme">Böhme’s trees, in the Embassy of the Free Mind</Section>

        <p className={p}>
          Jacob Böhme (1575–1624), a shoemaker of Görlitz, opened his first book, <em>Aurora</em> (1612), by
          likening the whole of philosophy and theology to a great tree. His followers drew the soul as a tree
          growing out of the dark world, through fire, into light. The pictures in this section all belong to the
          Bibliotheca Philosophica Hermetica, the library of the Embassy of the Free Mind in Amsterdam.
        </p>

        <Pair>
          <PageFigure
            src={`${IMG}/law-tree-of-the-soul.jpg`}
            alt="Hand-coloured engraving: a palm tree rising from a dark globe through the fire world and paradise to a triangle of light"
            href="/book/the-works-of-jacob-behmen-with-figures-by-william-law-bohme?page=655"
            source={<><em>The Works of Jacob Behmen</em> (London, 1764–81)</>}
          >
            “The Tree of the Soul,” rooted in the dark world and reaching the Light of Majesty.
          </PageFigure>
          <PageFigure
            src={`${IMG}/bohme-russian-ms-paradise.jpg`}
            alt="Drawing: Adam and Eve on either side of a tree in a circle marked Paradise, the abyss below, an eye in a triangle above"
            href="/book/bohme-macrocosm-microcosm-18th-century-ms-bohme?page=4"
            source="An eighteenth-century Russian manuscript of Böhme’s figures"
          >
            Adam and Eve at the tree, between Paradise (Рай) and the abyss.
          </PageFigure>
        </Pair>

        <p className={p}>
          One Böhmist figure of the tree of the knowledge of good and evil had a long life. A hand from a cloud holds
          a tree whose branches end in hands, with the sun among its leaves and its roots in three globes. It appears
          as the frontispiece of a{' '}
          <Link href="/book/der-richtigste-weg-durch-christum-zu-gott-arnold?page=134">pietist devotional book of 1700</Link> and again,
          hand-coloured, in the{' '}
          <Link href="/book/the-secret-symbols-of-the-rosicrucians?page=132">
            <em>Geheime Figuren der Rosenkreuzer</em>
          </Link>{' '}
          printed at Altona in 1785–88.
        </p>

        <Pair>
          <PageFigure
            src={`${IMG}/arnold-1700-tree.jpg`}
            alt="Engraving: a tree held by a hand from a cloud, its branches ending in hands, the sun among its leaves, roots in three globes"
            href="/book/der-richtigste-weg-durch-christum-zu-gott-arnold?page=134"
            source={<>Gottfried Arnold, <em>Der richtigste Weg durch Christum zu Gott</em> (Frankfurt, 1700)</>}
          >
            The frontispiece.
          </PageFigure>
          <PageFigure
            src={`${IMG}/geheime-figuren-baum.jpg`}
            alt="Hand-coloured engraving of the same tree: fruiting branches, a radiant sun, roots in three coloured globes"
            href="/book/the-secret-symbols-of-the-rosicrucians?page=132"
            source={<><em>Geheime Figuren der Rosenkreuzer</em> (1785–88)</>}
          >
            The tree of the knowledge of good and evil.
          </PageFigure>
        </Pair>

        <Fig
          src={`${IMG}/freher-una-vitis.jpg`}
          alt="Pen drawing in a circle: a vine heavy with grapes climbing a cross, with a Latin motto around the rim"
          href="/book/freher-paradoxes-emblems-enigmas-18th-century-ms-freher?page=49"
          source="Dionysius Andreas Freher, emblem manuscript (c. 1720)"
        >
          “From this stock rises one vine: many branches, but the many are nothing without the one.”
        </Fig>

        <Section id="knowledge">Trees of knowledge, logic and kinship</Section>

        <p className={p}>
          The tree also became a way to draw an argument. Porphyry’s <em>Isagoge</em> (third century) divides
          substance step by step, body, living thing, animal, rational animal, down to a single man. Medieval scribes
          drew the division as a tree, and the figure travelled wherever Aristotle’s logic was taught. An{' '}
          <Link href="/book/kitab-al-mantiq-butrus-bin-butrus?page=112">Arabic logic manuscript</Link> in the library runs it
          from substance (<em>al-jawhar</em>) through body, living thing and animal to man (<em>al-insān</em>), and at
          the root one man, Buṭrus: Peter.
        </p>

        <Pair>
          <PageFigure
            src={`${IMG}/arabic-porphyrian-tree.jpg`}
            alt="Red-ink tree of circles in Arabic, from substance at the top to the individual Butrus at the bottom"
            href="/book/kitab-al-mantiq-butrus-bin-butrus?page=112"
            source={<><em>Kitāb al-Manṭiq</em> (Arabic MS 829)</>}
          >
            The Porphyrian tree in Arabic.
          </PageFigure>
          <PageFigure
            src={`${IMG}/porphyry-greek.jpg`}
            alt="Branching division diagrams in brown ink with Greek labels"
            href="/book/porphyry-ammonius-commentary-on-aristotle-s-categories-ammonius?page=13"
            source={<>A Greek manuscript of Porphyry and Ammonius on Aristotle’s <em>Categories</em></>}
          >
            Division diagrams.
          </PageFigure>
        </Pair>

        <p className={p}>
          Ramon Llull’s{' '}
          <Link href="/book/the-tree-of-science-llull?page=13">
            <em>Arbor scientiae</em>
          </Link>{' '}
          (1295–96) arranges all knowledge as a forest of sixteen trees, from the elemental to the divine, each with
          roots, trunk, branches, leaves, flowers and fruit. Isidore of Seville’s{' '}
          <Link href="/book/etymologiae-de-summo-bono-1483-incunabulum-seville?page=108">
            <em>Etymologies</em>
          </Link>{' '}
          carries the <em>arbor consanguinitatis</em>, a tree for counting degrees of kinship, which canon lawyers later
          used to decide who might marry whom.
        </p>

        <Pair>
          <PageFigure
            src={`${IMG}/llull-arbor-scientiae.jpg`}
            alt="Woodcut of a tree with round fruit, a monk and Raymundus holding scrolls at its foot, Gloria and Poena at the top"
            href="/book/the-tree-of-science-llull?page=13"
            source={<>Ramon Llull, <em>Arbor scientiae</em> (Lyon, 1515)</>}
          >
            The opening woodcut: Llull and a monk at the foot of the tree. See also its{' '}
            <Link href="/book/the-tree-of-science-llull?page=137">Moral Tree</Link>.
          </PageFigure>
          <PageFigure
            src={`${IMG}/isidore-consanguinity.jpg`}
            alt="Woodcut tree of consanguinity: labelled compartments for each degree of kinship, roots and banners below"
            href="/book/etymologiae-de-summo-bono-1483-incunabulum-seville?page=108"
            source={<>Isidore of Seville, <em>Etymologiae</em> (1483)</>}
          >
            The tree of consanguinity.
          </PageFigure>
        </Pair>

        <p className={p}>
          The only illustration in Darwin’s{' '}
          <Link href="/book/on-the-origin-of-species-darwin?page=141">
            <em>On the Origin of Species</em>
          </Link>{' '}
          is a branching diagram. In chapter four he wrote:
        </p>

        <SourceQuote
          book="69e8b1842ff2a8dc09e76141"
          page={154}
          printedPage={129}
          src="https://images.sourcelibrary.org/archived/69e8b1842ff2a8dc09e76141/154.jpg"
          pageAlt="Page 129 of the first edition of On the Origin of Species, from the summary of chapter four"
          source={<>Charles Darwin, <em>On the Origin of Species</em> (1859)</>}
        >
          The affinities of all the beings of the same class have sometimes been represented by a great tree. I believe
          this simile largely speaks the truth.
        </SourceQuote>

        <PageFigure
          src={`${IMG}/darwin-diagram.jpg`}
          alt="Darwin’s diagram: lines branching upward from eleven species A to L through fourteen horizontal levels"
          href="/book/on-the-origin-of-species-darwin?page=141"
          source={<>Charles Darwin, <em>On the Origin of Species</em> (1859)</>}
        >
          The diagram of divergence (contrast raised for legibility).
        </PageFigure>

        <Section id="living">Living sacred trees</Section>

        <p className={p}>
          Some sacred trees are living trees. In India shrines are built under the banyan and the pipal, the
          aśvattha of the Gita. Bernard Picart’s plate of 1723 sets temples, offerings and ascetics beneath “le grand
          Arbre des Banians,” the first item in its key.
        </p>

        <PageFigure
          src={`${IMG}/picart-banyan.jpg`}
          alt="Engraving: a great banyan spreading over domed shrines, worshippers and ascetics in a forest clearing"
          href="/book/ceremonies-et-coutumes-religieuses-des-peuples-idolatres-s-n-2?page=18"
          source={<>Bernard Picart, <em>Cérémonies et coutumes religieuses des peuples idolâtres</em> (1723)</>}
        >
          “Diverses pagodes et pénitences des faquirs,” under the great banyan.
        </PageFigure>

        <p className={p}>
          The gods’ paradise has its own tree, the wish-granting <em>kalpavṛkṣa</em> or <em>kalpataru</em>, which
          yields whatever is asked of it. On the temples of central Java it is carved again and again: a stylised
          tree under a parasol, birds in its crown, guarded by kinnaras, half-bird musicians of heaven.
        </p>

        <Fig
          src={`${IMG}/prambanan-kalpataru.jpg`}
          alt="Stone relief: a stylised tree under a parasol with birds above and two bird-bodied figures at its foot"
          credit={
            <>
              Photo: Photo Dharma, CC BY 2.0, via{' '}
              <Ext href={COMMONS('Candi_Prambanan_-_041_Kalpataru_and_Kinnara_(12041745124).jpg')}>Wikimedia Commons</Ext>.
            </>
          }
        >
          Kalpataru with kinnaras, Prambanan, ninth century.
        </Fig>

        <p className={p}>
          The Buddha reached enlightenment under a pipal at Bodh Gaya, and the earliest Buddhist sculpture shows the
          tree, an empty seat or a pair of footprints in his place. In West Africa, R. E. Dennett photographed a tree
          planted over a grave, which then became sacred.
        </p>

        <Pair>
          <PageFigure
            src={`${IMG}/kanheri-bodhi.jpg`}
            alt="Engraving of a pillar capital: worshippers before the Bodhi tree and the Buddha’s footprints"
            href="/book/buddhist-art-in-india-grunwedel?page=14"
            source={<>Albert Grünwedel, <em>Buddhist Art in India</em> (1901)</>}
          >
            Worship of the Buddha’s footprints and the Bodhi tree, pillar capital from the Kanheri caves.
          </PageFigure>
          <PageFigure
            src={`${IMG}/yoruba-grave-tree.jpg`}
            alt="Photograph: a young tree in a village compound, a figure and stones at its foot"
            href="/book/nigerian-studies-religious-and-political-system-of-the-dennett?page=59"
            source={<>R. E. Dennett, <em>Nigerian Studies</em> (1910)</>}
          >
            “Tree planted over grave which then becomes sacred.”
          </PageFigure>
        </Pair>

        <Section id="not-yet">Trees the library does not yet show</Section>

        <p className={p}>
          A search of the library’s images, the Internet Archive and Wikimedia Commons on 16 October 2026 found no
          usable public-domain picture of these:
        </p>

        <ul className="list-disc pl-6 text-secondary leading-relaxed mb-8 space-y-2">
          <li>
            <strong>China:</strong> Jianmu, the tree by which the gods climb between heaven and earth. The illustrated{' '}
            <Link href="/book/illustrated-shanhai-jing-vol-1-renchen?page=129">
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
          More trees from the collection are in the <Link href="/gallery?q=tree%20of%20life">image gallery</Link>.
        </p>
      </article>
    </ContentPageLayout>
  );
}
