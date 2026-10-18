import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import SourceQuote from '@/components/articles/SourceQuote';
import PageFigure from '@/components/articles/PageFigure';
import MeansDiagram from './MeansDiagram';
import MoneyTimeline from './MoneyTimeline';

// Every quotation from a Source Library book is copied from the stored text of the page it links to,
// fetched through the get_quote tool on 2026-10-16 and 2026-10-17. Claims from outside the library link
// to their source. This note absorbed "Ledgers and Heavens" (2026-10-17); that URL redirects here.
// The hero print is signed "Cross sculpsit" on the plate; our artwork record attributes it to Goltzius,
// which the signature contradicts, so the caption describes only what the print shows.
// The page images and the dodecahedron woodcut (our 1509 De divina proportione, scan p. 248) were checked
// by eye on 2026-10-18.

const TITLE = 'Harmonic Justice';
const DESCRIPTION =
  'Before economics was a science, money and fair exchange were problems of proportion, worked out with the tools used on music and the heavens. Philosophers, a banker, a friar who taught merchants, Copernicus at the mint, Kepler correcting Bodin, the alchemists, a London exchange dealer and Adam Smith.';
const HERO = 'https://images.sourcelibrary.org/artwork/art-goltzius-print-satirical-print.jpg';
const HERO_ALT =
  'English satirical engraving signed "Cross sculpsit": Money, a coin with wings and bird legs, runs off to the right; a spendthrift labelled Prodigality scatters coins; the scales of Justice lie on the ground; hounds named Diligence, Industry, Labour, Rapine, Hazard and Deceit are held on leashes.';

export const metadata: Metadata = withArticleMeta('harmonic-justice', {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/articles/harmonic-justice' },
});

const BOOK = {
  aristotle: '/book/aristotle-opera-vol-6-metaphysica-aldine-editio-princeps-aristotle',
  oresme: '/book/traictie-de-la-premiere-invention-des-monnoies-oresme',
  plotinus: '/book/enneads-1580-greek-latin-ficino-trans-plotinus-ficino',
  pimander: '/book/corpus-hermeticum-pimander-1481-venice-edition-hermes-trismegistus',
  summa: '/book/summa-de-arithmetica-geometria-proportioni-et-proportionalit',
  geijsbeek: '/book/ancient-double-entry-bookkeeping-lucas-pacioli-s-treatise-tr',
  divina: '/book/de-divina-proportione-illust',
  wolowski: '/book/traictie-de-la-premiere-invention-des-monnoies-de-nicole-ed',
  kepler: '/book/the-harmony-of-the-world-kepler',
  fama: '/book/fama-fraternitatis-oder-entdeckung-der-brudersch-des-ordens-fraternitatis',
  splendor: '/book/splendor-solis-the-splendour-of-the-sun-trismosin',
  canker: '/book/the-canker-of-england-s-common-wealth-malynes',
  misselden: '/book/the-circle-of-commerce-misselden',
  hartlib: '/book/chymical-medicinal-and-chyrurgical-addresses-made-to-samuel-hartlib',
  becher: '/book/narrische-weiszheit-und-weise-narrheit-oder-ein-hundert-so-becher',
  quesnay: '/book/economic-table-tableau-oeconomique-quesnay',
  smithTms: '/book/the-theory-of-moral-sentiments-smith',
};

// Book slugs for SourceQuote.
const SLUG = {
  aristotle: 'aristotle-opera-vol-6-metaphysica-aldine-editio-princeps-aristotle',
  oresme: 'traictie-de-la-premiere-invention-des-monnoies-oresme',
  plotinus: 'enneads-1580-greek-latin-ficino-trans-plotinus-ficino',
  geijsbeek: 'ancient-double-entry-bookkeeping-lucas-pacioli-s-treatise-tr',
  divina: 'de-divina-proportione-illust',
  wolowski: 'traictie-de-la-premiere-invention-des-monnoies-de-nicole-ed',
  kepler: 'the-harmony-of-the-world-kepler',
  fama: 'fama-fraternitatis-oder-entdeckung-der-brudersch-des-ordens-fraternitatis',
  splendor: 'splendor-solis-the-splendour-of-the-sun-trismosin',
  hartlib: 'chymical-medicinal-and-chyrurgical-addresses-made-to-samuel-hartlib',
  smithTms: 'the-theory-of-moral-sentiments-smith',
};

