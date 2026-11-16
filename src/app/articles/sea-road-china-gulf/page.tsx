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
    'Pepper, musk, gold thrown into the sea and four hundred ships at Hormuz: the ocean road from China to the Persian Gulf in the words of the people who sailed, taxed and charted it.',
  openGraph: {
    title: 'The Sea Road from China to the Gulf',
    description:
      'The ocean road between the Persian Gulf, India and China, told from Arabic, Persian, Chinese, Latin, Italian, Spanish and Dutch books in Source Library.',
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
const PLINY = 'c-plinii-secundi-historiae-naturalis-libri-xxxvii-1510-elder';
const PLINY_ID = '69b2692ab42fc08a921c5c1b';
const KHORDADBEH = 'khordadbeh';
const KHORDADBEH_ID = '6a9f341a9a132af385445c23';
const FAQIH = 'al-hamadhani';
const FAQIH_ID = '6a9f34409a132af385446091';
const RUSTAH = 'al-a-laq-al-nafisa-rustah';
const RUSTAH_ID = '69ea3ea1300d991d0f1d3bd6';
const HAWQAL = 'kitab-surat-al-ard-bga-ii-goeje';
const QAZWINI = 'aja-ib-al-makhluqat-ms-nn-3-74-al-qazwini';
const QAZWINI_ID = '69907bdc5f855ec553e7177b';
// The Zhufan zhi (zhufan-zhi-records-of-the-foreign-peoples-hanhai-edition-zhao-rugua) is hidden, so its
// /book/ page 404s for readers: the text and the figure do not link to it until the book is visible.
const ZHUFAN_ID = '6af5744df1e1ade0853a24c4';
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
const KAEMPFER = 'amoenitatum-exoticarum-persia-and-asia-observations-kaempfer';
const KAEMPFER_ID = '6959106fecb01322b306752b';

const COSTA_SRC = (
  <>
    Cristóvão da Costa, <em>Tractado de las drogas</em> (Burgos, 1578), English translation by Source Library
  </>
);
const POLO_SRC = (
  <>
    Marco Polo, <em>Il Milione</em> (Florence, 1827), English translation by Source Library
  </>
);
const BATTUTA_SRC = (
  <>
    Ibn Battuta, <em>Rihla</em>, Arabic text, English translation by Source Library
  </>
);
const WUBEI_SRC = (
  <>
    Mao Yuanyi, <em>Wubei zhi</em> (1621), chapter 240
  </>
);

export default function SeaRoadPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          feature
          headerVariant="dark"
          title="The Sea Road from China to the Gulf"
          subtitle="Pepper bought by weight like gold, a king who threw his treasury into the sea, musk the customs men could smell, and four hundred ships on a single tide: the ocean road between China, India and the Persian Gulf, in the words of the people who sailed, taxed and charted it"
          image={LEAD_IMAGE}
          imageAlt={LEAD_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">11 November 2026 &middot; 24 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Pepper grows on a vine on the Malabar coast of India and almost nowhere else, and for two thousand years
          ships came for it from both directions: from the Red Sea and the Persian Gulf on one side, from the river
          ports of southern China on the other. This article is about the road between them, and the stories the
          people who sailed it told.
        </p>

        <P>
          Here is one. In 1578 a Portuguese physician who had practised in India, Cristóvão da Costa, published a
          book on the drugs of the East. In the middle of a chapter about cinnamon he passes on something he had
          been told at Hormuz, the island at the mouth of the Persian Gulf, about the days when Chinese ships came
          there.
        </P>

        <SourceQuote
          book={COSTA}
          page={38}
          printedPage={8}
          src={IMG(COSTA_ID, 38)}
          source={COSTA_SRC}
          pageAlt="Page 8 of da Costa’s Tractado, on cinnamon, with printed side-notes reading ‘Where the error was born’ and ‘Note’"
        >
          &hellip;the people of Hormuz recount that they find it written in their books, that in a single tide,
          four hundred large ships entered the Island of Geru (which is now called Hormuz)&hellip;
        </SourceQuote>

        <P>
          Da Costa does not vouch for the number. He had the story from the people of Hormuz, who had it from
          their books. The sentence does not end there, either: what became of the fleet is on the next page, and
          it comes at the end of this article.
        </P>

        <Section>Bought by weight like gold</Section>

        <P>
          &ldquo;In Malabar, in the forests of Cranganor next to the Mangate River, I took this leaf from the actual
          plant, Anno Domini 1569.&rdquo; Da Costa wrote that under a woodcut in his chapter on pepper. He drew the
          leaf himself, with a cluster of berries hanging from its stalk.
        </P>

        <div className="max-w-md mx-auto">
          <PageFigure
            src={IMG(COSTA_ID, 50)}
            alt="Woodcut of a single pepper leaf with its veins and a hanging cluster of round peppercorns, labelled Hembra (female), with a caption below saying it was taken from the plant at Cranganore in 1569"
            href={`/book/${COSTA}?page=50`}
            source={COSTA_SRC}
          >
            &ldquo;Pepper leaf, drawn from life.&rdquo; Da Costa&rsquo;s woodcut, with his note that he took the
            leaf from the plant near Cranganore in 1569.
          </PageFigure>
        </div>

        <P>
          The plant, he says,{' '}
          <Link href={`/book/${COSTA}?page=51`}>
            &ldquo;climbs like ivy, twisting and attaching itself to the tree it reaches&rdquo;
          </Link>
          . Growers put a cutting at the foot of a big tree or a stake,{' '}
          <Link href={`/book/${COSTA}?page=52`}>manured it with ox dung and ash</Link>, and had fruit within a year;
          the vine grew as tall as the tree it leaned on, and each cluster held thirty to fifty grains.
        </P>

        <P>
          They had been coming for a very long time. Fifteen hundred years before da Costa, Pliny the Elder set
          down the Roman voyage in his <em>Natural History</em>, read here in the Latin that Aldus printed at Venice
          in 1510. Ships left Egypt in midsummer, ran down the Red Sea to its mouth, and from
          there{' '}
          <Link href={`/book/${PLINY}?page=292`}>
            &ldquo;they sail for 40 days with the Hipalus wind to the first emporium of India, Muziris&rdquo;
          </Link>
          . The pepper came down to the coast from a district he calls Cottonara &ldquo;in single-log boats&rdquo;,
          and the ships sailed for home in December or January, &ldquo;thus it happens that they return in the
          same year.&rdquo; Muziris is usually placed near Cranganore, where da Costa picked his leaf. Pliny did not
          see the attraction.
        </P>

        <SourceQuote
          book={PLINY}
          page={597}
          src={IMG(PLINY_ID, 597)}
          source={
            <>
              Pliny the Elder, <em>Historiae naturalis libri XXXVII</em> (Venice: Aldus, 1510), book 12, English
              translation by Source Library
            </>
          }
          pageAlt="A page of the 1510 Aldine Pliny in Latin, with the passage on pepper, its kinds and its prices"
          original="Vsum eius adeo placuisse mirũ est. In alijs quippe suauitas cœpit in alijs species inuitauit. Huic hæc pomi: nec baccæ cõmendatio est aliqua. Sola placere amaritudine: & hanc in indos peti. Quis ille qui primus cibos experiri uoluit? aut cui in appetẽda auiditate esurire non fuit satius? Vtrũq; siluestre gẽtibus suis est: & tamẽ pondere emitur ut aurũ uel argentũ."
        >
          It is a wonder that its use has been so pleasing. In some things sweetness attracts, in others
          appearance. This one has no recommendation of fruit or berry. It pleases solely for its bitterness, and
          for this, it is sought among the Indians. Who was he who first wished to test food? Or for whom, in
          seeking out gluttony, was it not better to go hungry? Each is wild in its own lands, and yet it is bought
          by weight like gold or silver.
        </SourceQuote>

        <P>
          The Hipalus was the south-west monsoon. The rest of this article comes from the other end of the ocean,
          and starts eight hundred years after Pliny.
        </P>

        <Section>A thousand dirhams for water</Section>

        <P>
          In the ninth century a Chinese ship that stopped for water on the Malabar coast paid a thousand silver
          dirhams for it. Any other ship paid ten gold dinars. The figures come from a merchant called Sulayman,
          whose account of the road was written down around 851 and copied some fifty years later by the Persian
          geographer Ibn al-Faqih.
        </P>

        <SourceQuote
          book={FAQIH}
          page={19}
          printedPage={11}
          src={IMG(FAQIH_ID, 19)}
          source={
            <>
              Ibn al-Faqih, <em>Mukhtasar Kitab al-Buldan</em>, ed. de Goeje (Leiden), English translation by Source
              Library
            </>
          }
          pageAlt="Page 11 of de Goeje’s Arabic edition of Ibn al-Faqih, with the passage on Siraf, Muscat and Kulam Mali and the editor’s notes below"
        >
          The ship then snatches from there to the lands of India and heads for Kulam Mali. In it is a garrison for
          the lands of India, and it has fresh water. When they take fresh water from there, they collect one
          thousand dirhams from a Chinese vessel and ten dinars from others.
        </SourceQuote>

        <P>
          Kulam Mali is Quilon, now Kollam, a little south of Cranganore. Sulayman does not say why a Chinese ship
          paid so much more. The port comes back twice in this article.
        </P>

        <P>
          Sulayman also says where the voyage began.{' '}
          <Link href={`/book/${FAQIH}?page=19`}>
            &ldquo;Most Chinese ships carry from Basra and Oman, and between them is Siraf&rdquo;
          </Link>
          , because the head of the Gulf had too many waves and too little water for big hulls. Siraf was a harbour
          on the Persian shore. From there the ships ran down to Muscat for water, past a narrow place in the
          mountains of Oman &ldquo;traversed by small ships but not by Chinese ships&rdquo;, and struck out across
          the Arabian Sea for Quilon and its water bill.
        </P>

        <P>
          The crossing after that took them over the Bay of Bengal, and on the{' '}
          <Link href={`/book/${FAQIH}?page=20`}>next page</Link> of the itinerary is this. On a chain
          of islands lived a people called the Lanj, who &ldquo;do not wear clothes&rdquo;. They came out to the ships in skiffs with coconuts and a white coconut wine, &ldquo;sweet like
          honey&rdquo; when fresh, intoxicating after a day, sour after several. They wanted iron and paid for it in
          ambergris. &ldquo;They trade by signs, hand to hand.&rdquo; These are the Nicobar Islands. Beyond them lay
          the Malay coast, Tioman for water, Champa, and China.
        </P>

        <ContextNote title="Who wrote the road down">
          <p>
            Most of what survives about the early sea road comes from geographers writing in Arabic under or near
            the Abbasid caliphs of Baghdad in the ninth and tenth centuries. Ibn Khordadbeh, a Persian, ran the
            caliph&rsquo;s postal and intelligence service and wrote a <em>Book of Roads and Kingdoms</em>: routes,
            distances, tolls and goods. Ibn al-Faqih and Ibn Rustah wrote general geographies a generation later;
            Ibn Hawqal travelled widely. None of them sailed to China. They copied merchants&rsquo; accounts and one
            another, which is why the same stages, prices and marvels turn up in book after book. They are read here
            in the Arabic editions that M. J. de Goeje printed at Leiden from the 1870s.
          </p>
        </ContextNote>

        <Section>&ldquo;This is my treasury&rdquo;</Section>

        <P>
          Every day, the sailors said, the king of Zabaj had two hundred <em>mann</em> of gold cast into bricks and
          thrown into the water. Zabaj was the Arabs&rsquo; name for the Sumatran kingdom that held the straits
          between Sumatra and the Malay peninsula, the gate every ship to China had to pass. Ibn Khordadbeh put the
          story in his book of routes in the later ninth century, between a haunted island and the road to China.
        </P>

        <SourceQuote
          book={KHORDADBEH}
          page={76}
          printedPage={68}
          src={IMG(KHORDADBEH_ID, 76)}
          source={
            <>
              Ibn Khordadbeh, <em>Kitab al-Masalik wa&rsquo;l-Mamalik</em>, ed. de Goeje (Leiden), English translation
              by Source Library
            </>
          }
          pageAlt="Page 68 of de Goeje’s edition of Ibn Khordadbeh, Arabic text on the Maharaja of Zabaj and the start of the route to China"
        >
          The King of al-Zabaj is called the Maharaja. In his kingdom is an island called Bartayil, where the sound
          of lutes and drums is heard all night; seafarers say that the Antichrist is there. &hellip; The Maharaja
          has a tax revenue that reaches two hundred <em>mann</em> of gold every day. He fashions it into bricks and
          throws them into the water, saying: &ldquo;This is my treasury.&rdquo;
        </SourceQuote>

        <P>
          He made another fifty <em>mann</em> a day from cockfighting, because he took the leg of every winning cock
          and its owner had to buy it back. Then, under the heading &ldquo;The Route to China&rdquo;, the same page
          turns to business: Tioman with its aloeswood and camphor, Khmer five days on, and Champa, whose aloeswood
          was the best &ldquo;because it sinks in water due to its quality and weight.&rdquo;
        </P>

        <P>
          <Link href={`/book/${KHORDADBEH}?page=77`}>Overleaf come the ports of China.</Link> Luqin was &ldquo;the
          first of the ports of China&rdquo;, with silk and fine porcelain. Four days on by sea was Khanfu,
          &ldquo;the largest port&rdquo;, which is Guangzhou, the city Europeans later called Canton. &ldquo;In every
          port of the ports of China is a great river that ships enter, where there are tides.&rdquo;
        </P>

        <P>
          The gold bricks outlived the kingdom by centuries. Some four hundred years after Ibn Khordadbeh, Zakariya
          al-Qazwini, a judge from Qazvin who died in 1283, put the Maharaja into his <em>Wonders of Creation</em>,
          a book of the world&rsquo;s marvels that was copied and painted for centuries afterwards. In a Persian
          version now at Cambridge,{' '}
          <Link href={`/book/${QAZWINI}?page=110`}>
            the king &ldquo;receives a hundred <em>manns</em> of gold every day&rdquo;
          </Link>
          , has it made into bricks, and throws them into the sea, &ldquo;and his treasury is there.&rdquo; The sum
          has halved on the way.
        </P>

        <Section>White wings before a calm</Section>

        <P>
          A few lines above the Maharaja, on the same Cambridge page, is something a pilot would want to know. In
          the Sea of China, al-Qazwini says, there are times when the water lies still &ldquo;as if it were white
          wings&rdquo;, because a fish has risen from the bottom. &ldquo;When it lays its eggs in the middle of the
          sea on a piece of debris, it is known that it is the time for the sea to become calm.&rdquo; Then he
          lists the rest of that sea&rsquo;s dangers and treasures in a breath.
        </P>

        <SourceQuote
          book={QAZWINI}
          page={110}
          printedPage="fol. 54v"
          src={IMG(QAZWINI_ID, 110)}
          source={
            <>
              al-Qazwini, <em>&lsquo;Aja&rsquo;ib al-makhluqat</em>, Persian version, Cambridge University Library MS
              Nn.3.74, English translation by Source Library
            </>
          }
          pageAlt="A page of a Persian manuscript of Qazwini’s Wonders of Creation in a gold-ruled frame, with a heading in gold for the chapter on the islands of China"
        >
          In this sea, there are pearls in the water, and it happens that these are precious for the divers. In some
          of its islands, there are mines of pearls, and in it are animals of strange shapes. In this sea, there is
          a whirlpool that, if any ship falls into it, nothing comes out. The wonders of this sea are many. And God
          knows best.
        </SourceQuote>

        <P>
          The leaf that follows carries a painting. The islands of China, it says, have parrots &ldquo;that repeat
          whatever they hear&rdquo;, a green peacock, and{' '}
          <Link href={`/book/${QAZWINI}?page=111`}>
            &ldquo;creatures in the form of humans, and they have wings and feathers&rdquo;
          </Link>
          , white, black and green.
        </P>

        <div className="max-w-lg mx-auto">
          <PageFigure
            src={IMG(QAZWINI_ID, 111)}
            alt="Persian miniature in a gold frame: a tree with red blossoms sheltering two winged figures, among coloured rocks, a spotted deer, a peacock, a monkey and small birds, with a winged human figure standing at the lower left"
            href={`/book/${QAZWINI}?page=111`}
            source={
              <>
                al-Qazwini, <em>&lsquo;Aja&rsquo;ib al-makhluqat</em>, Cambridge University Library MS Nn.3.74
              </>
            }
          >
            The islands of China in the Cambridge manuscript: winged people in a tree, a deer, a peacock and a
            monkey, painted where the text describes them.
          </PageFigure>
        </div>

        <P>
          For a ship that moved only by the wind, a calm could mean weeks lost and water running short, and a sign
          that one was coming was worth writing down.
        </P>

        <ContextNote title="What the monsoon meant">
          <p>
            The winds of the Indian Ocean blow from the south-west for about half the year and from the north-east
            for the other half. A voyage was timed to them, and a ship that missed its season waited months for the
            next. Pliny&rsquo;s Hipalus was the south-west monsoon. In the 1590s Linschoten gives the sailing season
            from Goa to Hormuz as{' '}
            <Link href={`/book/${LINSCHOTEN}?page=36`}>
              January, February and March, and again September and October
            </Link>
            . The rains spoiled cargo too: Garcia de Orta says rhubarb landed in India in May was{' '}
            <Link href={`/book/${ORTA}?page=171`}>&ldquo;completely useless&rdquo; unless used before September</Link>
            . A run from China to the Gulf usually took more than one season, with long stops on the way.
          </p>
        </ContextNote>

        <Section>Musk that gave itself away</Section>

        <P>
          Pepper went west from Malabar. Musk went the whole length of the road the same way, from China to the
          head of the Gulf. Ibn Rustah, writing in Isfahan in the
          early tenth century, quotes an older writer, Ahmad ibn Abi Ya&lsquo;qub, on the grades of musk: Tibetan
          first, then Sogdian, then Chinese, and the best Chinese came by sea.
        </P>

        <SourceQuote
          book={RUSTAH}
          page={25}
          src={IMG(RUSTAH_ID, 25)}
          source={
            <>
              Ibn Rustah, <em>al-A&lsquo;laq al-Nafisa</em>, ed. de Goeje, English translation by Source Library
            </>
          }
          pageAlt="Arabic page of Ibn Rustah’s Precious Records with the passage on the grades of musk"
        >
          The best of the Chinese is what is brought from Khanfu, which is the great city that is in the port of
          China, where the ships of Muslim merchants anchor. Then it is carried by sea to al-Ubulla. When it nears
          the land of al-Ubulla, its scent intensifies, and the merchants cannot hide it from the tax collectors.
          When it exits the ship, its scent becomes excellent, and the smell of the sea leaves it.
        </SourceQuote>

        <P>
          Al-Ubulla was the port of Basra, at the far end of the road from Khanfu, Ibn Khordadbeh&rsquo;s
          &ldquo;largest port&rdquo;.
        </P>

        <P>
          Ibn Hawqal, later in the tenth century, found Siraf almost
          as large as Shiraz, the capital of the province, and built of teak and other timber brought from East
          Africa.{' '}
          <Link href={`/book/${HAWQAL}?page=200`}>
            Its houses rose in storeys on the edge of the sea, and &ldquo;a merchant might spend more than thirty
            thousand dinars on his house.&rdquo;
          </Link>{' '}
          At the foot of the same page de Goeje prints, in Arabic only, a note from one manuscript about a Siraf
          merchant named Ramisht, whose clerk came back from China with goods worth five hundred thousand dinars,
          and who replaced the silver water-spout of the Ka&lsquo;ba at Mecca with one of gold. That is my reading
          of the note; the library&rsquo;s translation gives the main text only.
        </P>

        <Section>A customs inspector at Quanzhou</Section>

        {/* TODO(zhufan-zhi): quote the Chinese edition once the library has translated it (0 of 140 pages
            translated at the time of writing). 大食國 (Arabs) pp. 51-57, the voyage from Quanzhou on pp. 51-52;
            施那幃 and the burial ground p. 57; 故臨 (Quilon); 甕蠻國 (Oman) p. 62; 記施國 (Kish) p. 63.
            Do not quote Hirth & Rockhill. */}
        <P>
          At the other end of the road, three centuries on, the man who collected the taxes also wrote the book. By
          then the main Chinese port for the western ocean had moved north-east from Guangzhou to Quanzhou in
          Fujian, which Arab and Persian sailors called Zaitun. Around 1225 its Inspector of Foreign Trade, Zhao
          Rugua, wrote the <em>Zhufan zhi</em> (
          諸蕃志, <em>Records of the Foreign Peoples</em>). He never went
          abroad. He asked the captains and merchants in his port about their countries and wrote down what they
          said.
        </P>

        <P>
          His chapter on the Arabs begins with the length of the voyage. Ships from Quanzhou took about forty days
          to reach Lambri in northern Sumatra, traded there, and went on the following year with the seasonal wind,
          about sixty days more. He knew Quilon, which he calls Gulin, as the place where traders bound for the Arab
          countries changed ships: Sulayman&rsquo;s Kulam Mali, seen from the other side. He knew Oman for horses,
          pearls and dates, and the island of Kish in the Gulf. He also recorded a man who stayed, a rich Arab
          merchant living in the southern suburb of Quanzhou, who paid for a cemetery where foreign traders who
          died far from home could be buried. The library&rsquo;s Chinese text is not yet translated; when it is,
          his own words will go here.
        </P>

        <div className="max-w-md mx-auto">
          <PageFigure
            src={IMG(ZHUFAN_ID, 51)}
            alt="Woodblock-printed page of Chinese text in vertical columns from the chapter on the country of the Arabs in the 1776 Hanhai edition of the Zhufan zhi"
            source={
              <>
                Zhao Rugua, <em>Zhufan zhi</em>, Hanhai edition (1776)
              </>
            }
          >
            A page of Zhao Rugua&rsquo;s chapter on the Arabs, 大食國, in the 1776 printing. The first column on
            the right (發船四十餘日至藍里&hellip;) is the sentence about the ships: forty-odd days to Lanli, trade and
            winter there, and the next year sixty-odd days more with a fair wind. My reading of the Chinese; the
            library&rsquo;s translation is not yet made.
          </PageFigure>
        </div>

        <ContextNote title="The Mongols at both ends">
          <p>
            In the thirteenth century the Mongols conquered both ends of the sea road. Kublai Khan ruled China and
            took the southern ports, Quanzhou among them, when the Song dynasty fell in the 1270s; his kinsmen, the
            Ilkhans, ruled Persia and the shore of the Gulf. For a few decades one family held both terminals, and
            envoys, brides and merchants moved between the two courts. That is how a Venetian came to sail from
            Quanzhou to Persia in charge of a Mongol bride, and why a Moroccan sent by the Sultan of Delhi to the
            Mongol emperor of China expected to find a Chinese ship waiting for him in India.
          </p>
        </ContextNote>

        <Section>Fourteen ships, six hundred dead</Section>

        <P>
          Arghun, the Mongol ruler of Persia, had lost his wife and sent to Kublai
          Khan for a bride of her family. Kublai found one, and the envoys, who had heard that Marco Polo had sailed
          in those seas, asked to take her home by water, with the three Venetians, Niccolò, Maffeo and Marco, to
          guide them. Kublai{' '}
          <Link href={`/book/${POLO}?page=56`}>&ldquo;showed great displeasure on his face&rdquo;</Link> and let them
          go. They sailed from Zaitun, Zhao Rugua&rsquo;s port, around 1291.
        </P>

        <SourceQuote
          book={POLO}
          page={56}
          printedPage={18}
          src={IMG(POLO_ID, 56)}
          source={POLO_SRC}
          pageAlt="Page 18 of the 1827 Florence edition of Il Milione, Italian text of the prologue on the departure by sea"
        >
          He then had fourteen ships prepared, each of which had four masts and could sail with nine sails. How these
          were constructed could be described, but as it is a lengthy subject, it is left aside for the present.
          Among the said ships, there were at least four or five that carried between two hundred and fifty and two
          hundred and sixty sailors.
        </SourceQuote>

        <P>
          Three months took them to &ldquo;an island towards the south named Java&rdquo;, which the editor of the
          Florence edition explains is Sumatra, and then they &ldquo;navigated the Indian Sea for eighteen
          months&rdquo;. The cost is on the <Link href={`/book/${POLO}?page=57`}>next page</Link>: &ldquo;about six
          hundred people died among the sailors and others who were in said ships; and of the three ambassadors,
          only one remained, whose name was Goza; and of all the ladies and damsels, only one died.&rdquo; Arghun
          had died while they were at sea. The bride was married to his son Ghazan instead.
        </P>

        <P>
          Later in the book Polo describes the port they had left. So much pepper came into Zaitun that{' '}
          <Link href={`/book/${POLO}?page=391`}>
            what was carried from Alexandria to the West was &ldquo;a minimal part, and almost one percent in
            comparison to this.&rdquo;
          </Link>{' '}
          The Khan took a tenth of every cargo and the ship charged
          forty-four per cent freight on pepper, so a merchant paid away half of what he brought, &ldquo;and yet,
          from that half which remains to them, they make such large profits that they wish to return at every hour
          with other merchandise.&rdquo;
        </P>

        <P>
          The Chinese ships had sealed compartments in the hold, and Polo has a story for why. At night a whale sees
          the water foaming white along the hull, takes it for food, charges, and{' '}
          <Link href={`/book/${POLO}?page=397`}>&ldquo;often breaks it in some part.&rdquo;</Link> The crew then empty
          only the flooded hold, &ldquo;because the water cannot pass from one hold to another, since they are so
          well fitted.&rdquo;
        </P>

        <P>
          He thought little of the boats at the far end of the road. Hormuz was the place where{' '}
          <Link href={`/book/${POLO}?page=92`}>
            &ldquo;arrive all the merchants from all parts of India with spices, precious stones, pearls, cloths of
            gold and of silk, elephant teeth&rdquo;
          </Link>
          , so hot in summer that its people moved out to shelters built on stakes over the water. And its ships
          were sewn together.
        </P>

        <SourceQuote
          book={POLO}
          page={94}
          printedPage={56}
          src={IMG(POLO_ID, 94)}
          source={POLO_SRC}
          pageAlt="Page 56 of the 1827 Il Milione, chapter 16, on the ships of Ormus, with the editor’s long note on sewn boats"
        >
          The ships of Ormus are very bad and dangerous, whence the merchants and others often find themselves in
          peril in them; and the cause is this, because they are not fastened with nails&hellip; Each ship has only
          one mast, and one rudder, and one deck, and when it is loaded, it is covered with leather, and above the
          leather they place the horses that are led into India.
        </SourceQuote>

        <P>
          The thread was coir, from the husk of the coconut. Horses come back at Hormuz, three hundred years
          later.
        </P>

        <Section>Three months at Calicut</Section>

        <P>
          Ibn Battuta spent the night of the storm on the beach at Calicut with a mat to sleep on, while everything
          he owned rode at anchor out in the harbour, aboard a small ship nobody could reach.
        </P>

        <P>
          He had come to the Malabar coast in the early 1340s, half a century after Polo, as the envoy of the Sultan
          of Delhi to the Mongol emperor of China, carrying a gift for the emperor. The chief of the merchants at
          Calicut, a man from Bahrain, came out to meet the party{' '}
          <Link href={`/book/${BATTUTA}?page=448`}>
            with &ldquo;drums, trumpets, and flags on their boats&rdquo;
          </Link>
          . Thirteen Chinese ships lay in the harbour. &ldquo;We stayed waiting for the time of travel to China for
          three months.&rdquo; He used the time to look at the junks.
        </P>

        <SourceQuote
          book={BATTUTA}
          page={448}
          printedPage={140}
          src={IMG(BATTUTA_ID, 448)}
          source={BATTUTA_SRC}
          pageAlt="Arabic page of Ibn Battuta’s Rihla, on Calicut and the start of the description of the Chinese ships"
        >
          The sea of China is not traveled except in Chinese ships. Let us mention their order. The Chinese ships are
          of three kinds: the large ones are called Junūt, one of them is called a Junk; the medium ones are called
          Zaw; and the small ones are called Kakam. A large ship among them has twelve sails or fewer, down to three.
          Their sails are made of bamboo rods woven like mats, which are never lowered; they rotate them according to
          the rotation of the wind.
        </SourceQuote>

        <P>
          A big junk carried a thousand men, six hundred sailors and four hundred soldiers. It had four decks, with
          cabins that locked, and the crew grew &ldquo;vegetables, greens, and ginger in wooden troughs&rdquo; on
          board; &ldquo;there is no one in the world with more wealth than the people of China.&rdquo;
        </P>

        <P>
          When the season came, his slaves and goods went aboard on a Thursday, and were moved on Friday morning to
          a smaller ship, a <em>kakam</em>, while he stayed ashore for the Friday prayer. That afternoon the sea got
          up, as it did there every day after the afternoon prayer, and nobody could board. Hence the beach and the
          mat. In the morning a junk bound to winter up the coast was thrown on the shore and broke apart. A merchant offered ten dinars to anyone who would save his slave girl,
          who was clinging to the stern, and{' '}
          <Link href={`/book/${BATTUTA}?page=450`}>
            &ldquo;one of the Hormuzian sailors came and rescued her. He refused to take the dinars, saying, &lsquo;I
            only did this for the sake of God the Exalted.&rsquo;&rdquo;
          </Link>
        </P>

        <P>
          That night the junk carrying the Sultan&rsquo;s gift went onto the shore too, &ldquo;and everyone on board
          died.&rdquo; In the morning he buried the two officers who had sailed with it; one had a nail driven
          through his temples. The crew of the <em>kakam</em> had seen enough. They &ldquo;raised their sails and
          departed, taking with them all my luggage, my servants, and my slave girls.&rdquo; He was left with{' '}
          <Link href={`/book/${BATTUTA}?page=451`}>
            &ldquo;nothing but the ten dinars the Yogi had given me and the mat I used to sleep on&rdquo;
          </Link>
          .
        </P>

        <P>
          Told that the <em>kakam</em> would put in at Quilon, he went after it, ten days by river through forests of
          cinnamon and sappanwood that the boatmen burned for firewood. Quilon, he writes, &ldquo;is the first to
          which ships travel from the lands of Malabar to China, and most of them travel to it.&rdquo; This is
          Sulayman&rsquo;s Kulam Mali, five hundred years on.
        </P>

        <P>
          Years later, after the Maldives, Ceylon and Sumatra, he reached China, and the first city he came to was
          the one Polo had sailed from.
        </P>

        <SourceQuote
          book={BATTUTA}
          page={505}
          printedPage={197}
          src={IMG(BATTUTA_ID, 505)}
          source={BATTUTA_SRC}
          pageAlt="Arabic page of Ibn Battuta’s Rihla, on the safety of Chinese roads and the arrival at Zaytun"
        >
          When we crossed the sea, the first city we reached was the city of Zaytun. This city has no olives, nor
          does all the land of China and India, but it is a name placed upon it. &hellip; Its harbor is one of the
          greatest harbors in the world; indeed, it is the greatest. I saw in it about a hundred large junks, and as
          for the small ones, they are beyond count.
        </SourceQuote>

        <P>
          <em>Zaytun</em> is Arabic for olive, hence the joke. On the same page he describes the inns on Chinese
          roads. Each evening an official wrote down the names of the Muslim travellers and locked them in; each
          morning he called the roll and sent them on with an escort, who had to bring back a receipt from the next
          inn. &ldquo;The land of China is the safest land and the best in condition for travelers.&rdquo;
        </P>

        <ContextNote title="The Ming voyages">
          <p>
            The Mongols were driven out of China in 1368. Between 1405 and 1433 the new Ming dynasty sent seven
            great fleets into the Indian Ocean under the palace eunuch Zheng He. They reached Calicut on the first
            voyage and Hormuz on the fourth, and later squadrons went on to Aden, Dhofar and East Africa. The
            voyages were about prestige and tribute more than trade. The Ming history, as Wei Yuan quotes it, says
            that when Dhofar sent
            envoys with those of Aden in 1421,{' '}
            <Link href={`/book/${WEI16}?page=48`}>
              &ldquo;the Emperor ordered Zheng He to carry the imperial seal and gifts to reward them.&rdquo;
            </Link>{' '}
            After 1433 the fleets stopped, and the court turned away from the sea.
          </p>
        </ContextNote>

        <Section>Stars to Hormuz</Section>

        <P>
          Two hundred years after the last fleet came home, a writer on war printed its charts. Mao Yuanyi put them
          into chapter 240 of his huge treatise on armament, the <em>Wubei zhi</em> (武備志), in 1621, because
          Zheng He{' '}
          <Link href={`/book/${WUBEI}?page=44`}>
            &ldquo;did not disgrace his imperial commission. His charts record the routes, distances, and foreign
            territories in detail and without falsehood.&rdquo;
          </Link>{' '}
          They are the only charts of the fleets that survive.
        </P>

        <P>
          The chart is a long strip cut into pages. Coasts run along the top and bottom, islands are drawn as little
          mountains, and the sailing courses are dotted lines between, labelled with compass bearings and the number
          of watches to sail. Off southern Vietnam, among islands named Overturned Cauldron Mountain and Bronze Drum
          Mountain, one line records the fleet itself.
        </P>

        <PageFigure
          src={IMG(WUBEI_ID, 67)}
          alt="Woodblock page from the Wubei zhi chart: islands drawn as small mountains, dotted sailing courses, and a line of text along a course recording Zheng He’s passage in 1416"
          href={`/book/${WUBEI}?page=67`}
          source={WUBEI_SRC}
        >
          A page of the chart around Pulo Condore, the Côn Sơn islands (崑崙山, &ldquo;Kunlun Mountain&rdquo;). The
          line along the course reads, in the library&rsquo;s translation, &ldquo;Kunlun Mountain. In the 14th year
          of the Yongle reign [1416], the Principal Envoy, Grand Eunuch Zheng He, arrived here while traveling to
          the Western Ocean.&rdquo;
        </PageFigure>

        <P>
          Out of sight of land the pilots steered by the stars. The chapter ends with four star charts for the
          open-sea crossings, all in the Indian Ocean. Each shows a ship under sail in the middle of the page, with
          the stars to look for around it and their height above the horizon in &ldquo;fingers&rdquo;, about a
          degree and a half each. <Link href={`/book/${WUBEI}?page=86`}>The first is for Hormuz.</Link>
        </P>

        <div className="max-w-lg mx-auto">
          <PageFigure
            src={IMG(WUBEI_ID, 86)}
            alt="Star chart from the Wubei zhi: a three-masted junk with matting sails in the centre, surrounded by small star diagrams and columns of text giving their altitudes"
            href={`/book/${WUBEI}?page=86`}
            source={WUBEI_SRC}
          >
            The star chart for the crossing to Hormuz. The top right column reads, in the library&rsquo;s
            translation: &ldquo;When sailing from Dingdebaqi to Hormuz, observe the North Star at fourteen
            fingers.&rdquo; Dingdebaqi is Ras al-Hadd, the eastern tip of Oman.
          </PageFigure>
        </div>

        <P>
          Around the ship are the Southern Cross, which the chart calls the Lantern Bone Star, at four and a half
          fingers on reaching Shaguma Mountain, probably near the Strait of Hormuz; Vega, the Weaver Girl, at seven
          fingers to the east; and Alpha and Beta Centauri, the South Gate Double Stars, at six.
        </P>

        <ContextNote title="The Portuguese arrive">
          <p>
            In 1498 Vasco da Gama&rsquo;s ships came round Africa to Calicut. The Portuguese set out to control the
            old trade with forts and armed fleets, run from Goa after 1510. Afonso de Albuquerque took
            Hormuz in 1515, and the Portuguese held it for over a century, until the Persians, with English ships,
            drove them out in 1622. By then the Chinese junks were a memory on the Malabar coast. Da Costa says the
            Chinese had once kept{' '}
            <Link href={`/book/${COSTA}?page=196`}>
              a house of trade at Calicut, &ldquo;called to this day Chinacota&rdquo;
            </Link>
            , where they sold sandalwood that went on to the West.
          </p>
        </ContextNote>

        <Section>Sleeping in tubs at Hormuz</Section>

        <P>
          On a summer night on Hormuz, under the Portuguese, a married couple went to bed in a wooden tub of water
          with only their heads above it. The witness is Jan Huyghen van Linschoten, a young Dutchman who spent the
          1580s in Goa in the household of the Portuguese archbishop and in 1596 published his <em>Itinerario</em>.
        </P>

        <SourceQuote
          book={LINSCHOTEN}
          page={36}
          printedPage={12}
          src={IMG(LINSCHOTEN_ID, 36)}
          source={
            <>
              Jan Huyghen van Linschoten, <em>Itinerario</em> (Amsterdam, 1596), English translation by Source Library
            </>
          }
          pageAlt="Page 12 of Linschoten’s Itinerario in Dutch black letter, two columns headed Van’t Eylandt Ormus, with printed side-notes"
        >
          Returning again to our outpost of the Island of Hormuz, which lies at 27 degrees; in the summer (which comes
          at the same time as in our lands) it is so exceedingly and unbearably hot that one must sleep in wooden
          tubs (made for that purpose) full of water, lying naked, man and wife, entirely under the water except for
          the head.
        </SourceQuote>

        <P>
          The island had no water of its own. Drinking water came over from the mainland and was kept in great jars
          and cisterns, and some came from Bahrain, where divers went down four or five fathoms under the salt sea
          to a spring &ldquo;as sweet and good as the best fountain water.&rdquo; Horses were still shipped from the
          island. Only the Portuguese captain of Hormuz was allowed to ship them to India, where they sold for four
          or five hundred <em>pardaos</em> each and sometimes a thousand.
        </P>

        <P>
          Linschoten&rsquo;s Hormuz was copied for a century. Engelbert Kaempfer, a German physician with the Dutch
          East India Company at Bandar Abbas in the 1680s, published his <em>Amoenitates exoticae</em> in 1712 with
          a view of Hormuz in the corner of his map of the Gulf labelled &ldquo;ex Linschoto&rdquo;, from Linschoten.
          By then the Portuguese had been gone for ninety years and the town was in ruins.
        </P>

        <PageFigure
          src={IMG(KAEMPFER_ID, 851)}
          alt="Part of a folding plate in Kaempfer’s Amoenitates exoticae: an engraved view of Hormuz from the sea with ships, a small plan of the island, and a fortress on Qeshm, set into a map of the Gulf"
          href={`/book/${KAEMPFER}?page=851`}
          source={<>Engelbert Kaempfer, <em>Amoenitates exoticae</em> (Lemgo, 1712)</>}
        >
          Hormuz &ldquo;ex Linschoto&rdquo; in the corner of Kaempfer&rsquo;s map of the Gulf, with a plan of the
          island (&ldquo;Ormus ins. plan.&rdquo;) and below it the castle on Qeshm (&ldquo;Kismis&rdquo;). The scan
          shows the plate partly folded. The picture at the top of this article is taken from it.
        </PageFigure>

        <ContextNote title="The Opium War and Wei Yuan">
          <p>
            By the nineteenth century the ships on the road were European, and they came to China. Britain&rsquo;s
            trade at Canton ran on opium grown in India, and when the Qing commissioner Lin Zexu destroyed the
            British stocks in 1839, Britain went to war. The First Opium War ended in 1842 with Hong Kong ceded and
            five ports opened. Lin had collected and translated Western books on geography at Canton. His friend
            the scholar Wei Yuan used them, with the Chinese histories, to compile the <em>Haiguo tuzhi</em> (海國圖志,{' '}
            <em>Illustrated Treatise on the Maritime Kingdoms</em>), first printed in 1843 and enlarged in 1844, so
            that China could learn about the countries now at its door.
          </p>
        </ContextNote>

        <Section>Hormuz from Canton, 1844</Section>

        <P>
          A hundred and thirty years after Kaempfer, Wei Yuan printed this in his survey of the maritime
          countries.
        </P>

        <SourceQuote
          book={WEI16}
          page={47}
          src={IMG(WEI16_ID, 47)}
          source={
            <>
              Wei Yuan, <em>Haiguo tuzhi</em> (1844), quoting Verbiest&rsquo;s <em>Kunyu tushuo</em>, English
              translation by Source Library
            </>
          }
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
          A&rsquo;ermusi is Hormuz. Wei is quoting the <em>Kunyu tushuo</em>, a geography written in Chinese in 1674
          by the Flemish Jesuit Ferdinand Verbiest at the Qing court in Beijing. People lying in water to their
          mouths, and drinking water brought by boat: it reads like Linschoten&rsquo;s Hormuz, come by way of a
          Jesuit into a Chinese book. Wei adds a note in small characters that the{' '}
          <Link href={`/book/${WEI16}?page=48`}>
            <em>History of the Ming</em> writes the name as Hulumusi
          </Link>
          , which is the name on Zheng He&rsquo;s star chart.
        </P>

        <P>
          In another volume he says how far Chinese ships now went. Under the Qing, he writes, the trade of the
          north-western seas came to China in foreign ships, and only in the southern seas did Chinese ships go out
          to trade.
        </P>

        <SourceQuote
          book={WEI8}
          page={68}
          src={IMG(WEI8_ID, 68)}
          source={
            <>
              Wei Yuan, <em>Haiguo tuzhi</em> (1844), English translation by Source Library
            </>
          }
          pageAlt="Page of the Haiguo tuzhi in Chinese, the end of a chapter on the islands of the south-eastern seas"
        >
          Sailboats and crane-like ships traverse ten thousand miles, yet our domestic merchant ships reach only as
          far as India and the South Ocean; they do not reach the &ldquo;Lesser Western Ocean,&rdquo; let alone the
          &ldquo;Greater Western Ocean.&rdquo; The Ming dynasty eunuch Zheng He also only reached the Lesser Western
          Ocean and did not reach the Greater Western Ocean.
        </SourceQuote>

        <P>
          The Lesser Western Ocean is the western Indian Ocean, the waters of Arabia and the Gulf; the Greater is the
          seas of Europe.
        </P>

        <Section>On the shoals of Chilao</Section>

        <P>
          Which leaves the four hundred ships of the Hormuz books, riding at Geru on a single tide. Da Costa&rsquo;s
          sentence goes on.
        </P>

        <SourceQuote
          book={COSTA}
          page={39}
          printedPage="8–9"
          src={IMG(COSTA_ID, 39)}
          source={COSTA_SRC}
          pageAlt="Page 9 of da Costa’s Tractado, on cinnamon, with printed side-notes listing what the Chinese brought from China, Malacca, Ceylon, Malabar and Java"
        >
          &hellip;in a single tide, four hundred large ships entered the Island of Geru (which is now called
          Hormuz), and that all at once they were lost together on the shoals of Chilao, numbering more than two
          hundred ships.
        </SourceQuote>

        <P>
          Chilao is probably Chilaw, on the west coast of Ceylon, on the way back east. Da Costa does not say how
          four hundred became more than two hundred, or when it happened, or whether anyone got home. Overleaf he
          lists what such ships had carried: gold, silk, musk, seed pearl, porcelain, copper and alum from China;
          sandalwood, nutmeg, mace and cloves from Malacca; cinnamon from Ceylon; and from Malabar the pepper and
          cardamom they took on to Hormuz and the coast of Arabia, &ldquo;where merchants came to buy it, who from
          there took it to Alexandria, Aleppo, and Damascus.&rdquo; He had it from the people of Hormuz, who had it
          from their books, and he put it in his chapter on cinnamon.
        </P>

        <p className="text-sm text-muted leading-relaxed mt-16">
          <strong>Sources.</strong> Quotations are Source Library&rsquo;s English translations of the Arabic,
          Persian, Chinese, Italian, Latin, Spanish and Dutch pages linked; follow a link to read the page beside
          its scan. Zhao Rugua is paraphrased until the library&rsquo;s Chinese text is translated. Dates the pages
          do not give (Pliny, Sulayman, Zheng He&rsquo;s voyages, the Portuguese at Hormuz, the Opium War) are the
          standard ones.
        </p>
      </article>
    </ContentPageLayout>
  );
}
