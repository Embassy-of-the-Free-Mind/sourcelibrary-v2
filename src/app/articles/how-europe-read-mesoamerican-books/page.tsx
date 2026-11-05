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
    'From two books on a list of 1519 to the syllables of 1952: Peter Martyr, Landa, Horn, Humboldt, Rafinesque, Stephens, Valentini and Brinton on Mesoamerican writing.',
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
const ACOSTA = '695910f2ecb01322b3068302';
const VILLAGUTIERRE = '6a9f3f9783c3b522416e4054';
const MERCATI = '6ac4f9964ba7223afef6945d';
const HORN = '6a42b8f85207af7c42f66a51';
const LOMEIER = '69b6b5a696dc15d4a16e8df0';
const GOETZE = '6aeaf0d157b73e60374be3d0';
const ROBERTSON = '6a4a34b3b49cf960c37df713';
const HUMBOLDT_PLATES = '6aeb00fe19312ecd297aa315';
const RAFINESQUE = '6aeae63136e02f68d854190d';
const STEPHENS = '6a98bc55ec48f9ad103e477d';
const ROSNY = '6acc3e2c230e9a56175cdfaf';
const VALENTINI = '6abfbf233c453a90d6662f6e';
const THOMAS_1882 = '6abfbf293c453a90d6663269';
const THOMAS_1893 = '6abfbf363c453a90d6663420';
const BRINTON = '6abfbf383c453a90d6663443';
const MORLEY = '6abfbf433c453a90d66639d1';

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
        <a href="https://mayadecipherment.com/2013/09/18/maya-hieroglyphic-syllabary/">Maya Hieroglyph Syllabary</a> (2013). These are Classic carved forms, some centuries older than the
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
          subtitle="From two books on a list of 1519 to the syllables of 1952: who saw one, who copied whom, and where the evidence stops"
          image={HEADER_IMAGE}
          imageAlt="Five leaves of the Dresden Codex in the coloured engraving from Humboldt's Vues des cordillères, with columns of signs, bars and dots and painted panels of gods"
        >
          <p className="text-stone-400 text-sm mt-4">5 November 2026 &middot; 15 min read</p>
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
        That is all the list says. It gives no maker, no place and no description. The list is <Leaf book={CORTES} page={90}>dated 6 July 1519</Leaf>, and the same page says the king received the things at Valladolid in Holy Week 1520. We have read it only in this printing of 1866.
      </Para>
      <Para>
        For the next four centuries Europeans argued about what such books were: writing, pictures, magic, or something between. Very few of them ever handled one. This article follows that argument through the pages the library holds, and says at each step who saw a book and who was repeating someone else.
      </Para>

      <H2>The man who described them</H2>
      <Para>
        Peter Martyr of Anghiera, an Italian humanist at the Spanish court, wrote up the same gifts. He saw at least the messengers who came with them, since he remarks that he never saw anything uglier than their pierced lips. He begins his account of the gifts with the books.
      </Para>

      <SourceQuote
        book={MARTYR} page={175} src={`${A}${MARTYR}/175.jpg`}
        source={<>Peter Martyr, <em>De insulis nuper inventis</em>, in <em>De orbe novo</em> (Basel, 1533), fol. 73</>}
        original="Diximus libros habere gentes has: libros attulerunt una cum ceteris muneribus, hi Colluacanae noui coloni, procuratores, nuncii, multos."
      >
        We have said that these peoples have books. These new settlers of Colhuacan, the agents and messengers, brought many books along with the other gifts.
      </SourceQuote>

      <Para>
        <em>Multos</em>: many, where the list says two. Martyr does not explain the difference, and we cannot. He may have counted loosely, or seen books from more than one shipment. A little earlier he says of the houses on Cozumel, off Yucatan, <Leaf book={MARTYR} page={171}>&ldquo;Habent etiam innumeros libros&rdquo;</Leaf>, they also have innumerable books, and that word will come back.
      </Para>
      <Para>
        He then gives the first European description of a Mesoamerican book that we have found. The leaves are the thin inner bark of trees, joined with a tough glue and coated with something like gypsum. The book is not cut into leaves but drawn out in a strip several cubits long and folded, with two written faces showing wherever it is opened, and when closed it looks like one of ours. Then the signs.
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
        Martyr also records the first doubt. As Philipp Valentini quoted him in 1880, from the old English version in Hakluyt, one of Cortés&rsquo;s messengers said these were not for reading at all but patterns for craftsmen. Martyr answered: <Leaf book={VALENTINI} page={565}>&ldquo;I suppose them to be books,&rdquo;</Leaf> since he had seen the like on the obelisks and pillars at Rome. We have not traced that passage in the Latin. The comparison with Egypt starts here and lasts until the nineteenth century.
      </Para>

      <H2>Whether the two books survive</H2>
      <Para>
        In 1902 Zelia Nuttall published a facsimile of a Mixtec screenfold from Florence and made the boldest claim anyone has made about the line in the list. She argued that this book and its sister in Vienna <Leaf book={NUTTALL} page={21}>are the two</Leaf>. Her chain has several links. The year 1 Reed, which she equates with 1519, is the most prominent date in both. An inscription on the Vienna book names King Manuel of Portugal and Clement VII. Charles V is known to have given away some of the rarities he received.
      </Para>
      <SourceQuote
        book={NUTTALL} page={21} printedPage={11} src={`${A}${NUTTALL}/21.jpg`}
        source={<>Zelia Nuttall, <em>Codex Nuttall</em> (Cambridge, Mass., 1902)</>}
      >
        Historical evidence points to the conclusion that they are identical with the &ldquo;two native books&rdquo; recorded in the inventory of 1519.
      </SourceQuote>
      <Para>
        This is an argument, and no record connects them. The inscription had already troubled readers: Johann Christian Götze <Leaf book={GOETZE} page={20}>pointed out in the 1740s</Leaf> that Manuel died before Clement was elected, and that Lambeck&rsquo;s repair to Leo X and 1513 cannot stand either, since no Mexican book was known in Europe before 1519. Nuttall also dates the shipment to 10 July, where the printed list has 6 July.
      </Para>

      <H2>Burned, and regretted in print</H2>
      <Para>
        The most quoted sentence about Maya books is about their end. It survives in a manuscript in Madrid, an anonymous copy of the account attributed to Diego de Landa. The Academy dates the copy after 1567 and probably before 1600, some scholars date it later, and how much of the text is Landa&rsquo;s own is disputed (Restall and Chuchiak). The copyist first wrote that the books held nothing without superstition and <em>engaño</em>, deceit, then struck the word and went on.
      </Para>

      <SourceQuote
        book={LANDA_MS} page={98} src={`${P}${LANDA_MS}/pages/0097.jpg`}
        source={<>Relación de las cosas de Yucatán, frame 98. {RAH}</>}
        original="Hallamos les grande numero de libros destas sus letras, y porque no tenian cosa, en que no uviesse supersticion y falsedades del demonio se los quemamos todos, lo qual a maravilla sentian, y les dava pena."
      >
        We found a great number of books in these letters of theirs, and because they held nothing without superstition and falsehoods of the devil we burned them all, which they felt wonderfully and which gave them grief.
      </SourceQuote>

      <Para>
        No source we have read gives a number. &ldquo;A great number&rdquo; is what there is, and any figure beyond it needs its own witness. The Franciscan Bernardo de Lizana, defending Landa as a saintly man, admits what went with the idols: <Leaf book={LIZANA} page={163}>&ldquo;a las bueltas se quemaron muchos libros historiales&rdquo;</Leaf>, many historical books were burned along with them, which would have been a great pleasure to have, he adds, if copied into our letters. He justifies it from the converts in Acts who burned their books.
      </Para>
      <Para>
        The first printed complaint we have found is by the Jesuit José de Acosta, who never names the friar.
      </Para>

      <SourceQuote
        book={ACOSTA} page={415} printedPage={407} src={`${A}${ACOSTA}/415.jpg`}
        source={<>José de Acosta, <em>Historia natural y moral de las Indias</em> (Seville, 1590), book VI, ch. 7</>}
        original="Pareciole a vn Doctrinero, que todo aquello deuia de ser hechizos, y arte Magica, y porfiò, que se auian de quemar, y quemaronse aquellos libros, lo qual sintieron despues no solo los Indios sino Españoles curiosos, que desseauan saber secretos de aquella tierra."
      >
        It seemed to a parish friar that all of it must be spells and magic art, and he insisted they be burned, and those books were burned, which was regretted afterwards not only by the Indians but by curious Spaniards who wanted to know the secrets of that land.
      </SourceQuote>

      <Para>
        Not every book went then. In 1697 the Spanish took the Itza island in Lake Petén, and Juan de Villagutierre&rsquo;s history of 1701 reports that books of tree bark with their prophecies <Leaf book={VILLAGUTIERRE} page={728}>&ldquo;tenia en su poder el General Ursua&rdquo;</Leaf>, were in General Ursúa&rsquo;s own hands, found when he took the island. He does not say what became of them, and the trail stops there. The burnings and the other colonial sources on Maya religion are the subject of <Link href="/articles/maya-ritual-in-the-colonial-dictionaries">Maya Religion in the Colonial Sources</Link>.
      </Para>

      <H2>Two become many, without a new witness</H2>
      <Para>
        What Europe knew in the next century it mostly knew from these few pages. In 1589 Michele Mercati, writing on the obelisks of Rome, placed Mexican writing beside the Egyptian and pointed to something a reader could go and see.
      </Para>

      <SourceQuote
        book={MERCATI} page={122} printedPage="96-97" src="https://www.e-rara.ch/i3f/v21/31875/full/full/0/default.jpg"
        source={<>Michele Mercati, <em>De gli obelischi di Roma</em> (Rome, 1589)</>}
        original="come si può vedere in due libri della libraria Vaticana, ritratti da gli essemplari istessi, venuti dal Mexico."
      >
        as can be seen in two books of the Vatican Library, drawn from the very exemplars that came from Mexico.
      </SourceQuote>

      <Para>
        <em>Ritratti</em> suggests copies. Mercati never says who brought them or when, and he does not link them to 1519. He thinks the system crude: it was <Leaf book={MERCATI} page={123}>&ldquo;molto imperfetta&rdquo;</Leaf>, and such peoples could not by natural instinct reach &ldquo;la diuina inuentione delle lettere nostre&rdquo;, the divine invention of our letters.
      </Para>
      <Para>
        Georg Horn&rsquo;s <em>De originibus Americanis</em> of 1669 shows how the evidence travelled. He wants Mexican writing to descend from Chinese, and he lists bound books of bark found <Leaf book={HORN} page={516}>in Cozumel, Yucatan, Mexico, Nicaragua and Guatemala</Leaf>, &ldquo;innumeri libri&rdquo;. His authorities are Martyr, Gómara, Acosta and Herrera. Three pages later he retells the burning from Acosta and lifts Martyr&rsquo;s description almost word for word.
      </Para>

      <SourceQuote
        book={HORN} page={520} printedPage={490} src={`${A}${HORN}/520.jpg`}
        source={<>Georg Horn, <em>De originibus Americanis</em> (1669), book IV, ch. 14</>}
        original="Unde irreparabili damno combusti fuerunt. Et Martyr dicit Coluacanorum literas Aegyptiacis similes fuisse, & taxillis, hamis, laqueis, limis, stellis ac ejusmodi formis constitisse"
      >
        Whence they were burned, an irreparable loss. And Martyr says that the letters of the Colhuacans were like the Egyptian, and consisted of little dice, hooks, snares, files, stars and forms of that kind.
      </SourceQuote>

      <Para>
        Eleven years later Johannes Lomeier, in a history of libraries, has the same five places and the same countless books, <Leaf book={LOMEIER} page={372}>&ldquo;ut variis testibus probat Hornius&rdquo;</Leaf>, as Horn proves from various witnesses, and then Martyr&rsquo;s description again. By then a reader meets &ldquo;innumerable books&rdquo; in three authors, and in the chain we have read only the first of them, Martyr, was at court when any arrived. We have not yet checked Gómara and Herrera for what they add.
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
        &ldquo;Without doubt&rdquo; is Götze&rsquo;s guess, with no name attached. There is no record of the Dresden book before that purchase, and any link to Cortés is speculation. Götze never connects it with Yucatan.
      </Para>
      <Para>
        William Robertson&rsquo;s <em>History of America</em> of 1777 gave English readers the settled view. Having had paintings copied for him at Vienna, he wrote that the Mexicans <Leaf book={ROBERTSON} page={291}>&ldquo;were not acquainted, it is true, with any other method of recording transactions, than that of delineating the objects which they wished to represent&rdquo;</Leaf>. He calls it picture-writing and blames <Leaf book={ROBERTSON} page={275}>the &ldquo;fanatical zeal of the monks&rdquo;</Leaf> for the loss.
      </Para>

      <PageFigure
        src={`${P}${HUMBOLDT_PLATES}/pages/0095.jpg`}
        alt="A folio plate printed sideways: five leaves of the Dresden Codex in colour, with columns of signs, bars and dots and painted panels, above an engraved caption"
        href={`/book/${HUMBOLDT_PLATES}?page=96`}
        source={<>Alexander von Humboldt, <em>Vues des cordillères</em>, plate 45 (Paris, 1810-13)</>}
      >
        &ldquo;Fragment d&rsquo;un manuscrit hiéroglyphique conservé à la Bibliothèque royale de Dresde.&rdquo; The caption names no people and no language.
      </PageFigure>

      <Para>
        Alexander von Humboldt saw that something was different. The Dresden manuscript was <a href="https://archive.org/details/vuesdescordille00humb/page/n293/mode/1up">entirely unknown to him</a> when his book went to press; he had a copy of five leaves through friends, and in his text he calls it &ldquo;ce manuscrit aztèque&rdquo;. Yet he notices that it resembles none of the Mexican ritual books he had just engraved. Here, he writes, <a href="https://archive.org/details/vuesdescordille00humb/page/n294/mode/1up">&ldquo;un grand nombre d&rsquo;hiéroglyphes simples se suivent sans liaison, comme dans les hiéroglyphes égyptiens et dans les clefs des Chinois&rdquo;</a>, many simple hieroglyphs follow one another unlinked, as in Egyptian hieroglyphs and Chinese radicals, some of them set in lines as in true symbolic writing. Of the dots and bars he declines to say whether they are numbers, a list of tribute perhaps, or real cursive characters: &ldquo;Nous ne déciderons pas&rdquo;.
      </Para>

      <H2>Matching the book to the stones</H2>
      <Para>
        The next step came from an unlikely man. In 1832 the Philadelphia naturalist Constantine Rafinesque printed open letters to Champollion in his own <em>Atlantic Journal</em>. Most of what he says about Palenque is wild: he derives its signs from a Libyan alphabet and reads groups as <Leaf book={RAFINESQUE} page={51}>UOBAC, ICBE, BOCOGO</Leaf>. In the same column he makes three claims about Humboldt&rsquo;s plate.
      </Para>

      <SourceQuote
        book={RAFINESQUE} page={51} printedPage={43} src={`${A}${RAFINESQUE}/51.jpg`}
        source={<>C. S. Rafinesque, <em>Atlantic Journal</em> (Philadelphia, 1832)</>}
      >
        A specimen of it has been given by Humboldt in his American Researches, plate 45, from the Dresden Library, and has been ascertained to be Guatimalan instead of Mexican, being totally unlike the Mexican pictorial manuscripts. This page of Demotic has letters and numbers, these represented by strokes meaning 5 and dots meaning unities, as the dots never exceed 4.
      </SourceQuote>

      <Para>
        &ldquo;Has been ascertained&rdquo; names nobody, but this is the first place we have found that takes the Dresden book away from Mexico and reads the bars and dots as fives and ones. On the next page he adds that it <Leaf book={RAFINESQUE} page={52}>&ldquo;might not be impossible to decypher&rdquo;</Leaf> such manuscripts, because they are written in languages yet spoken.
      </Para>
      <Para>
        The comparison that readers remembered was printed nine years later. John Lloyd Stephens, back from Copán and Palenque with Frederick Catherwood&rsquo;s drawings, put a carved altar top and Humboldt&rsquo;s manuscript on one page, and called the manuscripts Mexican even as he joined them to the Maya ruins.
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
        Sylvanus Morley, looking back in 1915, says it was <Leaf book={MORLEY} page={53}>&ldquo;at once heralded by Americanists as the long-awaited key&rdquo;</Leaf>. Nobody could make it work. Morley notes that Brasseur added signs of his own invention, and Brinton that Léon de Rosny, author of the <Leaf book={ROSNY} page={7}><em>Essai sur le déchiffrement</em></Leaf> of 1876, <Leaf book={BRINTON} page={18}>extended it to twenty-nine</Leaf>.
      </Para>
      <Para>
        Brasseur&rsquo;s text also differs from the manuscript at points that touch this question. Where the manuscript says the priests taught <Leaf book={LANDA_MS} page={19}>&ldquo;leer, y escrivir con sus letras, y carateres&rdquo;</Leaf>, to read and write with their letters and characters, the 1864 printing has <Leaf book={LANDA_1864} page={167}>&ldquo;con sus libros y carateres&rdquo;</Leaf>, with their books and characters, and in 1882 English readers got <Leaf book={THOMAS_1882} page={33}>&ldquo;reading and writing their books with characters&rdquo;</Leaf>. One word is not a pattern, and we do not yet know how far the two differ overall.
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

      <H2>The answer, written down early</H2>
      <Para>
        The right idea had already been stated, and had gone nowhere. David Stuart, the Maya epigrapher, drew attention in 2013 to a <a href="https://mayadecipherment.com/2013/05/01/archives-daniel-brintons-letter-on-landas-alphabet/">letter of 1879</a> from Daniel Garrison Brinton to Charles Rau, printed in Rau&rsquo;s book on the Palenque tablet, which the library does not hold.
      </Para>
      <blockquote className="border-l-2 border-stone-300 pl-5 my-8 text-secondary font-body leading-relaxed">
        It appears more likely that the figures he gives represent compound sounds, syllabic or partly so, and that they are but fragments of a large repertory of phonetic signs, never reduced to the elements of sound, used by the Mayas of that age.
        <footer className="text-sm mt-2 font-sans">Brinton to Rau, 4 March 1879, in Rau, <em>The Palenque Tablet</em> (1879), pp. 52-53, as quoted by Stuart</footer>
      </blockquote>
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
        Stuart&rsquo;s point stands: Brinton proposed no readings on that basis. By his <em>Primer</em> of 1895 he had settled for less, saying only that the alphabet was <Leaf book={BRINTON} page={18}>&ldquo;proof that some sort of phonetic writing was not unknown&rdquo;</Leaf>. In 1899 Alfred Maudslay remarked in passing, in another passage <a href="https://mayadecipherment.com/2007/12/18/alfred-maudslays-insight/">Stuart has brought back to notice</a>, that whatever phonetic value the glyphs had &ldquo;was probably of a syllabic and not of an alphabetic character&rdquo;. Stuart calls it a lost insight, because nobody followed it up.
      </Para>
      <Para>
        By 1915 Morley could report <Leaf book={MORLEY} page={53}>&ldquo;the general acceptance of the second theory, that the signs are ideographic&rdquo;</Leaf>, with phonetic use admitted only as occasional rebus. Attempts at an alphabet, he says, &ldquo;have completely broken down&rdquo;.
      </Para>
      <Para>
        Stuart credits the breakthrough to Yuri Knorosov, who in 1952 published the observation that Maya writing was in part phonetic, with syllabic signs that spelled words, and that Landa&rsquo;s &ldquo;alphabet&rdquo; was a misrepresentation of a syllabary. Read that way, the Madrid page makes sense. The text says that the Spaniards told the scribes <em>le</em> was two letters, and that they wrote it with three, putting before the <em>ele</em> its vowel <em>e</em>; the labels above the signs read e, l, é, le. The usual explanation is that the scribe wrote the sounds he heard when a Spaniard said the names of the letters aloud. In the row headed &ldquo;Siguese su a, b, c&rdquo;, third in the second line, is the sign labelled <em>e</em>, and sixth is the comb labelled <em>ca</em>.
      </Para>

      <SyllabarySigns />

      <Para>
        The carved signs for those syllables are recognisably the same. The comb form of <em>ka</em> has a history of its own: Stuart <a href="https://mayadecipherment.com/2024/09/02/day-sign-notes-manik/">argued in 2024</a> that it began as a fish fin, an origin even Classic scribes had lost. The same manuscript page ends with the sentence that explains how the knowledge was lost: &ldquo;ya no usan para nada destos sus carateres especialmente la gente moça que an aprendido los nuestros&rdquo;, they no longer use these characters of theirs for anything, especially the young people who have learned ours.
      </Para>

      <H2>What is still not known</H2>
      <ul className="list-disc pl-6 mb-6 text-secondary font-body leading-relaxed space-y-2">
        <li>What the two books on the list of 1519 were, and whether Vienna and Nuttall are they. We have also read the list only in print, and the original should be examined.</li>
        <li>Whether any Maya book was in that shipment, and how Martyr came to see &ldquo;many&rdquo;.</li>
        <li>How the Dresden book reached Vienna. Nothing we have read gives its history before Götze.</li>
        <li>What the two Vatican books of 1589 were, and what happened to the books in Ursúa&rsquo;s hands in 1697.</li>
        <li>How many books were burned. No witness we have read gives a figure.</li>
        <li>How far Brasseur&rsquo;s printing departs from the Madrid manuscript overall, and which of the differences come from whom.</li>
      </ul>

      <p className="text-sm text-secondary mt-10 font-sans leading-relaxed">
        <strong>A note on the sources.</strong> Every quotation from a book in the library was checked against its page image. Translations from Latin, Spanish, Italian and German are ours; long s is modernised and contractions are expanded. Several of these pages are still uncorrected machine readings, and the stored English of Martyr fol. 73 misreads <em>multos</em> as &ldquo;many others&rdquo; where it goes with the books. Humboldt&rsquo;s text volume is quoted from the Internet Archive copy. Brinton&rsquo;s letter of 1879, Maudslay&rsquo;s remark of 1899 and the work of Knorosov are cited through Stuart&rsquo;s posts on <a href="https://mayadecipherment.com/">Maya Decipherment</a>; we have not read Rau, Maudslay&rsquo;s <em>Glimpse at Guatemala</em> or Knorosov directly. Restall and Chuchiak are cited through Stephen Houston&rsquo;s post on that blog. The Madrid dating is the Academy&rsquo;s catalogue record. The classification of Vienna and Nuttall as Mixtec is the modern consensus, which Nuttall did not know. For how the Maya wrote numbers, see <Link href="/articles/maya-mathematics">How the Maya Counted</Link>.
      </p>
    </ContentPageLayout>
  );
}
