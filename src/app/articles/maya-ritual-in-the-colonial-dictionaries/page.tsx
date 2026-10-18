import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import SourceQuote from '@/components/articles/SourceQuote';
import PageFigure from '@/components/articles/PageFigure';
import BacabYears from './BacabYears';

const HEADER_IMAGE = 'https://images.sourcelibrary.org/archived/69dfd990220eedf04e13b0cf/40.jpg';

export const metadata: Metadata = withArticleMeta('maya-ritual-in-the-colonial-dictionaries', {
  title: 'Maya Religion in the Colonial Sources - Articles - Source Library',
  description:
    'The Maya gods, the count of days, the rites and the books, from the friars who suppressed them and the Maya who kept them: Landa, Sánchez de Aguilar, the Motul dictionary, the Ritual of the Bacabs and the books of Chilam Balam.',
  openGraph: {
    title: 'Maya Religion in the Colonial Sources',
    description:
      'Gods, days, rites and books, from the friars who suppressed them and the Maya who kept them.',
    images: [{ url: HEADER_IMAGE, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: HEADER_IMAGE }],
  },
  alternates: {
    canonical: '/articles/maya-ritual-in-the-colonial-dictionaries',
  },
});

const A = 'https://images.sourcelibrary.org/archived/';
const P = 'https://images.sourcelibrary.org/pages/';

const MOTUL_1 = '6acc3d5f230e9a56175cc731';
const MOTUL_2 = '6acc3d6c230e9a56175ccae2';
const PIO_PEREZ = '6acc3dfa230e9a56175cdd32';
const SANCHEZ = '69f8c1170c0c281d4bd32721';
const KAUA = '6a878ac1d71f2514794f9e40';
const LANDA = '69f8c0f74c6a515115aedadd';
const BACABS = '6ad191a242debc96269252b6';
const LETTERS = '6ad191b742debc9626925415';
const LEGAL = '6ad191c442debc962692562c';
const SERMONES = '6acc3dd5230e9a56175cd709';

function Leaf({ book, page, children }: { book: string; page: number; children: React.ReactNode }) {
  return <Link href={`/book/${book}?page=${page}`}>{children}</Link>;
}

// `solo`: a single page on its own, kept to a reading size rather than the full column.
function Fig({ book, page, src, alt, caption, solo = false }: { book: string; page: number; src: string; alt: string; caption: React.ReactNode; solo?: boolean }) {
  const fig = (
    <PageFigure src={src} alt={alt} href={`/book/${book}?page=${page}`}>
      {caption}
    </PageFigure>
  );
  return solo ? <div className="mx-auto max-w-md">{fig}</div> : fig;
}

function FigRow({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return <div className={`grid grid-cols-1 ${cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-x-6 my-4 items-start`}>{children}</div>;
}

function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return <h2 id={id} className="text-2xl md:text-3xl text-primary mt-16 mb-6">{children}</h2>;
}

function Para({ children }: { children: React.ReactNode }) {
  return <p className="text-secondary leading-relaxed mb-6 font-body">{children}</p>;
}

