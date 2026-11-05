import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import SourceQuote from '@/components/articles/SourceQuote';
import PageFigure from '@/components/articles/PageFigure';

const HEADER_IMAGE = '/articles/how-europe-read-mesoamerican-books/humboldt-plate-45.jpg';

export const metadata: Metadata = withArticleMeta('how-europe-read-mesoamerican-books', {
  title: 'How Europe Read the Books of Mesoamerica - Articles - Source Library',
  description:
    'From two books on a list of 1519 to the syllables of 1952: Peter Martyr, Landa, the Popol Vuh, Humboldt, Kingsborough, Valentini, Förstemann and Brinton on Mesoamerican writing.',
  openGraph: {
    title: 'How Europe Read the Books of Mesoamerica',
    description: 'From two books on a list of 1519 to the syllables of 1952.',
    images: [{ url: HEADER_IMAGE, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: HEADER_IMAGE }],
  },
});

const A = 'https://images.sourcelibrary.org/archived/';
const P = 'https://images.sourcelibrary.org/books/';

const CORTES = '6aeaf0c757b73e60374be150';
const MARTYR = '69e9c969625ec74a14473450';
const NUTTALL = '6953cbc877f38f6761be004a';
const LANDA_MS = '6aeae8510ac105855784fac8';
const LANDA_1864 = '69f8c0f74c6a515115aedadd';
const LIZANA = '6aeae62636e02f68d85417e4';
const SANCHEZ = '69f8c1170c0c281d4bd32721';
const COGOLLUDO_1867 = '69f8c1030c0c281d4bd321fd';
const ACOSTA = '695910f2ecb01322b3068302';
const VILLAGUTIERRE = '6a9f3f9783c3b522416e4054';
const POPOL_VUH = '6a87106327fd08cecf145caa';
const SAHAGUN = '6a9f3fc183c3b522416e5d32';
const IXTLILXOCHITL = '6a9f3fb983c3b522416e5601';
const CANTARES = '6acc3973c1411f8cc628ca5c';
const RAMUSIO = '6aeb0ece442d702bccb966ea';
const MERCATI = '6ac4f9964ba7223afef6945d';
const HORN = '6a42b8f85207af7c42f66a51';
const LOMEIER = '69b6b5a696dc15d4a16e8df0';
const GOETZE = '6aeaf0d157b73e60374be3d0';
const ROBERTSON = '6a4a34b3b49cf960c37df713';
const HUMBOLDT_PLATES = '6aeb00fe19312ecd297aa315';
const RAFINESQUE = '6aeae63136e02f68d854190d';
const KINGSBOROUGH_8 = '6a9f3ff383c3b522416e8282';
const STEPHENS = '6a98bc55ec48f9ad103e477d';
const VALENTINI = '6abfbf233c453a90d6662f6e';
const SELER = '6abfbf2f3c453a90d666340f';
const THOMAS_1882 = '6abfbf293c453a90d6663269';
const THOMAS_1893 = '6abfbf363c453a90d6663420';
const BRINTON = '6abfbf383c453a90d6663443';
const BRINTON_1882 = '69f8c11e0c0c281d4bd32838';
const FORSTEMANN = '6abfbf2c3c453a90d66633a5';
const BOWDITCH = '6abfbf413c453a90d66637dc';
const SCHELLHAS = '6abfbf3d3c453a90d6663605';
const MORLEY = '6abfbf433c453a90d66639d1';

const IA = 'https://archive.org/details/';

const RAH = <>Madrid, Real Academia de la Historia, MS 9/5153, Public Domain Mark on the Academy&rsquo;s record; the Academy&rsquo;s notice is on the scan</>;

function Leaf({ book, page, children }: { book: string; page: number; children: React.ReactNode }) {
  return <Link href={`/book/${book}?page=${page}`}>{children}</Link>;
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">{children}</h2>;
}

function Para({ children }: { children: React.ReactNode }) {
  return <p className="text-secondary leading-relaxed mb-6 font-body">{children}</p>;
}

// A quotation from a book outside the library: cited in the text, no page picture (article-rules.md).
function OutsideQuote({ cite, children }: { cite: React.ReactNode; children: React.ReactNode }) {
  return (
    <blockquote className="border-l-2 border-stone-300 pl-5 my-8 text-secondary font-body leading-relaxed">
      {children}
      <footer className="text-sm mt-2 font-sans">{cite}</footer>
    </blockquote>
  );
}

