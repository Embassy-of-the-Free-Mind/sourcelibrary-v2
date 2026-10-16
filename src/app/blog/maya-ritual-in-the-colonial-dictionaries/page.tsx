import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

const HEADER_IMAGE = 'https://images.sourcelibrary.org/archived/6acc3d6c230e9a56175ccae2/423.jpg';

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

export const dynamic = 'force-dynamic';

const MOTUL_1 = '6acc3d5f230e9a56175cc731';
const MOTUL_2 = '6acc3d6c230e9a56175ccae2';
const PIO_PEREZ = '6acc3dfa230e9a56175cdd32';
const SANCHEZ = '69f8c1170c0c281d4bd32721';
const KAUA = '6a878ac1d71f2514794f9e40';

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

export default function MayaRitualDictionariesPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Maya Ritual in the Colonial Dictionaries"
          subtitle="Dreaming, transformation, conjuring and the count of days, as the friars and the extirpators wrote them down"
          image={HEADER_IMAGE}
          imageAlt="A leaf of the Spanish–Maya volume of the Diccionario de Motul, entries for Visión to Vmanidad, including Visiones ver como entre sueños: uay"
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

        <p className="text-secondary leading-relaxed mb-6 font-body">
          That pattern runs through the colonial record of Yucatán. The people who wrote to suppress Maya ritual had to name it, and the dictionaries they compiled to preach in Maya recorded its vocabulary along with everything else. Source Library has now read the two volumes of the <em>Diccionario de Motul</em>, Juan Pío Pérez&rsquo;s <em>Diccionario de la lengua maya</em> (1866) and Beltrán&rsquo;s <em>Arte</em> (1859) page by page. This note collects what they, and Sánchez de Aguilar, say about a few ritual words.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          Every Maya and Spanish quotation below is copied from the page image it links to. The English glosses of the Spanish are ours.
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

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Being read now</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          These books were imported this week from Princeton&rsquo;s Garrett-Gates Mesoamerican Manuscripts and the University of Pennsylvania&rsquo;s Berendt-Brinton Collection, and are being read now. They will appear in the library as they are finished:
        </p>

        <ul className="space-y-2 mb-8 list-disc pl-6 font-body text-secondary">
          <li>the <em>Ritual of the Bacabs</em>, the Yucatec healing incantations (Princeton, Garrett-Gates no. 1);</li>
          <li>twenty-six letters of the Caste War leaders, 1848&ndash;50, among them Jacinto Pat and Bonifacio Novelo (Princeton);</li>
          <li>nineteenth-century copies of the books of Chilam Balam of Chumayel, Tizimín, Ixil, Kaua and Calkiní, and the <em>Libro de los Médicos</em>;</li>
          <li>Maya wills and land titles from Ebtún and Chicxulub, 1561&ndash;1869;</li>
          <li>the <em>Títulos</em> of the K&rsquo;iche&rsquo; lords, the manuscript of the Kaqchikel annals, and a Q&rsquo;eqchi&rsquo; divinatory calendar of 1867.</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          One Maya-written counterpart to the friars&rsquo; record is already readable: the <em>Book of Chilam Balam of Kaua</em>, where the twenty day names are set, one by one, against the names of saints (<Leaf book={KAUA} page={11}>p. 11</Leaf>).
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">How these pages were read</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The transcriptions were made by Claude Opus from the page images, with an instruction to keep the colonial letters (ɔ, the barred <em>cħ</em>, doubled consonants) as written. The English translations are machine drafts. On the nineteenth-century Yucatec sermons we found a numeral error of the kind to expect: <em>lahu oxkal catac oxpel</em>, which Beltrán&rsquo;s <em>Arte</em> gives as fifty-three, was translated as the thirty-three the context suggested. Quote the Maya and the Spanish from the page images; treat the English as a guide to them. Corrections are welcome.
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
