import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import PageFigure from '@/components/articles/PageFigure';
import SourceQuote from '@/components/articles/SourceQuote';
import ContextNote from '@/components/articles/ContextNote';

const LEAD_IMAGE = '/articles/sea-road-china-gulf/ormus-kaempfer.jpg';
const LEAD_ALT =
  'Engraving from Kaempfer’s Amoenitates exoticae (1712): the town of Hormuz seen from the sea, with European ships in the roads, a small plan of the island, and below it the castle on Qeshm';

export const metadata: Metadata = withArticleMeta('sea-road-china-gulf', {
  title: 'The Sea Road from China to the Gulf - Articles - Source Library',
  description:
    'Siraf, Khanfu, Quanzhou, Calicut and Hormuz in the books of the people who sailed or charted the route: Arab geographers, Chinese officials, Marco Polo, Ibn Battuta, Zheng He’s charts and Wei Yuan.',
  openGraph: {
    title: 'The Sea Road from China to the Gulf',
    description:
      'The maritime route between Chinese ports and the Persian Gulf, told through Arab, Persian, Chinese and European books in Source Library.',
    images: [{ url: LEAD_IMAGE, alt: LEAD_ALT }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: LEAD_IMAGE, alt: LEAD_ALT }],
  },
  alternates: {
    canonical: '/articles/sea-road-china-gulf',
  },
});

function Section({ children }: { children: React.ReactNode }) {
  return <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-secondary leading-relaxed mb-6">{children}</p>;
}

const IMG = (id: string, page: number) =>
  `https://images.sourcelibrary.org/pages/${id}/${String(page).padStart(4, '0')}.jpg`;

const COSTA = 'tractado-de-las-drogas-y-medicinas-de-las-indias-orientales-costa';
const COSTA_ID = '69ef286185daccce30f2ca01';
const KHORDADBEH = 'khordadbeh';
const KHORDADBEH_ID = '6a9f341a9a132af385445c23';
const FAQIH = 'al-hamadhani';
const FAQIH_ID = '6a9f34409a132af385446091';
const RUSTAH = 'al-a-laq-al-nafisa-rustah';
const RUSTAH_ID = '69ea3ea1300d991d0f1d3bd6';
const HAWQAL = 'kitab-surat-al-ard-bga-ii-goeje';
const HAWQAL_ID = '6aa84cd9483bd3ad2caed139';
const QAZWINI = 'aja-ib-al-makhluqat-ms-nn-3-74-al-qazwini';
const QAZWINI_ID = '69907bdc5f855ec553e7177b';
const POLO = 'il-milione-polo';
const POLO_ID = '69e961732beefe2f6f72b7d9';
const BATTUTA = 'rihlat-ibn-battuta-battuta';
const BATTUTA_ID = '69e96123390d3ed634590b97';
const WUBEI = 'treatise-on-armament-technology-wubei-zhi-3';
const WUBEI_ID = '6992cf3bf5b4f75c1a4c84bd';
const WEI16 = 'illustrated-gazetteer-of-the-maritime-kingdoms-vol-16';
const WEI16_ID = '6992cf77f5b4f75c1a4c8f7f';
const WEI8 = 'illustrated-treatise-on-the-maritime-kingdoms-vol-8';
const WEI8_ID = '6992cf4ef5b4f75c1a4c891d';
const LINSCHOTEN = 'itinerario-voyage-ofte-schipvaert-naer-oost-ofte-portugaels-linschoten';
const LINSCHOTEN_ID = '69a5d8d3a63a00aaae8aab0d';
const ORTA = 'aromatum-et-simplicium-aliquot-medicamentorum-apud-indos-trans';
const ORTA_ID = '69ef285385daccce30f2c71d';
const KAEMPFER = 'amoenitatum-exoticarum-persia-and-asia-observations-kaempfer';
const KAEMPFER_ID = '6959106fecb01322b306752b';