// Three signs from Stuart's Syllabary. Vector files, which the image optimiser
// does not take, so these are plain <img> at a fixed size. The credit is the
// wording recorded with the permission and must stay beside any use.
function SyllabarySigns() {
  const signs = [
    { file: 'e-1', label: 'e', alt: 'The syllable e: a rounded sign with an arch over three dots' },
    { file: 'ka-2', label: 'ka', alt: 'The syllable ka in its comb form: a curved stem with teeth' },
    { file: 'ka-1', label: 'ka', alt: 'The syllable ka in its fish form: a fish head with fins' },
  ];
  return (
    <figure className="not-prose my-10">
      <div className="flex flex-wrap justify-center gap-8">
        {signs.map((s) => (
          <div key={s.file} className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/learn/maya/glyphs/stuart/${s.file}.svg`} alt={s.alt} width={96} height={96} className="h-24 w-24 object-contain" />
            <div className="text-sm text-secondary mt-2 font-sans italic">{s.label}</div>
          </div>
        ))}
      </div>
      <figcaption className="text-sm text-secondary mt-4 font-sans">
        Syllable signs from David Stuart&rsquo;s{' '}
        <a href="https://mayadecipherment.com/2013/09/18/maya-hieroglyphic-syllabary/">Maya Hieroglyph Syllabary</a> (2013). These are Classic carved forms, centuries older than the
        manuscript and in a different medium. Drawings &copy; David Stuart, used with permission; vector tracing by Source Library.
      </figcaption>
    </figure>
  );
}

export default function HowEuropeReadPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title="How Europe Read the Books of Mesoamerica"
          subtitle="From two books on a list of 1519 to the syllables of 1952: who saw one, who copied whom, and what the people who made them said"
          image={HEADER_IMAGE}
          imageAlt="Five leaves of the Dresden Codex in the coloured engraving from Humboldt's Vues des cordillères, with columns of signs, bars and dots and painted panels of gods"
        >
          <p className="text-stone-400 text-sm mt-4">6 November 2026 &middot; 18 min read</p>
        </ContentHeader>
      }
    >
      <Para>
        In the summer of 1519 the town council Cortés had just founded at Veracruz sent a shipment to Charles V. The list of what went with it runs to gold, feathers and cotton. Between some small deerskins and half a dozen feather fly-whisks is one line.
      </Para>

      <SourceQuote
        book={CORTES} page={89} printedPage={33} src={`${A}${CORTES}/89.jpg`}
        source={<><em>Cartas y relaciones de Hernán Cortés</em>, ed. Gayangos (Paris, 1866)</>}
        original="Mas dos libros de los que acá tienen los indios."
      >
        Also two books, of those the Indians have here.
      </SourceQuote>

      <Para>
        That is all the list says. It gives no maker, no place and no description. The editors of the <a href={`${IA}coleccindedocu01madruoft/page/n476/mode/1up`}><em>Colección de documentos inéditos</em></a> printed it in 1842 with the variants of a second manuscript, the treasurer&rsquo;s manual at Seville, and marked where the Vienna copy falls short. They note no variant on this line. The same page of the list says the king received everything <Leaf book={CORTES} page={90}>at Valladolid in Holy Week 1520</Leaf>.
      </Para>
      <Para>
        For the next four centuries Europeans argued about what such books were: writing, pictures, magic, or something between. Very few of them ever handled one. This article follows that argument through the pages the library holds, and says at each step who saw a book, who was repeating someone else, and what the people who made the books said about them.
      </Para>

      <H2>The man who described them</H2>
      <Para>
        Peter Martyr of Anghiera, an Italian humanist at the Spanish court, wrote up the same gifts. He had at least seen the messengers who came with them, since he remarks that he never saw anything uglier than their pierced lips. He begins his account of the gifts with the books.
      </Para>

      <SourceQuote
        book={MARTYR} page={175} src={`${A}${MARTYR}/175.jpg`}
        source={<>Peter Martyr, <em>De insulis nuper inventis</em>, in <em>De orbe novo</em> (Basel, 1533), fol. 73</>}
        original="Diximus libros habere gentes has: libros attulerunt una cum ceteris muneribus, hi Colluacanae noui coloni, procuratores, nuncii, multos."
      >
        We have said that these peoples have books. These new settlers of Colhuacan, the agents and messengers, brought many books along with the other gifts.
      </SourceQuote>

      <Para>
        <em>Multos</em>: many, where the list says two. Martyr does not explain the difference. A little earlier he says of the houses on Cozumel, off Yucatan, <Leaf book={MARTYR} page={171}>&ldquo;Habent etiam innumeros libros&rdquo;</Leaf>, they also have innumerable books, and that word will come back.
      </Para>
      <Para>
        He then gives the earliest European description of a Mesoamerican book we have found. The leaves are the thin inner bark of trees, joined with a tough glue and coated with something like gypsum. The book is drawn out in a strip several cubits long and folded, with two written faces showing wherever it is opened, and when closed it looks like one of ours. Then the signs.
      </Para>

      <SourceQuote
        book={MARTYR} page={176} src={`${A}${MARTYR}/176.jpg`}
        source={<>Peter Martyr, <em>De orbe novo</em> (Basel, 1533), fol. 73v</>}
        original="Sunt characteres a nostris ualde dissimiles, taxillis, hamis, laqueis, limis, stellisque ac formis eiusmodi, lineatim exarati nostro more, aegyptias fere formas aemulantur. Interlineatim hominum, animaliumque species, regum praecipue ac procerum depingunt: quare credendum est gesta esse ibi maiorum cuiusque regis conscripta."
      >
        The characters are very unlike ours: little dice, hooks, snares, files, stars and forms of that kind, marked out in lines after our manner, and they come close to Egyptian forms. Between the lines they paint figures of people and animals, especially kings and nobles, so it is to be believed that the deeds of each king&rsquo;s ancestors are written there.
      </SourceQuote>

      <Para>
        Signs like dice and hooks, set in lines, sound more like Maya writing than like the painted Mixtec screenfolds. That is an inference, and it is ours. Martyr names Colhuacan, not Yucatan, and he may be running several books together. Whether a Maya book was in the shipment of 1519 is not known.
      </Para>
      <Para>
        Two years later Martyr recorded the first doubt. A man called Ribera, a companion of Cortés, told him these were no books at all but pattern sheets for jewellers and embroiderers. Martyr would not have it. Lord Kingsborough printed the passage in an old English version, with his own puzzled comment that Ribera, who had spent two years in New Spain, must have known better.
      </Para>
      <OutsideQuote cite={<>Peter Martyr, fifth Decade, ch. 10, <a href={`${IA}deorbenouopetrim00angh/page/n180/mode/1up`}><em>De orbe novo decades</em> (Alcalá, 1530), fol. 86</a>; English from the old version printed by Kingsborough, <a href={`${IA}AntiquitiesMexi6King/page/n279/mode/1up`}><em>Antiquities of Mexico</em>, vol. VI, p. 268</a></>}>
        <p className="italic mb-3">Quid credam in hac varietate non intelligo. Libros esse puto, charactheresque illos ac imagines aliud aliquid significare, cum Romae viderim in obeliscis eiusmodi res quae pro litteris habebantur.</p>
        What I should thinke in this variety I knowe not. I suppose them to bee bookes, and that those characters and images signifie some other thinge, seeinge I have seene the like thinges in the obeliskes and pillers at Rome, which were accounted letters.
      </OutsideQuote>
      <Para>
        The comparison with Egypt starts here and lasts until the nineteenth century.
      </Para>

      <H2>Whether the two books survive</H2>
      <Para>
        In 1902 Zelia Nuttall published a facsimile of a screenfold from Florence and made the boldest claim anyone has made about that line in the list. She argued that this book and its sister in Vienna <Leaf book={NUTTALL} page={20}>are the two</Leaf>. Her chain has several links. The year 1 Reed, which she equates with 1519, is the most prominent date in both. An inscription on the Vienna book names King Manuel of Portugal and Clement VII. Charles V is known to have given away some of the rarities he received.
      </Para>
      <SourceQuote
        book={NUTTALL} page={21} printedPage={11} src={`${A}${NUTTALL}/21.jpg`}
        source={<>Zelia Nuttall, <em>Codex Nuttall</em> (Cambridge, Mass., 1902)</>}
      >
        Historical evidence points to the conclusion that they are identical with the &ldquo;native books&rdquo; recorded in the inventory of 1519.
      </SourceQuote>
      <Para>
        This is an argument, and no record connects them. Both books are now classed as Mixtec, which Nuttall did not know. The inscription had already troubled readers: Johann Christian Götze <Leaf book={GOETZE} page={20}>pointed out in the 1740s</Leaf> that Lambeck&rsquo;s repair of it, moving the gift to Leo X and 1513, cannot stand, since no Mexican book was known in Europe before 1519.
      </Para>

      <H2>Burned, and regretted in print</H2>
      <Para>
        The most quoted sentence about Maya books is about their end. It survives in a manuscript in Madrid, an anonymous copy of the account attributed to Diego de Landa. The copy is undated, estimates run from the later sixteenth century to after 1616, and how much of the text is Landa&rsquo;s own is disputed (Restall and Chuchiak, 2002). The copyist first wrote that the books held nothing without superstition and <em>engaño</em>, deceit, then struck the word and went on.
      </Para>

      <SourceQuote
        book={LANDA_MS} page={98} src={`${P}${LANDA_MS}/pages/0097.jpg`}
        source={<>Relación de las cosas de Yucatán, frame 98. {RAH}</>}
        original="Hallamos les grande numero de libros destas sus letras, y porque no tenian cosa, en que no uviesse supersticion y falsedades del demonio se los quemamos todos, lo qual a maravilla sentian, y les dava pena."
      >
        We found a great number of books in these letters of theirs, and because they held nothing without superstition and falsehoods of the devil we burned them all, which they felt wonderfully and which gave them grief.
      </SourceQuote>

      <Para>
        The number usually given does not come from this page. Daniel Brinton wrote in 1882 of <Leaf book={BRINTON_1882} page={73}>&ldquo;Twenty-seven rolls&rdquo;</Leaf> of deerskin burned at Maní in 1562. His footnote cites only the sentence above, which has no figure, and <Leaf book={BOWDITCH} page={28}>Charles Bowditch repeated him</Leaf> in 1910. The figure is older than Brinton and much younger than Landa. An appendix to the 1867 Mérida edition of Cogolludo quotes a Yucatec writer who had tried to learn what was destroyed and could offer, from notes by Pablo Moreno and a letter written in Bologna in 1805 by the Jesuit Domingo Rodríguez, <Leaf book={COGOLLUDO_1867} page={616}>&ldquo;sin otra autoridad&rdquo;</Leaf>, on no other authority, a list: 5,000 idols, 13 altar stones, 22 smaller stones, &ldquo;27 rollos de signos y geroglíficos en piel de venado&rdquo;, 27 rolls of signs and hieroglyphs on deerskin, and 197 vessels. That is the source of the number, as far as we can trace it: a list made about 240 years after the event. None of the colonial witnesses we read gives a count. Bernardo de Lizana, defending Landa as a saintly man, admits what went with the idols, <Leaf book={LIZANA} page={163}>&ldquo;a las bueltas se quemaron muchos libros historiales&rdquo;</Leaf>, many historical books were burned along with them, and justifies it from the converts in Acts. Pedro Sánchez de Aguilar, a priest in Yucatan, says the first friars gathered and burned these books <Leaf book={SANCHEZ} page={198}>&ldquo;inaduertidamente&rdquo;</Leaf>, carelessly, and regrets it for a practical reason: the priests could have preached against what they contained.
      </Para>
      <Para>
        The earliest printed complaint we have found is by the Jesuit José de Acosta, who never names the friar.
      </Para>

      <SourceQuote
        book={ACOSTA} page={415} printedPage={407} src={`${A}${ACOSTA}/415.jpg`}
        source={<>José de Acosta, <em>Historia natural y moral de las Indias</em> (Seville, 1590), book VI, ch. 7</>}
        original="Pareciole a vn Doctrinero, que todo aquello deuia de ser hechizos, y arte Magica, y porfiò, que se auian de quemar, y quemaronse aquellos libros, lo qual sintieron despues no solo los Indios sino Españoles curiosos, que desseauan saber secretos de aquella tierra."
      >
        It seemed to a parish friar that all of it must be spells and magic art, and he insisted they be burned, and those books were burned, which was regretted afterwards not only by the Indians but by curious Spaniards who wanted to know the secrets of that land.
      </SourceQuote>

      <Para>
        Not every book went then, and not all of the knowledge. The account of Fray Alonso Ponce&rsquo;s travels, quoted by Bowditch, says that only the priests and some leading men understood the characters, and adds: <Leaf book={BOWDITCH} page={28}>&ldquo;Despues las entendieron y supieron léer algunos frailes nuestros y aun las escribien&rdquo;</Leaf>, afterwards some of our friars understood them and learned to read them, and even write them. In 1697 the Spanish took the Itza island in Lake Petén, and Juan de Villagutierre&rsquo;s history of 1701 reports that books of tree bark with their prophecies <Leaf book={VILLAGUTIERRE} page={728}>&ldquo;tenia en su poder el General Ursua&rdquo;</Leaf>, were in General Ursúa&rsquo;s own hands. He does not say what became of them. The colonial sources on Maya religion are the subject of <Link href="/articles/maya-ritual-in-the-colonial-dictionaries">Maya Religion in the Colonial Sources</Link>.
      </Para>

      <H2>What the people who made them said</H2>
      <Para>
        Every voice so far is European. The books had readers of their own, and some of them wrote about the loss. The strongest statement stands on the first page of the Popol Vuh, written in K&rsquo;iche&rsquo; in Latin letters by an author who does not give a name, and known to us through the copy Francisco Ximénez made about 1701 with his Spanish in the facing column.
      </Para>

      <SourceQuote
        book={POPOL_VUH} page={9} printedPage={1} src={`${A}${POPOL_VUH}/9.jpg`}
        source={<>Popol Vuh, Ximénez manuscript (Newberry Library, Ayer MS 1515), in Ximénez&rsquo;s Spanish</>}
        original="esto escriviremos ya en la ley de Dios, en la cristiandad, lo sacaremos porque ya no ay libro comun, original donde verlo."
      >
        This we shall write now within the law of God, in Christianity. We bring it out because there is no longer a common book, the original, where it can be seen.
      </SourceQuote>

      <Para>
        The K&rsquo;iche&rsquo; column has the book&rsquo;s name where the Spanish has <em>libro comun</em>: &ldquo;maha bi chic ilbal re popo vuh&rdquo;. The Spanish goes on to say that there was once an original, &ldquo;sino que esta escondido al que lo mira, y al que lo piensa&rdquo;, but it is hidden from the one who looks and the one who thinks. Ximénez himself did not believe it. In his notes at the back he comments on that sentence: <Leaf book={POPOL_VUH} page={128}>&ldquo;lo cierto es que tal libro no paresio nunca, ni se ha visto&rdquo;</Leaf>, the fact is that no such book ever appeared or has been seen. He guessed it might have been painted on cloth, like the land maps kept in a town he knew. Brasseur de Bourbourg, printing the same line in 1861, called it <Leaf book={'69e729dca409200ea79f16d5'} page={22}>&ldquo;le Livre national&rdquo;</Leaf> and supposed the author a prince who learned European writing to save it.
      </Para>
      <Para>
        In central Mexico the transfer from painting to letters was done by people we can almost name. Bernardino de Sahagún describes how it went at Tepeapulco, and his account gives the work to the Nahua students he had taught.
      </Para>

      <SourceQuote
        book={SAHAGUN} page={14} printedPage="IV" src={`${A}${SAHAGUN}/14.jpg`}
        source={<>Bernardino de Sahagún, <em>Historia general de las cosas de Nueva España</em>, prologue (Mexico, 1829)</>}
        original="Todas las cosas que conferimos me las dieron por pinturas, que aquella era la escritura que ellos antiguamente usaban: los gramáticos las declararon en su lengua, escribiendo la declaracion al pie de la pintura. Tengo aun ahora estos originales."
      >
        Everything we discussed they gave me in paintings, for that was the writing they used in old times. The grammarians explained them in their own language, writing the explanation at the foot of the painting. I still have these originals.
      </SourceQuote>

      <Para>
        Two generations on, a descendant of the kings of Texcoco wrote as a reader of those books with a stake in them. Fernando de Alva Ixtlilxóchitl says that the first missionaries <Leaf book={IXTLILXOCHITL} page={22}>&ldquo;brûla tout sans examen&rdquo;</Leaf>, burned everything without looking, and that what escaped was saved by his ancestors and came to him. He says he gathered the old nobles to explain the paintings and <Leaf book={IXTLILXOCHITL} page={20}>&ldquo;je n&rsquo;en trouvai que deux&rdquo;</Leaf>, found only two who fully understood the figures and characters and could explain the songs. We read him in Ternaux-Compans&rsquo;s French of 1840. The songs themselves use the same vocabulary: the <Leaf book={CANTARES} page={66}><em>Cantares mexicanos</em></Leaf> speak of song as <em>amox</em>, book, and <em>tlacuilol</em>, painting.
      </Para>
      <Para>
        Every one of these reaches us through a friar, a copyist or an editor. We searched the Chilam Balam books of Chumayel and Tizimín for a Yucatec statement on the burning and did not find one.
      </Para>

      <H2>Two become many, without a new witness</H2>
      <Para>
        Some books did reach Italy. The Venetian editor Giovanni Battista Ramusio, in a discourse printed in the third volume of his <em>Navigationi</em>, says he owned some, sent by the chronicler Oviedo.
      </Para>

      <SourceQuote
        book={RAMUSIO} page={13} src="https://images.sourcelibrary.org/pages/6aeb0ece442d702bccb966ea/0013.jpg"
        source={<>Giovanni Battista Ramusio, <em>Terzo volume delle navigationi et viaggi</em> (Venice, 1565), Discorso</>}
        original="con alcune imagini hieroglifice descriuono le loro historie, & notano le memorie de i loro Re del Mexico, che sono certe figure d'animali, fiori, & huomini fatti in diuersi atti & modi: si come s'è veduto in que libri, che'l detto S. Gonzalo mandò à donare à V. E. & a me, gli anni passati, pieni di varie figure & bizzarie."
      >
        With certain hieroglyphic images they set down their histories and note the memory of their kings of Mexico, which are figures of animals, flowers and men in various acts and ways: as has been seen in those books that Signor Gonzalo sent as a gift to Your Excellency and to me some years ago, full of various figures and oddities.
      </SourceQuote>

      <Para>
        In 1589 Michele Mercati, writing on the obelisks of Rome, placed Mexican writing beside the Egyptian and pointed to something a reader could go and see: <Leaf book={MERCATI} page={122}>&ldquo;due libri della libraria Vaticana, ritratti da gli essemplari istessi, venuti dal Mexico&rdquo;</Leaf>, two books of the Vatican Library, drawn from the very exemplars that came from Mexico. <em>Ritratti</em> suggests copies. He thinks the system <Leaf book={MERCATI} page={123}>&ldquo;molto imperfetta&rdquo;</Leaf>, and that such peoples could not reach &ldquo;la diuina inuentione delle lettere nostre&rdquo;, the divine invention of our letters.
      </Para>
      <Para>
        After that the evidence mostly travels by copying. Georg Horn&rsquo;s <em>De originibus Americanis</em> of 1669 wants Mexican writing to descend from Chinese, and lists bound books of bark found <Leaf book={HORN} page={516}>in Cozumel, Yucatan, Mexico, Nicaragua and Guatemala</Leaf>, &ldquo;innumeri libri&rdquo;. His authorities are Martyr, Gómara, Acosta and Herrera. Three pages later he retells the burning from Acosta and lifts Martyr&rsquo;s description almost word for word.
      </Para>

      <SourceQuote
        book={HORN} page={520} printedPage={490} src={`${A}${HORN}/520.jpg`}
        source={<>Georg Horn, <em>De originibus Americanis</em> (1669), book IV, ch. 14</>}
        original="Unde irreparabili damno combusti fuerunt. Et Martyr dicit Coluacanorum literas Aegyptiacis similes fuisse, & taxillis, hamis, laqueis, limis, stellis ac ejusmodi formis constitisse"
      >
        Whence they were burned, an irreparable loss. And Martyr says that the letters of the Colhuacans were like the Egyptian, and consisted of little dice, hooks, snares, files, stars and forms of that kind.
      </SourceQuote>

      <Para>
        Eleven years later Johannes Lomeier, in a history of libraries, has the same five places and the same countless books, <Leaf book={LOMEIER} page={372}>&ldquo;ut variis testibus probat Hornius&rdquo;</Leaf>, as Horn proves from various witnesses, and then Martyr&rsquo;s description again. The printed histories we searched from before 1600, in the John Carter Brown collection, add French and Spanish versions of the same comparison with Egypt and no new account of Maya books. Martyr&rsquo;s word had become common knowledge.
      </Para>

      <H2>A Mexican book in Dresden</H2>
      <Para>
        The book that would change the question surfaces in the 1740s, as the first entry in Götze&rsquo;s catalogue of the treasures of the royal library at Dresden: <Leaf book={GOETZE} page={17}>&ldquo;Ein Mexicanisches Buch&rdquo;</Leaf>, in 39 folds and over six ells long, painted with figures &ldquo;die weder Buchstaben noch Wörter andeuten&rdquo;, that signify neither letters nor words.
      </Para>

      <SourceQuote
        book={GOETZE} page={20} printedPage={4} src={`${A}${GOETZE}/20.jpg`}
        source={<>Johann Christian Götze, <em>Die Merckwürdigkeiten der Königlichen Bibliotheck zu Dreßden</em> (Dresden, 1743-48)</>}
        original="Man hat ihn vor wenig Jahren bey einer Privat-Person in Wien gefunden, und als eine unbekannte Sache gar leicht umsonst erhalten. Ohne Zweiffel ist er aus einer Verlassenschafft eines Spaniers, welcher entweder selbst, oder doch dessen Vorfahren in America gewesen."
      >
        It was found a few years ago with a private person in Vienna and, as an unknown thing, obtained very easily for nothing. Without doubt it comes from the estate of a Spaniard who, himself or through his ancestors, had been in America.
      </SourceQuote>

      <Para>
        &ldquo;Without doubt&rdquo; is Götze&rsquo;s guess, with no name attached. A century later the position was the same: <a href={`${IA}palenquetabletin00rauc/page/53/mode/1up`}>Charles Rau wrote in 1879</a> that &ldquo;Nothing is known of the history of the codex, excepting that it was bought in 1739 at Vienna&rdquo;. Any link to Cortés is speculation.
      </Para>
      <Para>
        William Robertson&rsquo;s <em>History of America</em> of 1777 gave English readers the settled view. Having had paintings copied for him at Vienna, he wrote that the Mexicans <Leaf book={ROBERTSON} page={291}>&ldquo;were not acquainted, it is true, with any other method of recording transactions, than that of delineating the objects which they wished to represent&rdquo;</Leaf>. He calls it picture-writing and blames <Leaf book={ROBERTSON} page={275}>the &ldquo;fanatical zeal of the monks&rdquo;</Leaf> for the loss.
      </Para>
      <Para>
        Alexander von Humboldt saw that something was different. <Leaf book={HUMBOLDT_PLATES} page={96}>His plate 45</Leaf>, the picture at the head of this article, was made from a copy of five leaves he got through friends, and its caption names no people and no language. In his text he still calls it <a href={`${IA}vuesdescordille00humb/page/266/mode/1up`}>&ldquo;ce manuscrit aztèque&rdquo;</a>. Yet he notices that it resembles none of the Mexican ritual books he had just engraved. Here, he writes, <a href={`${IA}vuesdescordille00humb/page/267/mode/1up`}>&ldquo;un grand nombre d&rsquo;hiéroglyphes simples se suivent sans liaison, comme dans les hiéroglyphes égyptiens et dans les clefs des Chinois&rdquo;</a>, many simple hieroglyphs follow one another unlinked, as in Egyptian hieroglyphs and Chinese radicals. Of the dots and bars he declines to say whether they are numbers or real cursive characters: &ldquo;Nous ne déciderons pas&rdquo;.
      </Para>

      <H2>A fortune and a theory</H2>
      <Para>
        The whole Dresden book came into print through Lord Kingsborough, whose <em>Antiquities of Mexico</em> began to appear in 1831, with the plates drawn on stone by A. Aglio. Volume III holds the Dresden Codex in hand-coloured lithograph.
      </Para>

      <PageFigure
        src="/articles/how-europe-read-mesoamerican-books/kingsborough-dresden-46-48.jpg"
        alt="Three leaves of the Dresden Codex, numbered 46 to 48, in a hand-coloured plate: columns of signs and bar-and-dot numbers beside painted panels of seated and striding gods"
        credit={<>Kingsborough, <a href={`${IA}AntiquitiesMexiv3King/page/n200/mode/1up`}><em>Antiquities of Mexico</em>, vol. III</a> (London, 1831). Internet Archive copy, marked public domain by the holding library.</>}
      >
        Leaves 46 to 48 of the Dresden Codex as Kingsborough&rsquo;s readers saw them. These are among the pages Förstemann would read as a table of Venus.
      </PageFigure>

      <Para>
        He paid for it because he thought the Americans were Israelites, and he read the book accordingly: it was <Leaf book={KINGSBOROUGH_8} page={112}>&ldquo;a legendary history of the flight of the children of Israel from Egypt, since we there behold a nation with Jewish features proceeding on a migration with their knapsacks literally harnessed to their backs&rdquo;</Leaf>. In Philadelphia the naturalist Constantine Rafinesque was scathing: he had <Leaf book={RAFINESQUE} page={107}>&ldquo;vainly spent the vast sum of 30,000 pounds sterling, or $135,000!!!&rdquo;</Leaf>.
      </Para>
      <Para>
        Rafinesque was an unlikely man to correct him. Most of what he says about Palenque in his <em>Atlantic Journal</em> is wild: he derives its signs from a Libyan alphabet and reads groups as <Leaf book={RAFINESQUE} page={51}>UOBAC, ICBE, BOCOGO</Leaf>. In the same column he makes three claims about Humboldt&rsquo;s plate.
      </Para>

      <SourceQuote
        book={RAFINESQUE} page={51} printedPage={43} src={`${A}${RAFINESQUE}/51.jpg`}
        source={<>C. S. Rafinesque, <em>Atlantic Journal</em> (Philadelphia, 1832)</>}
      >
        A specimen of it has been given by Humboldt in his American Researches, plate 45, from the Dresden Library, and has been ascertained to be Guatimalan instead of Mexican, being totally unlike the Mexican pictorial manuscripts. This page of Demotic has letters and numbers, these represented by strokes meaning 5 and dots meaning unities, as the dots never exceed 4.
      </SourceQuote>

      <Para>
        &ldquo;Has been ascertained&rdquo; names nobody, but this is the earliest place we have found that takes the Dresden book away from Mexico and reads the bars and dots as fives and ones. On the next page he adds that it <Leaf book={RAFINESQUE} page={52}>&ldquo;might not be impossible to decypher&rdquo;</Leaf> such manuscripts, because they are written in languages yet spoken.
      </Para>
      <Para>
        The comparison readers remembered was printed nine years later. John Lloyd Stephens, back from Copán and Palenque with Frederick Catherwood&rsquo;s drawings, put a carved altar top and Humboldt&rsquo;s manuscript on one page, and still called the manuscripts Mexican as he joined them to the ruins.
      </Para>

      <SourceQuote
        book={STEPHENS} page={539} printedPage="453-454" src={`${A}${STEPHENS}/539.jpg`}
        source={<>John Lloyd Stephens, <em>Incidents of Travel in Central America, Chiapas, and Yucatan</em>, vol. II (New York, 1841)</>}
        pageAlt="A page with Catherwood's engraving of carved glyph blocks from the altar at Copán above a smaller block of signs from the Dresden manuscript"
      >
        These have been published in Humboldt&rsquo;s work and in that of Lord Kingsborough, and, on a careful examination, we are strongly of the opinion that the characters are the same with those found on the monuments and tablets at Copan and Palenque.
      </SourceQuote>

      <H2>Landa&rsquo;s alphabet</H2>
      <Para>
        In 1864 the Abbé Brasseur de Bourbourg printed the Madrid manuscript, and with it the page that seemed to end the matter. Having told of the burning, the text goes straight on: &ldquo;De sus letras porne aqui un A, b, c&rdquo;, of their letters I will set down here an A, B, C.
      </Para>

      <SourceQuote
        book={LANDA_MS} page={99} src={`${P}${LANDA_MS}/pages/0098.jpg`}
        source={<>Relación de las cosas de Yucatán, fol. 45, frame 99. {RAH}</>}
        original="Ma in kati quiere dezir no quiero, ellos lo escriven a partes desta manera."
        pageAlt="A manuscript page with Maya signs drawn in rows, each with a small Latin letter above it, under the heading Siguese su a, b, c"
      >
        Ma in kati means I do not want to; they write it in parts, in this way.
      </SourceQuote>

      <Para>
        Sylvanus Morley, looking back in 1915, says it was <Leaf book={MORLEY} page={53}>&ldquo;at once heralded by Americanists as the long-awaited key&rdquo;</Leaf>. Nobody could make it work. Brasseur and Léon de Rosny <Leaf book={BRINTON} page={18}>extended it</Leaf>, Rosny to twenty-nine signs, and Eduard Seler later charged that one sign Cyrus Thomas relied on was <Leaf book={SELER} page={2}>&ldquo;Brasseur de Bourbourg&rsquo;s fabrication, since it is not seen in Landa&rsquo;s text&rdquo;</Leaf>.
      </Para>
      <Para>
        Brasseur&rsquo;s text differs from the manuscript at one point that touches this question. Where the manuscript says the priests taught <Leaf book={LANDA_MS} page={19}>&ldquo;leer, y escrivir con sus letras, y carateres&rdquo;</Leaf>, to read and write with their letters and characters, the 1864 printing has <Leaf book={LANDA_1864} page={167}>&ldquo;con sus libros y caracteres&rdquo;</Leaf>, with their books and characters, and in 1882 English readers got <Leaf book={THOMAS_1882} page={33}>&ldquo;reading and writing their books with characters&rdquo;</Leaf>. Across about 26,000 words of the manuscript we compared by machine, roughly 93 words in 100 match the printing once spelling is levelled. The rest are scattered, mostly pronouns and expanded abbreviations, and on books and burning this is the only change of sense. Whether it is Brasseur&rsquo;s, a transcriber&rsquo;s or another copy&rsquo;s cannot be told from these two texts.
      </Para>

      <H2>Objects and nothing else</H2>
      <Para>
        The strongest attack came in 1880. Philipp Valentini gave the Antiquarian Society in Worcester a paper called <Leaf book={VALENTINI} page={563}>&ldquo;The Landa Alphabet; a Spanish Fabrication&rdquo;</Leaf>.
      </Para>

      <SourceQuote
        book={VALENTINI} page={564} printedPage={60} src={`${A}${VALENTINI}/564.jpg`}
        source={<>Philipp J. J. Valentini, in <em>Proceedings of the American Antiquarian Society</em> (Worcester, 1880)</>}
      >
        My study of the writers on the Spanish Conquest gave me the firmest conviction that the Central-American hieroglyphics stood for objects and nothing else.
      </SourceQuote>

      <Para>
        His case was that a Maya informant, asked for a Spanish letter, simply drew an object whose name began with that sound. He rested it on the old sources, and one of his footnotes shows what those sources could be made to do. He quotes Martyr&rsquo;s passage on the characters and, at the word <em>maiorum</em>, adds <Leaf book={VALENTINI} page={565}>&ldquo;(of the Maya people)&rdquo;</Leaf>. In Martyr&rsquo;s Latin <em>maiorum cuiusque regis</em> are the ancestors of each king. The Maya are not named there.
      </Para>
      <Para>
        Cyrus Thomas took the other side and went further. By 1893 he could list the camps: Förstemann, Schellhas, Seler and Valentini for ideographic signs, Charencey, Rosny and himself for phonetic ones. He promised that <Leaf book={THOMAS_1893} page={2}>&ldquo;the question of phoneticism is settled&rdquo;</Leaf> if his readings were accepted, even in part.
      </Para>

      <H2>The librarian who counted</H2>
      <Para>
        While this went on, the real progress was being made without reading a word. Ernst Förstemann, head librarian at Dresden, had the book in his care. He complained that in Kingsborough it was <Leaf book={FORSTEMANN} page={14}>&ldquo;so gut wie unzugänglich&rdquo;</Leaf>, as good as inaccessible, and in 1880 published it himself in 74 chromolithograph plates. Then he began with the part he could be sure of.
      </Para>

      <PageFigure
        src={`${A}${FORSTEMANN}/16.jpg`}
        alt="A printed German page with four signs from Landa's alphabet labelled b, h, o and ma, above a table of the numbers 1 to 19 in dots and bars"
        href={`/book/${FORSTEMANN}?page=16`}
        source={<>Ernst Förstemann, <em>Erläuterungen zur Mayahandschrift</em> (Dresden, 1886), p. 3</>}
      >
        One page holds both halves of the problem. Above, four of Landa&rsquo;s signs that do appear in the manuscript, which &ldquo;kein Zufall sein kann&rdquo;, cannot be chance. Below, the numbers, which he calls the clearest and least disputed signs of all.
      </PageFigure>

      <Para>
        He worked out the sign for twenty and the sign for zero, and the place values of the counts, in which the third place is eighteen times the second. Working through the columns of leaves 46 to 50 he found the same intervals returning, and with some hesitation, &ldquo;wenn auch etwas zagend&rdquo;, gave them a meaning.
      </Para>

      <SourceQuote
        book={FORSTEMANN} page={79} printedPage={66} src={`${A}${FORSTEMANN}/79.jpg`}
        source={<>Ernst Förstemann, <em>Erläuterungen zur Mayahandschrift</em> (Dresden, 1886)</>}
        original="Meine Hypothese ist folgende: Blatt 46 bis 50 behandeln den grade 584 Tage (genau 583 Tage 22 Stunden) dauernden scheinbaren Umlauf der Venus"
      >
        My hypothesis is this: leaves 46 to 50 treat the apparent revolution of Venus, lasting just 584 days (more exactly 583 days 22 hours).
      </SourceQuote>

      <Para>
        Kingsborough had looked at the same leaves and seen Israelites with knapsacks. Förstemann took the numbers on them and found a planet. How the Maya counted is the subject of <Link href="/articles/maya-mathematics">How the Maya Counted</Link>. Paul Schellhas did for the gods what Förstemann did for the numbers, sorting the figures by looking, and keeping letters for them because the Spanish accounts <Leaf book={SCHELLHAS} page={20}>&ldquo;correspond only slightly or not at all with these figures of gods&rdquo;</Leaf>. Bowditch, who refused to assign credit for individual discoveries, made one exception: <Leaf book={BOWDITCH} page={9}>Förstemann was &ldquo;the leader who blazed out the path&rdquo;</Leaf>.
      </Para>
      <Para>
        Success with numbers strengthened the view that the rest was ideas without sounds. Förstemann thought the writing essentially ideographic and Landa&rsquo;s alphabet useless for his manuscript. Bowditch wrote that <Leaf book={BOWDITCH} page={278}>&ldquo;the idea of a phonetic alphabet must be abandoned&rdquo;</Leaf>. By 1915 Morley could report <Leaf book={MORLEY} page={53}>&ldquo;the general acceptance of the second theory, that the signs are ideographic&rdquo;</Leaf>, with phonetic use admitted only as occasional rebus.
      </Para>

      <H2>The answer, written down early</H2>
      <Para>
        The right idea had already been stated, and had gone nowhere. David Stuart, the Maya epigrapher, drew attention in 2013 to <a href="https://mayadecipherment.com/2013/05/01/archives-daniel-brintons-letter-on-landas-alphabet/">a letter of 1879</a> from Brinton to Charles Rau, printed in Rau&rsquo;s book on the Palenque tablet. Nine years earlier <a href={`${IA}palenquetabletin00rauc/page/52/mode/1up`}>Brinton had been sure</a> the inscriptions would soon be easier to read than the cuneiform of Nineveh. Now he wrote this.
      </Para>
      <OutsideQuote cite={<>Brinton to Rau, 4 March 1879, in Charles Rau, <a href={`${IA}palenquetabletin00rauc/page/53/mode/1up`}><em>The Palenque Tablet in the United States National Museum</em></a> (Washington, 1879), pp. 52-53</>}>
        It appears more likely that the figures he gives represent compound sounds, syllabic or partly so, and that they are but fragments of a large repertory of phonetic signs, never reduced to the elements of sound, used by the Mayas of that age.
      </OutsideQuote>
      <Para>
        &ldquo;Here Brinton nails it,&rdquo; Stuart writes, and he wonders why Brinton did not go on to specific readings, suggesting that Valentini&rsquo;s attack a year later may have discouraged him. The library holds a page that bears on this. Two years after Valentini, in his introduction to Thomas&rsquo;s <em>Study of the Manuscript Troano</em>, Brinton answered him directly. Valentini is &ldquo;not wrong in a number of his identifications,&rdquo; he says, but they point the other way.
      </Para>

      <SourceQuote
        book={THOMAS_1882} page={33} printedPage="xxvi" src={`${A}${THOMAS_1882}/33.jpg`}
        source={<>Daniel G. Brinton, introduction to Cyrus Thomas, <em>A Study of the Manuscript Troano</em> (Washington, 1882)</>}
      >
        Instead of proving that this is picture-writing, it indicates that the Mayas used the second or higher grade of phonetic syllabic writing&hellip; Therefore the importance and authenticity of Landa&rsquo;s alphabet are, I think, vindicated by this attempt to treat it as a &ldquo;fabrication.&rdquo;
      </SourceQuote>

      <Para>
        Stuart&rsquo;s point stands: Brinton proposed no readings on that basis. By his <em>Primer</em> of 1895 he had settled for less, saying only that the alphabet was <Leaf book={BRINTON} page={18}>&ldquo;proof that some sort of phonetic writing was not unknown&rdquo;</Leaf>. In 1899 <a href={`${IA}glimpseatguatema00maud/page/255/mode/1up`}><em>A Glimpse at Guatemala</em></a>, by Alfred and Anne Maudslay, remarked in passing that whatever phonetic value the glyphs had &ldquo;was probably of a syllabic and not of an alphabetic character&rdquo;. <a href="https://mayadecipherment.com/2007/12/18/alfred-maudslays-insight/">Stuart calls it a lost insight</a>, because nobody followed it up.
      </Para>
      <Para>
        Stuart credits the breakthrough to Yuri Knorosov, who in 1952, in a Moscow journal, took the opposite line from Valentini and Morley. He defended the page itself.
      </Para>
      <OutsideQuote cite={<>Yuri Knorosov, &ldquo;Drevnyaya pis&rsquo;mennost&rsquo; Tsentral&rsquo;noi Ameriki&rdquo;, <a href="https://eo.iea.ras.ru/wp-content/uploads/1952/03/eoarchive_1952_3_100_Knorozov.pdf"><em>Sovetskaya Etnografiya</em> 1952, no. 3</a>, p. 110; our translation</>}>
        <p className="italic mb-3">Знаки, приведенные Д. де Ланда, несмотря на столетние нападки на него, действительно имеют то самое звуковое значение, которое он им приписал.</p>
        The signs given by D. de Landa, despite a century of attacks on him, really do have the very sound value he assigned them.
      </OutsideQuote>
      <Para>
        Landa&rsquo;s own examples, Knorosov notes on the same page, show one sign serving as both syllable and letter. His conclusion was that the &ldquo;alphabet&rdquo; is a primary source, a set of syllable signs that a Spanish friar had arranged as if they were letters. Read that way, the Madrid page explains itself, and it had been saying so all along. It reports that the Spaniards told the scribes <em>le</em> was two letters, and that the scribes wrote it with three, <Leaf book={LANDA_MS} page={99}>&ldquo;poniendo a la aspiracion de la ele, la vocal e, que antes de si trae&rdquo;</Leaf>, giving the letter <em>ele</em> the vowel <em>e</em> that it carries in front of it. The labels above the signs read e, l, é, le. The scribe was writing the sounds of what he heard. In the row headed &ldquo;Siguese su a, b, c&rdquo;, third in the second line, is the sign labelled <em>e</em>, and sixth is the comb labelled <em>ca</em>.
      </Para>

      <SyllabarySigns />

      <Para>
        The carved signs for those syllables are recognisably the same. The comb form of <em>ka</em> has a history of its own: Stuart <a href="https://mayadecipherment.com/2024/09/02/day-sign-notes-manik/">argued in 2024</a> that it began as a fish fin, an origin even Classic scribes had lost. The same manuscript page ends with the sentence that explains how the knowledge was lost: &ldquo;ya no usan para nada destos sus carateres especialmente la gente moça que an aprendido los nuestros&rdquo;, they no longer use these characters of theirs for anything, especially the young people who have learned ours.
      </Para>

      <H2>What is still not known</H2>
      <ul className="list-disc pl-6 mb-6 text-secondary font-body leading-relaxed space-y-2">
        <li>What the two books on the list of 1519 were, and whether Vienna and Nuttall are they.</li>
        <li>Whether any Maya book was in that shipment, and how Martyr came to see &ldquo;many&rdquo;.</li>
        <li>How the Dresden book reached Vienna.</li>
        <li>What the two Vatican books of 1589 and Oviedo&rsquo;s gift to Ramusio were, and what happened to the books in Ursúa&rsquo;s hands in 1697.</li>
        <li>How many books were burned. The only count, twenty-seven rolls, goes back no further than a list of the early nineteenth century.</li>
        <li>Whether the book the Popol Vuh says can no longer be seen was ever a single book.</li>
      </ul>

      <p className="text-sm text-secondary mt-10 font-sans leading-relaxed">
        <strong>A note on the sources.</strong> Every quotation from a book in the library was checked against its page image. Translations from Latin, Spanish, Italian, French and German are ours; long s is modernised and contractions are expanded. The Popol Vuh is quoted from Ximénez&rsquo;s Spanish, and the K&rsquo;iche&rsquo; words are given as they stand on the leaf. Several of these pages are still uncorrected machine readings: the stored English of Martyr fol. 73 misreads <em>multos</em> as &ldquo;many others&rdquo;, and the stored English of the <em>Cantares</em> is too weak to quote, so we give only single words from that leaf and a reader of Nahuatl should check them. <strong>From outside the library:</strong> Martyr&rsquo;s remark on Ribera is read in the Alcalá edition of 1530 (our 1533 volume stops at the third Decade), with the English printed by Kingsborough. Knorosov is read in the scan published by the Institute of Ethnology and Anthropology, Moscow. Humboldt&rsquo;s text volume, Rau, the Maudslays, the <em>Colección</em> (vol. I, p. 469; Nuttall cites p. 464) and Kingsborough vols. III and VI are read in Internet Archive copies. We have not found where the original inventory of 1519 is kept. Restall and Chuchiak, <em>Ethnohistory</em> 49 (2002), 651-669, are cited from the abstract, for the authorship dispute only. We could not open the Academy&rsquo;s own catalogue record of the Madrid manuscript, so its dating is given as a range. The classing of Vienna and Nuttall as Mixtec is the modern consensus. <strong>Reach of the searches:</strong> Gómara&rsquo;s gift lists in his <em>Conquista</em> name no books; Herrera and Torquemada, which have no transcription in the library yet, were not read for this article. The John Carter Brown search covered about 340 books before 1600 through their Archive text, which misses plates and badly read pages. The Chilam Balam books of Chumayel, Tizimín, Calkiní, Kaua, Nah and Ixil and the Ritual of the Bacabs were searched for statements about books lost, burned or copied, by keyword over their transcriptions, without result.
      </p>
    </ContentPageLayout>
  );
}
