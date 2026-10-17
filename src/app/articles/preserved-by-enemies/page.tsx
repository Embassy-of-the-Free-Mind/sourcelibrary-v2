import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';

// Every quotation below is copied from the stored text of the page it links to (#6559): the served English
// translation, or, for Legge's Hippolytus and Harvey's notes, the printed English itself. Each passage the
// argument rests on was read against its page image on 2026-10-15; the Spanish, French and Greek glosses quoted
// from the prints were read off the scans. The images in public/articles/preserved-by-enemies are cut from those scans.

const DIR = '/articles/preserved-by-enemies';
const HERO = `${DIR}/florentine-omen-jaguar.jpg`;
const HERO_ALT =
  'Florentine Codex, Book 5, chapter 1: a spotted jaguar with a speech scroll at its mouth, and a man with a carrying bag who raises his hands to his head. The omen of the beast heard crying in the hills.';

const TITLE = 'Preserved by Their Enemies';
const DESCRIPTION =
  'The books written to stamp out a religion are often the only record of it. Hippolytus and Epiphanius copied the Gnostics they refuted; in Mexico and Yucatán the friars who burned the books wrote down the spells, the omens and the alphabet.';

export const metadata: Metadata = withArticleMeta('preserved-by-enemies', {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/articles/preserved-by-enemies' },
});

const BOOK = {
  hippolytus1: '/book/refutation-of-all-heresies-vol-1-rome',
  hippolytus2: '/book/refutation-of-all-heresies-vol-2-rome',
  irenaeus: '/book/sancti-irenaei-adversus-haereses-ed',
  epiphanius: '/book/epiphanius-epiphanius',
  landa: '/book/relation-des-choses-de-yucatan-de-diego-de-landa-bilingual-bourbourg',
  florentine: '/book/florentine-codex-vol-1-books-1-5',
  sermonario: '/book/a-iesu-christo-sn-ofrece-este-sermonario-en-lengua-mexicana-fray-juan',
  paredes: '/book/promptuario-manual-mexicano-que-a-la-verdad-podra-ser-utilissimo-a-los',
  motul1: '/book/diccionario-de-motul-maya-espanol-vol-1-antonio-de-ciudad-real',
  motul2: '/book/diccionario-de-motul-maya-espanol-vol-2-antonio-de-ciudad-real',
  kaua: '/book/libro-de-chilam-balam-de-kaua-scribes',
  kauaMaler: '/book/chilam-balam-de-kaua-maler-photographs-1887',
};

// The reader route takes a page id, not a page number (quote-and-snippet-integrity.md).
const PAGE = {
  legge11: `${BOOK.hippolytus1}/page/69ac9bb999d9a0170d090d29`,
  legge13: `${BOOK.hippolytus1}/page/69ac9bb999d9a0170d090d2b`,
  naassene154: `${BOOK.hippolytus1}/page/69ac9bb999d9a0170d090db8`,
  naassene155: `${BOOK.hippolytus1}/page/69ac9bb999d9a0170d090db9`,
  simon14: `${BOOK.hippolytus2}/page/69ac9bbf99d9a0170d090e02`,
  irenaeus205: `${BOOK.irenaeus}/page/69920bf777b798aa12121bc9`,
  irenaeus209: `${BOOK.irenaeus}/page/69920bf777b798aa12121bcd`,
  flora465: `${BOOK.epiphanius}/page/6a3f035697e91e1768f6a286`,
  landa14: `${BOOK.landa}/page/69f8c0f74c6a515115aedaeb`,
  landa19: `${BOOK.landa}/page/69f8c0f74c6a515115aedaf0`,
  landa439: `${BOOK.landa}/page/69f8c0f74c6a515115aedc94`,
  landa443: `${BOOK.landa}/page/69f8c0f74c6a515115aedc98`,
  sahagun14: `${BOOK.florentine}/page/69dfeba8090ad7d5c33b0f44`,
  sahagun124: `${BOOK.florentine}/page/69dfeba8090ad7d5c33b0fb2`,
  sahagun675: `${BOOK.florentine}/page/69dfeba8090ad7d5c33b11d9`,
  sahagun677: `${BOOK.florentine}/page/69dfeba8090ad7d5c33b11db`,
  sermonario77: `${BOOK.sermonario}/page/6acc3c2877e6be3481e74756`,
  sermonario78: `${BOOK.sermonario}/page/6acc3c2877e6be3481e74757`,
  paredes84: `${BOOK.paredes}/page/6acc3ae6c1411f8cc628f539`,
  paredes181: `${BOOK.paredes}/page/6acc3ae6c1411f8cc628f59a`,
  motul1_31: `${BOOK.motul1}/page/6acc3d60230e9a56175cc750`,
  motul1_47: `${BOOK.motul1}/page/6acc3d60230e9a56175cc760`,
  motul1_48: `${BOOK.motul1}/page/6acc3d60230e9a56175cc761`,
  motul1_56: `${BOOK.motul1}/page/6acc3d60230e9a56175cc769`,
  motul2_236: `${BOOK.motul2}/page/6acc3d6d230e9a56175ccbce`,
  motul2_237: `${BOOK.motul2}/page/6acc3d6d230e9a56175ccbcf`,
  kaua13: `${BOOK.kaua}/page/6a87102131598d129803de88`,
  kaua20: `${BOOK.kaua}/page/6a87102131598d129803de8f`,
  kaua42: `${BOOK.kaua}/page/6a87102131598d129803dea5`,
  maler241: `${BOOK.kauaMaler}/page/6a879ba86f4a03d5d89ad5a9`,
};