export default function MayaReligionPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title="Maya Religion in the Colonial Sources"
          subtitle="Gods, days, rites and books, from the friars who suppressed them and the Maya who kept them"
          image={HEADER_IMAGE}
          imageAlt="A page of the Dresden Codex with columns of glyphs and two descending serpents"
        >
          <p className="text-stone-400 text-sm mt-4">17 October 2026 &middot; 15 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >

      <article className="prose-content max-w-none">
        <SourceQuote
          original="Hallamosles grande numero de libros destas sus letras, y porque no tenian cosa en que no uviesse supersticion y falsedades del demonio se les quemamos todos, lo qual a maravilla sentian, y les dava pena."
          book={LANDA}
          page={439}
          src={`${A}${LANDA}/439.jpg`}
          pageAlt="Page 316 of Landa's Relación: the katun idols, and the paragraph on burning the books"
          source={<>Diego de Landa, <em>Relación de las cosas de Yucatán</em>, c. 1566</>}
          printedPage="316"
        >
          We found a great number of books in these letters of theirs, and because they had nothing in which there was not superstition and the devil’s falsehoods, we burned them all, which they felt deeply and which grieved them.
        </SourceQuote>

        <Para>
          The next sentence begins: &ldquo;De sus letras porne aqui un a, b, c&rdquo;, of their letters I will set down an a, b, c. Two pages later Landa writes <em>Ma in kati</em>, &ldquo;I don&rsquo;t want to&rdquo;, in Maya signs. The man who burned the books left the key that, four centuries later, let them be read again.
        </Para>

        <Fig solo book={LANDA} page={441} src={`${A}${LANDA}/441.jpg`} alt="Page 318 of Landa's Relación, with Maya signs set into the Spanish text, ending with ma in kati" caption={<>Two pages later: <em>Ma in kati</em>, &ldquo;no quiero&rdquo;, written in Maya signs in the Spanish text.</>} />

        <Para>
          Much of what is known of Maya religion at the conquest comes this way, from the people who set out to end it. Landa, the dean of Mérida Pedro Sánchez de Aguilar, and the friars who compiled the great Yucatec dictionaries had to name what they were suppressing. Beside them sit books the Maya wrote for themselves: the <em>Ritual of the Bacabs</em>, the books of Chilam Balam, wills, land titles, and the letters of the Caste War.
        </Para>

        <FigRow cols={3}>
          <Fig book="69dfd990220eedf04e13b0cf" page={40} src={`${A}69dfd990220eedf04e13b0cf/40.jpg`} alt="A page of the Dresden Codex with glyph columns and two descending serpents" caption={<>The Dresden Codex. Four painted Maya books survive.</>} />
          <Fig book="69dfdec78e5ccd1c891f0cd4" page={10} src={`${A}69dfdec78e5ccd1c891f0cd4/10.jpg`} alt="An opening of the Paris Codex, worn at the edges, with traces of painted figures and columns of glyphs" caption={<>The Paris Codex.</>} />
          <Fig book={BACABS} page={11} src={`${P}${BACABS}/0011.jpg`} alt="A ragged leaf of the Ritual of the Bacabs manuscript in Maya" caption={<>The <em>Ritual of the Bacabs</em>, eighteenth-century Yucatec incantations.</>} />
        </FigRow>

        <H2>The gods</H2>

        <SourceQuote
          original="Entre la muchedumbre de dioses que esta gente adorava, adoravan quatro llamados Bacab cada uno dellos. Estos dezian eran quatro hermanos a los quales puso Dios quando crio el mundo a las quatro partes del, sustentando el cielo no se cayesse. Dezian tambien destos Bacabes que escaparon quando el mundo fue del diluvio destruido."
          book={LANDA}
          page={329}
          src={`${A}${LANDA}/329.jpg`}
          pageAlt="Page 206 of Landa's Relación, with the four year-bearer signs Kan, Muluc, Ix and Cauac above the passage on the Bacabs"
          source="Landa"
          printedPage="206"
        >
          Among the multitude of gods this people worshipped, they worshipped four, each called Bacab. These, they said, were four brothers whom God placed at the four parts of the world when he made it, holding up the sky so that it should not fall. They also said that these Bacabs escaped when the world was destroyed by the flood.
        </SourceQuote>

        <Para>
          Each Bacab was tied to a direction, a colour and one of the four days that could begin a year, Kan, Muluc, Ix and Cauac. In the <em>Ritual of the Bacabs</em> the same fourfold order runs through the gods themselves: the incantations call on a red, a white, a black and a yellow Ix Chel, and a white and a black Itzamna, and the curer brings to birth a rattlesnake in each of the four colours (<Leaf book={BACABS} page={124}>pp. 124</Leaf>, <Leaf book={BACABS} page={142}>142</Leaf>, <Leaf book={BACABS} page={220}>220</Leaf>).
        </Para>

        <BacabYears />

        <Fig solo book={LANDA} page={331} src={`${A}${LANDA}/331.jpg`} alt="Page 208 of Landa's Relación: each year-bearer sign printed beside the names of its Bacab and his quarter of the world" caption={<>Landa, two pages on: Kan with Hobnil and the south, Muluc with Canzienal and the east, Ix with Zaczini and the north, Cauac with Hozanek and the west.</>} />

        <Para>
          Of death, Landa writes that those who hanged themselves went to rest carried by &ldquo;la diosa de la horca que llamavan Ixtab&rdquo;, the goddess of the gallows (<Leaf book={LANDA} page={325}>p. 202</Leaf>). Sánchez de Aguilar says the Maya &ldquo;hablavan con el demonio, a quien llamavan Xibilba, que quiere dezir el que se desaparece, o desvanece&rdquo;, spoke with the devil, whom they called Xibilba, the one who vanishes (<Leaf book={SANCHEZ} page={198}>p. 198</Leaf>). Two centuries on, a book of sermons printed in Mérida in 1846 calls the serpent of Eden <em>uchben x kukican</em>, the old feathered serpent (<Leaf book={SERMONES} page={25}>p. 25</Leaf>).
        </Para>

        <Fig solo book={SERMONES} page={25} src={`${A}${SERMONES}/25.jpg`} alt="A printed page of Maya-language sermons, Mérida 1846, in which the words uchben x kukican appear" caption={<>The Mérida sermons of 1846: <em>uchben x kukican</em>, the old feathered serpent, in the last paragraph.</>} />

        <H2>The count of days</H2>

        <Para>
          Landa gives the 365-day year as eighteen months of twenty days, with twenty signs for the days, &ldquo;dexando de poner nombre a los demas cinco, porque los tenian por aciagos y malos&rdquo;, leaving the last five without names, because they held them to be unlucky and bad (<Leaf book={LANDA} page={327}>p. 204</Leaf>). The Maya scribe of the <em>Chilam Balam of Kaua</em> writes the same days in his own language: &ldquo;hopel chich aban kin ti ma kaba kin&rdquo;, five days without names (<Leaf book={KAUA} page={73}>p. 73</Leaf>). Sánchez de Aguilar, copying the months from a confiscated book, counts six, &ldquo;Vayeab, por otro nombre Vtuç Kin Vlobol Kin&rdquo; (<Leaf book={SANCHEZ} page={196}>p. 196</Leaf>).
        </Para>

        <Fig solo book={LANDA} page={327} src={`${A}${LANDA}/327.jpg`} alt="Page 204 of Landa's Relación with the twenty Maya day signs drawn in a grid, each with its name above" caption={<>Landa: the twenty day signs, Kan to Akbal, after the sentence on the five unnamed days.</>} />

        <SourceQuote
          original="llegando estos lustros a cinco, que hazen veinte años, llamavan Katun, y ponian vna piedra labrada sobre otra piedra labrada fixada con cal y arena en las paredes de sus templos"
          book={SANCHEZ}
          page={198}
          src={`${A}${SANCHEZ}/198.jpg`}
          pageAlt="Printed page of Sánchez de Aguilar's Informe on the books burned, Xibilba, and the katun of carved stones"
          source={<>Pedro Sánchez de Aguilar, <em>Informe contra idolorum cultores</em>, 1639</>}
        >
          When these spans of four years reached five, which make twenty years, they called it a katun, and set one carved stone upon another carved stone, fixed with lime and sand, in the walls of their temples.
        </SourceQuote>

        <Para>
          The stones, he says, could still be seen in the old walls on which the friars built their cells in the convent of Mérida. The count lived on in speech: to say &ldquo;I am sixty&rdquo; was <em>oxppeluabil</em>, &ldquo;tres piedras&rdquo;, three stones; the town of Tixualahtun was &ldquo;the place where one carved stone is set upon another&rdquo;, which he compared to the royal archive at Simancas (<Leaf book={SANCHEZ} page={199}>p. 199</Leaf>). Landa adds that each katun had its idol in the temple, set up ten years before its turn and honoured for twenty: &ldquo;veneravan a estos sus katunes xx años&rdquo; (<Leaf book={LANDA} page={439}>p. 316</Leaf>).
        </Para>

        <SourceQuote
          original="por vno destos libros que quitè a vnos Idolatras, vi y supe, que a vna peste llamaron Mayacimil, y a otra Ocna Kuchil, que quiere dezir muertes repentinas, y tiempos en que los cuerbos se entraron a comer los cadaueres en las casas. Y la inundacion, o huracan llamaron Hunyecil, anegacion de arboles."
          book={SANCHEZ}
          page={196}
          src={`${A}${SANCHEZ}/196.jpg`}
          pageAlt="Printed page of Sánchez de Aguilar's Informe describing the confiscated book and listing the Maya months"
          source={<>Sánchez de Aguilar</>}
        >
          From one of these books that I took from some idolaters I saw and learned that they called one plague Mayacimil, and another Ocna Kuchil, which means sudden deaths, and times when the crows came into the houses to eat the dead; and the flood or hurricane they called Hunyecil, the drowning of the trees.
        </SourceQuote>

        <Para>
          The Kaua scribe copied a European eclipse table into Maya and kept the Maya way of saying it: &ldquo;chibil uen&rdquo;, &ldquo;chibil uich kin&rdquo;, the moon bitten, the face of the sun bitten (<Leaf book={KAUA} page={121}>p. 121</Leaf>). The same book sets the twenty day names beside the saints of the Church calendar, and gives the katun prophecies in which <em>kinich Kakmo</em>, the fire macaw, is the omen of 8 Ahau at Chichén Itzá (<Leaf book={KAUA} page={11}>p. 11</Leaf>, <Leaf book={KAUA} page={168}>p. 168</Leaf>). Landa says the Maya told the hour at night &ldquo;por el luzero y las cabrillas&rdquo;, by Venus and the Pleiades (<Leaf book={LANDA} page={325}>p. 202</Leaf>).
        </Para>

        <div className="max-w-md mx-auto">
          <Fig book={KAUA} page={11} src={`${A}${KAUA}/11.jpg`} alt="Photograph of an opening of the Book of Chilam Balam of Kaua: day names beside saints' names" caption={<>Kaua: the day names beside the saints.</>} />
        </div>

        <H2>Rites</H2>

        <SourceQuote
          original="Sangrandose en la lengua, y orejas, y ofreciendo en sus patenas de tablillas su sangre, y la de sus hijos, como lo auerigue muchas vezes en sus confessiones judiciales; y de sus ofrendas, y tortas reparten a todos, y a sus enfermos, y consortes por via de comunion."
          book={SANCHEZ}
          page={184}
          src={`${A}${SANCHEZ}/184.jpg`}
          pageAlt="Printed page of Sánchez de Aguilar's Informe, with the margin note Se sangran la lengua y las orejas"
          source={<>Sánchez de Aguilar</>}
        >
          Drawing blood from the tongue and the ears, and offering their blood, and their children’s, on little wooden plates, as I established many times in their judicial confessions; and they share their offerings and cakes with everyone, with their sick and their companions, by way of communion.
        </SourceQuote>

        <Para>
          Fishermen on the coast toward Río Lagartos, before fishing, left &ldquo;candelas, reales de plata, y cuzcas, que son sus esmeraldas&rdquo;, candles, silver coins and greenstones, at shrines on the sea inlets and salt lagoons; Sánchez had them torn down in 1607 (<Leaf book={SANCHEZ} page={231}>p. 231</Leaf>). Landa describes a rite he could only call baptism, &ldquo;caput zihil quiere dezir nacer de nuevo&rdquo;, to be born again (<Leaf book={LANDA} page={267}>p. 144</Leaf>).
        </Para>

        <Para>
          Christianity was absorbed as well as resisted. Around 1600 two men, Alonso Chablé and Francisco Canul, proclaimed themselves Pope and Bishop among the Maya, said Mass at night before idols on the altar, ordained priests for the idols by anointing their hands with oil and chrism, wore mitre and staff, and poured their <em>balché</em> to the idols. The margin of the report says: &ldquo;Nunca tal se ha visto en la Nueva-España&rdquo;, nothing like it has been seen in New Spain (<Leaf book={SANCHEZ} page={214}>p. 214</Leaf>).
        </Para>

        <Fig solo book={SANCHEZ} page={214} src={`${A}${SANCHEZ}/214.jpg`} alt="Latin page of Sánchez de Aguilar's Informe on Alonso Chablé and Francisco Canul, with Spanish notes in the margin" caption={<>Sánchez de Aguilar on Chablé and Canul. The margin notes name them as Pope and Bishop, then &ldquo;Ordenan Sacerdotes para sus idolos&rdquo;, &ldquo;Nunca tal se ha visto en la Nueva-España&rdquo;, and the <em>balché</em> offered to the idols.</>} />

        <H2>Healers, diviners, conjurers</H2>

        <Para>
          The incantations of the <em>Ritual of the Bacabs</em> master a disease by naming its birth and its parents. Against a fire-sickness: &ldquo;petan kin ayum te ti cane, yx pic ʒab ana te ti cane&rdquo;, the round sun is your father in the sky, Ix Pic Tzab, the Pleiades, is your mother in the sky (<Leaf book={BACABS} page={252}>p. 252</Leaf>). The spells call their own words <em>uoh</em>, which Pío Pérez defines as &ldquo;Letra. Escribir&rdquo;, a written character, to write (<Leaf book={PIO_PEREZ} page={423}>p. 382</Leaf>).
        </Para>

        <Para>
          A diviner cast lots with a handful of maize, counting by twos. When a girl ran away from home her mother called one, who &ldquo;echò suertes sobre los caminos&rdquo;, cast lots over the roads, and she was found in the town at the end of the road the lot chose. Sánchez punished him, and recorded the only words he said over the maize: &ldquo;Huylan nones: Caylan pares&rdquo;, away the odd, stay the even (<Leaf book={SANCHEZ} page={171}>p. 171</Leaf>).
        </Para>

        <Fig solo book={SANCHEZ} page={171} src={`${A}${SANCHEZ}/171.jpg`} alt="Printed page of Sánchez de Aguilar's Informe on diviners who cast lots with maize, margin note Sortilegos" caption={<>Sánchez de Aguilar on the diviners who count maize by twos, with the runaway girl and &ldquo;Huylan nones: Caylan pares&rdquo; halfway down.</>} />

        <Para>
          The Motul dictionary names the specialists: <em>ah kinyah</em>, who casts lots; <em>ah cunal can, ceh, balam</em>, &ldquo;encantador, o hechizero, que encanta culebras, venados&rdquo;, who charms snakes, deer and jaguars (<Leaf book={MOTUL_1} page={31}>f. 12</Leaf>); and the conjurings themselves, &ldquo;Conjurar nublados: tzac&rdquo;, &ldquo;Conjuro de venados: cunal ceh&rdquo;, &ldquo;Conjuros de aues: u cunal chich&rdquo; (<Leaf book={MOTUL_2} page={132}>Spanish–Maya volume</Leaf>). Pío Pérez prints <em>tzac</em> twice in a row: &ldquo;un pececillo así llamado&rdquo;, a small fish, and &ldquo;conjurar temporales&rdquo;, to conjure storms (<Leaf book={PIO_PEREZ} page={400}>Pío Pérez</Leaf>), the pairing behind the fish-in-hand sign read <em>tzak</em>, to conjure, in Classic inscriptions. Under the Church the word turned: <em>tzacomtah</em>, &ldquo;conjurar, maldecir, excomulgar, anatematizar&rdquo; (<Leaf book={PIO_PEREZ} page={401}>p. 360</Leaf>).
        </Para>

        <FigRow>
          <Fig book={PIO_PEREZ} page={400} src={`${A}${PIO_PEREZ}/400.jpg`} alt="Printed page of Pío Pérez's dictionary opening the letter TZ, with TZAC: un pececillo and TZAC: conjurar temporales" caption={<>Pío Pérez: <em>tzac</em>, a small fish; <em>tzac</em>, to conjure storms.</>} />
          <Fig book={MOTUL_2} page={132} src={`${A}${MOTUL_2}/132.jpg`} alt="Manuscript leaf of the Motul dictionary, entries Congregar to Consentir, including Conjurar nublados: tzac" caption={<>Motul: the conjurings of clouds, deer and birds.</>} />
        </FigRow>

        <Para>
          Women after childbirth went into the sweatbath: &ldquo;baño caliente de parida: pib&rdquo; (<Leaf book={MOTUL_2} page={90}>Motul</Leaf>). At Palenque the inner sanctuaries of the Cross Group name themselves <em>pib naah</em>, sweatbath houses, places of the gods&rsquo; birth.
        </Para>

        <H2>Dream and transformation</H2>

        <Para>
          Epigraphers read the Classic <em>way</em> glyph as a person&rsquo;s co-essence, the animal or being into which one could transform. The colonial dictionaries give <em>uay</em> the same field. The Motul: &ldquo;Visiones ver como entre sueños: uay&rdquo;, to see visions as in dreams (<Leaf book={MOTUL_2} page={423}>f. 234</Leaf>). Pío Pérez, on one page: <em>uayak</em>, &ldquo;sueño, ensueño ó vision&rdquo;; <em>uayinah</em>, &ldquo;transfigurarse ó tomar figura por hechicería&rdquo;; <em>uaytal</em>, &ldquo;desaparecerse por encanto, volverse brujo&rdquo;; <em>uaytan</em>, &ldquo;brujo, que se transforma&rdquo; (<Leaf book={PIO_PEREZ} page={416}>p. 375</Leaf>).
        </Para>

        <FigRow>
          <Fig book={MOTUL_2} page={423} src={`${A}${MOTUL_2}/423.jpg`} alt="Manuscript leaf of the Spanish–Maya Motul dictionary with the entries for visión and visiones" caption={<>Motul: <em>Visiones ver como entre sueños: uay</em>.</>} />
          <Fig book={PIO_PEREZ} page={416} src={`${A}${PIO_PEREZ}/416.jpg`} alt="Printed page of Pío Pérez's dictionary, entries UAYAB to UAYUN-AK" caption={<>Pío Pérez: <em>uayak</em>, <em>uayinah</em>, <em>uaytal</em>, <em>uaytan</em>.</>} />
        </FigRow>

        <H2>The people who kept it</H2>

        <Para>
          In 1719 Ygnacio Canul of Temax left his heirs forest land &ldquo;actun Jonot Quen Balam&rdquo;, at the cave and cenote of Quen Balam, so that no one should take it from them; in 1821 the Canul family sold it for forty pesos (<Leaf book={LEGAL} page={11}>p. 11</Leaf>, <Leaf book={LEGAL} page={13}>p. 13</Leaf>). In January 1850, in the middle of the Caste War, the rebel leader Venancio Pec protested the hanging of a commander&rsquo;s wife: what fault has a poor woman, &ldquo;xchup na cubatel&rdquo;, a woman who stays at home (<Leaf book={LETTERS} page={56}>p. 56</Leaf>). The same bundle of letters holds a message sent in the name of the Cross, signed Juan de la Cruz (<Leaf book={LETTERS} page={43}>p. 43</Leaf>).
        </Para>

        <FigRow cols={3}>
          <Fig book={BACABS} page={252} src={`${P}${BACABS}/0252.jpg`} alt="Manuscript page of the Ritual of the Bacabs" caption={<><em>Ritual of the Bacabs</em>: the sun the father, the Pleiades the mother.</>} />
          <Fig book={LETTERS} page={56} src={`${P}${LETTERS}/0056.jpg`} alt="Manuscript letter of Venancio Pec, 1850" caption={<>Venancio Pec, January 1850.</>} />
          <Fig book="6ad191c342debc962692561e" page={8} src={`${P}6ad191c342debc962692561e/0008.jpg`} alt="Ebtún land paper with a seal" caption={<>Ebtún land papers, 1561&ndash;1869.</>} />
        </FigRow>


        <p className="text-secondary leading-relaxed mb-6 font-body">
          Related:{' '}
          <Link href="/articles/preserved-by-enemies">Preserved by Their Enemies</Link>,{' '}
          <Link href="/collection/maya">Maya</Link>,{' '}
          <Link href="/collection/maya-decipherment">Decoding the Maya Script</Link>
        </p>
      </article>
    </ContentPageLayout>
  );
}
