import { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

// Pieter van den Keere's woodcut of the São Tiago on the Bassas da India, cut from
// Langenes, Caert-thresoor (1598), p. 299 (Amsterdam University Library IIIF).
const LEAD_IMAGE = '/blog/shipwrecks-and-buried-treasure/baixos-de-iudia.jpg';

export const metadata: Metadata = {
  title: 'Shipwrecks and Buried Treasure - Research Notes - Source Library',
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
    canonical: '/blog/shipwrecks-and-buried-treasure',
  },
};

const linkClass = 'text-accent-rust hover:text-accent-rust underline';

function Section({ children }: { children: React.ReactNode }) {
  return <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">{children}</h2>;
}

// One find: a heading, what the book says, the passage in translation, and the
// page it is on.
function Find({
  title,
  href,
  source,
  quote,
  children,
}: {
  title: string;
  href: string;
  source: React.ReactNode;
  quote: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-12">
      <h3 className="text-xl text-primary mb-3">{title}</h3>
      <p className="text-secondary leading-relaxed mb-4">{children}</p>
      <blockquote className="border-l-2 border-accent-gold/40 pl-5 italic text-secondary leading-relaxed mb-3">
        {quote}
      </blockquote>
      <p className="text-sm text-muted">
        {source}.{' '}
        <Link href={href} className={linkClass}>
          Read the page
        </Link>
      </p>
    </div>
  );
}

export default function ShipwrecksAndBuriedTreasurePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
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
          Travellers, chroniclers and antiquaries wrote down where ships went down and where money was dug up, often
          with the place, the year and the sum. These are some of those passages from the library’s books, in
          translation, each linked to the page it comes from. Most of the sums are the writers’ own estimates or
          local report; none has been checked against an excavation.
        </p>

        <figure className="mb-10">
          <div className="rounded-xl overflow-hidden border border-accent-gold/10 shadow-md bg-stone-100">
            <Link href="/book/69b4cd11d5b6c3815e1a3ccf?page=299">
              <Image
                src={LEAD_IMAGE}
                alt="Woodcut titled Baixos de Iudia: a carrack broken on the reef, survivors on the rocks and in the water"
                width={1400}
                height={1028}
                className="w-full h-auto"
                unoptimized
              />
            </Link>
          </div>
          <figcaption className="text-xs text-muted mt-2 text-center">
            The <em>São Tiago</em> on the Bassas da India shoals, 1585, woodcut signed PK (Pieter van den Keere), in
            Barent Langenes, <em>Caert-thresoor</em> (1598). A man in the foreground carries a chest out of
            the water.{' '}
            <Link href="/book/69b4cd11d5b6c3815e1a3ccf?page=299" className="text-accent-rust hover:text-accent-rust">
              View in collection →
            </Link>
          </figcaption>
        </figure>

        <Section>Sunk with their cargo</Section>

        <Find
          title="Six chests of the Emperor’s gold, off Cadiz"
          href="/book/69b525c46be6046083031e1b?page=90"
          source={
            <>
              Ulrich Schmidt, voyage to the Río de la Plata, in <em>Gedenkwaardige scheeps-togten</em> (Leiden, 1706)
            </>
          }
          quote="Besides all the goods of the merchants and others, there sank here into the abyss six chests of gold and silver, belonging to his Imperial Majesty Charles V."
        >
          Ulrich Schmidt, a German soldier, was sailing home from South America when his fleet anchored off Cadiz. A
          captain named Henrik Schetz mistook a fire burning at a mill on shore for the admiral’s lantern, steered for
          it and struck the rocks. Twenty-two people drowned; the captain and the helmsman survived by holding on to a
          tree trunk. Schmidt had been left ashore because the captain forgot to call him aboard.
        </Find>

        <Find
          title="A king’s revenues in the Baltic"
          href="/book/69c8716b6c6f3cc53c857589?page=1331"
          source={
            <>
              Sebastian Münster, <em>Cosmographey</em> (Basel, 1598 edition)
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
          href="/book/69e961ab2beefe2f6f72c3b6?page=460"
          source={
            <>
              Richard Hakluyt, <em>The Principal Navigations</em> (London, 1599), p. 425
            </>
          }
          quote="A chest containing dollars and gold, which they had received for company commodities sold at Bachu, fell into the water among the rocks while they were unloading the ship and was lost."
        >
          English merchants trading for Persian silk hired a small Armenian cargo boat to carry their goods from
          Bildih, near Baku, to Derbent. A storm broke the cables and drove the boat onto the rocks. Everyone got
          ashore, but the chest of takings went into the water.
        </Find>

        <Find
          title="Pieces of eight off Maldonado"
          href="/book/6909f75fcf28baa1b4cb0f71?page=249"
          source={
            <>
              Antoine-Joseph Pernety, <em>History of a Voyage to the Falkland Islands</em> (1770)
            </>
          }
          quote="An English ship, loaded with piastres, was lost there thirty years ago. The inhabitants of the island near the place where it broke apart still seek today to save a part of this cargo. They had fished up with a dragnet two thousand four hundred of them the day before our arrival."
        >
          Pernety sailed with Bougainville in 1763 and stopped at the anchorage by Maldonado Island, at the mouth of the
          Río de la Plata, which he calls one of the worst on the coast. Thirty years after the wreck, the islanders
          were still dragging coins off the bottom.
        </Find>

        <Find
          title="An Armada ship in Tobermory Bay"
          href="/book/69906a4dd69de0e6980706cf?page=264"
          source={
            <>
              Andrew Lang, <em>Cock Lane and Common-Sense</em> (1894)
            </>
          }
          quote="Busy trying to recover treasure from a ship of the Spanish Armada that had sunk in Tobermory Bay... recently, the fluke of a ship’s anchor even brought up a doubloon. However, the main treasure still lies at the bottom of Tobermory Bay."
        >
          Lang is writing about second sight in the Highlands, and the wreck comes in sideways: one of his witnesses
          stayed on Mull with Sir William Sacheverell, who was trying to raise the galleon. Lang adds that a cannon
          from the wreck was in the Duke of Argyll’s possession.
        </Find>

        <Find
          title="Wrecks on Bermuda"
          href="/book/69ea0f7013a685002bb8e200?page=204"
          source={
            <>
              John Smith, <em>The Generall Historie of Virginia, New-England, and the Summer Isles</em> (London, 1624)
            </>
          }
          quote="Our men found various crosses and pieces of Spanish money here and there. Two or three wrecks also they found, which by certain inscriptions appeared to be some Spanish, some Dutch, some French."
        >
          Smith collects what was known of the islands before the English settled them, including a story that the
          name comes from a Spanish ship called <em>Bermudas</em> wrecked there with a cargo of hogs, and the account
          of Henry May, cast away on the north-west of the islands in December 1593 because the pilots were “either drunk or careless of their charge”.
        </Find>

        <Find
          title="The São Tiago on the Bassas da India"
          href="/book/69ea0f7e13a685002bb8e4d8?page=244"
          source={
            <>
              Jan Huyghen van Linschoten, <em>Itinerario</em> (Amsterdam, 1595)
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
          href="/book/69567835be7c607c5f03b7e5?page=406"
          source={
            <>
              <em>Philosophical Transactions of the Royal Society</em>, vol. 16 (1686–87), p. 356
            </>
          }
          quote="In May 1687, at Hundon near Clare in Suffolk, the sexton, as he was digging a grave in the churchyard, found a skull; and near it his spade broke a yellow earthenware pot, in which were many silver pieces of Saxon money."
        >
          Sir Philip Skippon reported the find to the Royal Society and tried to read the coins. He found scarcely two
          inscriptions alike and guessed that each moneyer had his own stamp, citing King Æthelstan’s law on how many
          moneyers each town might keep.
        </Find>

        <Find
          title="Digging money in Luoyang"
          href="/book/6992cbe8018b80967354c531?page=74"
          source={
            <>
              Shen Kuo, <em>Dream Pool Essays</em> (eleventh century)
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
          href="/book/69ee470e6dd925d126f413f3?page=165"
          source={
            <>
              William Stukeley, <em>Itinerarium Curiosum</em> (London, 1724)
            </>
          }
          quote="They told me it was built many years ago by one Courd, once a poor sailor, who, being somewhere in the Mediterranean, was told by a certain Greek that much treasure was hid upon Hogsdon Hill near here."
        >
          Stukeley was looking at a long pier of piled rocks near the Roman site he calls Honey Ditches, by Seaton in
          Devon. Local people said Courd dug up the treasure and paid for the wall himself, that many had dug on the
          hill since in the same hope, and that his descendants still lived on the estate.
        </Find>

        <Section>Where to dig, and how</Section>

        <Find
          title="A Tibetan guide to a hidden valley"
          href="/book/69e7928980b52390feb16323?page=11"
          source={
            <>
              <em>sbas gnas kyi lam yig kun gsal me long</em>, Ogyen Choling collection, Bhutan
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
          href="/book/6955d95d8407b7c9ae212d38?page=85"
          source={
            <>
              <em>The Book of the Sacred Magic of Abra-Melin the Mage</em>, tr. S. L. MacGregor Mathers
            </>
          }
          quote="It is permitted to ask the Angel for a sum of coined money proportional to your birth, status, and station... This money is taken from Hidden Treasures. However, it is important to note that God permits one to take a fifth part of all treasures."
        >
          The author says his own treasure was assigned to him at Würzburg, and that he raised it with the operation
          in the eighth chapter of the third book.
        </Find>

        <Find
          title="A carbuncle between Swabia and Bavaria"
          href="/book/6a267ec86c1f37c9c4f3cbed?page=4"
          source={
            <>
              <em>Warhaffte Beschreibung einer Prophecey D. Theophrasti Paracelsi</em> (1632)
            </>
          }
          quote="The carbuncle stone lies together with the other precious stones in a small casket... The key lies on top of it, and it is buried in a golden coffin, the golden one in a silver one, the silver one in a tin coffin, and in the place where God would have it."
        >
          A pamphlet printed during the Thirty Years’ War under Paracelsus’s name, about the war and the Bohemian
          crown, which also describes a treasure “that surpasses all the others” in “a rejected place”.
        </Find>

        <Section>How these pages were found</Section>

        <p className="text-secondary leading-relaxed mb-6">
          We searched the English translations for words like <em>shipwreck</em>, <em>foundered</em>, <em>hidden
          treasure</em> and <em>hoard</em>, which gave about eleven thousand candidate pages. A small decision model,
          TypeSafe’s Jev, then answered four questions about each page: does it report a particular wreck; does it
          report particular valuables that were buried, hidden or sunk (not treasure in heaven, and not the
          philosophers’ stone); does it name a place someone could go and look; and is it a record, a legend, a method
          for finding treasure, law, allegory or fiction. The whole pass cost 64 cents. We then read the top-scoring
          pages and chose the ones above.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          The search only reaches pages that have been translated and that use one of the search words, so wrecks
          told in other words, or in books not yet translated, are missing. The passages are read from the
          translations; follow the links for the original page beside them.
        </p>
      </article>
    </ContentPageLayout>
  );
}