const EXT = {
  landaBritannica: 'https://www.britannica.com/biography/Diego-de-Landa',
  knorozov: 'https://exhibits.lib.unc.edu/exhibits/show/maya/decipherment/sistema-pisma-drevnikh-maiia',
  florentine1577:
    'https://biblat.unam.mx/pt/revista/historia-y-espacio/articulo/el-manuscrito-andante-las-misteriosas-vicisitudes-del-codice-florentino-entre-mexico-e-italia-1577-1587',
  augurios: 'https://www.mesoweb.com/es/articulos/sub/Augurios.pdf',
  ruizDeAlarcon: 'https://www.oupress.com/9780806160405/guardians-of-idolatry',
  nagHammadi: 'https://www.biblicalarchaeology.org/daily/the-nag-hammadi-codices/',
  experiment:
    'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/scripts/eval/experiments/2026-10-13-opus-vs-flash-translation-nahuatl-6559.md',
};

const linkClass = 'text-accent-rust hover:underline';
const p = 'text-secondary leading-relaxed mb-6 font-body';
const h2 = 'text-2xl md:text-3xl text-primary mt-16 mb-6';

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className={linkClass} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Quote({ href, cite, children }: { href: string; cite: React.ReactNode; children: React.ReactNode }) {
  return (
    <blockquote className="border-l-2 border-accent-rust/30 pl-6 my-8">
      <div className="text-secondary leading-relaxed italic font-body">{children}</div>
      <p className="text-xs text-muted mt-2 not-italic">
        <Link href={href} className={linkClass}>
          {cite} &rarr;
        </Link>
      </p>
    </blockquote>
  );
}

function Figure({ src, alt, children }: { src: string; alt: string; children: React.ReactNode }) {
  return (
    <figure className="my-10">
      <img src={src} alt={alt} className="w-full rounded-lg border border-stone-200" />
      <figcaption className="text-sm text-muted mt-3 leading-relaxed">{children}</figcaption>
    </figure>
  );
}