// Page images. images.sourcelibrary.org/pages/<bookId>/<NNNN>.jpg and .../archived/<bookId>/<page>.jpg
// are the same reader page numbers.
const PAGES = 'https://images.sourcelibrary.org/pages';
const PAGE_IMG = {
  aristotle7: `${PAGES}/69b220b356715b0e324732e1/0007.jpg`,
  aristotle584: `${PAGES}/69b220b356715b0e324732e1/0584.jpg`,
  oresme9: `${PAGES}/6991e16bb53cae6bb6024014/0009.jpg`,
  oresme143: `${PAGES}/6991e16bb53cae6bb6024014/0143.jpg`,
  kepler133: `${PAGES}/697d9ca2e930671f09614566/0133.jpg`,
  kepler203: `${PAGES}/697d9ca2e930671f09614566/0203.jpg`,
  kepler204: `${PAGES}/697d9ca2e930671f09614566/0204.jpg`,
  splendor43: `${PAGES}/6952dbf977f38f6761bc7720/0043.jpg`,
  splendor129: `${PAGES}/6952dbf977f38f6761bc7720/0129.jpg`,
  becher6: `${PAGES}/6a42727728e9db2e39c14050/0006.jpg`,
  smith344: `${PAGES}/69568c79be7c607c5f03d7bb/0344.jpg`,
};
const IMG = (bookId: string, page: number) => `https://images.sourcelibrary.org/archived/${bookId}/${page}.jpg`;
const ID = {
  plotinus: '6952c9c777f38f6761bc2ffd',
  pimander: '694f3d6cbe37f451a5324e10',
  geijsbeek: '6991e7e6c91ce7d733e50247',
  divina: '69de988c1b234a773e438b33',
  wolowski: '69af5923522dc3dfdf725739',
  fama: '69b51e639a81ef7feb3d4592',
  misselden: '6a8f6267ddd2f57fe0f81f3b',
  hartlib: '6ab5a4019e89e2a1f4139282',
  quesnay: '69568b13be7c607c5f03d575',
};

const Q = {
  misselden7: '/q/BnEPM4oI7IkqhzBgYb9',
};

const EXT = {
  oresmeGrant: 'https://en.wikipedia.org/wiki/Nicole_Oresme',
  kaye: 'https://assets.cambridge.org/97805215/72767/toc/9780521572767_toc.pdf',
  malynes: 'https://en.wikipedia.org/wiki/Gerard_de_Malynes',
  greshamCollege: 'https://en.wikipedia.org/wiki/Gresham_College',
  greshamMusic: 'https://en.wikipedia.org/wiki/Gresham_Professor_of_Music',
  smithAstronomy: 'https://www.adamsmithworks.org/speakings/smith-s-scientific-milestones',
  keynesNewton: 'https://mathshistory.st-andrews.ac.uk/Extras/Keynes_Newton/',
};

const p = 'text-secondary leading-relaxed mb-6 font-body';
const h2 = 'text-2xl md:text-3xl text-primary mt-16 mb-6';

// Tall, narrow pages: held to a reading width so one page does not fill the screen.
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

