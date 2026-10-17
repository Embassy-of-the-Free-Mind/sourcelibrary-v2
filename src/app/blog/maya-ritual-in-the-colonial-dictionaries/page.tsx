import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

const HEADER_IMAGE = 'https://images.sourcelibrary.org/archived/69dfd990220eedf04e13b0cf/40.jpg';

export const metadata: Metadata = {
  title: 'Maya Ritual in the Colonial Dictionaries - Research Notes - Source Library',
  description:
    'What the Motul dictionary, Pío Pérez, and a 1639 report against idolaters record about Maya dreaming, transformation, conjuring, divination and the calendar, with every entry linked to its page image.',
  openGraph: {
    title: 'Maya Ritual in the Colonial Dictionaries',
    description:
      'Uay, tzac, kinyah, pib: Maya ritual words as the colonial dictionaries and the extirpators of idolatry wrote them down.',
    images: [{ url: HEADER_IMAGE, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: HEADER_IMAGE }],
  },
  alternates: {
    canonical: '/blog/maya-ritual-in-the-colonial-dictionaries',
  },
};

const MOTUL_1 = '6acc3d5f230e9a56175cc731';
const MOTUL_2 = '6acc3d6c230e9a56175ccae2';
const PIO_PEREZ = '6acc3dfa230e9a56175cdd32';
const SANCHEZ = '69f8c1170c0c281d4bd32721';
const KAUA = '6a878ac1d71f2514794f9e40';
const LANDA = '69f8c0f74c6a515115aedadd';

function Leaf({ book, page, children }: { book: string; page: number; children: React.ReactNode }) {
  return (
    <Link href={`/book/${book}?page=${page}`} className="text-accent-rust hover:underline">
      {children}
    </Link>
  );
}

function Entry({ maya, gloss, source }: { maya: React.ReactNode; gloss: React.ReactNode; source: React.ReactNode }) {
  return (
    <li className="font-body text-secondary leading-relaxed">
      <span className="font-semibold">{maya}</span>: {gloss} <span className="text-muted text-sm">({source})</span>
    </li>
  );
}

function Fig({ book, page, src, alt, caption, wide = false }: { book: string; page: number; src: string; alt: string; caption: React.ReactNode; wide?: boolean }) {
  return (
    <figure className={wide ? 'my-10' : 'my-0'}>
      <Link href={`/book/${book}?page=${page}`} className="block group">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" className="w-full rounded-md shadow-md bg-stone-100 group-hover:shadow-lg transition-shadow" />
      </Link>
      <figcaption className="text-sm text-muted mt-2 leading-snug font-body">{caption}</figcaption>
    </figure>
  );
}

