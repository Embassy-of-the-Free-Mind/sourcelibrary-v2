import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import PageFigure from '@/components/articles/PageFigure';
import SourceQuote from '@/components/articles/SourceQuote';

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
const MASUDI = 'muruj-al-dhahab-meadows-of-gold-al-masudi';
const QAZWINI = 'aja-ib-al-makhluqat-ms-nn-3-74-al-qazwini';
const QAZWINI_ID = '69907bdc5f855ec553e7177b';
const ZHAO = 'description-of-foreign-peoples-rugua';
const ZHAO_ID = '69eb09b2357a59f9cb67e76b';
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
const MATELIEF = 'journael-ende-historische-verhael-van-de-treffelijcke-reyse-gedaen-nae';
const MATELIEF_ID = '6ab5a6b16122fe9080c041a0';
const KAEMPFER = 'amoenitatum-exoticarum-persia-and-asia-observations-kaempfer';
const KAEMPFER_ID = '6959106fecb01322b306752b';

export default function SeaRoadPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title="The Sea Road from China to the Gulf"
          subtitle="Guangzhou, Quanzhou, Calicut, Siraf and Hormuz, in the words of the merchants, geographers, officials and admirals who knew the route"
          image={LEAD_IMAGE}
          imageAlt={LEAD_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">11 November 2026 &middot; 30 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          In 1578 a Portuguese physician who had lived in India, Cristóvão da Costa, published a book on the drugs
          of the East. In the chapter on cinnamon he stops to explain why Europeans had two names for one bark, and
          the explanation takes him back to a time when the Chinese, not the Portuguese, ran the Indian Ocean. The
          people of Hormuz, he says, still had it in their books that{' '}
          <Link href={`/book/${COSTA}?page=38`}>four hundred Chinese ships had once come in on a single tide</Link>.
        </p>

        <SourceQuote
          book={COSTA}
          page={38}
          printedPage={8}
          src={IMG(COSTA_ID, 38)}
          source={<>Cristóvão da Costa, <em>Tractado de las drogas</em> (Burgos, 1578), English translation by Source Library</>}
          pageAlt="Page 8 of da Costa’s Tractado, on cinnamon, with printed side-notes reading ‘Where the error was born’ and ‘Note’"
        >
          For a long time, the Chinese sailed those lands of the Indies, and as those peoples were barbaric and
          without any civility, they took from the Chinese laws, customs, and the manner of ships and large vessels.
          And there were so many of them that the people of Hormuz recount that they find it written in their
          books, that in a single tide, four hundred large ships entered the Island of Geru (which is now called
          Hormuz)…
        </SourceQuote>

        <P>
          The sentence runs on to the next page, where{' '}
          <Link href={`/book/${COSTA}?page=39`}>
            the same fleet is lost on the shoals of Chilao, &ldquo;numbering more than two hundred ships&rdquo;
          </Link>
          , and da Costa lists what such ships had carried: gold, silk, musk, seed pearl, porcelain, copper and alum
          from China; sandalwood, nutmeg, mace and cloves from Malacca; cinnamon from Ceylon; pepper and cardamom
          from Malabar, taken on to Hormuz and the Arabian coast and from there to Alexandria, Aleppo and Damascus.
          The four hundred ships are a story told at Hormuz and retold by a European, and nobody should count them.
          But the outline behind the story is real, and it is the subject of this article: a sea road that joined
          the ports of southern China to the head of the Persian Gulf, running past Champa, through the straits by
          Sumatra, past Ceylon and along the Malabar coast, then across to Oman and into the Gulf.
        </P>

        <P>
          Source Library holds a surprising number of the books in which that road is described by people who used
          it, taxed it or charted it. The Arab geographers of the ninth and tenth centuries wrote down the stages
          from Siraf to Canton. A Chinese customs inspector at Quanzhou in the thirteenth century wrote down what
          the foreign merchants told him about their countries. Marco Polo went home by this route, Ibn Battuta
          waited three months at Calicut for a Chinese junk, and a Ming military encyclopaedia preserved the charts
          of Zheng He&rsquo;s fleets, with the stars to steer by on the way to Hormuz. The Portuguese and the Dutch
          came in at the western end, and in 1844 the Qing scholar Wei Yuan looked back over all of it from Canton.
          The books are in Arabic, Persian, Chinese, Italian, Latin, Portuguese, Spanish and Dutch; unless the
          source note at the end says otherwise, the English is Source Library&rsquo;s translation. This is a
          reading for the long flight from Shanghai to Dubai, which crosses most of the route in eight hours that
          took the old ships a year or two.
        </P>

        <Section>The stages from Siraf</Section>

        <P>
          The oldest detailed accounts of the road come from the Persian Gulf end. In the ninth century the
          merchants who made the voyage to China sailed from Siraf, on the coast of Fars, and the Arab geographers
          copied their sailing directions into their books. One of those merchants is known only as Sulayman. His
          account was used by Ibn al-Faqih, a Persian writer of the early tenth century, in a geography that
          survives in an abridgement, edited by M. J. de Goeje at Leiden in his{' '}
          <em>Bibliotheca Geographorum Arabicorum</em>. Ibn al-Faqih names his source:{' '}
          <Link href={`/book/${FAQIH}?page=19`}>
            &ldquo;Sulayman the Merchant mentioned that most Chinese ships carry from Basra and Oman, and between
            them is Siraf.&rdquo;
          </Link>{' '}
          The translation is a little stiff here; the sense is that the ships for China loaded at Siraf, where goods
          from Basra and Oman were brought to them, because the waters further up the Gulf were rough and shallow.
          From Siraf the ships went down the Gulf to Muscat for water, past a narrow passage in the mountains of
          Oman called the Durdur that &ldquo;small ships&rdquo; could use &ldquo;but not Chinese ships&rdquo;, and
          then struck out across the open sea.
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
          Kulam Mali is Quilon, on the Malabar coast. The figures say something about the ships: a &ldquo;Chinese
          vessel&rdquo; paid a thousand silver dirhams for water where other ships paid ten gold dinars, which
          suggests the China ships were by far the largest on the sea. The next page carries the itinerary on
          through the Bay of Bengal. Between Quilon and the Sea of Harkand lie the islands of the{' '}
          <Link href={`/book/${FAQIH}?page=20`}>Lanj, who &ldquo;do not wear clothes&rdquo;</Link>, come out to the
          ships in skiffs with coconuts and coconut wine, sell ambergris for pieces of iron, and trade &ldquo;by
          signs, hand to hand&rdquo;. These are the Nicobar Islands. Then comes Kalah on the Malay coast, then
          Tiyumah (Tioman) for water, then Champa (al-Sanf) and Khmer (Qumar), and so to China.
        </P>

        <P>
          Ibn Khordadbeh, a Persian who ran the caliph&rsquo;s post and intelligence service in the ninth century,
          gives the same road as a list of stages and the goods of each. His <em>Book of Roads and Kingdoms</em>{' '}
          has a section headed{' '}
          <Link href={`/book/${KHORDADBEH}?page=76`}>&ldquo;The Route to China&rdquo;</Link>: from Tioman, with
          its aloeswood and camphor, five days to Khmer, then three days along the coast to Champa, whose aloeswood
          is better than the Khmer kind &ldquo;because it sinks in water due to its quality and weight&rdquo;. On
          the same page he tells the story of the Maharaja of Zabaj, the king of Srivijaya on Sumatra, whose revenue
          was two hundred <em>mann</em> of gold a day: &ldquo;He fashions it into bricks and throws them into the
          water, saying: &lsquo;This is my treasury.&rsquo;&rdquo; Then, overleaf, the ports of China themselves:
        </P>

        <SourceQuote
          book={KHORDADBEH}
          page={77}
          printedPage={69}
          src={IMG(KHORDADBEH_ID, 77)}
          source={<>Ibn Khordadbeh, <em>Kitab al-Masalik wa&rsquo;l-Mamalik</em>, ed. de Goeje (Leiden), English translation by Source Library</>}
          pageAlt="Page 69 of de Goeje’s edition of Ibn Khordadbeh, Arabic text with the stages from Champa to the ports of China"
        >
          From al-Sanf to Luqin, which is the first of the ports of China, is a hundred parasangs by land and sea.
          It contains Chinese stone, Chinese silk, fine Chinese porcelain, and rice. From Luqin to Khanfu, which is
          the largest port, is a journey of four days by sea and twenty days by land. It has all kinds of fruits,
          vegetables, wheat, barley, rice, and sugar cane. From Khanfu to Khanju is a journey of eight days, and it
          contains the same as Khanfu. From Khanju to Qantu is a journey of twenty days, with similar features. In
          every port of the ports of China is a great river that ships enter, where there are tides.
        </SourceQuote>

        <P>
          Khanfu is Guangzhou, the city Europeans later called Canton. Luqin is probably in northern Vietnam;
          Khanju and Qantu are further up the Chinese coast, and the editor&rsquo;s notes argue over which cities
          they were. What matters for the reader is the shape of the thing: a chain of named harbours, each a
          known number of days from the next, each with its own product, ending in a great river port where the
          tide carried ships upstream.
        </P>

        <P>
          The goods went the other way too, and one of them could be smelled. Ibn Rustah, writing in Isfahan in
          the early tenth century, quotes an older authority on the grades of musk. Tibetan musk is best, then
          Sogdian, then Chinese, and the best Chinese musk comes by sea:
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
          Al-Ubulla was the port of Basra, at the head of the Gulf. So the musk made the whole run, from the
          Chinese river port to the Iraqi one, and announced itself to the customs men as it came up the Shatt
          al-Arab. The historian al-Mas&lsquo;udi, who travelled widely in the first half of the tenth century,
          says he had talked to the people who did this for a living. In the chapter of his <em>Meadows of Gold</em>{' '}
          on the seas he writes:{' '}
          <Link href={`/book/${MASUDI}?page=385`}>
            &ldquo;I have had many conversations with merchants of &lsquo;Omán and of Síráf, who are in the habit
            of navigating the seas of China, India, es-Sind&rdquo;
          </Link>
          , and on through the seas of East Africa and Arabia. For him the seas of China, India, Persia and Yemen{' '}
          <Link href={`/book/${MASUDI}?page=422`}>
            &ldquo;are connected, and form only one mass of water&rdquo;
          </Link>
          .
        </P>

        <P>
          Siraf grew rich on it. Ibn Hawqal, who travelled the Islamic world in the tenth century and revised the
          geography of al-Istakhri, describes the town as almost the equal of Shiraz, the capital of the province:
        </P>

        <SourceQuote
          book={HAWQAL}
          page={200}
          printedPage={198}
          src={IMG(HAWQAL_ID, 200)}
          source={<>Ibn Hawqal, <em>Kitab Surat al-Ard</em>, ed. de Goeje (Leiden, 1873), English translation by Source Library</>}
          pageAlt="Page 198 of de Goeje’s Ibn Hawqal, the description of Siraf in Arabic, with a long variant from another manuscript in the notes"
        >
          The largest city in it after Shiraz is Siraf. It approaches Shiraz in size, and their construction is of
          teak and wood carried from the lands of the Zanj. Their buildings are in stories on the edge of the sea
          and the like. It has crowded buildings and many people. They go to extremes in the expenses of their
          buildings, to the point that a merchant might spend more than thirty thousand dinars on his house.
        </SourceQuote>

        <P>
          The houses of Siraf were built of teak brought from East Africa (the land of the Zanj), several storeys
          high, on a coast with no farmland and little water. In de Goeje&rsquo;s notes on the same page, printed
          in Arabic and not translated in the library&rsquo;s English, is a long addition found in one manuscript
          about a Siraf merchant called Ramisht, whose clerk was said to have come back from China with goods worth
          half a million dinars, and who replaced the silver water-spout of the Ka&lsquo;ba with gold and hung the
          shrine with Chinese cloth. I give that from the Arabic of the note, so treat the details with care; the
          point is that a Siraf fortune and a China voyage went together in people&rsquo;s minds.
        </P>

        <Section>Wonders of the China Sea</Section>

        <P>
          Geographers who never sailed collected what sailors said, and the sea road filled up with marvels. The
          most widely copied collection was the <em>Wonders of Creation</em> of Zakariya al-Qazwini, a judge from
          Qazvin who died in 1283. Source Library has a Persian version of it in a Cambridge manuscript (MS
          Nn.3.74), written in a fine hand within ruled gold frames. Its chapter on the Sea of China tells sailors
          how to read the weather from the water: when the sea is about to fall calm,{' '}
          <Link href={`/book/${QAZWINI}?page=110`}>white wings appear on it</Link>, a fish that rises from the bottom,
          and when the fish lays its eggs on floating debris in mid-sea the sailors know the calm has come. Then:
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
          A heading in gold follows, &ldquo;On the Chapter of the Islands of China&rdquo;, and the first island in
          it belongs to the Maharaj, who receives &ldquo;a hundred <em>manns</em> of gold every day&rdquo; and has
          it made into bricks and thrown into the sea. It is Ibn Khordadbeh&rsquo;s story of the king of Zabaj,
          four centuries on, with the number halved. The marvels of the sea road were passed from book to book as
          faithfully as its distances.
        </P>

        <Section>The same road from the Chinese end</Section>

        <P>
          The Chinese record of the western seas is best read in the edition of the <em>Zhufan zhi</em> (諸蕃志,
          &ldquo;Records of the Foreign Peoples&rdquo;) that Friedrich Hirth and W. W. Rockhill published in St
          Petersburg in 1911 as <em>Chau Ju-kua: His Work on the Chinese and Arab Trade</em>. Its author, Zhao
          Rugua, was Inspector of Foreign Trade at Quanzhou in Fujian in the early thirteenth century and wrote down
          what foreign merchants in his port told him. The book is in English in the library, translated by Hirth
          and Rockhill, so the quotations from it below are theirs, with their spellings: Chau Ju-kua for Zhao
          Rugua, Ts&lsquo;üan-chóu for Quanzhou, Kuang-chóu for Guangzhou.
        </P>

        <P>
          Hirth and Rockhill open with a long introduction that gathers every older Chinese text on the sea trade,
          and the best of them is an itinerary from Canton to the Persian Gulf by Kia Tan (Jia Dan), a T&lsquo;ang
          official writing around the year 800. It runs from the Chinese coast past Champa and Pulo Condore{' '}
          <Link href={`/book/${ZHAO}?page=27`}>to a strait &ldquo;which the Barbarians call Chi&rdquo;</Link>, with
          Sumatra on one shore and the Malay Peninsula on the other, and warns of an island whose people &ldquo;are
          pirates and cruel; sailors dread them&rdquo;. Then it goes west by the{' '}
          <Link href={`/book/${ZHAO}?page=28`}>Nicobars and &ldquo;the country of the Lion&rdquo;, Ceylon</Link>, to
          Mo-lai, &ldquo;the extreme southern frontier of southern India&rdquo;, which the translators identify with
          Quilon, the same Kulam Mali where the Arab itinerary charged the China ships a thousand dirhams. Up the
          Indian coast it reaches the mouth of the Indus, and then, twenty days and twenty little countries further
          west, a place where there was something to see at night:
        </P>

        <SourceQuote
          book={ZHAO}
          page={29}
          printedPage={13}
          src={IMG(ZHAO_ID, 29)}
          source={<>Kia Tan&rsquo;s itinerary, in Hirth and Rockhill, <em>Chau Ju-kua</em> (St Petersburg, 1911), their translation</>}
          pageAlt="Page 13 of Hirth and Rockhill’s Chau Ju-kua, with Kia Tan’s itinerary and long footnotes on the beacons in the sea"
        >
          The people of this country have set up ornamented pillars (華表) in the sea, on which at night they place
          torches (炬) so that people travelling on board ships at night shall not go astray.
        </SourceQuote>

        <P>
          The translators&rsquo; notes argue over where the beacons stood, at Cape Musandam at the mouth of the Gulf
          or at al-Ubulla at its head. A day further on is Wu-la, which they take to be Sohar in Oman, and then the
          itinerary turns up a river:{' '}
          <Link href={`/book/${ZHAO}?page=30`}>
            &ldquo;the Fu-li-la river of the realm of the Ta-shi flows southward into the sea. Small boats ascend it
            two days and reach the country of Mo-lo, an important market of the Ta-shi&rdquo;
          </Link>
          , and a thousand <em>li</em> overland from there is the city of Fu-ta, the capital of the
          &ldquo;Mau-mön&rdquo;, which is Arabic <em>mu&rsquo;minin</em>, the Commander of the Faithful. Ta-shi is
          the Chinese name for the Arabs. Fu-li-la is the Euphrates, the Arabic Furat. Hirth and Rockhill suggest Mo-lo was Old Hormuz on the
          mainland, which would make this, they say, &ldquo;the only reference in Chinese works to this great port of
          the Persian Gulf&rdquo;; for Fu-ta they offer Baghdad or Fustat.
          Either way, a Chinese official around 800 knew the road all the way to the caliph&rsquo;s city.
        </P>

        <P>
          A later Chinese witness describes the ships themselves. In the early twelfth century Zhu Yu, in a
          notebook called <em>P&lsquo;ing-chou k&lsquo;o-t&lsquo;an</em>, wrote down what was known in Canton about
          the foreign ships that came there; Hirth and Rockhill quote him at length. The traders on each ship{' '}
          <Link href={`/book/${ZHAO}?page=47`}>
            &ldquo;choose one of the more important traders as head-man&rdquo;
          </Link>
          , and the Superintendent of Merchant Shipping at Canton gives the head-man a certificate &ldquo;permitting
          them to use the light bamboo for the punishing of their followers&rdquo;. Ships sail large and crowded
          because there are pirates. Each trader is allotted a few feet of hold &ldquo;and at night he sleeps on top
          of them&rdquo;. &ldquo;The greater part of the cargo consists of pottery, the small pieces packed in the
          larger, till there is not a crevice left.&rdquo; Leaks below the waterline are mended from outside by
          slaves who can swim with their eyes open. And then comes the passage for which the book is famous:
        </P>

        <SourceQuote
          book={ZHAO}
          page={48}
          printedPage={32}
          src={IMG(ZHAO_ID, 48)}
          source={<>Zhu Yu, <em>P&lsquo;ing-chou k&lsquo;o-t&lsquo;an</em>, quoted in Hirth and Rockhill, <em>Chau Ju-kua</em> (1911), their translation</>}
          pageAlt="Page 32 of Hirth and Rockhill’s introduction, with the passage on the ship masters and the south-pointing needle"
        >
          The ship masters know the configuration of the coasts (地理); at night they steer by the stars and in the
          day-time by the sun. When the sun is obscured they look at the south-pointing needle (指南針) or use a line
          a hundred feet long with a hook (鈎), with which they take up mud from the sea bottom; by its smell they
          determine their whereabouts. In mid-ocean it never rains; whenever it rains (they know) they are nearing an
          island (or headland 山).
        </SourceQuote>

        <P>
          The editors held that the ships Zhu Yu describes were &ldquo;certainly not Chinese, either in build or
          crew&rdquo;: they were foreign ships in a Chinese port, using a Chinese instrument. Chau Ju-kua himself
          calls the ships that traded between Quanzhou and the Arab countries <em>fan-po</em>, foreign ships. His
          chapter on the Arabs begins with the length of the voyage:
        </P>

        <SourceQuote
          book={ZHAO}
          page={130}
          printedPage={114}
          src={IMG(ZHAO_ID, 130)}
          source={<>Chau Ju-kua (Zhao Rugua), <em>Zhufan zhi</em>, tr. Hirth and Rockhill (1911)</>}
          pageAlt="Page 114 of Hirth and Rockhill’s Chau Ju-kua, the start of chapter 22, The Arabs (Ta-shi)"
        >
          The Ta-shï are to the west and north (or north-west) of Ts&lsquo;üan-chóu at a very great distance from
          it, so that the foreign ships (番舶) find it difficult to make the voyage there direct. After these ships
          have left Ts&lsquo;üan-chóu they come in some forty days to Lan-li (藍里), where they trade. The following
          year they go to sea again, when with the aid of the regular wind (順風) they take some sixty days to make
          the journey.
        </SourceQuote>

        <P>
          Lan-li is Lambri in northern Sumatra. The voyage took two sailing seasons because the monsoon winds
          blow one way for half the year and the other way for the other half; a ship from China waited in Sumatra
          for the wind to turn. The same chapter ends with a man who stayed. A trader named Shi-na-wei,{' '}
          <Link href={`/book/${ZHAO}?page=135`}>
            &ldquo;a Ta-shi by birth, established himself in the southern suburb of Ts&lsquo;üan-chou&rdquo;
          </Link>{' '}
          and, &ldquo;disdaining wealth, but charitable&rdquo;, built a burial ground in the south-west of the
          suburb &ldquo;as a last resting-place for the abandoned bodies of foreign traders&rdquo;. Chau Ju-kua
          also knew the Gulf by name. He gives a chapter to Oman, where{' '}
          <Link href={`/book/${ZHAO}?page=149`}>
            &ldquo;the other countries which trade here purchase horses, pearls and dates&rdquo;
          </Link>
          , paying in cloves, cardamom and camphor, and one to the island of Kish. In their note on that page Hirth
          and Rockhill sum up the shift of the Gulf&rsquo;s trade: Siraf was its centre until the twelfth century,
          suffered from the pirates of Kish, and was ruined in the thirteenth; &ldquo;Then Ormuz began its great
          career.&rdquo;
        </P>

        <Section>Marco Polo goes home by sea</Section>

        <P>
          Marco Polo saw both ends of the road. On his way out, probably in the 1270s, he came down through Persia
          to Hormuz, meaning to take ship for India, and did not. On his way home, around 1291, he sailed the whole
          route from China. Source Library has the Italian text in the Florentine edition of 1827, with the
          editor&rsquo;s long notes, and the library&rsquo;s English translation. The editor&rsquo;s note on the
          lord of Hormuz points out that Polo names him as living, and argues that Polo saw the city again in 1293, when
          he landed there from Cathay on his way home.
        </P>

        <P>
          The reason for the voyage is told in the prologue. The Mongol ruler of Persia, Arghun, had lost his wife
          and sent to Kublai Khan for a bride of her family. The overland road was blocked by war, so the envoys
          proposed to go by sea, taking the three Venetians, &ldquo;who were experienced in navigating those
          seas&rdquo;. Kublai let them go unwillingly:
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
          They sailed about three months to &ldquo;an island towards the south named Java&rdquo;, which the editor
          explains is Sumatra, and then{' '}
          <Link href={`/book/${POLO}?page=56`}>
            &ldquo;navigated the Indian Sea for eighteen months before they could arrive at the country of King
            Argon&rdquo;
          </Link>
          . The cost is given on the next page:{' '}
          <Link href={`/book/${POLO}?page=57`}>
            &ldquo;from the day they entered the sea until their arrival, about six hundred people died among the
            sailors and others who were in said ships; and of the three ambassadors, only one remained, whose name
            was Goza&rdquo;
          </Link>
          . Arghun was dead when they arrived, and the bride was given to his son Ghazan.
        </P>

        <P>
          The port they left from was Zaitun, the name the Arabs and Persians used for Quanzhou, Chau Ju-kua&rsquo;s
          city. Polo&rsquo;s description of it is the boast of a merchant:
        </P>

        <SourceQuote
          book={POLO}
          page={391}
          printedPage={353}
          src={IMG(POLO_ID, 391)}
          source={<>Marco Polo, <em>Il Milione</em> (Florence, 1827), English translation by Source Library</>}
          pageAlt="Page 353 of the 1827 Il Milione, Polo’s chapter on the port of Zaitun, with the editor’s note identifying it with Quanzhou"
        >
          It has a port on the Ocean Sea, very famous for the arrival of so many ships with so much merchandise,
          which is distributed throughout the entire province of Mangi. Such a quantity of pepper comes here that
          what is brought from Alexandria to the parts of the West is a minimal part, and almost one percent in
          comparison to this.
        </SourceQuote>

        <P>
          He adds the arithmetic of the trade. The Khan takes ten per cent of every cargo; the ship charges thirty per
          cent freight on fine goods, forty-four on pepper, forty on aloeswood and sandalwood; so the merchants pay
          away half of what they bring, &ldquo;and yet, from that half which remains to them, they make such large
          profits that they wish to return at every hour with other merchandise.&rdquo; In the book on India he
          describes the ships of Mangi, southern China: four masts, bulkheads dividing the hold into watertight
          compartments, so that when a whale stoves in a plank{' '}
          <Link href={`/book/${POLO}?page=397`}>
            &ldquo;the water cannot pass from one hold to another, since they are so well fitted&rdquo;
          </Link>
          ; double planking nailed with iron, caulked with a paste of lime, hemp and tree oil &ldquo;more tenacious
          than birdlime, and better than pitch&rdquo;; crews of three hundred, two hundred or a hundred and fifty
          sailors; cargoes of five or six thousand baskets of pepper.
        </P>

        <P>
          At the other end he had seen the opposite. Hormuz, on an island off the Persian coast, was the market for
          the Indies: there{' '}
          <Link href={`/book/${POLO}?page=92`}>
            &ldquo;arrive all the merchants from all parts of India with spices, precious stones, pearls, cloths of
            gold and of silk, elephant teeth, and many other goods&rdquo;
          </Link>
          . In summer the people left the town for huts built over the water, to escape a wind from the sand so
          hot that it could kill. And the ships of Hormuz frightened him:
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
          peril in them; and the cause is this, because they are not fastened with nails, as the wood with which
          they are built is hard and of a fragile material like an earthen vessel, and immediately as the nail is
          driven it recoils into itself and almost breaks; but the planks are bored with iron drills as lightly as
          they can at the extremities, and afterwards some wooden keys are put in, with which they are closed, and
          after they bind or sew them with a thick thread, which is taken from the barks…
        </SourceQuote>

        <P>
          The thread is coir, from the husk of the coconut. Each of these ships had one mast, one rudder and one
          deck, and when loaded was covered with hides on which stood the horses being shipped to India. The
          contrast between the two ends of the road, nailed Chinese junks with bulkheads and sewn Gulf boats with a
          single mast, is one Polo drew himself.
        </P>

        <Section>Ibn Battuta waits for the monsoon</Section>

        <P>
          Ibn Battuta of Tangier reached the Malabar coast in the 1340s as the envoy of the Sultan of Delhi to the
          Mongol emperor of China. The library has the Arabic text of his <em>Rihla</em> with an English
          translation. At Calicut he and his party were met by the chief of the merchants, a man from Bahrain, with
          drums, trumpets and flags on boats. In the harbour were thirteen Chinese ships, and they waited three
          months for the season to sail. Calicut, he says, was{' '}
          <Link href={`/book/${BATTUTA}?page=448`}>
            &ldquo;visited by people from China, Java, Ceylon, the Maldives, Yemen, and Fars&rdquo;
          </Link>
          , and among its residents was a ship-owner named Mithqal with &ldquo;many ships for his trade in India,
          China, Yemen, and Fars&rdquo;. Then he explains why they had to wait for a Chinese ship at all:
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
          The account goes on (the library&rsquo;s translation carries it further on this page than the printed
          Arabic leaf does, so I quote only what is on the scan) to give a thousand men to a large junk, six hundred
          sailors and four hundred soldiers, and four decks with private cabins for merchants. His own departure was
          a disaster. He stayed ashore for the Friday prayer while his people and goods went aboard a smaller ship,
          a <em>kakam</em>; that night the sea rose,{' '}
          <Link href={`/book/${BATTUTA}?page=450`}>
            the junk carrying the Sultan&rsquo;s gift was thrown on the shore and &ldquo;everyone on board
            died&rdquo;
          </Link>
          , and the crew of the <em>kakam</em>, seeing it, raised sail and left &ldquo;taking with them all my
          luggage, my servants, and my slave girls.&rdquo; In the wreck of another junk a slave girl clinging to the
          stern was saved by &ldquo;one of the Hormuzian sailors&rdquo;, who refused the reward. Ibn Battuta was left
          on the beach with ten dinars and a mat. He went down the coast to Quilon, which he calls{' '}
          <Link href={`/book/${BATTUTA}?page=451`}>
            &ldquo;the first to which ships travel from the lands of Malabar to China, and most of them travel to
            it&rdquo;
          </Link>
          . Quilon again: the Kulam Mali of the ninth-century Arab itinerary and the Mo-lai of Kia Tan.
        </P>

        <P>
          Years later, after the Maldives, Ceylon, Bengal and Sumatra, he did reach China, and landed where Polo had
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
          does all the land of China and India, but it is a name placed upon it. It is a great and huge city where
          kamkha and satin garments are made; it is known by them and is superior to the Khansawi and Khanbaliqi
          garments. Its harbor is one of the greatest harbors in the world; indeed, it is the greatest. I saw in it
          about a hundred large junks, and as for the small ones, they are beyond count.
        </SourceQuote>

        <P>
          <em>Zaytun</em> is Arabic for olive, which is why he stops to say there were none. The word
          &ldquo;satin&rdquo; may come from this city&rsquo;s name, though that is a later etymology and not his.
          On the same page he describes the inns along the Chinese roads, where an official locked the Muslim
          travellers in each night, called the roll each morning and sent them on with an escort who had to bring
          back a receipt: &ldquo;The land of China is the safest land and the best in condition for
          travelers.&rdquo;
        </P>

        <Section>Zheng He&rsquo;s charts</Section>

        <P>
          Between 1405 and 1433 the Ming court sent seven fleets into the Indian Ocean under the eunuch Zheng He.
          They reached Calicut on the first voyage and Hormuz on the fourth, and later squadrons went on to Aden,
          Dhofar and the coast of Africa. The library does not yet hold an English translation of the narratives
          written by men who sailed with him, though what appears to be the Chinese text of Fei Xin&rsquo;s account
          sits untranslated in a Ming collectanea. What it does hold, translated, is the chart.
        </P>

        <P>
          In 1621 Mao Yuanyi, a Ming writer on military affairs, finished the <em>Wubei zhi</em> (武備志), a huge
          treatise on armament, and in its 240th chapter he printed a set of sea charts drawn from Zheng He&rsquo;s
          voyages. They are now usually called the Mao Kun map. In his preface to the chapter he explains why a
          military encyclopaedia should keep them:
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
          The charts are a long strip cut into pages, with the coast drawn along the top and bottom and the sailing
          courses as dotted lines between, labelled with compass bearings and the number of watches to sail. On one
          page off southern Vietnam, among islands with names like Overturned Cauldron Mountain and Bronze Drum
          Mountain, a single line of text runs along the course:
        </P>

        <PageFigure
          src={IMG(WUBEI_ID, 67)}
          alt="Woodblock page from the Wubei zhi chart: islands drawn as small mountains, dotted sailing courses, and a line of text along a course recording Zheng He’s passage in 1416"
          href={`/book/${WUBEI}?page=67`}
          source={<>Mao Yuanyi, <em>Wubei zhi</em> (1621)</>}
        >
          A page of the Mao Kun chart around Pulo Condore (崑崙山, &ldquo;Kunlun Mountain&rdquo;). The line along the
          dotted course reads, in the library&rsquo;s translation, &ldquo;Kunlun Mountain. In the 14th year of the
          Yongle reign [1416], the Principal Envoy, Grand Eunuch Zheng He, arrived here while traveling to the
          Western Ocean.&rdquo;
        </PageFigure>

        <P>
          At the end of the chapter are four star charts for the open-sea crossings, where there was no coast to
          follow. Each shows a ship with its sails set in the middle of the page and, around it, the stars to look
          for and their height above the horizon in &ldquo;fingers&rdquo;, a unit of about a degree and a half.
          All four are for crossings in the Indian Ocean: from the coast of Arabia to Hormuz, to Ceylon, from Ceylon
          back to Calicut, and back towards Sumatra. The first is for Hormuz:
        </P>

        <div className="max-w-lg mx-auto">
          <PageFigure
            src={IMG(WUBEI_ID, 86)}
            alt="Star chart from the Wubei zhi: a three-masted junk with matting sails in the centre, surrounded by small star diagrams and columns of text giving their altitudes"
            href={`/book/${WUBEI}?page=86`}
            source={<>Mao Yuanyi, <em>Wubei zhi</em> (1621)</>}
          >
            The star chart for the crossing to Hormuz. The first column of text at the top right reads, in the library&rsquo;s
            translation: &ldquo;When sailing from Dingdebaqi to Hormuz, observe the North Star at fourteen
            fingers.&rdquo; Dingdebaqi is identified in the translation&rsquo;s note with Ras al-Hadd in Oman.
          </PageFigure>
        </div>

        <P>
          The other labels around the ship give the Southern Cross, called the Lantern Bone Star, at four and a half
          fingers on reaching &ldquo;Shaguma Mountain&rdquo;, probably near the Strait of Hormuz; Vega, the Weaver
          Girl, at seven fingers to the east; Alpha and Beta Centauri, the South Gate Double Stars, at six. It is
          the same craft Zhu Yu described three centuries earlier, steering by the stars at night, now written
          down for the Gulf.
        </P>

        <P>
          The Chinese record of the countries Zheng He visited passed into the official <em>History of the
          Ming</em>, and from there into later compilations. Wei Yuan, in 1844, quotes it on Dhofar in southern
          Arabia, which{' '}
          <Link href={`/book/${WEI16}?page=48`}>
            &ldquo;can be reached by sailing northwest from Guli [Calicut] with a favorable wind for ten days and
            nights&rdquo;
          </Link>
          . In 1421 it sent envoys to the Ming court with those of Aden, and &ldquo;the Emperor ordered Zheng He to
          carry the imperial seal and gifts to reward them.&rdquo; The <em>History</em> notes the mosques, and that
          on the day of prayer all markets close and everyone bathes and puts on new clothes, scented with rosewater
          or agarwood.
        </P>

        <Section>The Portuguese at Hormuz</Section>

        <P>
          The Chinese fleets stopped after 1433, and when the Portuguese came round Africa in 1498 the junks were a
          memory on the Malabar coast. Da Costa, whose four hundred ships opened this article, says the Chinese
          had once{' '}
          <Link href={`/book/${COSTA}?page=196`}>
            had in Calicut &ldquo;their house of trade, called to this day Chinacota&rdquo;
          </Link>
          , where they sold sandalwood that was then carried west. He wrote at second hand, following the Goa
          physician Garcia de Orta, whose <em>Colloquies</em> of 1563 were put into Latin by Carolus Clusius in
          1567. Orta knew that the overland and sea roads competed, and that the sea was harder on the cargo:
        </P>

        <SourceQuote
          book={ORTA}
          page={171}
          printedPage={165}
          src={IMG(ORTA_ID, 171)}
          source={<>Garcia de Orta, <em>Aromatum historia</em>, tr. Clusius (Antwerp, 1567), English translation by Source Library</>}
          pageAlt="Page 165 of Clusius’s Latin Orta, with the chapter on rhubarb"
        >
          For it is conveyed from the region of China through Tartary, Hormuz, and Aleppo, thence to Alexandria, and
          finally to Venice, whence it seeks the remaining realms of Europe. Besides that which is brought in by ships
          from China, we also use that which the Persians convey from Hormuz, which suffers less from wood-boring
          worms and rot than what is brought by ships from China. For aromatics that are imported by sea in the space
          of one month spoil more than those that are imported by an overland journey in the time of a whole year.
        </SourceQuote>

        <P>
          Hormuz by then belonged to the Portuguese, who had taken it under Afonso de Albuquerque in 1515 and kept a
          fortress there. The fullest description in the library is by the Dutchman Jan Huyghen van Linschoten, who
          served the Archbishop of Goa in the 1580s and published his <em>Itinerario</em> at Amsterdam in 1596. His
          Hormuz is the one Polo knew, still unbearably hot:
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
          There was no fresh water on the island. It came from the mainland and was kept in great jars and cisterns,
          and some was fetched from Bahrain, where divers went down four or five fathoms below the salt sea to a
          spring of sweet water, &ldquo;as sweet and good as the best fountain water&rdquo;. The captaincy of Hormuz
          was one of the most profitable posts in Portuguese India, chiefly because the captain controlled the export
          of horses, which sold in India for four or five hundred pardaos each and sometimes a thousand. Ships sailed
          from Goa to Hormuz in January, February and March, and again in September and October.
        </P>

        <P>
          Linschoten&rsquo;s book was copied for a century. When the German physician Engelbert Kaempfer, who served
          the Dutch East India Company at Bandar Abbas in the 1680s, published his <em>Amoenitates exoticae</em> in
          1712, his folding map of the Gulf carried a view of Hormuz with the caption &ldquo;Ormus urbs a Lusitanis
          habitata, ex Linschoto&rdquo;, the town of Hormuz as inhabited by the Portuguese, after Linschoten. By then
          the Portuguese had been gone for ninety years, driven out in 1622 by the Persians with English ships, and
          the town was in ruins.
        </P>

        <PageFigure
          src={IMG(KAEMPFER_ID, 851)}
          alt="Part of a folding plate in Kaempfer’s Amoenitates exoticae: an engraved view of Hormuz from the sea with ships, a small plan of the island, and a fortress on Qeshm, set into a map of the Gulf"
          href={`/book/${KAEMPFER}?page=851`}
          source={<>Engelbert Kaempfer, <em>Amoenitates exoticae</em> (Lemgo, 1712)</>}
        >
          Hormuz &ldquo;after Linschoten&rdquo; in the corner of Kaempfer&rsquo;s map of the Gulf, with a plan of
          the island (&ldquo;Ormus ins. plan.&rdquo;) and below it the castle on Qeshm (&ldquo;Kismis&rdquo;). The
          scan shows the plate partly folded. The detail at the top of this article is taken from it.
        </PageFigure>

        <P>
          The Dutch, coming after the Portuguese, thought about the whole road as a business. Cornelis Matelief, who
          commanded a Dutch East India Company fleet in 1605 to 1608, besieged Malacca and tried to open trade at
          Canton, wrote a memorandum in 1607 that sets out the company&rsquo;s problem in a list:
        </P>

        <SourceQuote
          book={MATELIEF}
          page={88}
          printedPage={74}
          src={IMG(MATELIEF_ID, 88)}
          source={<>Cornelis Matelief, <em>Journael ende historische verhael</em> (1648 edition), English translation by Source Library</>}
          pageAlt="Page 74 of Matelief’s journal in Dutch black letter, with the numbered list of the parts of the East India trade"
        >
          All the trade of the East Indies consists of these following parts. 1. Fetching Pepper at Bantam, Johor,
          Patane, Queda, and Achem. 2. Fetching Cloves in Amboyna and the Moluques. 3. Fetching Nutmeg and Mace in
          Banda. 4. The trade at Camboya. 5. The trade on Coromandel with cloths, and at Bengala, still unknown. 6.
          The trade at China, and what is attached to it, Japan.
        </SourceQuote>

        <P>
          &ldquo;If these goods are not all in one hand,&rdquo; he goes on, &ldquo;whether that of the Portuguese or
          our own, we will ruin each other.&rdquo; The road that Sulayman and Ibn Battuta had travelled as one link
          in a chain of harbours, each with its own rulers and its own toll, was now looked at from Europe as a set
          of monopolies to be won.
        </P>

        <Section>Looking back from Canton, 1844</Section>

        <P>
          The last book on the road is Chinese again, and it was written after the road had turned against China.
          Wei Yuan compiled his <em>Haiguo tuzhi</em> (海國圖志, <em>Illustrated Treatise on the Maritime
          Kingdoms</em>) in 1842 to 1844, after the British victory in the First Opium War, from Chinese histories and
          from the translated Western geographies that Lin Zexu had collected at Canton. Source Library holds many of
          its volumes, translated. In the volume on the countries of the western Indian Ocean Wei quotes a Chinese
          geography of 1674 by the Flemish Jesuit Ferdinand Verbiest on Hormuz:
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
          overseas. Because it is situated in the midst of three continents, wealthy merchants and prominent traders
          gather here in great numbers.
        </SourceQuote>

        <P>
          It is Linschoten&rsquo;s Hormuz, people sleeping in water and drinking water carried from elsewhere,
          reaching China by way of a Jesuit, two centuries after Linschoten and more than a century after the town
          had ceased to matter. Wei adds a note in small characters: &ldquo;The History of the Ming writes it as
          Hulumusi&rdquo;, the name in Zheng He&rsquo;s star chart.
        </P>

        <P>
          Elsewhere Wei sets out plainly how far Chinese ships now went. Under the Qing, he says, the foreign trade of
          the north-western seas came to China in foreign ships, while in the southern seas Chinese ships went out.
          The maritime ban had been relaxed, and yet:
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
          In Wei&rsquo;s terms the Lesser Western Ocean is the Indian Ocean and the Greater Western Ocean is
          Europe&rsquo;s Atlantic. A thousand years after Kia Tan wrote down the stages from Canton to the
          caliph&rsquo;s river, the Chinese end of the road was being described by a man who had to learn its western
          end from European books, and whose reason for writing was that the ships now came the other way.
        </P>

        <Section>A note on the sources</Section>

        <P>
          The English of the Arabic, Persian, Chinese, Italian, Latin, Spanish and Dutch books quoted here is Source
          Library&rsquo;s own translation, made with AI from the transcription of each page; follow any link to read
          the page beside its scan and judge it. Two books are quoted in printed English: Hirth and Rockhill&rsquo;s{' '}
          <em>Chau Ju-kua</em> (1911), which includes their translations of Kia Tan and Zhu Yu, and the 1841 English
          version of al-Mas&lsquo;udi&rsquo;s <em>Meadows of Gold</em> by Aloys Sprenger. The Arabic geographers are
          read in M. J. de Goeje&rsquo;s Leiden editions. Dates and a few identifications that the pages themselves do
          not give (the years of Zheng He&rsquo;s voyages, the Portuguese capture and loss of Hormuz, Kia Tan&rsquo;s
          date) are the standard ones and are given here without a library page. Where the library&rsquo;s English
          translation runs beyond what the scan shows, as on one page of Ibn Battuta, only the part the scan bears out
          is quoted.
        </P>
      </article>
    </ContentPageLayout>
  );
}