export default function PreservedByEnemiesPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="How the books written to destroy a tradition became the record of it"
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">16 October 2026 &middot; 12 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          In July 1562, at Maní in Yucatán, the Franciscan Diego de Landa held an auto-da-fé. Maya images were smashed and
          Maya books were burned (
          <Ext href={EXT.landaBritannica}>Britannica</Ext>). A few years later, writing his account of the Maya in Spain, he
          described it in one sentence:
        </p>

        <Quote href={PAGE.landa439} cite={<>Diego de Landa, <em>Relación de las cosas de Yucatán</em>, ed. Brasseur de Bourbourg (1864), p. 316</>}>
          &ldquo;We found a great number of books of these letters of theirs, and because they contained nothing that did not
          have superstition and falsehoods of the devil, we burned them all&rdquo;
        </Quote>

        <p className={p}>
          The Spanish goes on: <em>lo qual a maravilla sentian, y les dava pena</em>, which they felt to an extraordinary
          degree, and it grieved them. The next sentence on the same page begins: &ldquo;Of their letters, I will place here
          an a, b, c&rdquo;. Four pages later, under the heading <em>Siguese su a b c</em>, Landa&rsquo;s book prints
          twenty-seven Maya signs, each beside the Spanish letter it was supposed to stand for.
        </p>

        <Figure src={`${DIR}/landa-abc-1864.jpg`} alt="Landa’s a b c: twenty-seven Maya signs in three columns, each with a Spanish letter or syllable beside it.">
          &ldquo;Siguese su a b c&rdquo;: Landa&rsquo;s signs as Brasseur printed them in 1864 (
          <Link href={PAGE.landa443} className={linkClass}>read the page</Link>). Brasseur copied them from a manuscript in
          Madrid that he describes as a later copy, not Landa&rsquo;s original (
          <Link href={PAGE.landa14} className={linkClass}>his note</Link>).
        </Figure>

        <p className={p}>
          The man who burned the books also kept the only key to them that survived the century. Brasseur, the French
          priest who found and published the manuscript, saw that at once. Landa, he wrote, &ldquo;rendered an immense service
          to historical sciences by compiling the precious information that follows, and by preserving for us the characters
          of the Maya alphabet&rdquo;; the book &ldquo;is the key to American inscriptions&rdquo; (
          <Link href={PAGE.landa19} className={linkClass}>Brasseur&rsquo;s introduction</Link>). It was not an alphabet. The
          key turned only in 1952, when the Soviet linguist Yuri Knorozov argued that Landa&rsquo;s informant had written
          syllables: asked for the letter <em>b</em>, pronounced <em>be</em>, he wrote the sign for the syllable <em>be</em>{' '}
          (<Ext href={EXT.knorozov}>University of North Carolina Libraries</Ext>). That reading opened the Maya script.
        </p>

        <p className={p}>
          This is a pattern, and it is older than Yucatán. A tradition is attacked in writing; the attacker, to refute it,
          has to quote it; the tradition&rsquo;s own books are lost; and the refutation survives because it was orthodox,
          and so was copied. The enemy becomes the archive. The pattern is clear in the early Church. In New Spain it is
          stronger, and it is also where the comparison stops working.
        </p>

        <h2 className={h2}>&ldquo;Sealed up, hidden, concealed&rdquo;</h2>

        <p className={p}>
          Around 225, Hippolytus of Rome wrote a <em>Refutation of All Heresies</em>. Most of it was itself lost until the
          1840s, when a Greek scholar sent by the French government to the monasteries of Mount Athos came back with a
          manuscript of seven of its ten books (
          <Link href={PAGE.legge11} className={linkClass}>Legge&rsquo;s introduction</Link>). Its value, wrote its English
          translator F. Legge in 1921, is the Gnostic writing it quotes, &ldquo;of which well-nigh the whole has been lost to
          us&rdquo; (<Link href={PAGE.legge13} className={linkClass}>p. 3</Link>).
        </p>

        <p className={p}>
          One of those quotations is a hymn of the sect Hippolytus calls the Naassenes. He introduces it with contempt:
          &ldquo;This psalm has been concocted by them, whereby they seem to hymn all the mysteries of their error&rdquo; (
          <Link href={PAGE.naassene154} className={linkClass}>p. 144</Link>). Then he copies it out. It ends with Jesus asking
          the Father to send him down to the soul lost in chaos:
        </p>

        <Quote href={PAGE.naassene155} cite={<>Hippolytus, <em>Refutation</em> V, trans. F. Legge (1921), vol. 1, p. 145</>}>
          &ldquo;Holding seals I will go down,
          <br />
          Through entire æons I will pass,
          <br />
          All mysteries I will disclose;
          <br />
          The forms of the gods I will display;
          <br />
          The secrets of the holy way
          <br />
          Called Gnosis, I will hand down.&rdquo;
        </Quote>

        <p className={p}>
          In the next book Hippolytus turns to Simon Magus, accuses him of &ldquo;stupidly and clumsily garbling the Law of
          Moses&rdquo;, and quotes the opening of a book attributed to him, the <em>Great Announcement</em>:
        </p>

        <Quote href={PAGE.simon14} cite={<>Hippolytus, <em>Refutation</em> VI, trans. F. Legge (1921), vol. 2, p. 4</>}>
          &ldquo;This is the writing of the Announcement of Voice and Name from the Thought of the great power of the
          Boundless One. Wherefore it will be sealed up, hidden, concealed and will be in the dwelling-place where the root
          of the universals is founded.&rdquo;
        </Quote>

        <p className={p}>
          A book that announces its own concealment survives in the pages of the man who wrote to expose it. (The English
          here is Legge&rsquo;s printed translation, not ours.)
        </p>

        <p className={p}>
          Hippolytus was not the first. Irenaeus of Lyon, about 180, explains in his preface why a bishop should spend a
          book on doctrines he despises: &ldquo;I have deemed it necessary, after reading the commentaries of the disciples
          of Valentinus, as they themselves call them, and having even met with some of them and grasped their way of
          thinking, to reveal to you, most beloved, the monstrous and profound mysteries&rdquo; (
          <Link href={PAGE.irenaeus205} className={linkClass}>Harvey&rsquo;s edition, 1857</Link>). His first chapter then
          sets out the Valentinian system from its first principle:
        </p>

        <Quote href={PAGE.irenaeus209} cite={<>Irenaeus, <em>Against Heresies</em> I.1.1, ed. W. W. Harvey (1857), p. 8</>}>
          &ldquo;They say that there is a certain perfect Æon, who existed before, in invisible and ineffable heights. Him they
          call Proarche, and Propator, and Bythos&rdquo;
        </Quote>

        <p className={p}>
          The chain goes one link further. Irenaeus&rsquo;s own Greek is lost; his work survives whole only in an old Latin
          translation. For this chapter, Harvey notes at the foot of the same page, &ldquo;Epiphanius in his work upon the
          heresies has preserved to us the Greek text&rdquo;. The refuter of the Valentinians is himself preserved by a later
          refuter.
        </p>

        <p className={p}>
          That later refuter, Epiphanius of Salamis, writing in the 370s, did the most generous thing a heresiologist ever
          did. Before attacking Ptolemy, a disciple of Valentinus, he copied out one of Ptolemy&rsquo;s letters entire, and
          said why:
        </p>

        <Quote href={PAGE.flora465} cite={<>Epiphanius, <em>Panarion</em> 33.3, ed. K. Holl (1915), p. 450</>}>
          &ldquo;For a more abundant refutation of the deceiver, I will set down in order and present the persuasive and
          poisonous words written by Ptolemy himself to a certain woman named Flora. This is so no one thinks we refute the
          deceiver based only on hearsay, without having first encountered his distorted teaching.&rdquo;
        </Quote>

        <p className={p}>
          The letter follows, beginning &ldquo;My good sister Flora, since not many have understood the law established
          through Moses&rdquo;. No other copy of it is known. It exists because a bishop wanted no one to say he had
          argued against a rumour.
        </p>

        <h2 className={h2}>The physician must know the disease</h2>

        <p className={p}>
          In New Spain the same logic ran under a new metaphor. Bernardino de Sahagún opens the twelve books of what is now
          called the Florentine Codex with it:
        </p>

        <Quote href={PAGE.sahagun14} cite={<>Bernardino de Sahagún, Prologue to Book 1, Florentine Codex (1577)</>}>
          &ldquo;A physician cannot properly apply medicines to a patient without first knowing from what humor or cause the
          illness proceeds. &hellip; Preachers and confessors are physicians of the souls, tasked with curing spiritual
          diseases.&rdquo;
        </Quote>

        <p className={p}>
          The disease is idolatry, and Sahagún says it is not over: &ldquo;The sins of idolatry, rites, superstitious
          idolatrous omens, abuses, and idolatrous ceremonies have not yet been entirely lost.&rdquo; Worse, the clergy
          cannot see it: &ldquo;Because of a lack of this knowledge, many idolatrous things happen in my presence without the
          ministers understanding them.&rdquo; So the friar sets out to record everything, in Nahuatl and Spanish side by side.
        </p>

        <p className={p}>
          The fifth book, on omens, carries the metaphor through. The omens are there &ldquo;so that when they are wounded by
          this sore, they may go to seek medicine, and the physician may easily understand them&rdquo; (
          <Link href={PAGE.sahagun675} className={linkClass}>prologue to Book 5</Link>). Then the book lets the diviner speak.
          A man has heard a wild beast howling at night (the painting at the head of this essay opens the chapter) and goes
          to the <em>tonalpouhqui</em>, the reader of the day-count,
          who tells him what it means and on what authority: &ldquo;And this is not because I say it: but because my elders
          and ancestors left it said and written.&rdquo; In the Nahuatl column the diviner points to his source: &ldquo;Listen
          to the word, for it is marked in the tonalamatl&rdquo;, the book of days (
          <Link href={PAGE.sahagun677} className={linkClass}>Book 5, ch. 1</Link>). The books of the kind Landa burned are
          cited by name, inside the book written to root them out.
        </p>

        <p className={p}>
          That book nearly went the same way. A royal decree of Philip II, dated 22 April 1577, ordered Sahagún&rsquo;s work
          collected because it contained the rites, ceremonies and idolatries of the Indians, and forbade anyone to write
          about their superstitions and way of life (Alfredo López Austin,{' '}
          <Ext href={EXT.augurios}><em>Augurios y abusiones</em></Ext>, UNAM). The manuscript in our scans went to Spain and
          then to the Medici, and it is now in the Biblioteca Laurenziana in Florence (
          <Ext href={EXT.florentine1577}>Historia y Espacio</Ext>).
        </p>

        <p className={p}>
          The sermon books show the same disease being charted in print. Fray Juan Bautista&rsquo;s Nahuatl{' '}
          <em>Sermonario</em> of 1606 preaches on the first Sunday of Advent, &ldquo;let us put on the armor of light&rdquo;.
          He imagines his listeners objecting that &ldquo;idolatry has already left, has already perished, and demon-worship
          scarcely shows its footprints anymore&rdquo;, and answers: &ldquo;Behold, listen, my children: there are still some
          who lead people astray, who still live in doubt&rdquo; (
          <Link href={PAGE.sermonario77} className={linkClass}>p. 17</Link>). A list follows, and the printer set a Spanish
          gloss after each Nahuatl word, so that the preacher reading it would know exactly whom he was naming:
        </p>

        <Figure
          src={`${DIR}/sermonario-1606-p78.jpg`}
          alt="A page of Nahuatl sermon text with italic Spanish glosses in parentheses after the names of different kinds of sorcerer."
        >
          Juan Bautista, <em>Sermonario en lengua mexicana</em> (Mexico, 1606), p. 18 (
          <Link href={PAGE.sermonario78} className={linkClass}>read the page</Link>). The italic Spanish glosses the Nahuatl:{' '}
          <em>tlaciuhque</em>, &ldquo;hechizeros astrologos&rdquo;; <em>atlan teitta</em>, &ldquo;hechizeros que adiuinan por
          el agua&rdquo;, sorcerers who divine by water; <em>tequaquamana</em>, who call themselves{' '}
          <em>moyohualihtohua</em>, &ldquo;Hechizeros, o encantadores que de noche se mostrauan en diuersas formas. s. Tigre,
          Gato, Raposo, Comadreja&rdquo;, sorcerers or enchanters who showed themselves at night in various forms: jaguar,
          cat, fox, weasel.
        </Figure>

        <p className={p}>
          The list runs to seven kinds of specialist across the two pages: day-count diviners, those who claim to draw stones
          out of the body, those who revive the frightened and fainting, those who give medicines to barren women, star-readers,
          water-gazers, night shape-changers. A sermon meant to make them disappear is, page for page, a
          record of who they were.
        </p>

        <p className={p}>
          A century and a half later they had not disappeared. Ignacio de Paredes&rsquo;s <em>Promptuario manual
          mexicano</em> (1759), a book of ready-made sermons for parish priests, still warns that God is offended by
          &ldquo;whoever goes about consulting, goes about seeking out, goes about testing&rdquo; the sorcerers and &ldquo;the
          shapeshifters Nanahualtin&rdquo;; the Spanish in the margin of the print says it plainly, <em>Hechizeros,
          Nahuales</em> (
          <Link href={PAGE.paredes181} className={linkClass}>read the page</Link>). And it tells its hearers what to do if someone
          shows them a god: &ldquo;And do not be afraid of it in any way, do not fear it&rdquo; (
          <Link href={PAGE.paredes84} className={linkClass}>read the page</Link>). More than two centuries after the conquest, a preacher
          still had to tell people not to be afraid of the old gods.
        </p>

        <p className={p}>
          Some of these records are less a sermon than a census. Hernando Ruiz de Alarcón&rsquo;s <em>Treatise on the
          Heathen Superstitions</em> (1629) recorded the incantations Nahua healers and farmers used, in Nahuatl with a
          Spanish translation, to help the Church abolish them (<Ext href={EXT.ruizDeAlarcon}>University of Oklahoma Press</Ext>). We do not yet hold it; it stayed in
          manuscript until 1892.
        </p>

        <p className={p}>
          The Franciscans in Yucatán made the same kind of record without the sermon. The great Maya&ndash;Spanish
          dictionary compiled at Motul, probably by Antonio de Ciudad Real in the late sixteenth century, defines the vocabulary of
          Maya religion the way it defines the vocabulary of farming, flatly. Under <em>ah kin</em>: &ldquo;a priest&rdquo;.
          A few entries later, <em>ah kinyah</em>: &ldquo;a sorcerer who casts lots with superstition&rdquo; (
          <Link href={PAGE.motul1_47} className={linkClass}>vol. 1, f. 20</Link>). <em>Ah cunal can, ceh, balam</em>:
          &ldquo;a charmer or sorcerer who charms snakes, deer, jaguars, and so on&rdquo; (
          <Link href={PAGE.motul1_31} className={linkClass}>vol. 1</Link>). <em>Ah ohel tukinam xiuob</em>, &ldquo;an
          herbalist&rdquo;, one who knows the power of plants (
          <Link href={PAGE.motul1_56} className={linkClass}>vol. 1</Link>). In the Spanish&ndash;Maya volume, under{' '}
          <em>hechizar</em> and <em>hechizero</em>, to bewitch and sorcerer, the Maya is <em>pulyah</em>, and
          &ldquo;Bewitched: pulaan yaah yokol&rdquo; (
          <Link href={PAGE.motul2_236} className={linkClass}>vol. 2</Link>). Those words will come back.
        </p>

        <h2 className={h2}>Where the parallel breaks</h2>

        <p className={p}>
          Hippolytus and Sahagún did the same thing for the same reason. But the Mesoamerican record differs from the Greek
          one in four ways, and each matters for how you read it.
        </p>

        <p className={p}>
          <strong>It was not written by the enemy alone.</strong> Hippolytus worked from books and, Legge suspected, from
          what a convert told him (<Link href={PAGE.naassene155} className={linkClass}>Legge&rsquo;s note</Link>). Sahagún worked with a team, and named it. In the prologue to Book 2 he lists the elders chosen
          by the town governments and the college students who checked and rewrote everything with him; among them &ldquo;the
          principal and most wise was Antonio Valeriano, a resident of Azcapotzalco&rdquo;, with Alonso Vegerano, Martín
          Jacobita and Pedro de San Buenaventura, &ldquo;all experts in three languages&rdquo;, Latin, Spanish and Nahuatl (
          <Link href={PAGE.sahagun124} className={linkClass}>Book 2, prologue</Link>). The Nahuatl column of the Florentine
          Codex is, in large part, Nahua writing.
        </p>

        <p className={p}>
          <strong>It keeps the original language.</strong> Irenaeus summarised the Valentinians in his own Greek; Epiphanius
          copied one letter. The friars needed the words themselves, because they had to preach and hear confession in them.
          So the <em>Sermonario</em> prints the Nahuatl names, Paredes prints <em>Nanahualtin</em>, and the Motul dictionary
          records the exact Maya term for each kind of specialist. A reader today can go behind the friar&rsquo;s gloss to the
          word he was glossing.
        </p>

        <p className={p}>
          <strong>The categories are the friars&rsquo;.</strong> Every one of these words reaches us sorted under
          <em> hechizero</em>, sorcerer, the category of a Spanish confessor. Sometimes the sorting shows. The Motul dictionary
          defines <em>ah koh keuel</em> as &ldquo;a sorcerer or wizard who dressed in the skins of jaguars and frightened people
          in order to rob them&rdquo; (
          <Link href={PAGE.motul1_48} className={linkClass}>vol. 1</Link>). A man in a jaguar skin may have been a robber, or a
          dancer, or a priest in regalia whose purpose the lexicographer did not know or did not record. The word is
          recorded exactly; the explanation attached to it is the friar&rsquo;s. The Spanish&ndash;Maya volume shows the
          filing from the other side: the one Spanish word <em>hechicero</em> is answered with three Maya ones,
          &ldquo;Sorcerer: tutuz nac: ahcunyah: ahpulyaah&rdquo; (
          <Link href={PAGE.motul2_237} className={linkClass}>vol. 2, f. 127</Link>). Three Maya words, one
          Spanish category.
        </p>

        <p className={p}>
          <strong>There is a check.</strong> For the Gnostics, the check arrived late. Legge, in 1921, could write that apart
          from patristic quotations &ldquo;the only extant Gnostic works are the Coptic collection in the British Museum and
          the Bodleian at Oxford, known as the Pistis Sophia and the Bruce Papyrus respectively&rdquo; (
          <Link href={PAGE.legge13} className={linkClass}>p. 3, note 1</Link>). Twenty-four years later, in 1945, farmers near
          Nag Hammadi in Upper Egypt dug up a jar of papyrus codices holding more than fifty treatises, most of them Gnostic,
          and the heretics could at last be read in their own words (
          <Ext href={EXT.nagHammadi}>Biblical Archaeology Society</Ext>).
        </p>

        <p className={p}>
          For the Maya the check was never buried. After the conquest, Maya scribes learned the Latin alphabet from the friars
          and used it to write their own books, the books of Chilam Balam, copied and recopied in towns across Yucatán into
          the nineteenth century. We hold two copies of the book from Kaua. They are Maya writing for Maya readers, and they
          keep what the dictionaries filed under sorcery.
        </p>

        <Figure
          src={`${DIR}/kaua-wheel.jpg`}
          alt="A hand-drawn wheel: the twenty Maya day names around the rim, faces between them, a cross at the top marked lakin (east), and numbered kings in the centre around the Spanish word mundo."
        >
          A day-wheel in the Book of Chilam Balam of Kaua (
          <Link href={PAGE.kaua42} className={linkClass}>read the page</Link>). The twenty Maya day names run round the rim,
          with <em>lakin</em>, east, under a cross at the top; in the middle, Spanish words, <em>Rey</em> (king) and{' '}
          <em>Mũdo</em> (world).
        </Figure>

        <p className={p}>
          The Kaua book carries a year-count that runs Christian years beside Maya ones. The line for 1810, read off the page,
          gives 7 Ahau, the day 9 Ik, the 2nd of the month Kankin (
          <Link href={PAGE.kaua13} className={linkClass}>read the page</Link>). It prescribes remedies by plant, and gives
          them a lineage the friars never would: a bath of gumbo-limbo (<em>chacah</em>), the scribe writes, &ldquo;has been
          used since ancient times to stop the pain and the aching of the body&rdquo; (
          <Link href={PAGE.kaua20} className={linkClass}>p. 5</Link>). In the copy Teobert Maler photographed, one remedy is headed &ldquo;For the cure of the lower-body sickness sent by sorcery&rdquo;: in the Maya,{' '}
          <em>pulbil yah</em> (<Link href={PAGE.maler241} className={linkClass}>read the page</Link>). It is built on the word
          the Motul dictionary gave for bewitching. In the dictionary it names a sin to be confessed. In the Kaua book it names a
          sickness that has a cure.
        </p>

        <h2 className={h2}>Reading the enemy&rsquo;s archive</h2>

        <p className={p}>
          None of this redeems the burning. Landa&rsquo;s a b c is one page against an unknown number of books, and the
          Florentine Codex exists because its author was racing a policy that wanted the old ways erased. But the readers
          who come to these books now come for what their authors tried to destroy, and the books reward them, on two
          conditions. Read the original words, not the friar&rsquo;s category for them. And find the other witness: Nag
          Hammadi for the Gnostics, the Chilam Balam books for the Maya, the Nahuatl column beside the Spanish one.
        </p>

        <p className={p}>
          Every passage quoted here links to its page, with the scan beside the transcription and the translation, so you
          can do both.
        </p>

        <hr className="my-12 border-stone-200" />

        <p className="text-sm text-muted leading-relaxed mb-6">
          <strong>About the English.</strong> Except for Legge&rsquo;s Hippolytus and Harvey&rsquo;s notes, which are printed
          English, the English quoted here is machine translation from the original pages, and no scholar has reviewed it.
          For the two Nahuatl sermon books, an AI judge compared the translation with the page image on 20 pages (pp. 60&ndash;69
          of each, 13 October 2026) and scored it 4.1 of 5 for fidelity. It flagged about one mistranslated phrase per page and
          one omitted phrase every two pages; that judge comes from the same model family as the translator (
          <Ext href={EXT.experiment}>experiment record</Ext>). The Motul dictionary was translated by Claude Opus; single pages
          were checked against the scans, but no error rate has been measured. The other books have no measured rate yet. For this essay, every passage the argument rests on was read against its page image, and the Spanish, French
          and Greek of the prints was read off the scans. If you find an error on any page, the feedback button on that page
          reaches us.
        </p>

        <p className="text-sm text-muted uppercase tracking-wider mb-4">Primary sources in the library</p>
        <ul className="space-y-2 mb-8">
          <li className="text-secondary font-body">
            Hippolytus, <em>Philosophumena, or the Refutation of All Heresies</em>, trans. F. Legge (1921):{' '}
            <Link href={BOOK.hippolytus1} className={linkClass}>vol. 1</Link>,{' '}
            <Link href={BOOK.hippolytus2} className={linkClass}>vol. 2</Link>.
          </li>
          <li className="text-secondary font-body">
            <Link href={BOOK.irenaeus} className={linkClass}>
              Irenaeus, <em>Adversus haereses</em>, ed. W. Wigan Harvey (Cambridge, 1857)
            </Link>
            , Latin with the surviving Greek.
          </li>
          <li className="text-secondary font-body">
            <Link href={BOOK.epiphanius} className={linkClass}>
              Epiphanius, <em>Ancoratus</em> and <em>Panarion</em> 1&ndash;33, ed. Karl Holl (Leipzig, 1915)
            </Link>
            , with Ptolemy&rsquo;s <em>Letter to Flora</em>.
          </li>
          <li className="text-secondary font-body">
            <Link href={BOOK.landa} className={linkClass}>
              Diego de Landa, <em>Relation des choses de Yucatan</em>, Spanish and French, ed. Brasseur de Bourbourg (Paris,
              1864)
            </Link>
            .
          </li>
          <li className="text-secondary font-body">
            <Link href={BOOK.florentine} className={linkClass}>
              Bernardino de Sahagún, Florentine Codex, vol. 1 (Books 1&ndash;5)
            </Link>
            .
          </li>
          <li className="text-secondary font-body">
            <Link href={BOOK.sermonario} className={linkClass}>
              Juan Bautista, <em>Sermonario en lengua mexicana</em> (Mexico, 1606)
            </Link>
            ;{' '}
            <Link href={BOOK.paredes} className={linkClass}>
              Ignacio de Paredes, <em>Promptuario manual mexicano</em> (Mexico, 1759)
            </Link>
            .
          </li>
          <li className="text-secondary font-body">
            <em>Diccionario de Motul</em>, Maya&ndash;Spanish:{' '}
            <Link href={BOOK.motul1} className={linkClass}>vol. 1</Link>,{' '}
            <Link href={BOOK.motul2} className={linkClass}>vol. 2</Link>.
          </li>
          <li className="text-secondary font-body">
            Book of Chilam Balam of Kaua:{' '}
            <Link href={BOOK.kaua} className={linkClass}>manuscript copy</Link>,{' '}
            <Link href={BOOK.kauaMaler} className={linkClass}>Teobert Maler&rsquo;s photographs</Link>.
          </li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Related:{' '}
          <Link href="/articles/indigenous-traditions" className={linkClass}>Indigenous traditions</Link>,{' '}
          <Link href="/collections/maya" className={linkClass}>Maya</Link>,{' '}
          <Link href="/collections/aztec-nahua" className={linkClass}>Aztec and Nahua</Link>,{' '}
          <Link href="/collections/mesoamerican" className={linkClass}>Mesoamerican</Link>
        </p>
      </article>
    </ContentPageLayout>
  );
}