export default function HarmonicJusticePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="Money, proportion and the heavens, before economics was a science"
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">17 October 2026 &middot; 18 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Economics became a separate science in the eighteenth century. Before that, the people who thought about
          prices, money and trade did it as philosophers, astronomers, music theorists and alchemists, and they used
          the tools they used on the heavens: proportion, the theory of means, and the idea that a whole holds
          together when its parts stand in the right ratios. The people who handled money for a living read the same
          books. This note follows both through the library, from Aristotle to Adam Smith: a banker, a friar who taught
          merchants, an astronomer at the mint, a London exchange dealer and a financier among them.
        </p>

        <p className={p}>
          Two earlier notes cover neighbouring ground.{' '}
          <Link href="/articles/invisible-hand">
            The Invisible Hand Has a History
          </Link>{' '}
          traces market theory from Aristotle to Bastiat, and{' '}
          <Link href="/articles/nature-of-harmony">
            The Nature of Harmony
          </Link>{' '}
          follows the measurers of musical ratio from Pythagoras to Kepler. This one is about the place where the
          two meet: the claim that a fair exchange and a well-ordered state are harmonic in the same sense a chord
          is.
        </p>

        <PageFigure src={HERO} alt={HERO_ALT} href="/book/goltzius-print-satirical-print">
          An English satirical engraving signed &ldquo;Cross sculpsit&rdquo;, seventeenth century. Money, a coin
          on bird&apos;s legs, runs away to the right. Prodigality scatters coins; Justice&apos;s scales lie on the
          ground beneath him. The hounds on the leashes are Diligence, Industry and Labour on one side, Rapine,
          Hazard and Deceit on the other.
        </PageFigure>

        <h2 className={h2}>Aristotle: money is a mean</h2>

        <p className={p}>
          In Book V of the <em>Nicomachean Ethics</em> Aristotle treats exchange as a problem in proportion. A
          shoemaker and a farmer make things that cannot be compared directly, so something has to make them
          comparable. He sets out the chain of conditions in our copy of the{' '}
          <Link href={BOOK.aristotle}>Aldine Greek edition of 1495</Link>:
        </p>

        <SourceQuote
          book={SLUG.aristotle}
          page={584}
          src={PAGE_IMG.aristotle584}
          pageAlt="A page of Greek text from the Nicomachean Ethics, Book V, in the Aldine edition"
          source={<>Aristotle, <em>Nicomachean Ethics</em> V, in the Aldine <em>Opera</em> vol. 6 (Venice, 1495)</>}
        >
          Currency, like a mean, makes things commensurable and equalizes them. For there would be no community
          without exchange, no exchange without equality, and no equality without commensurability. In truth, it is
          impossible that things so different can become commensurable. But with respect to need, it is sufficiently
          possible.
        </SourceQuote>

        <p className={p}>
          Two things in this passage matter for everything after it. Money is a <em>mean</em> in the mathematical
          sense: the middle term that lets two unlike extremes stand in a ratio. And the commensurability is not
          real. There must be one standard, Aristotle goes on, &ldquo;and this by assumption. Therefore, it is called{' '}
          <em>nomisma</em>,&rdquo; from <em>nomos</em>, custom or law. The measure is a convention, and it holds only
          with respect to need.
        </p>

        <PageFigure
          src={PAGE_IMG.aristotle7}
          alt="Contents leaf of the Aldine volume, in Greek and Latin, listing the Ethics to Nicomachus, the Politics, the Economics, the Magna Moralia and the Eudemian Ethics with their numbers of books"
          href={`${BOOK.aristotle}?page=7`}
          source={<>Aristotle, <em>Opera</em> vol. 6 (Venice: Aldus, 1495)</>}
        >
          The contents leaf of the volume, in Greek and then in Latin: the <em>Ethics</em> to Nicomachus in ten books,
          the <em>Politics</em> in eight, the <em>Economics</em> in two, the <em>Magna Moralia</em> in two and the
          ethics to Eudemus in eight.
        </PageFigure>

        <h2 className={h2}>Oresme: the measure belongs to the community</h2>

        <p className={p}>
          Nicole Oresme (c. 1320&ndash;1382) worked on both ends of this problem. In a treatise on the
          commensurability of the celestial motions he argued that the planets&apos; periods are probably{' '}
          <em>incommensurable</em>, and that exact astrological prediction is therefore impossible (
          <Ext href={EXT.oresmeGrant}>edited by Edward Grant in 1971</Ext>). In his treatise on money, written in the
          1350s while the French crown was repeatedly altering the coinage, he argued that the coinage is not the
          prince&apos;s to alter. The library holds the <Link href={BOOK.oresme}>1864 edition</Link> that prints the
          medieval French version beside the Latin:
        </p>

        <PageFigure
          src={PAGE_IMG.oresme9}
          alt="Title page: Traictie de la première invention des monnoies de Nicole Oresme, with Copernicus's treatise on money, edited by L. Wolowski, Paris, Guillaumin"
          href={`${BOOK.oresme}?page=9`}
          source={<>Oresme, <em>Traictie de la première invention des monnoies</em> (Paris, 1864)</>}
        >
          Wolowski&apos;s title page: Oresme&apos;s French and Latin texts from the manuscripts of the Bibliothèque
          impériale, bound with Copernicus&apos;s treatise on money in Latin and French.
        </PageFigure>

        <SourceQuote
          book={SLUG.oresme}
          page={143}
          src={PAGE_IMG.oresme143}
          pageAlt="Printed page lxv, the opening of chapter 22 in medieval French"
          source={<>Nicole Oresme, <em>Traictie de la première invention des monnoies</em>, ch. 22 (ed. Wolowski, Paris, 1864)</>}
          printedPage="lxv"
        >
          Since the money belongs to the community, as was stated and demonstrated in the 6th Chapter, it seems that
          this community may ordain concerning it at its will, and thus change it and take profit from it at its
          pleasure, and treat it as its own property.
        </SourceQuote>

        <p className={p}>
          Oresme states this as the strongest case for altering the coin, and then argues that even the community
          should not do it except in real necessity, because a measure that moves breeds &ldquo;innumerable
          perplexities, errors, and inextricable difficulties in accounts.&rdquo; The historian Joel Kaye has argued
          that the two projects are connected: that living in a monetized economy taught fourteenth-century scholars
          to see nature as a field of graded, measurable quantities (
          <Ext href={EXT.kaye}>
            <em>Economy and Nature in the Fourteenth Century</em>, 1998
          </Ext>
          ). On that reading the market did not only borrow its picture of order from cosmology. The traffic ran both
          ways.
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
          book={SLUG.plotinus}
          page={8}
          src={IMG(ID.plotinus, 8)}
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
          book={SLUG.geijsbeek}
          page={41}
          printedPage={33}
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
          book={SLUG.divina}
          page={24}
          src={IMG(ID.divina, 24)}
          pageAlt="A page of De divina proportione in roman type; the third and fourth 'convenientie' of the proportion stand near the top."
          source="Luca Pacioli, De divina proportione (Venice, 1509), Part I, ch. 5. Copy: Getty Research Institute"
        >
          The third convenience is that, just as God properly cannot be defined nor understood by us through words, so this
          our proportion can never be assigned by an intelligible number nor expressed by any rational quantity: but it is
          always occult and secret, and called irrational by mathematicians.
        </SourceQuote>

        <div className="mx-auto max-w-md">
          <PageFigure
            src={IMG(ID.divina, 248)}
            alt="Woodcut of a hollow dodecahedron, its twelve pentagonal faces drawn as open frames, labelled 'Dodecaedron Planum Vacuum', from Luca Pacioli’s De divina proportione, Venice, 1509."
            href={`${BOOK.divina}?page=248`}
            source={<><em>De divina proportione</em> (Venice, 1509)</>}
          >
            A hollow dodecahedron, one of the woodcuts after Leonardo.
          </PageFigure>
        </div>

        <p className={p}>
          He goes straight on to the fourth: that like God it never changes, &ldquo;holding the primacy of unity among all
          quantities indifferently, and never changing,&rdquo; and he quotes Boethius on the unmoved mover: &ldquo;Remaining
          stable, it gives all things to be moved.&rdquo;{' '}
          <Link href={`${BOOK.divina}?page=24`}>
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
          coinage for the Prussian estates, where several debased currencies were circulating at once.{' '}
          <Link href={BOOK.wolowski}>Wolowski&apos;s 1864 volume</Link> prints it after Oresme&apos;s treatise, in the
          editor&apos;s French translation of the Latin:
        </p>

        <SourceQuote
          book={SLUG.wolowski}
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
          by a somewhat latent action.&rdquo; This is Oresme&apos;s argument again, from a man with the same two
          subjects: the astronomer who moved the earth wanted the measure of value to stay still.
        </p>

        <h2 className={h2}>Bodin and Kepler: harmonic justice, checked against the ear</h2>

        <p className={p}>
          Jean Bodin ended his <em>Six Books of the Commonwealth</em> (1576) with a theory of harmonic justice.
          Arithmetic justice gives everyone equal shares. Geometric justice gives shares in proportion to merit. A
          well-ordered state, Bodin argued, blends the two, the way a harmonic proportion blends an arithmetic and a
          geometric one.
        </p>

        <MeansDiagram />

        <p className={p}>
          Forty years later Kepler read this and stopped the third book of his{' '}
          <Link href={BOOK.kepler}>
            <em>Harmony of the World</em>
          </Link>{' '}
          (1619) to deal with it. The section is headed &ldquo;A Political Digression,&rdquo; and he says plainly why
          it is there:
        </p>

        <SourceQuote
          book={SLUG.kepler}
          page={203}
          src={PAGE_IMG.kepler203}
          pageAlt="Printed page 86 of Harmonices mundi, headed De tribus medietatibus, Digressio politica, with small tables of numbers"
          source={<>Kepler, <em>Harmonices mundi</em> III (Linz, 1619; the Bibliotheca Philosophica Hermetica copy, Amsterdam)</>}
          printedPage="86"
        >
          I decided to transcribe the principal points of this political discussion from Bodin himself, with the
          words and order mostly shaped by my own understanding of that passage. I do this both to bring some light to
          a place that is obscure in itself (for Bodin did not bring enough support from mathematical disciplines to
          this speculation) and to soothe the boredom of those peevish mathematical demonstrations (of which this whole
          work is composed) by interspersing pleasant, popular material, and to show a taste of its usefulness in
          understanding the Commonwealth.
        </SourceQuote>

        <p className={p}>
          Kepler does not reject the idea that a state can be harmonic. He rejects Bodin&apos;s arithmetic. On the
          next page he shows that Bodin&apos;s definition admits mixtures of ratios that are not harmonic at all,
          excludes ratios that plainly are, and contradicts itself. Then he names the real fault:
        </p>

        <SourceQuote
          book={SLUG.kepler}
          page={204}
          src={PAGE_IMG.kepler204}
          pageAlt="Printed page 87 of Harmonices mundi, Book III, with tables of arithmetic and geometric progressions above Kepler's objections to Bodin"
          source={<>Kepler, <em>Harmonices mundi</em> III (Linz, 1619)</>}
          printedPage="87"
        >
          Bodin wrongly denies that these latter sets produce harmonic concords, rising up on the authority of the
          ancients against the very evidence of the sense of hearing.
        </SourceQuote>

        <p className={p}>
          This is the useful part of the episode. A model of social order borrowed from music was held to the
          standard of the music. If you say a distribution is harmonic, the ratios have to be consonant, and the test
          is the ear, not the authority.
        </p>

        <PageFigure
          src={PAGE_IMG.kepler133}
          alt="Printed page 27 of Harmonices mundi, Book III, with a diagram of a string divided into sections, numbered fractions beside each division"
          href={`${BOOK.kepler}?page=133`}
          source={<>Kepler, <em>Harmonices mundi</em> III (Linz, 1619), printed p. 27</>}
        >
          Earlier in the same book Kepler sets out the seven divisions of a string that give the consonances, drawn as
          brackets with their fractions. The paragraph beside the diagram opens &ldquo;Has sectiones chordae septem
          primum auditu indice inveni&rdquo;: he found them first with the ear as judge.
        </PageFigure>

        <h2 className={h2}>A Rosicrucian debate on abolishing gold</h2>

        <p className={p}>
          The Rosicrucian manifesto <em>Fama Fraternitatis</em> first appeared in 1614, printed together with a piece called
          the <em>General Reformation of the Whole World</em>, a German version of a satire from Traiano Boccalini&apos;s{' '}
          <em>News from Parnassus</em> (1612). In it the sages of antiquity meet to reform humankind. One proposal is to
          banish &ldquo;the two scentless and villainous metals, gold and silver,&rdquo; for good. The library&apos;s{' '}
          <Link href={BOOK.fama}>1616 edition</Link> prints the reply:
        </p>

        <SourceQuote
          book={SLUG.fama}
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
          to Europe came bound with Aristotle&apos;s point: money is a measure, held by agreement, that people cannot do
          without.
        </p>

        <h2 className={h2}>The alchemists: wealth that multiplies without being spent</h2>

        <p className={p}>
          Alchemy is remembered as an attempt to make gold. The texts often set the Art above gold and above trade.
          The{' '}
          <Link href={BOOK.splendor}>
            English translation of <em>Splendor Solis</em>
          </Link>{' '}
          ends:
        </p>

        <SourceQuote
          book={SLUG.splendor}
          page={129}
          src={PAGE_IMG.splendor129}
          pageAlt="Printed page 81, the Conclusion of Splendor Solis, ending 'End of Splendor Solis'"
          source={<><em>Splendor Solis</em>, English translation (London, 1920)</>}
          printedPage="81"
        >
          He is like one who had a flint from which he strikes fire and gives to whosoever he likes, without the stone
          getting any smaller through it. It is as good as giving superfluous fine Gold. This Art is also better than
          all commerce, Gold and Silver, and her fruits are better than the wealth of all the world.
        </SourceQuote>

        <p className={p}>
          The flint that gives fire without wearing down is the alchemists&apos; &ldquo;multiplication&rdquo; of the
          Stone. Whatever one makes of the chemistry, it is an exact picture of what credit promises: a source that
          gives without being used up.
        </p>

        <PageFigure
          src={PAGE_IMG.splendor43}
          alt="Plate VI of Splendor Solis, The Other Parable: inside an ornate architectural frame a man on a ladder picks fruit from a tree into a bag while two robed men talk below; bathers sit in the foreground"
          href={`${BOOK.splendor}?page=43`}
          source={<><em>Splendor Solis</em> (London, 1920), plate VI</>}
        >
          &ldquo;The Other Parable&rdquo;: a man on a ladder gathers the fruit of a tree into a bag while two men talk
          beneath it.
        </PageFigure>

        <p className={p}>
          The people who held this picture of metals were not all recluses. Gerard de Malynes was a merchant, an adviser
          to the crown on trade and coinage, and the most combative writer on foreign exchange in Jacobean London (
          <Ext href={EXT.malynes}>biography</Ext>). In{' '}
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
          book={SLUG.hartlib}
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

        <p className={p}>
          Johann Joachim Becher (1635&ndash;1682) carried the same mixture into the next generation. He was an alchemist,
          a physician, an economic adviser to the emperor in Vienna, and a promoter of manufactories and trading
          companies. One of his books in the library is a ledger of his own projects. Its title promises{' '}
          <Link href={`${BOOK.becher}?page=6`}>
            &ldquo;one hundred political, physical, mechanical and mercantile concepts and propositions, some of which
            went well and some came to nothing&rdquo;
          </Link>{' '}
          (<em>Närrische Weißheit und weise Narrheit</em>, &ldquo;Foolish Wisdom and Wise Folly&rdquo;, 1707
          edition). A generation later Isaac Newton, who spent decades on alchemy, was running the Royal Mint.
        </p>

        <PageFigure
          src={PAGE_IMG.becher6}
          alt="Title page in black and red Fraktur: D. Joh. Joachim Bechers Närrische Weißheit und Weise Narrheit, oder ein hundert so politische als physicalische, mechanische und mercantilische Concepten und Propositionen, Anno MDCCVII"
          href={`${BOOK.becher}?page=6`}
          source={<>Becher, <em>Närrische Weißheit und weise Narrheit</em> (1707)</>}
        >
          The title page, printed in black and red, with the promise of a hundred concepts &ldquo;deren etliche gut
          gethan, etliche zu nichts worden&rdquo;, and a preface on Becher&apos;s virtues, vices and fortunes.
        </PageFigure>

        <h2 className={h2}>A financier&apos;s chair of music</h2>

        <p className={p}>
          Thomas Gresham managed the English crown&apos;s debts in Antwerp and built London&apos;s Royal Exchange. His name
          was later attached to Gresham&apos;s law, that bad money drives out good. When he died in 1579 his will founded a
          college in his house with seven professors, to lecture in divinity, law, physic, rhetoric, geometry, astronomy
          and music (<Ext href={EXT.greshamCollege}>Gresham College</Ext>). Three of the four mathematical arts of the old
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
          François Quesnay was physician to the court of Louis XV, and his{' '}
          <Link href={BOOK.quesnay}>
            <em>Tableau économique</em>
          </Link>{' '}
          (1758) drew the whole economy of France as a circulation: revenue passing back and forth between the farmers, the
          landowners and the artisans in a zigzag of lines, the kind of circulation a physician would draw. It was a
          diagram of an order that sustains itself if nothing blocks it.
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

        <h2 className={h2}>Adam Smith: the invisible hand is a providence</h2>

        <p className={p}>
          A year later the phrase everyone knows first appeared, in Smith&apos;s{' '}
          <Link href={BOOK.smithTms}>
            <em>Theory of Moral Sentiments</em>
          </Link>{' '}
          (1759), in a passage about the land and how its produce is shared:
        </p>

        <SourceQuote
          book={SLUG.smithTms}
          page={344}
          src={PAGE_IMG.smith344}
          pageAlt="Printed page 350 of The Theory of Moral Sentiments, the passage on the invisible hand"
          source={<>Adam Smith, <em>The Theory of Moral Sentiments</em> (London, 1759)</>}
          printedPage="350"
        >
          They are led by an invisible hand to make nearly the same distribution of the necessaries of life, which
          would have been made, had the earth been divided into equal portions among all its inhabitants, and thus
          without intending it, without knowing it, advance the interest of the society, and afford means to the
          multiplication of the species.
        </SourceQuote>

        <p className={p}>
          The next sentence begins &ldquo;When providence divided the earth among a few lordly masters.&rdquo; The
          hand is the hand of providence, and the claim is a claim of hidden harmony: a division nobody intended
          comes out close to an equal one. It is Bodin&apos;s question, whether the shares are just, answered by an
          appeal to design.
        </p>

        <p className={p}>
          Smith knew how such systems work on the mind. In his essay on the history of astronomy he described a
          philosophical system as an &ldquo;imaginary machine,&rdquo; built to connect appearances and quiet the
          imagination&apos;s unease at what it cannot explain (
          <Ext href={EXT.smithAstronomy}>published after his death, in 1795</Ext>). He judged astronomical systems
          partly by how well they satisfied the imagination. The same test can be put to his own.
        </p>

        <h2 className={h2}>Keynes and the last of the magicians</h2>

        <p className={p}>
          John Maynard Keynes bought a large part of Newton&apos;s alchemical papers at auction in 1936. In a lecture
          read for him at the Royal Society&apos;s Newton tercentenary in 1946, after his death, he said that Newton
          &ldquo;was not the first of the age of reason. He was the last of the magicians&rdquo; (
          <Ext href={EXT.keynesNewton}>&ldquo;Newton, the Man&rdquo;</Ext>). Keynes&apos;s own best-known phrase for
          what drives investment, &ldquo;animal spirits,&rdquo; has a long history behind it, through Descartes back
          to the <em>spiritus animalis</em> of Galenic medicine, though which source Keynes had in mind is disputed.
          The economist who did most to break the idea that markets settle into harmony on their own named what moves
          them with a term from the old physiology.
        </p>

        <h2 className={h2}>Two uses of harmony</h2>

        <p className={p}>
          There are two ways to bring harmony into talk about markets, and these books show both.
        </p>

        <p className={p}>
          The first is apologetic. The system is already harmonious; what looks like conflict is concord at a higher
          level; the shares are fair because providence, or the market, set them. Bastiat&apos;s{' '}
          <em>Economic Harmonies</em> (1850) is the plainest case, and Smith&apos;s invisible hand can be read that
          way.
        </p>

        <p className={p}>
          The second is critical, and it is older. Aristotle says the measure is a convention that holds only with
          respect to need. Oresme says it belongs to the community and should not be moved at will, and Copernicus,
          from the mint, says the same. Kepler says that if you call a distribution harmonic, show the ratios and test
          them against something other than authority. The alchemists, read soberly, describe the thing to be wary of:
          wealth that seems to multiply without being spent.
        </p>

        <MoneyTimeline />

        <p className={p}>
          The people who dealt in money reached for the heavens for specific reasons. Copernicus wanted a measure that
          would stay fixed, like the motions he was charting. Pacioli wanted books that balance, and he set beside them a
          proportion so perfect it could not be written down. Malynes wanted coin held to its true metal and looked for
          that truth in the generation of metals. The sages of the <em>General Reformation</em> concluded that people will
          always need a measure, and the only question is what it is made of. Cosimo, who had all the money he could want,
          asked first for Hermes.
        </p>

        <p className={p}>
          What all these writers shared was the assumption that an economy is one case of a general problem: how unlike
          things can be brought into a ratio that holds. They asked it about justice, music and the heavens at once.
          Modern economics kept the mathematics of the question and set aside the part about justice. The older books
          ask which ratios are fair in the same breath as which ones are stable.
        </p>

        <p className="text-sm text-muted leading-relaxed">
          Quotations are the library&apos;s English translations, or for Malynes, Misselden and Smith the printed English,
          copied from the pages they link to. Where a book is itself a translation (Geijsbeek&apos;s Pacioli,
          Wolowski&apos;s Copernicus), the wording is the translator&apos;s. Bodin&apos;s <em>République</em> is not yet
          in the library, so his theory is given here in Kepler&apos;s account of it. Gresham&apos;s will and
          Petty&apos;s professorship are cited from outside the library.
        </p>
      </article>
    </ContentPageLayout>
  );
}
