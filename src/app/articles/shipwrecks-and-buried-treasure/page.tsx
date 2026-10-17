import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import PageFigure from '@/components/articles/PageFigure';
import SourceQuote from '@/components/articles/SourceQuote';
import LossToPrint from './LossToPrint';

// Pieter van den Keere's woodcut of the São Tiago on the Bassas da India, cut from
// Langenes, Caert-thresoor (1598), p. 299 (Amsterdam University Library IIIF).
const LEAD_IMAGE = '/articles/shipwrecks-and-buried-treasure/baixos-de-iudia.jpg';

export const metadata: Metadata = withArticleMeta('shipwrecks-and-buried-treasure', {
  title: 'Shipwrecks and Buried Treasure - Articles - Source Library',
  description:
    'Sunk chests of gold, a sexton’s pot of Saxon silver, a Spanish galleon in Tobermory Bay and a Tibetan guide that says where to dig: wrecks and hidden treasure in the pages Source Library holds.',
  openGraph: {
    title: 'Shipwrecks and Buried Treasure',
    description:
      'Wrecks, lost cargoes and buried hoards reported in the library’s books, from Cadiz to the Caspian to Luoyang.',
    images: [{ url: LEAD_IMAGE, width: 1400, height: 1028 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: LEAD_IMAGE }],
  },
  alternates: {
    canonical: '/articles/shipwrecks-and-buried-treasure',
  },
});

// Page images are the library's archived scans, each checked by eye on 2026-10-18.
// Münster and Pernety are photographed as spreads, so they use the cropped single page.
const IMG = (bookId: string, page: number) => `https://images.sourcelibrary.org/archived/${bookId}/${page}.jpg`;
const CROPPED = (bookId: string, pageId: string) => `https://images.sourcelibrary.org/cropped/${bookId}/${pageId}.jpg`;

function Section({ children }: { children: React.ReactNode }) {
  return <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">{children}</h2>;
}

// One find: a heading, what the book says, and the passage beside the page it is
// on. Passages from books printed in English are given as printed (long s made
// round); the rest are the library's translations.
function Find({
  title,
  book,
  page,
  printedPage,
  src,
  pageAlt,
  source,
  quote,
  children,
}: {
  title: string;
  book: string;
  page: number;
  printedPage?: number | string;
  src: string;
  pageAlt: string;
  source: React.ReactNode;
  quote: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-12">
      <h3 className="text-xl text-primary mb-3">{title}</h3>
      <p className="text-secondary leading-relaxed mb-4">{children}</p>
      <SourceQuote book={book} page={page} printedPage={printedPage} src={src} source={source} pageAlt={pageAlt}>
        {quote}
      </SourceQuote>
    </div>
  );
}

export default function ShipwrecksAndBuriedTreasurePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title="Shipwrecks and Buried Treasure"
          subtitle="Lost cargoes, sunk chests and buried hoards, as the books that recorded them tell it"
          image={LEAD_IMAGE}
          imageAlt="Woodcut of a Portuguese carrack broken on rocks, people climbing onto the reef and swimming, a boat rowing away, lobsters in the foreground"
        >
          <p className="text-stone-400 text-sm mt-4">16 October 2026 &middot; 8 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Travellers, chroniclers and antiquaries wrote down where ships went down and where money was dug up, often
          with the place, the year and the sum. These are some of those passages from the library’s books, in
          translation, each linked to the page it comes from. Most of the sums are the writers’ own estimates or
          local report; none has been checked against an excavation.
        </p>

        <PageFigure
          src={LEAD_IMAGE}
          alt="Woodcut titled Baixos de Iudia: a carrack broken on the reef, survivors on the rocks and in the water"
          href="/book/barent-langenes-caert-thresoor-1598-langenes?page=299"
          source={
            <>
              Barent Langenes, <em>Caert-thresoor</em> (1598), p. 113
            </>
          }
        >
          The <em>São Tiago</em> on the Bassas da India shoals, 1585, woodcut signed PK (Pieter van den Keere). A man in
          the foreground carries a chest out of the water.
        </PageFigure>

        <Section>Sunk with their cargo</Section>

        <Find
          title="Six chests of the Emperor’s gold, off Cadiz"
          book="69b525c46be6046083031e1b"
          page={90}
          printedPage={73}
          src={IMG('69b525c46be6046083031e1b', 90)}
          pageAlt="Page 73 of the Dutch edition of Ulrich Schmidt’s voyage, in black letter, with marginal notes on the wreck at Cadiz"
          source={
            <>
              Ulrich Schmidt, voyage to the Río de la Plata, in{' '}
              <Link href="/book/gedenkwaardige-scheeps-togten-na-rio-de-la-plata-in-t-schmidt">
                <em>Gedenkwaardige scheeps-togten</em>
              </Link>{' '}
              (Leiden, 1706)
            </>
          }
          quote="Besides all the goods of the merchants and others, there sank here into the abyss six chests of gold and silver, belonging to his Imperial Majesty Charles V."
        >
          Ulrich Schmidt, a German soldier, was sailing home from South America when his fleet anchored off Cadiz. A
          captain named Henrik Schetz mistook a fire burning at a mill on shore for the admiral’s lantern, steered for
          it and struck the rocks. Of the twenty-two people aboard, only the captain and the helmsman survived, by
          holding on to a tree trunk. Schmidt had been left ashore because the captain forgot to call him aboard.
        </Find>

        <Find
          title="A king’s revenues in the Baltic"
          book="69c8716b6c6f3cc53c857589"
          page={1331}
          printedPage="1189 (mclxxxix)"
          src={CROPPED('69c8716b6c6f3cc53c857589', '69f7743f6028036f8e2397ab')}
          pageAlt="Page of Münster’s Cosmographey with a woodcut of a three-masted ship beside the account of King Christopher’s lost treasure"
          source={
            <>
              Sebastian Münster,{' '}
              <Link href="/book/cosmographey-das-ist-beschreibung-aller-laender-munster">
                <em>Cosmographey</em>
              </Link>{' '}
              (Basel, 1598 edition)
            </>
          }
          quote="All the silver and gold sank with the ship. It is thought that over 1,000,000 guilders’ worth was sunk. The King barely reached land with his ship."
        >
          Münster tells how King Christopher of Denmark, after his wedding in 1445, went to Sweden, loaded the treasure
          collected from the Swedish revenues onto his ships and was caught by a storm on the way home. He died in
          1448 without heirs.
        </Find>

        <Find
          title="A chest of dollars and gold in the Caspian"
          book="69e961ab2beefe2f6f72c3b6"
          page={460}
          printedPage={425}
          src={IMG('69e961ab2beefe2f6f72c3b6', 460)}
          pageAlt="Page 425 of Hakluyt’s Principal Navigations, black-letter text headed Christopher Burrough, with the marginal note The English suffer shipwracke"
          source={
            <>
              Richard Hakluyt,{' '}
              <Link href="/book/the-principal-navigations-voyages-traffiques-and-discoveries-hakluyt">
                <em>The Principal Navigations</em>
              </Link>{' '}
              (London, 1599)
            </>
          }
          quote="There was a Carobia or cheste, wherein were dollers, and golde, which they had receiued for the commodities of the company, which they sold at Bachu, which at the taking out of the Busse, fell by the barkes side into the water amongst the rockes, and so was lost."
        >
          English merchants trading for Persian silk hired a small Armenian cargo boat to carry their goods from
          Bildih, near Baku, to Derbent. A storm broke the cables and drove the boat onto the rocks. Everyone got
          ashore, but the chest of takings went into the water.
        </Find>

        <Find
          title="Pieces of eight off Maldonado"
          book="6909f75fcf28baa1b4cb0f71"
          page={249}
          printedPage={241}
          src={CROPPED('6909f75fcf28baa1b4cb0f71', '69f6a9d6b6ebee470a7a2abc')}
          pageAlt="Page 241 of Pernety’s account of the voyage to the Falklands, in French, describing the anchorage at Maldonado and the English silver ship"
          source={
            <>
              Antoine-Joseph Pernety,{' '}
              <Link href="/book/history-of-a-voyage-to-the-falkland-islands-pernety">
                <em>History of a Voyage to the Falkland Islands</em>
              </Link>{' '}
              (1770), vol. 1
            </>
          }
          quote="An English ship, loaded with piastres, or pieces of eight, was lost there thirty years ago. The inhabitants of the island near the place where it broke apart still seek today to save a part of this cargo. They had fished up with a dragnet two thousand four hundred of them the day before our arrival."
        >
          Pernety sailed with Bougainville in 1763 and stopped at the anchorage by Maldonado Island, at the mouth of the
          Río de la Plata, which he calls one of the worst on the coast. Thirty years after the wreck, the islanders
          were still dragging coins off the bottom.
        </Find>

        <Find
          title="An Armada ship in Tobermory Bay"
          book="69906a4dd69de0e6980706cf"
          page={264}
          printedPage={240}
          src={IMG('69906a4dd69de0e6980706cf', 264)}
          pageAlt="Page 240 of Andrew Lang’s Cock Lane and Common-Sense, on second sight, mentioning the Armada vessel sunk in Tobermory Bay"
          source={
            <>
              Andrew Lang,{' '}
              <Link href="/book/cock-lane-and-common-sense-lang">
                <em>Cock Lane and Common-Sense</em>
              </Link>{' '}
              (1894)
            </>
          }
          quote="Engaged in trying to recover treasures from the vessel of the Armada sunk in Tobermory Bay. … lately, the fluke of a ship’s anchor brought up a doubloon. But the treasure still lies in Tobermory Bay."
        >
          Lang is writing about second sight in the Highlands, and the wreck comes in sideways: one of his witnesses
          stayed on Mull with Sir William Sacheverell, who was trying to raise the galleon. Lang adds that a cannon
          from the wreck was in the Duke of Argyll’s possession.
        </Find>

        <Find
          title="Wrecks on Bermuda"
          book="69ea0f7013a685002bb8e200"
          page={203}
          printedPage={173}
          src={IMG('69ea0f7013a685002bb8e200', 203)}
          pageAlt="Page 173 of John Smith’s Generall Historie, headed A briefe relation of Henrie May, signed Written by me Henry May"
          source={
            <>
              John Smith,{' '}
              <Link href="/book/the-generall-historie-of-virginia-new-england-and-the-smith">
                <em>The Generall Historie of Virginia, New-England, and the Summer Isles</em>
              </Link>{' '}
              (London, 1624)
            </>
          }
          quote="Our men found diuers crosses, peeces of Spanish monies here and there. Two or three wracks also they found, by certaine inscriptions to bee some Spanish, some Dutch, some French."
        >
          Smith collects what was known of the islands before the English settled them, including a story that the
          name comes from a Spanish ship called <em>Bermudas</em> wrecked there with a cargo of hogs, and the account
          of Henry May, cast away on the north-west of the islands in December 1593 because the pilots were “either drunke, or carelesse of their charge”.
        </Find>

        <Find
          title="The São Tiago on the Bassas da India"
          book="69ea0f7e13a685002bb8e4d8"
          page={244}
          printedPage={116}
          src={IMG('69ea0f7e13a685002bb8e4d8', 244)}
          pageAlt="Page 116 of Linschoten’s Itinerario, two columns of Dutch black letter with marginal notes, including the year 1586 and the loss of the Sant Iago"
          source={
            <>
              Jan Huyghen van Linschoten,{' '}
              <Link href="/book/itinerario-voyage-ofte-schipvaert-naer-oost-indien-linschoten">
                <em>Itinerario</em>
              </Link>{' '}
              (Amsterdam, 1595)
            </>
          }
          quote="There were still missing 2 ships of the company that had left Lisbon with them, namely the ship Sant Salvator and the Admiral-ship Sant Iago, of which there was still no news."
        >
          Linschoten was in Goa when news came that the flagship of the 1585 India fleet had been lost on the shoals
          between Madagascar and Mozambique. In his margins: the pilot’s quarrel with everyone aboard, the cause of the
          wreck, and the admiral escaping in a boat with ten or twelve others. Langenes retold the story three years
          later beside the woodcut above.
        </Find>

        <Section>Dug up</Section>

        <Find
          title="A pot of Saxon silver in a Suffolk churchyard"
          book="69567835be7c607c5f03b7e5"
          page={406}
          printedPage={356}
          src={IMG('69567835be7c607c5f03b7e5', 406)}
          pageAlt="Page 356 of the Philosophical Transactions: An Account of some Saxon Coyns found in Suffolk, with the margin note Some say there was no Pot"
          source={
            <>
              <Link href="/book/philosophical-transactions-of-the-royal-society-vol-16-1686-london">
                <em>Philosophical Transactions of the Royal Society</em>
              </Link>
              , vol. 16 (1686–87)
            </>
          }
          quote="In May 1687, at Honedon nigh Clare in Suffolk, the Sexton, as he was digging a Grave in the Church-yard, met with a Skull; and near it his Spade broke a Yellow Earthen Pot, wherein were many Silver pieces of Saxon Mony."
        >
          Sir Philip Skippon reported the find to the Royal Society and tried to read the coins. He found scarcely two
          inscriptions alike and guessed that each moneyer had his own stamp, citing King Æthelstan’s law on how many
          moneyers each town might keep.
        </Find>

        <Find
          title="Digging money in Luoyang"
          book="6992cbe8018b80967354c531"
          page={74}
          src={IMG('6992cbe8018b80967354c531', 74)}
          pageAlt="Leaf of the Dream Pool Essays in Chinese, six columns of large characters beginning with Luoyang"
          source={
            <>
              Shen Kuo,{' '}
              <Link href="/book/mengxi-bitan-dream-pool-essays-vols-19-24-kuo">
                <em>Dream Pool Essays</em>
              </Link>{' '}
              (eleventh century)
            </>
          }
          quote="Opening the casket, they found several hundred ounces of yellow gold. When sold, the value of the gold matched the exact cost of purchasing the mansion, with the excavation fee included, without differing by a single coin."
        >
          In Luoyang, Shen Kuo says, so much old treasure lay underground that a buyer of unexcavated land paid the
          seller an extra fee for the right to dig. One official paid over a thousand strings of cash in digging money
          for a mansion, and everyone thought him a fool until his builders turned up a carved stone casket.
        </Find>

        <Find
          title="The sailor who built a harbour wall"
          book="69ee470e6dd925d126f413f3"
          page={165}
          printedPage={152}
          src={IMG('69ee470e6dd925d126f413f3', 165)}
          pageAlt="Page 152 of Stukeley’s Itinerarium Curiosum, Iter VI, with the margin note Honey-ditches, a Camp"
          source={
            <>
              William Stukeley,{' '}
              <Link href="/book/itinerarium-curiosum-or-an-account-of-the-antiquities-and-stukeley">
                <em>Itinerarium Curiosum</em>
              </Link>{' '}
              (London, 1724)
            </>
          }
          quote="They told me it was built many years ago by one Courd, once a poor sailor, who being somewhere in the Mediterranean, was told by a certain greek that much treasure was hid upon Hogsdon hill near here."
        >
          Stukeley was looking at a long pier of piled rocks near the Roman site he calls Honey Ditches, by Seaton in
          Devon. Local people said Courd dug up the treasure and paid for the wall himself, that many had dug on the
          hill since in the same hope, and that his descendants still lived on the estate.
        </Find>

        <Section>Where to dig, and how</Section>

        <Find
          title="A Tibetan guide to a hidden valley"
          book="69e7928980b52390feb16323"
          page={11}
          src={IMG('69e7928980b52390feb16323', 11)}
          pageAlt="Photograph of two leaves of a Tibetan manuscript in black ink on paper, laid on a grey board between measuring tapes"
          source={
            <>
              <Link href="/book/sbas-gnas-kyi-lam-yig-kun-gsal-me-long-collection">
                <em>sbas gnas kyi lam yig kun gsal me long</em>
              </Link>
              , Ogyen Choling collection, Bhutan
            </>
          }
          quote="In the middle-lower part of that, there is a white boulder the size of a yak. Underneath it is a vase-treasure about the size of a hand. By digging two fathoms deep, it will be found."
        >
          Guidebooks (<em>lam yig</em>) to the hidden lands (<em>sbas yul</em>) of the Himalaya give routes,
          landmarks, food and dangers, and sometimes where a treasure lies. This one also advises carrying plenty of
          salt.
        </Find>

        <Find
          title="A fifth part, by the angel’s leave"
          book="6955d95d8407b7c9ae212d38"
          page={85}
          printedPage={33}
          src={IMG('6955d95d8407b7c9ae212d38', 85)}
          pageAlt="Page 33 of Mathers’s translation of Abra-Melin, with footnotes on Herbipolis, the Latin name of Würzburg"
          source={
            <>
              <Link href="/book/the-book-of-the-sacred-magic-of-abra-melin-the-mage-simeon">
                <em>The Book of the Sacred Magic of Abra-Melin the Mage</em>
              </Link>
              , tr. S. L. MacGregor Mathers
            </>
          }
          quote="It is permissible to demand from the Angel a sum of coined money proportionate unto thy birth, quality and capacity, the which without difficulty will be granted unto thee. Such money is taken from the Hidden Treasures. It is, however, necessary to note that in all Treasures one is allowed to take the fifth part, God permitting the same."
        >
          The author says his own treasure was assigned to him at Würzburg, and that he raised it with the operation
          in the eighth chapter of the third book.
        </Find>

        <Find
          title="A carbuncle between Swabia and Bavaria"
          book="6a267ec86c1f37c9c4f3cbed"
          page={4}
          src={IMG('6a267ec86c1f37c9c4f3cbed', 4)}
          pageAlt="Page of the 1632 Paracelsus prophecy pamphlet in German black letter, ending Philippus Theophrastus, followed by a letter of Gustav Adolph of Sweden"
          source={
            <>
              <Link href="/book/warhaffte-beschreibung-einer-prophecey-d-theophrasti-paracelsus">
                <em>Warhaffte Beschreibung einer Prophecey D. Theophrasti Paracelsi</em>
              </Link>{' '}
              (1632)
            </>
          }
          quote="The carbuncle stone lies together with the other precious stones in a small casket... The key lies on top of it, and it is buried in a golden coffin, the golden one in a silver one, the silver one in a tin coffin, and in the place where God would have it."
        >
          A pamphlet printed during the Thirty Years’ War under Paracelsus’s name, about the war and the Bohemian
          crown, which also describes a treasure “that surpasses all the others” in “a rejected place”.
        </Find>

        <Section>Never recovered</Section>

        <p className="text-secondary leading-relaxed mb-8">
          A second pass asked of every wreck and hoard page whether it says the valuables were never recovered. These
          four came out on top, and none of them has a wreck site that we could find in published sources.
        </p>

        <Find
          title="The 1502 gold fleet, and a nugget like a loaf of bread"
          book="69ea06f14c15c76fe934a77a"
          page={41}
          printedPage={13}
          src={IMG('69ea06f14c15c76fe934a77a', 41)}
          pageAlt="Page 13 of a modern printing of Las Casas’s Brevísima relación, in Spanish, on the kingdoms of Hispaniola"
          source={
            <>
              Bartolomé de las Casas,{' '}
              <Link href="/book/brevisima-relacion-de-la-destruccion-de-las-indias-casas">
                <em>Brevísima relación de la destrucción de las Indias</em>
              </Link>{' '}
              (Seville, 1552)
            </>
          }
          quote="The ship was lost at sea, and along with him, many Christians and a large quantity of gold drowned; among the items lost was a large nugget that was like a loaf of bread and weighed three thousand six hundred castellanos."
        >
          The &ldquo;him&rdquo; is Guarionex, a Taíno king captured on Hispaniola and shipped to Castile in chains. He
          sailed with the fleet that left Santo Domingo in 1502 carrying the outgoing governor, Francisco de
          Bobadilla, against Columbus’s warning that a storm was coming. Oviedo gives the same story from the island
          (
          <Link href="/book/historia-general-y-natural-de-las-indias-vol-1-oviedo?page=194">
            Oviedo, Historia general, vol. 1, ch. VII
          </Link>
          ). Most of the fleet sank in the hurricane, and later accounts disagree on the number of ships.
        </Find>

        <div className="mx-auto max-w-md">
          <PageFigure
            src={IMG('695910f5ecb01322b306854d', 194)}
            alt="Page 74 of Oviedo’s Historia general, volume 1, with the heading Capitulo VII and its summary in small type"
            href="/book/historia-general-y-natural-de-las-indias-vol-1-oviedo?page=194"
            source={
              <>
                Gonzalo Fernández de Oviedo, <em>Historia general y natural de las Indias</em>, vol. 1 (1851), p. 74
              </>
            }
          >
            Oviedo’s chapter VII: the summary under the heading names Bobadilla’s fleet, lost at sea with much gold,
            and the admiral’s warning that it should not sail.
          </PageFigure>
        </div>

        <Find
          title="Prince Rupert’s prize money"
          book="6a4a3ea3f0f4a3b75e90cdbc"
          page={78}
          printedPage={68}
          src={IMG('6a4a3ea3f0f4a3b75e90cdbc', 78)}
          pageAlt="Page 68 of Clarendon’s History, book XIV, 1655, with the margin note Prince Rupert gives an ill account of his fleet"
          source={
            <>
              Edward Hyde, Earl of Clarendon,{' '}
              <Link href="/book/the-history-of-the-rebellion-and-civil-wars-in-england-vol-5-edward-hy">
                <em>The History of the Rebellion and Civil Wars in England</em>
              </Link>
              , book XIV
            </>
          }
          quote="What treasure had been gotten together, which, he confessed, had amounted to great value, had been all lost in the ship in which himself was."
        >
          Rupert’s Royalist squadron spent 1650 to 1653 taking prizes at sea. Clarendon reports the prince’s account to
          Charles II: the treasure went down with his own ship, and more with the ship in which his brother Maurice was
          lost. Clarendon names the sunken ship as the <em>Antelope</em> and puts the loss &ldquo;in the Indies&rdquo;;
          other sources name the <em>Constant Reformation</em>, wrecked off Terceira in the Azores on 30 September
          1651. We found no published wreck site.
        </Find>

        <Find
          title="The loot of Kaffa, 1475"
          book="6991e7ecc91ce7d733e50311"
          page={283}
          printedPage={270}
          src={IMG('6991e7ecc91ce7d733e50311', 283)}
          pageAlt="Page 270 of Pagnini’s Della decima, Italian chronicle text, with the stamp Digitized by Google"
          source={
            <>
              An Italian chronicle printed in Giovanni Francesco Pagnini,{' '}
              <Link href="/book/della-decima-e-di-varie-altre-gravezze-pagnini">
                <em>Della decima</em>
              </Link>{' '}
              (Florence, 1765); scan digitised by Google
            </>
          }
          quote="He carried away many souls, and many treasures, and many goods, and loaded everything onto a Genoese ship, and coming in the direction of Constantinople the said ship broke and perished, and went to the bottom of the Sea, and everything was lost."
        >
          After the Ottoman capture of the Genoese colony of Kaffa in the Crimea, the spoils and captives were sent to
          Constantinople in a Genoese ship. When it sank, the chronicle says, the Sultan seized the Genoese merchants of
          Pera and made them pay for the loss. The text does not say where in the Black Sea it went down.
        </Find>

        <Find
          title="Moctezuma’s gold in the lagoon"
          book="695910f9ecb01322b3068858"
          page={533}
          printedPage={517}
          src={IMG('695910f9ecb01322b3068858', 533)}
          pageAlt="Page 517 of Oviedo’s Historia general, volume 2, book XXXIII, chapter XLVIII, two columns of Spanish"
          source={
            <>
              Gonzalo Fernández de Oviedo,{' '}
              <Link href="/book/historia-general-y-natural-de-las-indias-vol-2-oviedo">
                <em>Historia general y natural de las Indias</em>
              </Link>
              , vol. 2
            </>
          }
          quote="They told where they had thrown the gold into the lagoon, and part of it was found; but not a third part of what had been lost."
        >
          After the fall of Tenochtitlan in 1521, Cuauhtémoc and the stewards of his household told the Spaniards where
          the gold had been thrown into the lake. The lake has since been drained and Mexico City built over it.
        </Find>

        <Section>Where are they now?</Section>

        <p className="text-secondary leading-relaxed mb-6">
          What we could find about the stories above, in published sources, as of October 2026.
        </p>
        <ul className="list-disc pl-6 text-secondary leading-relaxed mb-8 space-y-3">
          <li>
            <strong>The São Tiago</strong> was found on the Bassas da India and salvaged: guns identified by the Natal
            Museum, coins and jewellery, an astrolabe, and a bronze falconet raised in 1985 that is now in Lisbon’s
            Museu de Marinha (
            <a href="https://shiplib.org/?p=4602">
              ShipLib
            </a>
            ). The atoll is a French nature reserve and visits need a permit.
          </li>
          <li>
            <strong>The Tobermory ship</strong> has been searched with diving bells in 1666, by Sacheverell in 1688,
            by the Pieces of Eight Company in 1906 to 1908 and by the Duke of Argyll between 2008 and 2014. No
            significant treasure has come up, the hull lies deep in mud, and the records suggest it carried soldiers,
            not money (
            <a href="https://canmore.org.uk/site/22320">
              Canmore
            </a>
            ).
          </li>
          <li>
            <strong>The Hundon pot</strong> was the find itself, in 1687.
          </li>
          <li>
            <strong>Hawkesdown Hill</strong> is an Iron Age hillfort and has been a scheduled monument since 1924, so
            digging for Courd’s treasure would now be a criminal offence.
          </li>
          <li>
            <strong>The Cadiz wreck</strong> has no identified site that we could find. Schmidt’s own pages date it:
            he reached Lisbon on 30 September 1553 (
            <Link href="/book/gedenkwaardige-scheeps-togten-na-rio-de-la-plata-in-t-schmidt?page=88">
              p. 71
            </Link>
            ). The captain’s name is also the name of the Antwerp merchant family Schmidt mentions as owners of
            sugar estates at São Vicente in Brazil (
            <Link href="/book/gedenkwaardige-scheeps-togten-na-rio-de-la-plata-in-t-schmidt?page=85">
              p. 68
            </Link>
            ), but he does not say they owned this ship.
          </li>
          <li>
            <strong>The Maldonado silver ship</strong> has no identified site either. Pernety’s visit was in 1763, so
            the loss was around 1733, close enough to the island for a dragnet to bring up coins.
          </li>
          <li>
            <strong>King Christopher’s ship</strong> appears in Münster; we found no other record of it.
          </li>
          <li>
            <strong>The Caspian chest</strong> is recorded only in Hakluyt. The voyage itself, Christopher Burrough’s
            of 1580, is well documented (
            <a href="https://www.iranicaonline.org/articles/borough-christopher-merchant/">
              Encyclopaedia Iranica
            </a>
            ).
          </li>
        </ul>

        <LossToPrint />

        <Section>How these pages were found</Section>

        <p className="text-secondary leading-relaxed mb-6">
          We searched the English translations for words like <em>shipwreck</em>, <em>foundered</em>, <em>hidden
          treasure</em> and <em>hoard</em>, which gave about eleven thousand candidate pages. A small decision model,
          TypeSafe’s Jev, then answered four questions about each page: does it report a particular wreck; does it
          report particular valuables that were buried, hidden or sunk (not treasure in heaven, and not the
          philosophers’ stone); does it name a place someone could go and look; and is it a record, a legend, a method
          for finding treasure, law, allegory or fiction. The whole pass cost 64 cents. A second pass over the 1,356
          pages that named a place asked whether the valuables were never recovered, for another 6 cents. We then read the top-scoring
          pages and chose the ones above.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          The search only reaches pages that have been translated and that use one of the search words, so wrecks
          told in other words, or in books not yet translated, are missing. The passages are read from the
          translations; follow the links for the original page beside them. Passages from books printed in English (Hakluyt, Smith, the Philosophical Transactions, Stukeley, Clarendon, Lang and Mathers’s Abra-Melin) are given as printed, with the long s made round.
        </p>
      </article>
    </ContentPageLayout>
  );
}
