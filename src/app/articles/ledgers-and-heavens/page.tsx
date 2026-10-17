import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import SourceQuote from '@/components/articles/SourceQuote';
import PageFigure from '@/components/articles/PageFigure';
import MoneyTimeline from './MoneyTimeline';

// Every quotation from a Source Library book is copied from the stored text of the page it links to,
// fetched through the get_quote tool on 2026-10-17. The hero woodcut was checked by eye on our scan.
// Claims from outside the library link to their source.

const TITLE = 'Ledgers and Heavens';
const DESCRIPTION =
  'What the money-men paid for and read: Cosimo de’ Medici’s Hermes, Pacioli’s two proportions, Copernicus on coinage, a Rosicrucian debate on abolishing gold, a London merchant’s theory of metals, and a financier’s chair of music.';
const HERO = 'https://images.sourcelibrary.org/archived/69de988c1b234a773e438b33/248.jpg';
const HERO_ALT =
  'Woodcut of a hollow dodecahedron, its twelve pentagonal faces drawn as open frames, labelled "Dodecaedron Planum Vacuum", from Luca Pacioli’s De divina proportione, Venice, 1509.';

export const metadata: Metadata = withArticleMeta('ledgers-and-heavens', {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/articles/ledgers-and-heavens' },
});

const BOOK = {
  plotinus: '/book/enneads-1580-greek-latin-ficino-trans-plotinus-ficino',
  pimander: '/book/corpus-hermeticum-pimander-1481-venice-edition-hermes-trismegistus',
  summa: '/book/summa-de-arithmetica-geometria-proportioni-et-proportionalit',
  geijsbeek: '/book/ancient-double-entry-bookkeeping-lucas-pacioli-s-treatise-tr',
  divina: '/book/de-divina-proportione-illust',
  wolowski: '/book/traictie-de-la-premiere-invention-des-monnoies-de-nicole-ed',
  fama: '/book/fama-fraternitatis-oder-entdeckung-der-brudersch-des-ordens-fraternitatis',
  canker: '/book/the-canker-of-england-s-common-wealth-malynes',
  misselden: '/book/the-circle-of-commerce-misselden',
  hartlib: '/book/chymical-medicinal-and-chyrurgical-addresses-made-to-samuel-hartlib',
  quesnay: '/book/economic-table-tableau-oeconomique-quesnay',
};

// Page images (images.sourcelibrary.org/archived/<bookId>/<page>.jpg), each checked by eye on 2026-10-18.
const IMG = (bookId: string, page: number) => `https://images.sourcelibrary.org/archived/${bookId}/${page}.jpg`;
const ID = {
  pimander: '694f3d6cbe37f451a5324e10',
  geijsbeek: '6991e7e6c91ce7d733e50247',
  divina: '69de988c1b234a773e438b33',
  wolowski: '69af5923522dc3dfdf725739',
  fama: '69b51e639a81ef7feb3d4592',
  misselden: '6a8f6267ddd2f57fe0f81f3b',
  hartlib: '6ab5a4019e89e2a1f4139282',
  quesnay: '69568b13be7c607c5f03d575',
};

const PAGE = {
  divina24: `${BOOK.divina}?page=24`,
};

const Q = {
  misselden7: '/q/BnEPM4oI7IkqhzBgYb9',
};

const EXT = {
  greshamCollege: 'https://en.wikipedia.org/wiki/Gresham_College',
  greshamMusic: 'https://en.wikipedia.org/wiki/Gresham_Professor_of_Music',
  malynes: 'https://en.wikipedia.org/wiki/Gerard_de_Malynes',
};

const p = 'text-secondary leading-relaxed mb-6 font-body';
const h2 = 'text-2xl md:text-3xl text-primary mt-16 mb-6';