function FigRow({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return <div className={`grid grid-cols-1 ${cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-6 my-10`}>{children}</div>;
}

function Cover({ book, page = 1, src, title, note }: { book: string; page?: number; src: string; title: React.ReactNode; note: string }) {
  return (
    <Link href={`/book/${book}?page=${page}`} className="block group">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" loading="lazy" className="w-full aspect-[3/4] object-cover object-top rounded-md shadow-md bg-stone-100 group-hover:shadow-lg transition-shadow" />
      <p className="mt-2 text-sm text-primary leading-snug font-body group-hover:text-accent-rust">{title}</p>
      <p className="text-xs text-muted font-body">{note}</p>
    </Link>
  );
}

export default function MayaRitualDictionariesPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Maya Ritual in the Colonial Dictionaries"
          subtitle="Dreaming, transformation, conjuring and the count of days, as the friars and the extirpators wrote them down"
          image={HEADER_IMAGE}
          imageAlt="A page of the Dresden Codex with columns of glyphs and two descending serpents"
        >
          <p className="text-stone-400 text-sm mt-4">16 October 2026 &middot; 10 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          In 1639 Pedro Sánchez de Aguilar, dean of the cathedral of Mérida, printed a report urging harsher punishment for Maya &ldquo;idolaters.&rdquo; In the middle of it he describes a painted book he had taken from some of them, and writes down what he read in it before it disappeared.
        </p>

        <FigRow cols={3}>
          <Fig book="69dfd990220eedf04e13b0cf" page={40} src="https://images.sourcelibrary.org/archived/69dfd990220eedf04e13b0cf/40.jpg" alt="A page of the Dresden Codex with glyph columns and two descending serpents" caption={<>The Dresden Codex. Only four painted Maya books survive; this is the kind of book the extirpators took.</>} />
          <Fig book="69dfdec78e5ccd1c891f0cd4" page={10} src="https://images.sourcelibrary.org/archived/69dfdec78e5ccd1c891f0cd4/10.jpg" alt="An opening of the Paris Codex, worn at the edges, with red and blue painted figures and glyphs" caption={<>The Paris Codex, worn to its centre.</>} />
          <Fig book="6ad191a242debc96269252b6" page={11} src="https://images.sourcelibrary.org/pages/6ad191a242debc96269252b6/0011.jpg" alt="A ragged leaf of the Ritual of the Bacabs manuscript in Maya" caption={<>The <em>Ritual of the Bacabs</em>, Yucatec incantations copied in the eighteenth century. New to the library this week.</>} />
        </FigRow>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          That pattern runs through the colonial record of Yucatán. The people who wrote to suppress Maya ritual had to name it, and the dictionaries they compiled to preach in Maya recorded its vocabulary along with everything else. Source Library has now read the two volumes of the <em>Diccionario de Motul</em>, Juan Pío Pérez&rsquo;s <em>Diccionario de la lengua maya</em> (1866) and Beltrán&rsquo;s <em>Arte</em> (1859) page by page. This note collects what they, and Sánchez de Aguilar, say about a few ritual words.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          Every Maya and Spanish quotation below is copied from the page image it links to. The English glosses of the Spanish are ours.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">What we did this month</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          In October 2026 Source Library read nearly 5,000 pages of Maya-language sources and colonial works about Maya language and religion, almost all of it new to Source Library as searchable text.
        </p>

        <ul className="space-y-2 mb-6 list-disc pl-6 font-body text-secondary">
          <li><strong>Transcribed from the page images</strong> by Claude Opus, with an instruction to keep the colonial letters as written (ɔ, the barred <em>cħ</em>, doubled consonants such as <em>pp</em>), and to mark what it cannot read as unclear rather than guess.</li>
          <li><strong>Translated into English</strong> by the model that won a blind comparison for each language: Gemini 4 for Yucatec, Claude Opus for Kaqchikel and for the Motul dictionary. Each comparison was judged by two models from different companies, in both orders.</li>
          <li><strong>Checked</strong> against the page images, page by page on samples, and against the dictionaries themselves: Maya numerals in the translations were tested against Beltrán&rsquo;s tables, and the mistranslated ones fixed.</li>
          <li><strong>Imported</strong> manuscripts from Princeton&rsquo;s Garrett-Gates Mesoamerican Manuscripts and the University of Pennsylvania&rsquo;s Berendt-Brinton Collection, both in the public domain, including the <em>Ritual of the Bacabs</em> and the letters of the Caste War leaders.</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          Every book opens beside its page images, so any transcription or translation can be checked against the original. The full list of what is readable is <a href="#available" className="text-accent-rust hover:underline">at the end of this note</a>.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">A confiscated book</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The Maya, Sánchez de Aguilar writes, painted &ldquo;con colores la quenta de sus años, las guerras, pestes, huracanes, inundaciones, hambres, y otros sucessos&rdquo; (in colours the count of their years, the wars, plagues, hurricanes, floods, famines and other events). Then, on the <Leaf book={SANCHEZ} page={196}>same leaf</Leaf>:
        </p>

        <blockquote className="border-l-2 border-accent-rust/30 pl-6 my-8 font-body text-secondary leading-relaxed">
          &ldquo;y por vno destos libros que quitè a vnos Idolatras, vi y supe, que a vna peste llamaron Mayacimil, y a otra Ocna Kuchil, que quiere dezir muertes repentinas, y tiempos en que los cuerbos se entraron a comer los cadaueres en las casas. Y la inundacion, o huracan llamaron Hunyecil, anegacion de arboles.&rdquo;
          <p className="mt-3 text-muted text-sm">
            And from one of these books that I took from some idolaters, I saw and learned that they called one plague <em>Mayacimil</em>, and another <em>Ocna Kuchil</em>, which means sudden deaths and times when the crows came into the houses to eat the corpses; and the flood or hurricane they called <em>Hunyecil</em>, the drowning of the trees.
          </p>
        </blockquote>

        <Fig wide book={SANCHEZ} page={196} src="https://images.sourcelibrary.org/archived/69f8c1170c0c281d4bd32721/196.jpg" alt="Printed page of Sánchez de Aguilar's Informe (1639) describing the confiscated book and listing the Maya months" caption={<>Sánchez de Aguilar, <em>Informe contra idolorum cultores</em> (Madrid, 1639): the confiscated book, and below it the eighteen months.</>} />

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The same page gives the eighteen months of the year, each set against a European date (&ldquo;A 12. de Enero llamauan Yaax, a primero de Febrero Çac, a 12. de Febrero Ceh&hellip;&rdquo;). It closes the year with &ldquo;Vayeab, por otro nombre Vtuç Kin Vlobol Kin, por seis dias que eran sus Caniculares&rdquo;: <strong>six</strong> closing days, under two further names. Pío Pérez, two centuries later, defines <em>uayeb-haab</em> as &ldquo;los cinco dias complementarios que intercalaban los indios al fin de año para completar los 365&rdquo; (<Leaf book={PIO_PEREZ} page={416}>p. 375</Leaf>): five.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Elsewhere in the report (machine translation, linked for checking) he complains that the Maya &ldquo;drank their <em>balche</em>, worshiped idols in their homes, in caverns, and in caves&rdquo; (<Leaf book={SANCHEZ} page={49}>p. 49</Leaf>), describes finding a cave of idols at Cehac (<Leaf book={SANCHEZ} page={54}>p. 54</Leaf>), and records taking a notebook of creation stories from a choirmaster named Cuytun (<Leaf book={SANCHEZ} page={250}>p. 250</Leaf>).
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Uay: dream, vision, transformation</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Epigraphers read the Classic Maya <em>way</em> glyph as a spirit companion or co-essence, an animal or being into which a person could transform (Houston and Stuart 1989). The colonial Yucatec entries for <em>uay</em> cluster around the same field: dream, vision, and changing shape by sorcery.
        </p>

        <FigRow>
          <Fig book={MOTUL_2} page={423} src="https://images.sourcelibrary.org/archived/6acc3d6c230e9a56175ccae2/423.jpg" alt="Manuscript leaf of the Spanish–Maya Motul dictionary with the entries for visión and visiones" caption={<>Motul, Spanish–Maya, f. 234: <em>Visiones ver como entre sueños: uay</em>.</>} />
          <Fig book={PIO_PEREZ} page={416} src="https://images.sourcelibrary.org/archived/6acc3dfa230e9a56175cdd32/416.jpg" alt="Printed page of Pío Pérez's dictionary, entries UAYAB to UAYUN-AK" caption={<>Pío Pérez 1866, p. 375: <em>uayak</em>, <em>uayaz</em>, <em>uayinah</em>, <em>uaytal</em>, <em>uaytan</em>.</>} />
        </FigRow>

        <ul className="space-y-3 mb-8 list-none pl-0">
          <Entry
            maya="uay"
            gloss={<>&ldquo;Visiones ver como entre sueños&rdquo; (to see visions as in dreams); on the same leaf, <em>manab</em>, &ldquo;visión o fantasma&rdquo;, and <em>manabchi</em>, &ldquo;visiones ver&rdquo;</>}
            source={<Leaf book={MOTUL_2} page={423}>Motul, Spanish–Maya volume, f. 234</Leaf>}
          />
          <Entry
            maya="uayak, uayaktah"
            gloss={<>&ldquo;sueño, ensueño ó vision, entre sueños&rdquo;; &ldquo;soñar, ver visiones entre sueños&rdquo;</>}
            source={<Leaf book={PIO_PEREZ} page={416}>Pío Pérez 1866, p. 375</Leaf>}
          />
          <Entry
            maya="uayaz"
            gloss={<>&ldquo;lo que se pasa presto como sueño&hellip; Desaparecer, como una vision&rdquo;</>}
            source={<Leaf book={PIO_PEREZ} page={416}>same page</Leaf>}
          />
          <Entry
            maya="uayinah"
            gloss={<>&ldquo;transfigurarse ó tomar figura por hechicería&rdquo; (to transfigure oneself or take a shape by sorcery)</>}
            source={<Leaf book={PIO_PEREZ} page={416}>same page</Leaf>}
          />
          <Entry
            maya="uaytal, uaytan"
            gloss={<>&ldquo;desaparecerse por encanto, volverse brujo, convertirse en tal&rdquo;; &ldquo;brujo, que se transforma&rdquo;</>}
            source={<Leaf book={PIO_PEREZ} page={416}>same page</Leaf>}
          />
        </ul>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Tzac: a fish, and conjuring</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Pío Pérez prints two entries for <em>tzac</em> one above the other: &ldquo;un pececillo así llamado&rdquo; (a small fish so called) and &ldquo;conjurar temporales&rdquo; (to conjure storms) (<Leaf book={PIO_PEREZ} page={400}>Pío Pérez 1866, first page of <em>Tz</em></Leaf>). The fish-in-hand sign of Classic inscriptions is read <em>tzak</em>, &ldquo;to conjure.&rdquo; The next page shows what became of the word under the Church:
        </p>

        <ul className="space-y-3 mb-8 list-none pl-0">
          <Entry
            maya="tzac-ik, tzac-kin"
            gloss={<>&ldquo;conjuro idolátrico de los vientos&rdquo; (idolatrous conjuring of the winds)</>}
            source={<Leaf book={PIO_PEREZ} page={401}>Pío Pérez 1866, p. 360</Leaf>}
          />
          <Entry
            maya="tzacom"
            gloss={<>&ldquo;cosa excomulgada, maldita ú ofrecida al demonio&rdquo;</>}
            source={<Leaf book={PIO_PEREZ} page={401}>same page</Leaf>}
          />
          <Entry
            maya="tzacomtah"
            gloss={<>&ldquo;conjurar, maldecir, excomulgar, anatematizar&rdquo;; <em>tzacomtabil</em>, &ldquo;maldiciéndolo con deprecaciones idolátricas&rdquo;</>}
            source={<Leaf book={PIO_PEREZ} page={401}>same page</Leaf>}
          />
        </ul>

        <FigRow>
          <Fig book={PIO_PEREZ} page={401} src="https://images.sourcelibrary.org/archived/6acc3dfa230e9a56175cdd32/401.jpg" alt="Printed page of Pío Pérez's dictionary, entries TZACAM to TZANTZANTAL" caption={<>Pío Pérez 1866, p. 360: <em>tzac-ik, tzac-kin</em>, &ldquo;conjuro idolátrico de los vientos&rdquo;, and <em>tzacomtah</em>.</>} />
          <Fig book={MOTUL_2} page={132} src="https://images.sourcelibrary.org/archived/6acc3d6c230e9a56175ccae2/132.jpg" alt="Manuscript leaf of the Motul dictionary, entries Congregar to Consentir, including Conjurar nublados: tzac" caption={<>Motul, Spanish–Maya: <em>Conjurar nublados: tzac</em>, and the conjurings of deer and birds.</>} />
        </FigRow>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The Motul dictionary, two and a half centuries older, has a small cluster of conjurings on one leaf (<Leaf book={MOTUL_2} page={132}>Spanish–Maya volume</Leaf>): &ldquo;Conjurar nublados: tzac&rdquo; (to conjure clouds), &ldquo;Conjuro de hechizeros: cunyathan&rdquo; (sorcerers&rsquo; conjuring), &ldquo;Conjuro de venados: cunal ceh&rdquo; (conjuring of deer), &ldquo;Conjuros de aues: u cunal chich&rdquo; (conjurings of birds). The Maya–Spanish volume names the specialist: <em>ah cunal can, ceh, balam</em>, &ldquo;encantador, o hechizero, que encanta culebras, venados etcetera&rdquo; (<Leaf book={MOTUL_1} page={31}>Motul, Maya–Spanish volume, f. 12</Leaf>), and on the same leaf <em>ah cunal than</em>, &ldquo;encantador, o hechizero que sabe hechizos&rdquo;.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Kinyah: casting lots</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          &ldquo;Adeuinar o echar suertes: kinyah&rdquo; (to divine or cast lots) and, on the next line, &ldquo;Adeuinar el hechiçero: kinyah&rdquo; (the sorcerer divines) (<Leaf book={MOTUL_2} page={37}>Motul, Spanish–Maya volume, f. 8</Leaf>). The word is built on <em>kin</em>, sun and day.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Pib: the sweatbath after childbirth</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          &ldquo;Baño caliente de parida: pib&rdquo; (the hot bath of a woman who has given birth) (<Leaf book={MOTUL_2} page={90}>Motul, Spanish–Maya volume</Leaf>). The Maya–Spanish volume gives the other sense, &ldquo;pib: assar debaxo de tierra&rdquo; (to roast under the earth) (<Leaf book={MOTUL_1} page={758}>Motul, Maya–Spanish volume</Leaf>). The inner sanctuaries of the Cross Group at Palenque are named in their inscriptions as <em>pib naah</em>, &ldquo;sweatbath houses&rdquo;, and have been read as symbolic places of divine birth (Houston 1996).
        </p>

        <FigRow>
          <Fig book={MOTUL_2} page={90} src="https://images.sourcelibrary.org/archived/6acc3d6c230e9a56175ccae2/90.jpg" alt="Manuscript leaf of the Motul dictionary, entries baladron to barbar, including baño caliente de parida: pib" caption={<>Motul, Spanish–Maya: <em>baño caliente de parida: pib</em>.</>} />
          <Fig book={KAUA} page={11} src="https://images.sourcelibrary.org/archived/6a878ac1d71f2514794f9e40/11.jpg" alt="Photograph of an opening of the Book of Chilam Balam of Kaua: day names beside saints' names" caption={<>Chilam Balam of Kaua, p. 11 (Teobert Maler&rsquo;s photograph): the day names beside the saints.</>} />
        </FigRow>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">From the books themselves</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          A first reading of the newly readable books turned up these passages. Where the Spanish or Maya is quoted it was checked against the page image or the transcription; passages given only in English are the machine translation, linked so they can be checked.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">Katuns of stone</h3>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Sánchez de Aguilar on how the Maya counted their eras (<Leaf book={SANCHEZ} page={198}>p. 198</Leaf>): the years were set by direction, the first in the east, &ldquo;llamádole Cuch hab&rdquo;, and when five such four-year spans made twenty years &ldquo;llamauan Katun, y ponian vna piedra labrada sobre otra piedra labrada fixada con cal y arena en las paredes de sus templos&rdquo; (they called it a katun, and set one carved stone upon another, fixed with lime and sand, in the walls of their temples). He adds that the stones can still be seen in the old walls on which the friars built their cells in the convent of Mérida. On the same page: &ldquo;los primeros Religiosos recogieron, y quemaron estos libros inaduertidamente&rdquo; (the first friars gathered and burned these books, without thinking).
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          On the next page (<Leaf book={SANCHEZ} page={199}>p. 199</Leaf>) the town of Tixualahtun is &ldquo;lugar donde se pone vna piedra labrada sobre otra&rdquo;, which he compares to the royal archive at Simancas, and the count survives in speech: to say &ldquo;I am sixty&rdquo; was <em>oxppeluabil</em>, &ldquo;tengo tres eras de años, idest, tres piedras&rdquo; (I have three eras of years, that is, three stones). He learned this way of counting, he says, to preach to the Maya in their own terms.
        </p>

        <FigRow>
          <Fig book={SANCHEZ} page={198} src="https://images.sourcelibrary.org/archived/69f8c1170c0c281d4bd32721/198.jpg" alt="Printed page of Sánchez de Aguilar's Informe on the katun and the carved stones" caption={<>Sánchez de Aguilar 1639, p. 198: the burning of the books, <em>Xibilba</em>, and the katun of carved stones.</>} />
          <Fig book={SANCHEZ} page={199} src="https://images.sourcelibrary.org/archived/69f8c1170c0c281d4bd32721/199.jpg" alt="Printed page of Sánchez de Aguilar's Informe on Tixualahtun and counting age in stones" caption={<>p. 199: <em>oxppeluabil</em>, &ldquo;tres piedras&rdquo;, sixty years.</>} />
        </FigRow>

        <h3 className="text-xl text-primary mt-10 mb-4">A diviner&rsquo;s words</h3>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Diviners, Sánchez writes (<Leaf book={SANCHEZ} page={171}>p. 171</Leaf>), cast lots with a handful of maize, counting by twos. A girl once ran away from home; her mother called one of them, who &ldquo;echò suertes sobre los caminos&rdquo; (cast lots over the roads), and she was found in the town at the end of the road the lot chose. Sánchez punished him, and on examining him found that all he said while counting the maize was &ldquo;Huylan nones: Caylan pares&rdquo;, roughly &ldquo;away the odds, stay the pairs.&rdquo; He could not say whether he invoked the devil, &ldquo;porque el Sortilego era simplicissimo, y casi tonto.&rdquo;
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">The healer&rsquo;s parentage of a disease</h3>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The incantations of the <em>Ritual of the Bacabs</em> master a disease by naming its birth and its parents. Against a fire-illness (<Leaf book="6ad191a242debc96269252b6" page={252}>p. 252</Leaf>): &ldquo;petan kin ayum te ti cane, yx pic ʒab ana te ti cane&rdquo;, the round sun is your father there in the sky, <em>Ix Pic Tzab</em> is your mother there in the sky, a name the translation reads as the Pleiades. Other spells speak of their own words as <em>uoh</em> (<Leaf book="6ad191a242debc96269252b6" page={68}>p. 68</Leaf>), which Pío Pérez gives as &ldquo;Letra. | Escribir&rdquo; (a letter, to write) (<Leaf book={PIO_PEREZ} page={423}>p. 382</Leaf>). In machine translation, Ix Chel and Itzamna appear in the four colours of the directions (<Leaf book="6ad191a242debc96269252b6" page={142}>p. 142</Leaf>), and the curer brings to birth a rattlesnake in red, white, black and yellow (<Leaf book="6ad191a242debc96269252b6" page={220}>p. 220</Leaf>).
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">In the Maya scribes&rsquo; own almanac</h3>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The <em>Chilam Balam of Kaua</em> copies a European eclipse table into Maya and keeps the Maya idiom: &ldquo;chibil uen&rdquo; and &ldquo;chibil uich kin&rdquo;, the moon and the face of the sun bitten (<Leaf book={KAUA} page={121}>p. 121</Leaf>). It gives the Uayeb as &ldquo;hopel chich aban kin ti ma kaba kin&rdquo;, five days without names (<Leaf book={KAUA} page={73}>p. 73</Leaf>), and in its katun prophecies <em>kinich Kakmo</em>, the fire macaw, appears as the omen of 8 Ahau (<Leaf book={KAUA} page={168}>p. 168</Leaf>). The 1846 Yucatec sermons, in turn, name the ancient serpent of Genesis <em>uchben x kukican</em> (<Leaf book="6acc3dd5230e9a56175cd709" page={25}>p. 25</Leaf>).
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">The people</h3>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Venancio Pec, one of the leaders of the Caste War, in a postscript of January 1850, protests the hanging of a commander&rsquo;s wife: what fault has a poor woman, &ldquo;xchup na cubatel&rdquo;, a woman who just stays at home (<Leaf book="6ad191b742debc9626925415" page={56}>p. 56</Leaf>). In 1719 Ygnacio Canul of Temax left his heirs forest land &ldquo;actun Jonot Quen Balam&rdquo;, at the cave and cenote called Quen Balam, so that no one should take it from them; in 1821 members of the Canul family sold it for forty pesos (<Leaf book="6ad191c442debc962692562c" page={11}>p. 11</Leaf>, <Leaf book="6ad191c442debc962692562c" page={13}>p. 13</Leaf>). The letters also hold a message issued in the name of the Cross, signed &ldquo;Juan de la Cruz&rdquo;, with a Spanish translation made at the time (<Leaf book="6ad191b742debc9626925415" page={43}>pp. 43&ndash;45</Leaf>).
        </p>

        <FigRow cols={3}>
          <Fig book="6ad191a242debc96269252b6" page={252} src="https://images.sourcelibrary.org/pages/6ad191a242debc96269252b6/0252.jpg" alt="Manuscript page of the Ritual of the Bacabs" caption={<><em>Ritual of the Bacabs</em>, p. 252: the sun the father, Ix Pic Tzab the mother.</>} />
          <Fig book={KAUA} page={121} src="https://images.sourcelibrary.org/archived/6a878ac1d71f2514794f9e40/121.jpg" alt="Page of the Chilam Balam of Kaua with an eclipse table" caption={<>Kaua, p. 121: the moon and the sun &ldquo;bitten&rdquo;.</>} />
          <Fig book="6ad191b742debc9626925415" page={56} src="https://images.sourcelibrary.org/pages/6ad191b742debc9626925415/0056.jpg" alt="Manuscript letter of Venancio Pec, 1850" caption={<>Venancio Pec, January 1850.</>} />
        </FigRow>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Maya religion, as its destroyers recorded it</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Diego de Landa, the Franciscan who presided over the burning of Maya books at Maní in 1562, wrote the fullest early account of the religion he suppressed. The library holds it in Brasseur de Bourbourg&rsquo;s 1864 edition, Spanish and French side by side. Every quotation below is from Landa&rsquo;s Spanish on the page linked.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          <strong>The days.</strong> &ldquo;Para estos ccclx dias tienen xx letras o carateres con que los nombran, dexando de poner nombre a los demas cinco, porque los tenian por aciagos y malos&rdquo; (for these 360 days they have twenty letters or characters by which they name them, leaving the other five without a name, because they held them to be unlucky and bad). The page then draws the twenty day signs, Kan to Akbal (<Leaf book={LANDA} page={327}>p. 204</Leaf>).
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          <strong>The Bacabs.</strong> &ldquo;Entre la muchedumbre de dioses que esta gente adorava, adoravan quatro llamados Bacab&hellip; Estos dezian eran quatro hermanos a los quales puso Dios quando crio el mundo a las quatro partes del, sustentando el cielo no se cayesse. Dezian tambien destos Bacabes que escaparon quando el mundo fue del diluvio destruido&rdquo; (among the multitude of gods they worshipped four called Bacab. These, they said, were four brothers whom God set at the four parts of the world when he made it, holding up the sky so that it should not fall; and they said these Bacabs escaped when the world was destroyed by the flood). Each was tied to one of the four year-bearer days, Kan, Muluc, Ix and Cauac, drawn on the same page (<Leaf book={LANDA} page={329}>p. 206</Leaf>).
        </p>

        <FigRow>
          <Fig book={LANDA} page={327} src="https://images.sourcelibrary.org/archived/69f8c0f74c6a515115aedadd/327.jpg" alt="Page of Landa's Relación with the twenty Maya day signs drawn in a grid" caption={<>Landa, p. 204: the twenty day signs.</>} />
          <Fig book={LANDA} page={329} src="https://images.sourcelibrary.org/archived/69f8c0f74c6a515115aedadd/329.jpg" alt="Page of Landa's Relación with the four year-bearer signs and the passage on the four Bacabs" caption={<>p. 206: the year-bearers Kan, Muluc, Ix, Cauac, and the four Bacabs holding up the sky.</>} />
        </FigRow>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          <strong>The katuns as idols.</strong> Each twenty-year katun had its idol in the temple. Had there been no Spaniards, &ldquo;adoraran ellos el idolo de Buluc-Ahau hasta el año de LI&rdquo;, then set up an idol to Bolon-Ahau beside it to be honoured in turn, &ldquo;de manera que veneravan a estos sus katunes xx años&rdquo; (so that they venerated these katuns of theirs for twenty years) (<Leaf book={LANDA} page={439}>p. 316</Leaf>).
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          <strong>The books.</strong> On the same page: &ldquo;Hallamosles grande numero de libros destas sus letras, y porque no tenian cosa en que no uviesse superstición y falsedades del demonio se les quemamos todos, lo qual a maravilla sentian, y les dava pena&rdquo; (we found a great number of books in these letters of theirs, and because they had nothing in which there was not superstition and the devil&rsquo;s falsehoods, we burned them all, which they felt deeply and which grieved them). The next sentence begins &ldquo;De sus letras porne aqui un a, b, c&rdquo;; two pages on he writes <em>lé</em>, <em>ha</em> and &ldquo;Ma in kati, quiere dezir no quiero&rdquo; in Maya signs (<Leaf book={LANDA} page={441}>p. 318</Leaf>), the passage from which the phonetic reading of the script was eventually recovered.
        </p>

        <FigRow>
          <Fig book={LANDA} page={439} src="https://images.sourcelibrary.org/archived/69f8c0f74c6a515115aedadd/439.jpg" alt="Page of Landa's Relación on the katun idols and the burning of the books" caption={<>p. 316: the katun idols, and &ldquo;se les quemamos todos&rdquo;.</>} />
          <Fig book={LANDA} page={441} src="https://images.sourcelibrary.org/archived/69f8c0f74c6a515115aedadd/441.jpg" alt="Page of Landa's Relación writing words in Maya glyphs" caption={<>p. 318: <em>Ma in kati</em>, &ldquo;no quiero&rdquo;, written in Maya signs.</>} />
        </FigRow>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          <strong>Rebirth and death.</strong> Landa found among the Maya a rite he could only call baptism, &ldquo;con vocablo que quiere dezir nacer de nuevo&hellip; caput zihil quiere dezir nacer de nuevo&rdquo; (with a word that means to be born again) (<Leaf book={LANDA} page={267}>p. 144</Leaf>). Those who hanged themselves, he writes, went to their rest carried by &ldquo;la diosa de la horca que llamavan Ixtab&rdquo;, the goddess of the gallows, and at night the Maya told the hour &ldquo;por el luzero y las cabrillas&rdquo;, by Venus and the Pleiades (<Leaf book={LANDA} page={325}>p. 202</Leaf>).
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">What the extirpator found, two generations later</h3>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Sánchez de Aguilar&rsquo;s report shows the religion still practised around 1600, in the record of his own trials. The Maya drew blood &ldquo;en la lengua, y orejas, y ofreciendo en sus patenas de tablillas su sangre, y la de sus hijos, como lo auerigue muchas vezes en sus confessiones judiciales&rdquo; (from the tongue and ears, offering their blood and their children&rsquo;s on little wooden plates, as I established many times in their judicial confessions), then shared the offerings and cakes with everyone &ldquo;por via de comunion&rdquo; (<Leaf book={SANCHEZ} page={184}>p. 184</Leaf>). Fishermen of the coast toward Río Lagartos made offerings before fishing of &ldquo;candelas, reales de plata, y cuzcas, que son sus esmeraldas&rdquo; at shrines on the inlets and salt lagoons, which he had demolished in 1607 (<Leaf book={SANCHEZ} page={231}>p. 231</Leaf>). And two men, Alonso Chablé and Francisco Canul, declared themselves Pope and Bishop among the Maya, said Mass at night, ordained priests for the idols by anointing their hands with oil and chrism, and offered the idols their <em>balche</em>; in the margin, &ldquo;Nunca tal se ha visto en la Nueva-España&rdquo; (<Leaf book={SANCHEZ} page={214}>p. 214</Leaf>).
        </p>

        <h2 id="available" className="text-2xl md:text-3xl text-primary mt-16 mb-6">What you can read now</h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 my-8">
          <Cover book="6ad191a242debc96269252b6" page={11} src="https://images.sourcelibrary.org/pages/6ad191a242debc96269252b6/0011.jpg" title={<em>Ritual of the Bacabs</em>} note="18th c., Yucatec" />
          <Cover book="6ad191b742debc9626925415" page={8} src="https://images.sourcelibrary.org/pages/6ad191b742debc9626925415/0008.jpg" title="Caste War letters" note="1848–1850, Yucatec" />
          <Cover book="6a87106327fd08cecf145caa" src="https://images.sourcelibrary.org/archived/6a87106327fd08cecf145caa/1.jpg" title={<><em>Popol Vuh</em> manuscript</>} note="c. 1701, K’iche’ and Spanish" />
          <Cover book="6ad191c342debc962692561e" page={8} src="https://images.sourcelibrary.org/pages/6ad191c342debc962692561e/0008.jpg" title="Ebtún land papers" note="1561–1869, Yucatec" />
          <Cover book="69dfd990220eedf04e13b0cf" page={10} src="https://images.sourcelibrary.org/archived/69dfd990220eedf04e13b0cf/10.jpg" title="Dresden Codex" note="Maya painted book" />
          <Cover book="6acc3d72230e9a56175ccc93" page={5} src="https://images.sourcelibrary.org/archived/6acc3d72230e9a56175ccc93/5.jpg" title={<>Saz, <em>Libro de pláticas</em></>} note="1662, Kaqchikel" />
          <Cover book={PIO_PEREZ} page={12} src="https://images.sourcelibrary.org/archived/6acc3dfa230e9a56175cdd32/12.jpg" title={<>Pío Pérez, <em>Diccionario</em></>} note="1866, Yucatec–Spanish" />
          <Cover book={SANCHEZ} page={196} src="https://images.sourcelibrary.org/archived/69f8c1170c0c281d4bd32721/196.jpg" title={<>Sánchez de Aguilar, <em>Informe</em></>} note="1639, against the idolaters" />
        </div>

        <p className="text-secondary leading-relaxed mb-4 font-body"><strong>Written by Maya authors</strong></p>
        <ul className="space-y-2 mb-6 list-disc pl-6 font-body text-secondary">
          <li><Leaf book="6ad191a242debc96269252b6" page={1}><em>Ritual of the Bacabs</em></Leaf>, Yucatec healing incantations, late eighteenth century (Princeton, Garrett-Gates no. 1)</li>
          <li>The books of Chilam Balam: <Leaf book={KAUA} page={1}>Kaua</Leaf> (Maler&rsquo;s 1887 photographs) and <Leaf book="6a87102131598d129803de7b" page={1}>Kaua, 1824 copy</Leaf>, <Leaf book="699259a03d2d40d1b0592ce8" page={1}>Chumayel</Leaf> (Gordon&rsquo;s 1913 facsimile), <Leaf book="6a8ee3de880abaf2b45934c3" page={1}>Calkiní</Leaf>, <Leaf book="6a8d9b7c4cc19d0e10153aa9" page={1}>Teabo</Leaf>, <Leaf book="6a8da255aa8f57838adf7fe4" page={1}>Nah</Leaf> and the <Leaf book="6a8da256aa8f57838adf8025" page={1}>Ixil lunario</Leaf></li>
          <li><Leaf book="6ad191b742debc9626925415" page={1}>Letters of the Caste War leaders, 1848&ndash;1850</Leaf>, among them Jacinto Pat and Bonifacio Novelo</li>
          <li><Leaf book="6ad191c442debc962692562c" page={1}>Maya legal documents, 1686&ndash;1849</Leaf> (wills and deeds) and the <Leaf book="6ad191c342debc962692561e" page={1}>Ebtún land papers, 1561&ndash;1869</Leaf></li>
          <li>The <Leaf book="6a87106327fd08cecf145caa" page={1}><em>Popol Vuh</em> manuscript (Newberry Library, Ayer MS 1515)</Leaf> and <Leaf book="69e729dca409200ea79f16d5" page={1}>Brasseur de Bourbourg&rsquo;s 1861 edition</Leaf></li>
        </ul>

        <p className="text-secondary leading-relaxed mb-4 font-body"><strong>Dictionaries and grammars</strong></p>
        <ul className="space-y-2 mb-6 list-disc pl-6 font-body text-secondary">
          <li><Leaf book={MOTUL_1} page={1}><em>Diccionario de Motul</em>, Maya–Spanish</Leaf> and <Leaf book={MOTUL_2} page={1}>Spanish–Maya</Leaf></li>
          <li><Leaf book={PIO_PEREZ} page={1}>Pío Pérez, <em>Diccionario de la lengua maya</em></Leaf> (1866) and his <Leaf book="6a9f3fa783c3b522416e4a0d" page={1}><em>Coordinación alfabética</em></Leaf> of Beltrán&rsquo;s vocabulary (1898)</li>
          <li><Leaf book="6a9f3fa483c3b522416e48fa" page={1}>Beltrán, <em>Arte del idioma maya</em></Leaf> (1859 edition) and, for Kaqchikel, <Leaf book="6acc3da4230e9a56175cd383" page={1}>Maldonado&rsquo;s <em>Arte</em></Leaf> (1748)</li>
          <li><Leaf book="69f8c12d0c0c281d4bd32a5c" page={1}>Brasseur de Bourbourg, <em>Grammaire de la langue quichée</em></Leaf> (1862)</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-4 font-body"><strong>Written to convert, or to suppress</strong></p>
        <ul className="space-y-2 mb-6 list-disc pl-6 font-body text-secondary">
          <li><Leaf book={LANDA} page={1}>Diego de Landa, <em>Relación de las cosas de Yucatán</em></Leaf> (c. 1566; Brasseur de Bourbourg&rsquo;s 1864 edition) and <Leaf book={SANCHEZ} page={1}>Sánchez de Aguilar, <em>Informe contra idolorum cultores</em></Leaf> (1639)</li>
          <li>Sermons and catechisms in Yucatec: <Leaf book="6acc3dbd230e9a56175cd616" page={1}>Domínguez, <em>Pláticas</em></Leaf> (1758), the <Leaf book="6acc3dd5230e9a56175cd709" page={1}><em>Colección de sermones</em></Leaf> (1846), <Leaf book="6acc3ddc230e9a56175cd8f4" page={1}>Ruz, <em>Explicación</em></Leaf> (1847), <Leaf book="6acc3ddf230e9a56175cda8b" page={1}>Ripalda&rsquo;s catechism</Leaf> (1847) and the <Leaf book="6acc3e19230e9a56175cdf20" page={1}>Gospel of John</Leaf> (1869)</li>
          <li>In Kaqchikel: <Leaf book="6acc3d72230e9a56175ccc93" page={1}>Antonio del Saz, <em>Libro de pláticas</em></Leaf> (1662)</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-4 font-body"><strong>Still being read</strong></p>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          Nineteenth-century copies of the books of Chilam Balam of Chumayel, Calkiní, Tizimín, Ixil and Kaua and of the <em>Libro de los Médicos</em>; a manuscript of the Chumayel; the <em>Títulos</em> of the K&rsquo;iche&rsquo; lords; a Q&rsquo;eqchi&rsquo; divinatory calendar of 1867; and, from Penn, Berendt&rsquo;s copies of Maya texts, the manuscript of the Kaqchikel annals and an 1864 broadside to the people of Chan Santa Cruz.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">How these pages were read</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The English is a machine draft. Its typical error is fluent English that quietly corrects the source toward what the model expects. On the 1846 Yucatec sermons, <em>lahu oxkal catac oxpel</em>, which Beltrán&rsquo;s <em>Arte</em> gives as fifty-three, had been translated as the thirty-three the context suggested; a scan of every Maya numeral against Beltrán&rsquo;s tables found and fixed that and four more. The manuscripts are harder than the printed books, and their transcriptions mark doubtful readings. Quote the Maya and the Spanish from the page images and treat the English as a guide to them. Corrections are welcome.
        </p>

        <hr className="my-12 border-stone-200" />

        <p className="text-sm text-muted uppercase tracking-wider mb-4">Primary sources</p>
        <ul className="space-y-2 mb-8">
          <li className="text-secondary font-body">
            <Leaf book={MOTUL_1} page={1}><em>Diccionario de Motul</em>, Maya–Spanish</Leaf> and <Leaf book={MOTUL_2} page={1}>Spanish–Maya</Leaf> (attributed to Antonio de Ciudad Real, late sixteenth century).
          </li>
          <li className="text-secondary font-body">
            <Leaf book={PIO_PEREZ} page={1}>Juan Pío Pérez, <em>Diccionario de la lengua maya</em></Leaf> (Mérida, 1866).
          </li>
          <li className="text-secondary font-body">
            <Leaf book={SANCHEZ} page={1}>Pedro Sánchez de Aguilar, <em>Informe contra idolorum cultores del obispado de Yucatán</em></Leaf> (Madrid, 1639).
          </li>
          <li className="text-secondary font-body">
            <Leaf book="6a9f3fa483c3b522416e48fa" page={217}>Pedro Beltrán de Santa Rosa, <em>Arte del idioma maya</em></Leaf> (1746; Mérida edition of 1859), numeral tables.
          </li>
          <li className="text-secondary font-body">
            Stephen Houston and David Stuart, <em>The Way Glyph: Evidence for &ldquo;Co-essences&rdquo; among the Classic Maya</em>, Research Reports on Ancient Maya Writing 30 (1989); Stephen Houston, &ldquo;Symbolic Sweatbaths of the Maya,&rdquo; <em>Latin American Antiquity</em> 7 (1996).
          </li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Related:{' '}
          <Link href="/collection/maya" className="text-accent-rust hover:underline">Maya</Link>,{' '}
          <Link href="/collection/maya-decipherment" className="text-accent-rust hover:underline">Decoding the Maya Script</Link>,{' '}
          <Link href="/collection/mesoamerican" className="text-accent-rust hover:underline">Mesoamerican</Link>
        </p>
      </article>
    </ContentPageLayout>
  );
}