export default function SeaRoadPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title="The Sea Road from China to the Gulf"
          subtitle="Lost fleets, gold thrown into the sea, musk the customs men could smell, and the star chart to Hormuz: stories from the sea route between Guangzhou, Quanzhou, Calicut, Siraf and Hormuz"
          image={LEAD_IMAGE}
          imageAlt={LEAD_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">11 November 2026 &middot; 22 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          The people of Hormuz, a Portuguese physician wrote in 1578, kept a story in their books about a fleet
          from China that came in on a single tide and was lost all at once.
        </p>

        <SourceQuote
          book={COSTA}
          page={38}
          printedPage={8}
          src={IMG(COSTA_ID, 38)}
          source={<>Cristóvão da Costa, <em>Tractado de las drogas</em> (Burgos, 1578), English translation by Source Library</>}
          pageAlt="Page 8 of da Costa’s Tractado, on cinnamon, with printed side-notes reading ‘Where the error was born’ and ‘Note’"
        >
          &hellip;the people of Hormuz recount that they find it written in their books, that in a single tide, four
          hundred large ships entered the Island of Geru (which is now called Hormuz), and that all at once they were
          lost together on the shoals&hellip;
        </SourceQuote>

        <P>
          The sentence finishes overleaf:{' '}
          <Link href={`/book/${COSTA}?page=39`}>
            on the shoals &ldquo;of Chilao, numbering more than two hundred ships&rdquo;
          </Link>
          . Cristóvão da Costa tells it in his chapter on cinnamon, and then lists what such ships had carried:
          gold, silk, musk, seed pearl, porcelain, copper and alum from China; sandalwood, nutmeg, mace and cloves
          from Malacca; cinnamon from Ceylon; pepper and cardamom from Malabar, taken on to Hormuz and the coast of
          Arabia and from there to Alexandria, Aleppo and Damascus.
        </P>

        <P>
          Nobody should count the four hundred ships. But the road behind the story is real. It ran from the river
          ports of southern China past Champa and through the straits by Sumatra, across to Ceylon and up the
          Malabar coast, then over the Arabian Sea to Oman and into the Persian Gulf. These are some of the things
          that happened on it, told by the people who sailed it, taxed it or wrote it down.
        </P>

        <Section>A thousand dirhams for water</Section>

        <P>
          In the ninth century the ships for China loaded at Siraf, on the Persian shore of the Gulf. A merchant
          known only as Sulayman explained why, and the geographer Ibn al-Faqih copied him:{' '}
          <Link href={`/book/${FAQIH}?page=19`}>
            &ldquo;most Chinese ships carry from Basra and Oman, and between them is Siraf. This is due to the many
            waves in this sea and the shallow water in parts of it.&rdquo;
          </Link>{' '}
          From Siraf the ships ran down the Gulf to Muscat for water. On the way was a narrow passage between two
          mountains of Oman, the Durdur, &ldquo;traversed by small ships but not by Chinese ships&rdquo;. Then they
          struck out for India, and at the first port on the other side they paid:
        </P>

        <SourceQuote
          book={FAQIH}
          page={19}
          printedPage={11}
          src={IMG(FAQIH_ID, 19)}
          source={<>Ibn al-Faqih, <em>Mukhtasar Kitab al-Buldan</em>, ed. de Goeje (Leiden), English translation by Source Library</>}
          pageAlt="Page 11 of de Goeje’s Arabic edition of Ibn al-Faqih, with the passage on Siraf, Muscat and Kulam Mali and the editor’s notes below"
        >
          The ship then snatches from there to the lands of India and heads for Kulam Mali. In it is a garrison for
          the lands of India, and it has fresh water. When they take fresh water from there, they collect one
          thousand dirhams from a Chinese vessel and ten dinars from others.
        </SourceQuote>

        <P>
          Kulam Mali is Quilon, on the Malabar coast. A thousand silver dirhams for a Chinese ship against ten gold
          dinars for anyone else: the China ships were the giants of the sea, and the harbour charged them like it.
        </P>

        <P>
          Across the Bay of Bengal the next stop was stranger. On islands between Quilon and the Malay coast lived{' '}
          <Link href={`/book/${FAQIH}?page=20`}>a people called the Lanj</Link>, who &ldquo;do not wear clothes&rdquo;
          and came out to the ships in skiffs with coconuts and a white coconut wine, &ldquo;sweet like honey&rdquo;
          when fresh, intoxicating after a day, sour after several. They sold ambergris for pieces of iron, and
          &ldquo;they trade by signs, hand to hand.&rdquo; These are the Nicobar Islands. Then came the Malay
          coast, Tioman for water, Champa, Khmer, and China.
        </P>

        <ContextNote title="Who wrote the road down">
          <p>
            Most of what we know about the early sea road comes from geographers working for or near the Abbasid
            caliphs of Baghdad in the ninth and tenth centuries. Ibn Khordadbeh was a Persian who ran the
            caliph&rsquo;s post and intelligence service; his <em>Book of Roads and Kingdoms</em> is a list of routes
            with distances and goods. Ibn al-Faqih and Ibn Rustah wrote general geographies a generation later; Ibn
            Hawqal travelled the Islamic world himself. None of them sailed to China. They copied merchants and
            sailing directions, which is why the same stages, prices and marvels turn up in book after book. The
            texts read here are the Arabic editions that M. J. de Goeje printed at Leiden in his{' '}
            <em>Bibliotheca Geographorum Arabicorum</em>.
          </p>
        </ContextNote>

        <Section>&ldquo;This is my treasury&rdquo;</Section>

        <P>
          Ibn Khordadbeh gives the road east of India as a chain of stages, and halfway along it he stops for a king.
          Zabaj was the Arabs&rsquo; name for the Sumatran kingdom that controlled the straits.
        </P>

        <SourceQuote
          book={KHORDADBEH}
          page={76}
          printedPage={68}
          src={IMG(KHORDADBEH_ID, 76)}
          source={<>Ibn Khordadbeh, <em>Kitab al-Masalik wa&rsquo;l-Mamalik</em>, ed. de Goeje (Leiden), English translation by Source Library</>}
          pageAlt="Page 68 of de Goeje’s edition of Ibn Khordadbeh, Arabic text on the Maharaja of Zabaj and the start of the route to China"
        >
          The King of al-Zabaj is called the Maharaja. In his kingdom is an island called Bartayil, where the sound
          of lutes and drums is heard all night; seafarers say that the Antichrist is there. &hellip; The Maharaja
          has a tax revenue that reaches two hundred <em>mann</em> of gold every day. He fashions it into bricks and
          throws them into the water, saying: &ldquo;This is my treasury.&rdquo;
        </SourceQuote>

        <P>
          He made another fifty <em>mann</em> a day from cockfighting, because he took the leg of every winning cock
          and its owner had to buy it back. Under the heading &ldquo;The Route to China&rdquo; the same page goes on to
          Champa, whose aloeswood is the best &ldquo;because it sinks in water due to its quality and weight&rdquo;.
          Overleaf come{' '}
          <Link href={`/book/${KHORDADBEH}?page=77`}>the ports of China</Link>: Luqin, &ldquo;the first of the ports
          of China&rdquo;, with its silk and fine porcelain; then Khanfu, &ldquo;the largest port&rdquo;, which is
          Guangzhou; and in every one of them &ldquo;a great river that ships enter, where there are tides.&rdquo;
          Beyond China lay the land of al-Waqwaq, so rich in gold &ldquo;that the inhabitants make the chains of their
          dogs and the collars of their monkeys from gold.&rdquo;
        </P>

        <P>
          The gold bricks had a long life. Four hundred years later the Persian <em>Wonders of Creation</em> of
          Zakariya al-Qazwini, in a manuscript now at Cambridge, still tells of{' '}
          <Link href={`/book/${QAZWINI}?page=110`}>
            a king named Maharaj who &ldquo;receives a hundred <em>manns</em> of gold every day&rdquo;
          </Link>{' '}
          and has it made into bricks and thrown into the sea, &ldquo;and his treasury is there.&rdquo; The number
          has halved, the story has not changed.
        </P>

        <Section>White wings before a calm</Section>

        <P>
          Al-Qazwini also passes on a piece of sailors&rsquo; weather lore. In the Sea of China, when the water is
          about to fall calm, a fish rises from the bottom and white wings appear on the surface; when it lays its
          eggs on a scrap of floating debris in mid-sea, &ldquo;it is known that it is the time for the sea to become
          calm.&rdquo; Then he lists the rest of the sea&rsquo;s dangers and treasures in a breath:
        </P>

        <SourceQuote
          book={QAZWINI}
          page={110}
          printedPage="fol. 54v"
          src={IMG(QAZWINI_ID, 110)}
          source={<>al-Qazwini, <em>&lsquo;Aja&rsquo;ib al-makhluqat</em>, Persian version, Cambridge University Library MS Nn.3.74, English translation by Source Library</>}
          pageAlt="A page of a Persian manuscript of Qazwini’s Wonders of Creation in a gold-ruled frame, with a heading in gold for the chapter on the islands of China"
        >
          In this sea, there are pearls in the water, and it happens that these are precious for the divers. In some
          of its islands, there are mines of pearls, and in it are animals of strange shapes. In this sea, there is
          a whirlpool that, if any ship falls into it, nothing comes out. The wonders of this sea are many. And God
          knows best.
        </SourceQuote>

        <P>
          The next leaf, which carries a painting, goes on with the islands of China:{' '}
          <Link href={`/book/${QAZWINI}?page=111`}>
            parrots &ldquo;that repeat whatever they hear&rdquo;, a green peacock, and &ldquo;creatures in the form of
            humans&rdquo; with wings and feathers
          </Link>
          , white, black and green.
        </P>

        <Section>Musk that gave itself away</Section>

        <P>
          Goods went west along the road too, and one of them could be smelled from the shore. Ibn Rustah, writing
          in Isfahan in the early tenth century, quotes an older writer on the grades of musk: Tibetan first, then
          Sogdian, then Chinese, and the best Chinese musk came by sea.
        </P>

        <SourceQuote
          book={RUSTAH}
          page={25}
          src={IMG(RUSTAH_ID, 25)}
          source={<>Ibn Rustah, <em>al-A&lsquo;laq al-Nafisa</em>, ed. de Goeje, English translation by Source Library</>}
          pageAlt="Arabic page of Ibn Rustah’s Precious Records with the passage on the grades of musk"
        >
          The best of the Chinese is what is brought from Khanfu, which is the great city that is in the port of
          China, where the ships of Muslim merchants anchor. Then it is carried by sea to al-Ubulla. When it nears
          the land of al-Ubulla, its scent intensifies, and the merchants cannot hide it from the tax collectors.
          When it exits the ship, its scent becomes excellent, and the smell of the sea leaves it.
        </SourceQuote>

        <P>
          Al-Ubulla was the port of Basra, at the head of the Gulf. The musk made the whole run from Guangzhou and
          then announced itself to the customs men as it came up the river.
        </P>

        <P>
          The money stayed at Siraf. Ibn Hawqal, in the tenth century, found it almost the size of Shiraz, the
          provincial capital, built of teak brought from East Africa,{' '}
          <Link href={`/book/${HAWQAL}?page=200`}>
            in storeys on the edge of the sea, where &ldquo;a merchant might spend more than thirty thousand dinars
            on his house&rdquo;
          </Link>
          . In the notes on the same page de Goeje prints, in Arabic only, a passage found in one manuscript about
          a Siraf merchant called Ramisht. His clerk, the writer says, came back from China with goods worth five
          hundred thousand dinars; and Ramisht himself took down the silver water-spout of the Ka&lsquo;ba, put up
          one of gold, and hung the shrine with Chinese cloth &ldquo;whose value no one knows&rdquo;. (That is my
          reading of the Arabic note; the library&rsquo;s translation of the page leaves the notes out.)
        </P>

        <ContextNote title="What the monsoon meant">
          <p>
            Ships on this road did not sail when they liked. The monsoon winds of the Indian Ocean blow from one
            quarter for half the year and from the other for the rest, so a voyage was timed to the season and a
            ship that missed it waited months for the next. In the 1590s Linschoten gives the sailing season from
            Goa to Hormuz as{' '}
            <Link href={`/book/${LINSCHOTEN}?page=36`}>January to March, and again September and October</Link>.
            The rainy months on the Malabar coast were hard on cargo too: Garcia de Orta warns that rhubarb landed
            in India in May was{' '}
            <Link href={`/book/${ORTA}?page=171`}>
              &ldquo;completely useless&rdquo; unless used before September
            </Link>
            , spoiled by &ldquo;those four winter months, which are June, July, August, and September.&rdquo; A
            run from China to the Gulf usually took more than one season, with a long stop on the way.
          </p>
        </ContextNote>

        <Section>A customs inspector at Quanzhou</Section>

        {/* TODO(zhufan-zhi): quote the Chinese edition once translated. Book (hidden until QA):
            slug zhufan-zhi-records-of-the-foreign-peoples-hanhai-edition-zhao-rugua
            大食國 (Arabs) pp. 51-57, voyage from Quanzhou on pp. 51-52; 施那幃 and the burial ground p. 57;
            甕蠻國 (Oman) p. 62; 記施國 (Kish) p. 63. Do not quote Hirth & Rockhill. */}
        <P>
          At the Chinese end, the man who heard the most about the road was Zhao Rugua, Inspector of Foreign Trade
          at Quanzhou in Fujian in the early thirteenth century. His <em>Zhufan zhi</em> (諸蕃志, &ldquo;Records of
          the Foreign Peoples&rdquo;) sets down what the merchants in his port told him about their countries. On
          the Arabs he begins with the length of the voyage: foreign ships leaving Quanzhou took some forty days to
          reach Lambri in northern Sumatra, traded there, and sailed on the following year, about sixty days with
          the seasonal wind. He knew Oman as the place where traders bought horses, pearls and dates, and he
          recorded a man who stayed: an Arab merchant settled in the southern suburb of Quanzhou who paid for a
          burial ground for foreign traders who died far from home.
        </P>

        <ContextNote title="Mongols on land and sea">
          <p>
            In the thirteenth century the Mongols conquered both ends of the road. Kublai Khan ruled China and took
            the southern ports, Quanzhou among them, when the Song fell; his kinsmen, the Ilkhans, ruled Persia. For
            a few decades one family held the overland routes and the two great terminals of the sea road, and
            envoys, brides and merchants moved between the two courts. That is why a Venetian could sail from
            Quanzhou to Hormuz as an escort to a Mongol princess, and why a Moroccan envoy from Delhi could expect a
            Chinese ship to take him to Kublai&rsquo;s successors.
          </p>
        </ContextNote>

        <Section>Fourteen ships, six hundred dead</Section>

        <P>
          Arghun, the Mongol ruler of Persia, had sent to Kublai Khan for a new wife of his late wife&rsquo;s
          family. War had closed the land road, so the envoys asked to go by sea and to take the three
          Venetians, Niccolò, Maffeo and Marco Polo, &ldquo;who were experienced in navigating those seas&rdquo;.
          Kublai did not want to lose them, and let them go anyway. They sailed around 1291.
        </P>

        <SourceQuote
          book={POLO}
          page={56}
          printedPage={18}
          src={IMG(POLO_ID, 56)}
          source={<>Marco Polo, <em>Il Milione</em> (Florence, 1827), English translation by Source Library</>}
          pageAlt="Page 18 of the 1827 Florence edition of Il Milione, Italian text of the prologue on the departure by sea"
        >
          He then had fourteen ships prepared, each of which had four masts and could sail with nine sails. How these
          were constructed could be described, but as it is a lengthy subject, it is left aside for the present.
          Among the said ships, there were at least four or five that carried between two hundred and fifty and two
          hundred and sixty sailors.
        </SourceQuote>

        <P>
          Three months took them to &ldquo;an island towards the south named Java&rdquo;, which the editor explains is
          Sumatra. Then they{' '}
          <Link href={`/book/${POLO}?page=56`}>
            &ldquo;navigated the Indian Sea for eighteen months&rdquo;
          </Link>
          . The cost is on the next page:{' '}
          <Link href={`/book/${POLO}?page=57`}>
            &ldquo;about six hundred people died among the sailors and others who were in said ships; and of the
            three ambassadors, only one remained, whose name was Goza&rdquo;
          </Link>
          . When they arrived, Arghun was dead. The bride was given to his son Ghazan.
        </P>

        <P>
          They had sailed from Zaitun, the Arab and Persian name for Quanzhou, Zhao Rugua&rsquo;s port. So much
          pepper came in there, Polo says, that{' '}
          <Link href={`/book/${POLO}?page=391`}>
            what reached Europe through Alexandria was &ldquo;almost one percent in comparison to this&rdquo;
          </Link>
          . The Khan took a tenth of every cargo and the ship charged up to forty-four per cent freight, so a
          merchant paid away half of what he brought, &ldquo;and yet, from that half which remains to them, they make
          such large profits that they wish to return at every hour with other merchandise.&rdquo;
        </P>

        <P>
          He also explains why the big Chinese ships survived the sea. Their holds were divided into sealed
          compartments, and he has a reason ready for needing them: at night a whale sees the water foaming white
          along the hull, takes it for food, charges, and{' '}
          <Link href={`/book/${POLO}?page=397`}>
            &ldquo;often breaks it in some part&rdquo;
          </Link>
          . Then the crew empty only the flooded hold, &ldquo;because the water cannot pass from one hold to another,
          since they are so well fitted.&rdquo;
        </P>

        <P>
          The boats at the other end of the road frightened him. At Hormuz, where{' '}
          <Link href={`/book/${POLO}?page=92`}>
            &ldquo;arrive all the merchants from all parts of India with spices, precious stones, pearls, cloths of
            gold and of silk, elephant teeth&rdquo;
          </Link>
          , the ships were sewn together:
        </P>

        <SourceQuote
          book={POLO}
          page={94}
          printedPage={56}
          src={IMG(POLO_ID, 94)}
          source={<>Marco Polo, <em>Il Milione</em> (Florence, 1827), English translation by Source Library</>}
          pageAlt="Page 56 of the 1827 Il Milione, chapter 16, on the ships of Ormus, with the editor’s long note on sewn boats"
        >
          The ships of Ormus are very bad and dangerous, whence the merchants and others often find themselves in
          peril in them; and the cause is this, because they are not fastened with nails&hellip; Each ship has only
          one mast, and one rudder, and one deck, and when it is loaded, it is covered with leather, and above the
          leather they place the horses that are led into India.
        </SourceQuote>

        <Section>Three months at Calicut</Section>

        <P>
          Ibn Battuta of Tangier reached Calicut in the 1340s as the Sultan of Delhi&rsquo;s envoy to China, with a
          gift for the emperor. The chief of the merchants, a man from Bahrain, came out to meet him{' '}
          <Link href={`/book/${BATTUTA}?page=448`}>
            with &ldquo;drums, trumpets, and flags on their boats&rdquo;
          </Link>
          . Thirteen Chinese ships lay in the harbour, and the party waited three months for the season. In the
          meantime he described the ships:
        </P>

        <SourceQuote
          book={BATTUTA}
          page={448}
          printedPage={140}
          src={IMG(BATTUTA_ID, 448)}
          source={<>Ibn Battuta, <em>Rihla</em>, Arabic text, English translation by Source Library</>}
          pageAlt="Arabic page of Ibn Battuta’s Rihla, on Calicut and the start of the description of the Chinese ships"
        >
          The sea of China is not traveled except in Chinese ships. Let us mention their order. The Chinese ships are
          of three kinds: the large ones are called Junūt, one of them is called a Junk; the medium ones are called
          Zaw; and the small ones are called Kakam. A large ship among them has twelve sails or fewer, down to three.
          Their sails are made of bamboo rods woven like mats, which are never lowered; they rotate them according to
          the rotation of the wind.
        </SourceQuote>

        <P>
          When the time came, he sent his servants, his slave girls and his goods aboard a small <em>kakam</em> and
          stayed ashore for the Friday prayer. That evening the sea got up, as it did every afternoon there, and no
          one could board. He slept on the beach on a mat. In the morning a junk bound to winter up the coast was
          thrown on the shore and broke. A merchant offered ten dinars to whoever would save his slave girl, who
          was clinging to the stern, and{' '}
          <Link href={`/book/${BATTUTA}?page=450`}>
            &ldquo;one of the Hormuzian sailors came and rescued her. He refused to take the dinars&rdquo;
          </Link>
          . That night the junk carrying the Sultan&rsquo;s gift was wrecked too, &ldquo;and everyone on board
          died.&rdquo; He buried the two officers who had sailed with the gift; one had a nail driven through his temples.
          The crew of the <em>kakam</em>, seeing all this, &ldquo;raised their sails and departed, taking with them
          all my luggage, my servants, and my slave girls.&rdquo;
        </P>

        <P>
          He was left with{' '}
          <Link href={`/book/${BATTUTA}?page=451`}>
            &ldquo;nothing but the ten dinars the Yogi had given me and the mat I used to sleep on&rdquo;
          </Link>
          , and went ten days by river to Quilon, through forests of cinnamon and sappanwood that the
          boatmen burned for firewood. Quilon, he says, is &ldquo;the first to which ships travel from the lands of
          Malabar to China&rdquo;: the same Kulam Mali where, five hundred years earlier, a Chinese ship paid a
          thousand dirhams for water.
        </P>

        <P>
          Years later, after the Maldives, Ceylon and Sumatra, he did reach China, and landed where Polo had
          sailed from:
        </P>

        <SourceQuote
          book={BATTUTA}
          page={505}
          printedPage={197}
          src={IMG(BATTUTA_ID, 505)}
          source={<>Ibn Battuta, <em>Rihla</em>, Arabic text, English translation by Source Library</>}
          pageAlt="Arabic page of Ibn Battuta’s Rihla, on the safety of Chinese roads and the arrival at Zaytun"
        >
          When we crossed the sea, the first city we reached was the city of Zaytun. This city has no olives, nor
          does all the land of China and India, but it is a name placed upon it. &hellip; Its harbor is one of the
          greatest harbors in the world; indeed, it is the greatest. I saw in it about a hundred large junks, and as
          for the small ones, they are beyond count.
        </SourceQuote>

        <P>
          <em>Zaytun</em> means olive in Arabic, hence the joke. On the same page he describes the inns on the
          Chinese roads, where an official locked the Muslim travellers in each night, called the roll each morning
          and sent them on with an escort who had to bring back a receipt. &ldquo;The land of China is the safest
          land and the best in condition for travelers.&rdquo;
        </P>

        <ContextNote title="The Ming voyages">
          <p>
            Between 1405 and 1433 the Ming court sent seven great fleets into the Indian Ocean under the palace
            eunuch Zheng He. They reached Calicut on the first voyage and Hormuz on the fourth, and later squadrons
            went on to Aden, Dhofar and East Africa. The voyages were about prestige and tribute more than trade:
            rulers along the way sent envoys and gifts to the emperor and were rewarded. The Ming history, as Wei
            Yuan quotes it, says that when Dhofar sent envoys with those of Aden in 1421,{' '}
            <Link href={`/book/${WEI16}?page=48`}>
              &ldquo;the Emperor ordered Zheng He to carry the imperial seal and gifts to reward them&rdquo;
            </Link>
            . After 1433 the fleets stopped, and the court turned away from the sea.
          </p>
        </ContextNote>

        <Section>Stars to Hormuz</Section>

        <P>
          In 1621 Mao Yuanyi, a writer on military affairs, printed a set of sea charts from Zheng He&rsquo;s voyages
          in chapter 240 of his huge treatise on armament, the <em>Wubei zhi</em> (武備志). He explains why a
          military book should keep them:
        </P>

        <SourceQuote
          book={WUBEI}
          page={44}
          src={IMG(WUBEI_ID, 44)}
          source={<>Mao Yuanyi, <em>Wubei zhi</em> (1621), chapter 240, English translation by Source Library</>}
          pageAlt="Page of the Wubei zhi in Chinese with the end of Mao Yuanyi’s preface to the navigation chapter"
        >
          At that time, the palace attendant Zheng He likewise did not disgrace his imperial commission. His charts
          record the routes, distances, and foreign territories in detail and without falsehood. They are preserved
          here to display these accomplishments to future generations and to record military achievements.
        </SourceQuote>

        <P>
          The chart is a long strip cut into pages: coasts along the top and bottom, islands drawn as little
          mountains, sailing courses as dotted lines between. Off southern Vietnam, among islands called Overturned
          Cauldron Mountain and Bronze Drum Mountain, one line of text records the fleet itself.
        </P>

        <PageFigure
          src={IMG(WUBEI_ID, 67)}
          alt="Woodblock page from the Wubei zhi chart: islands drawn as small mountains, dotted sailing courses, and a line of text along a course recording Zheng He’s passage in 1416"
          href={`/book/${WUBEI}?page=67`}
          source={<>Mao Yuanyi, <em>Wubei zhi</em> (1621)</>}
        >
          A page of the chart around Pulo Condore (崑崙山, &ldquo;Kunlun Mountain&rdquo;). The line along the course
          reads, in the library&rsquo;s translation, &ldquo;Kunlun Mountain. In the 14th year of the Yongle reign
          [1416], the Principal Envoy, Grand Eunuch Zheng He, arrived here while traveling to the Western
          Ocean.&rdquo;
        </PageFigure>

        <P>
          For the open-sea crossings, where there was no coast to follow, the chapter ends with four star charts.
          Each shows a ship under sail in the middle of the page with the stars to look for around it, and their
          height above the horizon measured in &ldquo;fingers&rdquo;. All four are for the Indian Ocean.{' '}
          <Link href={`/book/${WUBEI}?page=86`}>The first is for Hormuz</Link>.
        </P>

        <div className="max-w-lg mx-auto">
          <PageFigure
            src={IMG(WUBEI_ID, 86)}
            alt="Star chart from the Wubei zhi: a three-masted junk with matting sails in the centre, surrounded by small star diagrams and columns of text giving their altitudes"
            href={`/book/${WUBEI}?page=86`}
            source={<>Mao Yuanyi, <em>Wubei zhi</em> (1621)</>}
          >
            The star chart for the crossing to Hormuz. The top right column reads, in the library&rsquo;s
            translation: &ldquo;When sailing from Dingdebaqi to Hormuz, observe the North Star at fourteen
            fingers.&rdquo; Dingdebaqi is Ras al-Hadd, the eastern tip of Oman.
          </PageFigure>
        </div>

        <P>
          Around the ship the other labels give the Southern Cross, called the Lantern Bone Star, at four and a half
          fingers on reaching &ldquo;Shaguma Mountain&rdquo;, probably near the Strait of Hormuz; Vega, the Weaver
          Girl, at seven fingers to the east; and Alpha and Beta Centauri, the South Gate Double Stars, at six.
        </P>

        <ContextNote title="The Portuguese arrive">
          <p>
            In 1498 Vasco da Gama&rsquo;s ships came round Africa to Calicut. The Portuguese did not join the old
            trade as one more set of merchants; they set out to control it with forts and armed fleets, based at Goa
            from 1510. Afonso de Albuquerque took Hormuz in 1515, and the Portuguese held it for a century, until
            the Persians, with English ships, drove them out in 1622. By the time they arrived, the Chinese junks
            were a memory on the Malabar coast: da Costa says the Chinese had once kept{' '}
            <Link href={`/book/${COSTA}?page=196`}>
              a house of trade at Calicut, &ldquo;called to this day Chinacota&rdquo;
            </Link>
            .
          </p>
        </ContextNote>

        <Section>Sleeping in tubs at Hormuz</Section>

        <P>
          The Dutchman Jan Huyghen van Linschoten served the Archbishop of Goa in the 1580s and described Portuguese
          Hormuz in his <em>Itinerario</em> of 1596. It was the Hormuz Polo knew, and still unbearably hot.
        </P>

        <SourceQuote
          book={LINSCHOTEN}
          page={36}
          printedPage={12}
          src={IMG(LINSCHOTEN_ID, 36)}
          source={<>Jan Huyghen van Linschoten, <em>Itinerario</em> (Amsterdam, 1596), English translation by Source Library</>}
          pageAlt="Page 12 of Linschoten’s Itinerario in Dutch black letter, two columns headed Van’t Eylandt Ormus, with printed side-notes"
        >
          Returning again to our outpost of the Island of Hormuz, which lies at 27 degrees; in the summer (which comes
          at the same time as in our lands) it is so exceedingly and unbearably hot that one must sleep in wooden
          tubs (made for that purpose) full of water, lying naked, man and wife, entirely under the water except for
          the head.
        </SourceQuote>

        <P>
          The island had no fresh water. It came over from the mainland and was stored in great jars and cisterns,
          and some came from Bahrain, where divers went down four or five fathoms under the salt sea to a spring
          &ldquo;as sweet and good as the best fountain water&rdquo;. The same page has a sickness of worms that grew
          in the legs, as long as lute-strings, which had to be wound out a little each day on a straw; a servant of
          the Archbishop pulled three or four out of his own legs. And it has the money: the captain of Hormuz alone
          could ship horses to India, where they sold for four or five hundred <em>pardaos</em> each and sometimes a
          thousand.
        </P>

        <P>
          Linschoten&rsquo;s Hormuz was copied for a century. When Engelbert Kaempfer, who served the Dutch East
          India Company at Bandar Abbas in the 1680s, published his <em>Amoenitates exoticae</em> in 1712, the view of
          Hormuz on his map of the Gulf was still taken &ldquo;from Linschoten&rdquo;, though the Portuguese had been
          gone for ninety years and the town was in ruins.
        </P>

        <PageFigure
          src={IMG(KAEMPFER_ID, 851)}
          alt="Part of a folding plate in Kaempfer’s Amoenitates exoticae: an engraved view of Hormuz from the sea with ships, a small plan of the island, and a fortress on Qeshm, set into a map of the Gulf"
          href={`/book/${KAEMPFER}?page=851`}
          source={<>Engelbert Kaempfer, <em>Amoenitates exoticae</em> (Lemgo, 1712)</>}
        >
          Hormuz &ldquo;after Linschoten&rdquo; in the corner of Kaempfer&rsquo;s map of the Gulf, with a plan of
          the island and below it the castle on Qeshm. The scan shows the plate partly folded. The picture at the
          top of this article is taken from it.
        </PageFigure>

        <ContextNote title="The Opium War and Wei Yuan">
          <p>
            By the nineteenth century the ships on the road were European, and they came to China. Britain&rsquo;s
            trade at Canton ran on opium from India, and when the Qing commissioner Lin Zexu destroyed the
            British stocks in 1839, Britain went to war. The First Opium War ended in 1842 with the Treaty of
            Nanjing: Hong Kong ceded and five ports opened. Lin had collected and translated Western books on
            geography at Canton. His friend the scholar Wei Yuan used them, with the Chinese histories, to compile
            the <em>Haiguo tuzhi</em> (海國圖志, <em>Illustrated Treatise on the Maritime Kingdoms</em>) in 1842
            to 1844, so that China could learn about the countries now at its door.
          </p>
        </ContextNote>

        <Section>Hormuz from Canton, 1844</Section>

        <P>
          In the volume on the western Indian Ocean Wei Yuan quotes a Chinese geography of 1674 by the Flemish
          Jesuit Ferdinand Verbiest on Hormuz:
        </P>

        <SourceQuote
          book={WEI16}
          page={47}
          src={IMG(WEI16_ID, 47)}
          source={<>Wei Yuan, <em>Haiguo tuzhi</em> (1844), quoting Verbiest&rsquo;s <em>Kunyu tushuo</em>, English translation by Source Library</>}
          pageAlt="Page of the Haiguo tuzhi in Chinese, with the passage from Verbiest on Hormuz and Wei Yuan’s small-print note"
        >
          The Illustrated Explanations of the Earth states that in A&rsquo;ermusi, the land consists entirely of salt
          and sulfur. Trees and vegetation do not grow there, and neither birds nor beasts leave any trace. People
          wear leather shoes; when rain passes over, the soles wear out within a single day. Earthquakes are
          frequent, and the climate is intensely hot, requiring people to sit or lie in water submerged up to their
          mouths for relief. There is no fresh water at all; every spoonful of water is brought by boat from
          overseas.
        </SourceQuote>

        <P>
          It is Linschoten&rsquo;s Hormuz, people lying in water and drinking water shipped from elsewhere, reaching
          China by way of a Jesuit long after the town had ceased to matter. Wei adds a note in small characters:
          the <em>History of the Ming</em> writes the name as Hulumusi, which is the name on Zheng He&rsquo;s star
          chart.
        </P>

        <P>
          Elsewhere he says plainly how far Chinese ships now went. Under the Qing the trade of the north-western
          seas came to China in foreign ships, and only in the southern seas did Chinese ships go out:
        </P>

        <SourceQuote
          book={WEI8}
          page={68}
          src={IMG(WEI8_ID, 68)}
          source={<>Wei Yuan, <em>Haiguo tuzhi</em> (1844), English translation by Source Library</>}
          pageAlt="Page of the Haiguo tuzhi in Chinese, the end of a chapter on the islands of the south-eastern seas"
        >
          Sailboats and crane-like ships traverse ten thousand miles, yet our domestic merchant ships reach only as
          far as India and the South Ocean; they do not reach the &ldquo;Lesser Western Ocean,&rdquo; let alone the
          &ldquo;Greater Western Ocean.&rdquo; The Ming dynasty eunuch Zheng He also only reached the Lesser Western
          Ocean and did not reach the Greater Western Ocean.
        </SourceQuote>

        <P>
          By the Lesser Western Ocean he means the Indian Ocean, and by the Greater, Europe&rsquo;s Atlantic.
        </P>

        <p className="text-sm text-muted leading-relaxed mt-16">
          <strong>Sources.</strong> Quotations are Source Library&rsquo;s English translations of the Arabic,
          Persian, Chinese, Italian, Latin, Spanish and Dutch pages linked; follow a link to read the page beside
          its scan. The Arabic geographers are read in de Goeje&rsquo;s Leiden editions. Zhao Rugua is paraphrased
          until the library&rsquo;s Chinese text is translated. Dates the pages do not give (Zheng He&rsquo;s voyages,
          the Portuguese at Hormuz, the Opium War) are the standard ones.
        </p>
      </article>
    </ContentPageLayout>
  );
}