// The pages here are all tall and narrow; at full column width one page fills the screen.
function Fig(props: React.ComponentProps<typeof PageFigure>) {
  return (
    <div className="mx-auto max-w-lg">
      <PageFigure {...props} />
    </div>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export default function LedgersAndHeavensPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="What bankers, merchants and mint reformers paid for and read"
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">17 October 2026 &middot; 11 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          <Link href="/articles/harmonic-justice">
            Harmonic Justice
          </Link>{' '}
          followed philosophers who treated money as a problem of proportion. This note goes the other way round. It
          follows the people who handled money for a living (a banker, a friar who taught merchants, a mint reformer, a
          London exchange dealer, a financier) and asks what they paid for and what they read. Again and again the answer
          is the heavens.
        </p>

        <h2 className={h2}>The banker who put Hermes first</h2>

        <p className={p}>
          In the 1430s the Medici bank was the largest in Europe, and Cosimo de&apos; Medici, who ran it, was the first
          citizen of Florence. When the Council of Florence brought Greek scholars to the city in 1439, Cosimo heard the
          Byzantine philosopher Gemistus Pletho lecture on Plato and conceived the idea of a Platonic academy. Twenty-four
          years later he gave the work to a young protégé, Marsilio Ficino. Ficino tells the story in the preface to his{' '}
          <Link href={BOOK.plotinus}>Plotinus</Link>, and the order of the commission is the surprising part:
        </p>

        <SourceQuote
          book="enneads-1580-greek-latin-ficino-trans-plotinus-ficino"
          page={8}
          src="https://images.sourcelibrary.org/archived/6952c9c777f38f6761bc2ffd/8.jpg"
          pageAlt="The first page of Ficino's preface to his Latin Plotinus, Basel 1580, opening with a large woodcut initial M."
          source="Marsilio Ficino, preface to his Latin Plotinus (Basel, 1580 edition)"
        >
          After this, in the year 1463, when I was thirty years old, he commissioned me to translate first Hermes
          Trismegistus and soon after, Plato. I completed Hermes in a few months while he was still living; I then also
          began Plato.
        </SourceQuote>

        <p className={p}>
          The richest banker in Europe, near the end of his life, wanted the Hermetic books before the dialogues of Plato.
          Ficino&apos;s Latin <em>Pimander</em>, dedicated &ldquo;to Cosimo de&apos; Medici, father of his country,&rdquo;
          became one of the most reprinted philosophical books of the Renaissance. The library holds the{' '}
          <Link href={BOOK.pimander}>
            Venice edition of 1481
          </Link>
          .
        </p>

        <Fig
          src={IMG(ID.pimander, 12)}
          alt="A printed page of Ficino's Latin dedication to Cosimo in the 1481 Venice Pimander, in a roman type with colons as punctuation."
          href={`${BOOK.pimander}?page=12`}
          source={<><em>Mercurii Trismegisti Pimander</em> (Venice, 1481)</>}
        >
          From Ficino&apos;s dedication: urged on by Cosimo, he decided to turn the book from Greek into Latin and thought
          it right to dedicate it to him (&ldquo;Cosme felix, ut nomini tuo opusculum dedicarem&rdquo;).
        </Fig>

        <h2 className={h2}>Pacioli&apos;s two proportions</h2>

        <p className={p}>
          Luca Pacioli was a Franciscan friar and a teacher of mathematics to merchants&apos; sons. In 1494 he printed a
          vast <Link href={BOOK.summa}><em>Summa</em> of arithmetic, geometry, proportion and
          proportionality</Link>. Tucked inside it is a short treatise that became famous on its own: the first printed
          account of double-entry bookkeeping, &ldquo;the system used in Venice.&rdquo; Its opening chapter is about what a
          merchant needs. The English is John Geijsbeek&apos;s 1914 translation of Pacioli&apos;s Italian:
        </p>

        <Fig
          src={IMG(ID.geijsbeek, 40)}
          alt="Facsimile of a dense black-letter page headed 'Distinctio nona. Tractatus xi. De scripturis', with a woodcut initial showing a seated figure."
          href={`${BOOK.geijsbeek}?page=40`}
          source={<>Geijsbeek, <em>Ancient Double-Entry Bookkeeping</em> (1914)</>}
        >
          The opening of Pacioli&apos;s treatise on accounts, &ldquo;Distinctio nona, Tractatus xi,&rdquo; reproduced in
          facsimile opposite Geijsbeek&apos;s translation.
        </Fig>

        <SourceQuote
          book="ancient-double-entry-bookkeeping-lucas-pacioli-s-treatise-tr"
          page={41}
          src={IMG(ID.geijsbeek, 41)}
          pageAlt="Geijsbeek's English page headed 'Complete translation of Pacioli', chapter 1 of the treatise on accounts."
          source="Luca Pacioli, Summa (1494), treatise on accounts, ch. 1, in Geijsbeek's translation (1914)"
        >
          It has happened that many people without capital of their own but with good credit carried on large
          transactions. By means of their credit, which they faithfully maintained, they became very wealthy. &hellip; In
          the great republics, nothing was considered superior to the word of a good merchant, and oaths were taken based
          on that word. &hellip; This is not strange because, according to the Christian religion, we are saved by faith,
          and without it, it is impossible to please God.
        </SourceQuote>

        <p className={p}>
          Credit and faith are the same word, and Pacioli means the pun. The third thing a merchant needs, after cash and
          arithmetic, is order: books arranged so &ldquo;that one may understand each of them at a glance by using the
          debit and credit method,&rdquo; because &ldquo;Where there is no order, there is confusion.&rdquo; Every entry has
          a twin, and the two columns must balance.
        </p>

        <p className={p}>
          Fifteen years later the same friar published{' '}
          <Link href={BOOK.divina}>
            <em>De divina proportione</em>
          </Link>{' '}
          (Venice, 1509), with woodcuts of the regular solids after drawings by his friend Leonardo da Vinci. Its subject is
          the ratio that divides a line so that the whole is to the larger part as the larger is to the smaller, what we
          call the golden ratio. Pacioli lists the ways it resembles God. The third:
        </p>

        <SourceQuote
          book="de-divina-proportione-illust"
          page={24}
          src={IMG(ID.divina, 24)}
          pageAlt="A page of De divina proportione in roman type; the third and fourth 'convenientie' of the proportion stand near the top."
          source="Luca Pacioli, De divina proportione (Venice, 1509), Part I, ch. 5. Copy: Getty Research Institute"
        >
          The third convenience is that, just as God properly cannot be defined nor understood by us through words, so this
          our proportion can never be assigned by an intelligible number nor expressed by any rational quantity: but it is
          always occult and secret, and called irrational by mathematicians.
        </SourceQuote>

        <p className={p}>
          He goes straight on to the fourth: that like God it never changes, &ldquo;holding the primacy of unity among all
          quantities indifferently, and never changing,&rdquo; and he quotes Boethius on the unmoved mover: &ldquo;Remaining
          stable, it gives all things to be moved.&rdquo;{' '}
          <Link href={PAGE.divina24}>
            (p. 24)
          </Link>{' '}
          So one man wrote down the two proportions an early-modern merchant lived between. The ledger&apos;s proportion
          must come out exactly, in whole ducats, or the books are false. The divine proportion can never be written as a
          ratio of whole numbers at all, and that is what makes it divine.
        </p>

        <Fig
          src={IMG(ID.divina, 270)}
          alt="Woodcut of a many-faced solid shaded with hatching, captioned 'Septuaginta duarum basium solidum'."
          href={`${BOOK.divina}?page=270`}
          source={<><em>De divina proportione</em> (Venice, 1509)</>}
        >
          One of the woodcut solids after Leonardo&apos;s drawings: the solid of seventy-two faces, &ldquo;Septuaginta
          duarum basium solidum.&rdquo;
        </Fig>

        <h2 className={h2}>Copernicus at the mint</h2>

        <p className={p}>
          In the 1520s, while he was working out a sun-centred astronomy, Nicolaus Copernicus also wrote a treatise on
          coinage for the Prussian estates, where several debased currencies were circulating at once. The library holds it
          in the <Link href={BOOK.wolowski}>same 1864 volume</Link> as Oresme&apos;s treatise, in the editor Louis Wolowski&apos;s French translation of the
          Latin:
        </p>

        <SourceQuote
          book="traictie-de-la-premiere-invention-des-monnoies-de-nicole-ed"
          page={265}
          src={IMG(ID.wolowski, 265)}
          pageAlt="The first page of 'Traité de la monnaie par Nicolas Copernic' in Wolowski's 1864 edition."
          source="Copernicus, Treatise on Money, in Wolowski's French translation (Paris, 1864)"
        >
          However innumerable the plagues that ordinarily bring about the decadence of kingdoms, principalities, and
          republics, the following four are, in my sense, the most formidable: discord, mortality, the sterility of the
          land, and the deterioration of the currency. &hellip; Money is therefore, in a way, a common measure for the
          estimation of values; but this measure must always be fixed and conform to the established rule. Otherwise, there
          would, of necessity, be disorder in the State: buyers and sellers would be deceived at every moment, just as if
          the ell, the bushel, or the weight did not maintain a certain quantity.
        </SourceQuote>

        <p className={p}>
          The fourth plague is the dangerous one, he says, because it works &ldquo;not all at once, but little by little,
          by a somewhat latent action.&rdquo; The astronomer who moved the earth wanted the measure of value to stay still.
        </p>

        <h2 className={h2}>A Rosicrucian debate on abolishing gold</h2>

        <p className={p}>
          The Rosicrucian manifesto <em>Fama Fraternitatis</em> first appeared in 1614, printed together with a piece called
          the <em>General Reformation of the Whole World</em>, a German version of a satire from Traiano Boccalini&apos;s{' '}
          <em>News from Parnassus</em> (1612). In it the sages of antiquity meet to reform humankind. One proposal is to
          banish &ldquo;the two scentless and villainous metals, gold and silver,&rdquo; for good. The library&apos;s{' '}
          <Link href={BOOK.fama}>1616 edition</Link> prints the reply:
        </p>

        <SourceQuote
          book="fama-fraternitatis-oder-entdeckung-der-brudersch-des-ordens-fraternitatis"
          page={145}
          src={IMG(ID.fama, 145)}
          pageAlt="A small page of German black-letter from the 1616 Fama Fraternitatis, headed 'der gantzen Welt'."
          source="General Reformation, in Fama Fraternitatis (1616). Copy: Bayerische Staatsbibliothek, Munich"
        >
          &hellip;people collected gold and silver because it was a measure and a counterweight of compensation for all
          things. And for the sustenance of the human race, it was absolutely necessary that one have a metal, or at least
          something else that would be held in such value, in exchange for which one could trade other things &hellip; as
          experience had clearly shown in India, where shells, which people use instead of money, are valued much higher
          than any gold and silver.
        </SourceQuote>

        <p className={p}>
          Cleobulus, one of the Seven Sages, then suggests that if a metal must go, it should be iron, which makes daggers,
          and that gold and silver be kept for the purpose &ldquo;for which they were created by God, namely, that all other
          things should be valued and paid for through them.&rdquo; Whatever the brotherhood was, the book that announced it
          to Europe came bound with an argument that money is a measure people cannot do without.
        </p>

        <h2 className={h2}>A London merchant&apos;s theory of metals</h2>

        <p className={p}>
          Gerard de Malynes was a merchant, an adviser to the crown on trade and coinage, and the most combative writer on foreign
          exchange in Jacobean London (<Ext href={EXT.malynes}>biography</Ext>). In{' '}
          <Link href={BOOK.canker}>
            <em>The Canker of England&apos;s Common Wealth</em>
          </Link>{' '}
          (1601) and later books he argued that exchange rates should be held to the &ldquo;par,&rdquo; the true metal
          content of each coin. His opponent Edward Misselden, in{' '}
          <Link href={BOOK.misselden}>
            <em>The Circle of Commerce</em>
          </Link>{' '}
          (1623), complained that &ldquo;Malyne&apos;s Par&rdquo; had been &ldquo;made a Mystery in Exchange&rdquo;{' '}
          <Link href={Q.misselden7}>
            (p. 7)
          </Link>
          .
        </p>

        <Fig
          src={IMG(ID.misselden, 7)}
          alt="A page of Misselden's dedicatory epistle in roman and italic type, with 'Malyne's Par' and 'Mystery in Exchange' set in italic."
          href={`${BOOK.misselden}?page=7`}
          source={<>Misselden, <em>The Circle of Commerce</em> (1623)</>}
        >
          From Misselden&apos;s dedication: &ldquo;Malyne&apos;s Par,&rdquo; &ldquo;a Mystery in Exchange,&rdquo; and
          further down a mocking plea that Malynes be made master of any office for &ldquo;Malyne&apos;s Par of
          Exchange.&rdquo;
        </Fig>

        <p className={p}>
          Misselden was more right than he knew. Malynes&apos;s law-merchant handbook, <em>Lex Mercatoria</em> (1622),
          includes a chapter on how metals are generated in the earth, and in 1655 Samuel Hartlib, the great London
          collector of reform schemes, reprinted it as an appendix to a{' '}
          <Link href={BOOK.hartlib}>book of chemical recipes</Link>. It opens:
        </p>

        <SourceQuote
          book="chymical-medicinal-and-chyrurgical-addresses-made-to-samuel-hartlib"
          page={171}
          src={IMG(ID.hartlib, 171)}
          pageAlt="Page headed 'The Appendix, Containing Mr. Gerard Malynes Philosophy, about the Essence or Existence of Metals', with a decorated initial A."
          source="Gerard Malynes, from Lex Mercatoria, reprinted in Hartlib, Chymical, Medicinal, and Chyrurgical Addresses (London, 1655)"
        >
          All Philosophers by the light of Nature and long observation have determined, that the sperme or seed of all
          things created of the four elements, doth in a secret manner lowre within the two elements of water and earth;
          and that Nature doth continually work to produce perfect things, but is hindered therein by accidental causes.
        </SourceQuote>

        <p className={p}>
          On the next page he turns to &ldquo;the operation of the Sun and Moon, and the other Planets and Stars, in the
          generation of all things.&rdquo; For the man who wanted every coin held to its true weight in silver, the silver
          itself was a slow work of nature under the planets.
        </p>

        <h2 className={h2}>A financier&apos;s chair of music</h2>

        <p className={p}>
          Thomas Gresham managed the English crown&apos;s debts in Antwerp and built London&apos;s Royal Exchange. His name
          was later attached to Gresham&apos;s law, that bad money drives out good. When he died in 1579 his will founded a college in his
          house with seven professors, to lecture in divinity, law, physic, rhetoric, geometry, astronomy and music (
          <Ext href={EXT.greshamCollege}>Gresham College</Ext>). Three of the four mathematical arts of the old
          curriculum, geometry, astronomy and music, were endowed by a financier for the City of London.
        </p>

        <p className={p}>
          In 1651 the Gresham chair of music went to William Petty (
          <Ext href={EXT.greshamMusic}>list of professors</Ext>), who went on to found what he called &ldquo;political
          arithmetic,&rdquo; the measurement of a nation&apos;s people, land and income. His work is covered in{' '}
          <Link href="/articles/invisible-hand">
            The Invisible Hand Has a History
          </Link>
          . The founder of economic statistics had first held a chair of music.
        </p>

        <h2 className={h2}>The physician&apos;s table</h2>

        <p className={p}>
          The thread runs on into the eighteenth century. François Quesnay was physician to the court of Louis XV, and his{' '}
          <Link href={BOOK.quesnay}>
            <em>Tableau économique</em>
          </Link>{' '}
          (1758) drew the whole economy of France as a circulation: revenue passing back and forth between the farmers, the
          landowners and the artisans in a zigzag of lines, a circulation of the kind a physician would draw. It was a diagram of an order that
          sustains itself if nothing blocks it.
        </p>

        <Fig
          src={IMG(ID.quesnay, 16)}
          alt="Engraved table headed 'Tableau économique', with three columns of sums for productive expenses, revenue and sterile expenses joined by criss-crossing lines."
          href={`${BOOK.quesnay}?page=16`}
          source={<>Quesnay, <em>Tableau économique</em> (1758 facsimile)</>}
        >
          The zigzag: sums pass between productive expenses, revenue and sterile expenses, halving at each step down the
          page.
        </Fig>

        <h2 className={h2}>What the money-men wanted from the sky</h2>

        <MoneyTimeline />

        <p className={p}>
          Read together, these books show people who dealt in money reaching for the heavens for specific reasons. Copernicus
          wanted a measure that would stay fixed, like the motions he was charting. Pacioli wanted books that balance, and
          he set beside them a proportion so perfect it could not be written down. Malynes wanted coin held to its true metal
          and looked for that truth in the generation of metals. The sages of the <em>General Reformation</em> concluded that
          people will always need a measure, and the only question is what it is made of. Cosimo, who had all the money he
          could want, asked first for Hermes.
        </p>


        <p className="text-sm text-muted leading-relaxed">
          Quotations are the library&apos;s English translations, or for Malynes and Misselden the printed English, copied
          from the pages they link to. Where a book is itself a translation (Geijsbeek&apos;s Pacioli, Wolowski&apos;s
          Copernicus), the wording is the translator&apos;s. Gresham&apos;s will and Petty&apos;s professorship are cited
          from outside the library.
        </p>
      </article>
    </ContentPageLayout>
  );
}
