import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import SourceQuote from '@/components/articles/SourceQuote';
import PageFigure from '@/components/articles/PageFigure';

// Every quotation is copied from the stored text of the page it links to, re-checked against
// /api/books/<id>/quote?page=N on 26 October 2026 (#7458). Notes and glosses the translation inserts
// inside a quoted sentence are left out (the Zhuangzi page glosses qi; the Taoist canon page explains
// Taixi). Each claim is a verified claim in the aliveness knowledge base; the ten turning points follow
// its ideas/02-turning-points.md, the practices ideas/03-making-aliveness.md.

const TITLE = 'What Is Alive? Ten Turning Points';
const DESCRIPTION =
  'How the answer to what makes a thing alive changed, from breath and heat to machine, force and feeling: ten turning points, from Anaximenes to the first use of the word aliveness in 1898.';
const HERO = 'https://images.sourcelibrary.org/archived/69904dd67d19f3f2aac1d49d/1.jpg';
const HERO_ALT =
  "Title page of Robert Fludd's Utriusque cosmi historia (1617): a naked man stands with arms outstretched inside the circles of the heavens, while a winged figure in the clouds turns the outer circle on a rope.";

export const metadata: Metadata = withArticleMeta('aliveness', {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/articles/aliveness' },
});

// A page in the reader: /book/<slug>?page=<scan>. B holds the /book/ links, which also build the
// "Books in this article" grid (scripts/maintenance/generate-article-books.mjs reads them from this file).
const pg = (book: string, page: number) => `${book}?page=${page}`;
// The slug, for SourceQuote's book prop.
const slug = (book: string) => book.replace('/book/', '');
const IMG = (bookId: string, page: number) => `https://images.sourcelibrary.org/archived/${bookId}/${page}.jpg`;

// The books cited, in the order they first appear.
const B = {
  fludd: '/book/utriusque-cosmi-historia-1617-fludd',
  diels: '/book/die-fragmente-der-vorsokratiker-diels',
  kircher: '/book/obeliscus-pamphilius-kircher',
  tertullian: '/book/scripta-1550-tertullian',
  upanishads: '/book/the-upanishads-part-1-sbe-vol-1-trans',
  aristotleWorks: '/book/the-works-of-aristotle-vol-3-de-mundo-aristotle',
  aristotleOpera: '/book/aristotelis-opera-complete-works-aristotle',
  zhuangzi: '/book/zhuangzi-with-commentary-vol-3-zhuangzi',
  elzevir: '/book/novum-testamentum-graece-elzevir-1633-textus-receptus-receptus',
  lascaris: '/book/lascaris-de-octo-partibus-orationis-greek-grammar-aldine-lascaris',
  basel: '/book/basel-universitatsbibliothek-an-iii-12-anonymous',
  abano: '/book/conciliator-differentiarum-philosophorum-et-medicorum-d-abano',
  rbacon: '/book/de-retardatione-accidentium-senectutis-bacon',
  regimen: '/book/regimen-sanitatis-add-arnoldus-de-villa-nova-phlebotomia-hippocrates-astronomia-',
  varchi: '/book/lezzioni-dell-accademia-fiorentina-varchi',
  plato: '/book/platonis-opera-republic-timaeus-critias-plato',
  hermetica: '/book/corpus-hermeticum-with-pneumatica-and-ocellus-lucanus-alexandria',
  ficino1529: '/book/de-vita-libri-tres-three-books-on-life-1529-ficino',
  ficino1489: '/book/three-books-on-life-ficino-2',
  agrippa: '/book/three-books-of-occult-philosophy-agrippa',
  gilbert: '/book/on-the-loadstone-and-magnetic-bodies-english-translation-gilbert',
  campanella: '/book/de-sensu-rerum-et-magia-campanella',
  discours: '/book/discours-de-la-methode-descartes',
  passions: '/book/passiones-animae-descartes',
  leviathan: '/book/leviathan-1651-first-edition-hobbes',
  more: '/book/a-collection-of-several-philosophical-writings-of-dr-henry-more',
  conway: '/book/principia-philosophiae-antiquissimae-et-recentissimae-helmont',
  kant: '/book/kritik-der-urteilskraft-german-kant',
  bichat: '/book/recherches-physiologiques-sur-la-vie-et-la-mort-bichat',
  wenzel: '/book/unterhaltungen-uber-die-auffallendsten-neuern-wenzel',
  huxley: '/book/lay-sermons-addresses-and-reviews-huxley',
  steiner: '/book/theosophy-an-introduction-to-the-supersensible-knowledge-of-the-world',
  schelling: '/book/erster-entwurf-eines-systems-der-naturphilosophie-schelling-2',
  nanna: '/book/nanna-oder-uber-das-seelenleben-der-pflanzen-fechner',
  zendAvesta: '/book/zend-avesta-fechner',
  nietzsche: '/book/unzeitgemasse-betrachtungen-nietzsche',
  schopenhauer: '/book/die-welt-als-wille-und-vorstellung-schopenhauer',
  james: '/book/the-varieties-of-religious-experience-james',
  bergson: '/book/l-evolution-creatrice-bergson',
  whitehead: '/book/process-and-reality-whitehead',
  trowardLectures: '/book/the-edinburgh-lectures-on-mental-science-troward',
  trowardCreative: '/book/the-creative-process-in-the-individual-troward',
  psychicHealing: '/book/the-science-of-psychic-healing-atkinson',
  scienceOfBreath: '/book/science-of-breath-atkinson',
  hypCommentary: '/book/light-on-hatha-yoga-hathayogapradipika-with-commentaries-svatmarama',
  hyp: '/book/hathayogapradipika-sanskrit-1867-svatmarama',
  wilmans: '/book/a-search-for-freedom-wilmans',
  isidore: '/book/etymologiae-de-summo-bono-1483-incunabulum-seville',
  ramazzini: '/book/opera-omnia-medica-et-physiologica-ramazzini',
  fbacon: '/book/history-of-life-and-death-bacon',
  musaeum: '/book/musaeum-hermeticum-1677-edition-jennis',
  glauber: '/book/des-teutschlandts-wohlfart-4-darinnen-viel-herrliche-vnd-glauber',
  taoistCanon: '/book/essence-of-taoist-canon-masters',
  daoyan: '/book/daoyan-neiwai-mijue-quanshu-wuzhen-pian',
  baopuzi: '/book/baopuzi-neipian-inner-chapters-of-the-master-who-embraces-hong',
  caraka: '/book/caraka-samhita-charaka',
  paracelsus: '/book/five-books-on-long-life-paracelsus',
  augustine: '/book/de-civitate-dei-augustine',
  browne: '/book/religio-medici-1642-first-edition-browne',
  redi: '/book/osservazioni-intorno-alle-vipere-redi',
  hildegard: '/book/physica-hildegard-von-bingen-bingen',
  peiwen: '/book/vol-515',
  wagner: '/book/diss-de-cognitione-naturali-existentiae-angelicae-wagner',
};

const ATLAS = 'https://aliveness-atlas.vercel.app/';
const VOCABULARY = 'https://aliveness-atlas.vercel.app/vocabulary';

const p = 'text-secondary leading-relaxed mb-6 font-body';
const h2 = 'text-2xl md:text-3xl text-primary mt-16 mb-6';
const h3 = 'text-xl text-primary mt-10 mb-4';
const when = 'text-sm text-muted font-body -mt-3 mb-6';

// A short quotation without its page picture; the page number links to the page in the reader.
function Quote({ href, page, cite, children }: { href: string; page: number | string; cite: React.ReactNode; children: React.ReactNode }) {
  return (
    <blockquote className="border-l-2 border-accent-gold/60 pl-6 my-8">
      <div className="text-secondary leading-relaxed italic font-body">{children}</div>
      <p className="text-xs text-muted mt-2 not-italic">
        {cite}, <Link href={href}>p. {page}</Link>
      </p>
    </blockquote>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

// The lexicon strip: eight words that carried what we now call aliveness.
const WORDS: { word: string; terms: string; gloss: React.ReactNode }[] = [
  {
    word: 'Breath',
    terms: 'pneuma, ruach, prāṇa, qi',
    gloss: <>Most words for life began as words for moving air. <Link href={pg(B.diels, 47)}>Anaximenes</Link></>,
  },
  {
    word: 'Soul',
    terms: 'psychē, anima',
    gloss: <>The soul is named from living, the spirit from breathing. <Link href={pg(B.isidore, 120)}>Isidore, c. 630</Link></>,
  },
  {
    word: 'Spirit',
    terms: 'spiritus',
    gloss: <>A vapour of the blood: pure, subtle, warm and bright. <Link href={pg(B.ficino1529, 37)}>Ficino, 1489</Link></>,
  },
  {
    word: 'Heat',
    terms: 'calor innatus',
    gloss: <>An inborn heat that feeds on the body&apos;s moisture like a flame on oil. <Link href={pg(B.rbacon, 138)}>Roger Bacon</Link></>,
  },
  {
    word: 'Force',
    terms: 'Lebenskraft, vital force',
    gloss: <>A power whose activity is life and which uses itself up. <Link href={pg(B.wenzel, 107)}>Wenzel, 1800</Link></>,
  },
  {
    word: 'Organisation',
    terms: 'organisierte Wesen',
    gloss: <>A thing in which every part is both end and means. <Link href={pg(B.kant, 285)}>Kant, 1790</Link></>,
  },
  {
    word: 'Will',
    terms: 'Wille zum Leben',
    gloss: <>To the will to live, life is its mirror and is certain. <Link href={pg(B.schopenhauer, 461)}>Schopenhauer, 1818</Link></>,
  },
  {
    word: 'Feeling',
    terms: 'aliveness',
    gloss: <>A condition you feel, in degrees, and can raise. <Link href={pg(B.wilmans, 94)}>Wilmans, 1898</Link></>,
  },
];

function Lexicon() {
  return (
    <div className="not-prose my-10 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-8">
      {WORDS.map((w) => (
        <div key={w.word} className="border-t border-accent-gold/60 pt-3">
          <p className="text-lg text-primary">{w.word}</p>
          <p className="text-xs text-muted italic font-body mb-2">{w.terms}</p>
          <p className="text-sm text-secondary leading-snug font-body">{w.gloss}</p>
        </div>
      ))}
    </div>
  );
}

export default function AlivenessPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="Breath, heat, spirit, machine, force and feeling: how the answer to what makes a thing alive changed, in the books where it changed"
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">26 October 2026 &middot; 14 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          No old language has a word for aliveness. Greek had <em>zōē</em>, the life an animal shares with
          plants, and <em>bios</em>, a lifetime and a way of living. Hebrew had <em>ruach</em>, which means wind
          and breath at once. Latin had <em>spiritus</em>, Sanskrit <em>prāṇa</em>, Chinese <em>qi</em>. Most of
          these began as words for moving air. For two and a half thousand years people argued over what life
          is: a breath, a heat, a soul, a machine, a force, a feeling. Each answer changed what they did to stay
          alive.
        </p>

        <p className={p}>
          Below are ten moments when the answer changed, each with a line from a book in the library and a link
          to the page it is printed on. Then come the ways people tried to make life, and last, the word itself.
          The picture above is the title page of Robert Fludd&apos;s{' '}
          <Link href={pg(B.fludd, 1)}>
            <em>Utriusque cosmi historia</em> (1617)
          </Link>
          : a man inside the circles of the heavens, the small world inside the great one, while a winged figure
          in the clouds turns the whole on a rope.
        </p>

        <p className={p}>Eight words carried most of the argument:</p>

        <Lexicon />

        {/* 1 */}
        <h2 className={h2}>1. Breath becomes soul</h2>
        <p className={when}>6th century BCE to about 210 CE</p>

        <p className={p}>
          The earliest Greek answer is air. Anaximenes, as later writers report him, made the soul air and gave it
          the work breath does for the world: &ldquo;Just as our soul,&rdquo; he says, &ldquo;being air, holds us
          together, so do breath and air encompass the whole world&rdquo; (Diels,{' '}
          <em>Die Fragmente der Vorsokratiker</em>, <Link href={pg(B.diels, 47)}>p. 26</Link>). In Genesis God
          blows the <Link href={pg(B.kircher, 268)}>breath of life</Link> into Adam&apos;s nostrils, and the man
          becomes a living being. There breath carries life; it is not yet life itself. By about 210 Tertullian
          had made it the test:
        </p>

        <SourceQuote
          book={slug(B.tertullian)}
          page={663}
          printedPage={647}
          src={IMG('69b3001c5545150b61b4bc01', 663)}
          pageAlt="A page of Tertullian's De anima in a Latin edition of 1550"
          source={<>Tertullian, <em>De anima</em> 10, in his <em>Scripta</em> (1550)</>}
          original="Quid est, oro te, spirare: flatum, opinor, ex semetipso agere. Quid est non uiuere: flatum, opinor, ex semetipso non agere."
        >
          What is it, I ask you, to breathe? It is, I believe, to drive breath from within oneself. What is it
          not to live? It is, I believe, not to drive breath from within oneself.
        </SourceQuote>

        <p className={p}>
          India reached the same place on its own. The Chāndogya Upaniṣad: &ldquo;Breath indeed is the oldest and
          the best&rdquo; (Müller, <em>The Upanishads</em>, <Link href={pg(B.upanishads, 184)}>p. 72</Link>).
        </p>

        {/* 2 */}
        <h2 className={h2}>2. Aristotle defines life by what a body does</h2>
        <p className={when}>About 350 BCE</p>

        <p className={p}>
          Before Aristotle, the Greek sign of a soul was moving oneself. Thales, Aristotle reports, gave the
          magnet a soul <Link href={pg(B.aristotleWorks, 206)}>because it moves iron</Link>. Aristotle replaced
          the sign with a definition:
        </p>

        <SourceQuote
          book={slug(B.aristotleOpera)}
          page={420}
          printedPage={412}
          src={IMG('699376e7b0a84a5763961e8f', 420)}
          pageAlt="A page of Aristotle's De anima in Greek, in Bekker's edition of the works"
          source={<>Aristotle, <em>De anima</em> II.1, 412a, in <em>Aristotelis opera</em> (1831)</>}
          original="τῶν δὲ φυσικῶν τὰ μὲν ἔχει ζωήν, τὰ δ’ οὐκ ἔχει· ζωὴν δὲ λέγομεν τὴν δι’ αὑτοῦ τροφήν τε καὶ αὔξησιν καὶ φθίσιν."
        >
          Of natural things, some possess life, while others do not; and by life we mean self-sustained
          nutrition, growth, and decay.
        </SourceQuote>

        <p className={p}>
          In his shorter works on biology he gives a second answer: an animal is warm and moist, and{' '}
          <Link href={pg(B.aristotleWorks, 402)}>to live is to be so</Link>, while old age and the corpse are dry
          and cold. Both answers ran on for two thousand years. In China, at about the same time, Zhuangzi placed
          life not in what a body does but in how its stuff is held together:
        </p>

        <Quote href={pg(B.zhuangzi, 140)} page={140} cite={<>Zhuangzi, &ldquo;Zhi bei you&rdquo;, in <em>Zhuangzi pangzhu</em> (1699)</>}>
          人之生氣之聚也聚則爲生. Human life is the gathering of qi. When it gathers, there is life; when it
          disperses, there is death.
        </Quote>

        {/* 3 */}
        <h2 className={h2}>3. Life becomes a gift</h2>
        <p className={when}>About 55 to 381 CE</p>

        <p className={p}>
          Christianity made the life that matters most something given, by a giver who makes alive. Paul sets the
          first Adam, made a living soul, against the last Adam, made{' '}
          <Link href={pg(B.elzevir, 620)}>a life-giving spirit</Link>. The Creed of 381 calls the Holy Spirit{' '}
          <Link href={pg(B.lascaris, 235)}>the giver of life</Link>, in Greek <em>to zōopoion</em>, the life-maker.
          And John&apos;s Jesus promises life in excess. In this Greek gospel book of the eighth or ninth century
          the words run on without spaces:
        </p>

        <SourceQuote
          book={slug(B.basel)}
          page={567}
          src={IMG('699389640f04c37dcfa60ef7', 567)}
          pageAlt="A parchment page of a Greek gospel book written in uncial capitals"
          source={<>John 10:10, Greek gospels, Basel, Universitätsbibliothek AN III 12 (8th to 9th century)</>}
          original="ΕΓΩΗΛΘΟΝ,ΙΝΑΖΩ ΗΝΕΧΩΣΙΝ,ΚΑΙΠΕΡΙΣΣΟΝΕΧΩ ΣΙΝ·"
        >
          I have come that they may have life, and that they may have it more abundantly.
        </SourceQuote>

        {/* 4 */}
        <h2 className={h2}>4. Life as a lamp</h2>
        <p className={when}>About 1250 to 1650</p>

        <p className={p}>
          Greek medicine had made breathing the guard of an inborn heat. Medieval Latin medicine gave that heat a
          fuel, the &ldquo;radical moisture&rdquo;, and so turned life into a lamp with a fixed supply of oil.
          Pietro d&apos;Abano seats the heat in the moisture{' '}
          <Link href={pg(B.abano, 447)}>like a form in its matter</Link>. Roger Bacon, writing on how to slow old
          age, drew the consequence:
        </p>

        <SourceQuote
          book={slug(B.rbacon)}
          page={138}
          printedPage={86}
          src={IMG('69ac7fdc03ac21d9202385ff', 138)}
          pageAlt="A page of Roger Bacon's Latin treatise on delaying old age, in a 1928 edition with notes"
          source={<>Roger Bacon, <em>De retardatione accidentium senectutis</em> (edition of 1928)</>}
          original="Sed calor naturalis illam paulatim et successiue accidentaliter dissoluit et consumit, et sic est causa extinguendi seipsum"
        >
          For natural heat exists in natural moisture and is nourished by it; and when that moisture is
          dissolved, the heat is diminished and weakened. But natural heat gradually, successively, and
          accidentally dissolves and consumes it, and thus it is the cause of extinguishing itself
        </SourceQuote>

        <p className={p}>
          If life is a lamp, it can be tended. The <em>Regimen senum</em> printed under Arnald of Villanova&apos;s
          name in 1502 says the accidents of old age <Link href={pg(B.regimen, 238)}>can be slowed</Link>. The
          picture lasted. Benedetto Varchi, lecturing in Florence in the sixteenth century, reports that many simply called natural
          heat &ldquo;life&rdquo;, since &ldquo;the natural heat lasts as long as the radical moisture lasts, from
          which it feeds and nourishes itself continuously, not otherwise than the flame of oil&rdquo; (
          <em>Lezzioni</em>, 1590, <Link href={pg(B.varchi, 278)}>p. 253</Link>).
        </p>

        {/* 5 */}
        <h2 className={h2}>5. The living world becomes a programme</h2>
        <p className={when}>1482 to 1620</p>

        <p className={p}>
          That the cosmos is a living creature was an ancient thesis. Plato&apos;s <em>Timaeus</em> calls it{' '}
          <Link href={pg(B.plato, 455)}>a living creature with soul and mind</Link>, and the Hermetic writings
          say the cosmos is <Link href={pg(B.hermetica, 225)}>the fullness of all life</Link>, with nothing in it
          dead. In the Renaissance the world&apos;s life became something one could use. Marsilio Ficino wrote
          that the world is animated &ldquo;just as any animal is, and much more effectively&rdquo;, and that by
          fitting our spirit to the world&apos;s, its goods pass into us (<em>De vita</em>,{' '}
          <Link href={pg(B.ficino1529, 169)}>1529 edition</Link>). Cornelius Agrippa found it{' '}
          <Link href={pg(B.agrippa, 390)}>absurd</Link> that flies and worms should live while the whole world does
          not. William Gilbert, the physician whose <em>De magnete</em> (1600) treated the Earth as a great
          magnet, argued the same from the lodestone:
        </p>

        <SourceQuote
          book={slug(B.gilbert)}
          page={368}
          printedPage={310}
          src={IMG('6953e59677f38f6761bf0f90', 368)}
          pageAlt="A page of Gilbert's book on the magnet in Mottelay's English translation"
          source={<>William Gilbert, <em>On the Loadstone and Magnetic Bodies</em> V.12 (English translation, 1893)</>}
        >
          Pitiable is the state of the stars, abject the lot of earth, if this high dignity of soul is denied
          them, while it is granted to the worm, the ant, the roach, to plants and morels
        </SourceQuote>

        <p className={p}>
          Tommaso Campanella went further: <Link href={pg(B.campanella, 112)}>the whole world feels</Link>, in
          some places more and in others less.
        </p>

        {/* 6 */}
        <h2 className={h2}>6. The body becomes a machine</h2>
        <p className={when}>1637 to 1690</p>

        <p className={p}>
          Descartes asked his readers to look at the body as an engine:
        </p>

        <Quote href={pg(B.discours, 60)} page={56} cite={<>René Descartes, <em>Discours de la méthode</em> (1637)</>}>
          will consider this body as a machine, which, having been made by the hands of God, is incomparably
          better ordered, and has within itself movements more admirable, than any of those that can be invented
          by men.
        </Quote>

        <p className={p}>
          Death, for him, is not the soul leaving. It is a principal part of the body{' '}
          <Link href={pg(B.passions, 71)}>breaking down</Link>, as a clock runs down. Thomas Hobbes then turned the
          question round in the first lines of <em>Leviathan</em>:
        </p>

        <SourceQuote
          book={slug(B.leviathan)}
          page={15}
          src={IMG('69906623ef12272ffdc952c7', 15)}
          pageAlt="The opening page of the Introduction to Hobbes's Leviathan, 1651"
          source={<>Thomas Hobbes, <em>Leviathan</em>, Introduction (London, 1651)</>}
        >
          For seeing life is but a motion of Limbs, the beginning whereof is in some principall part within; why
          may we not say, that all Automata (Engines that move themselves by springs and wheeles as doth a watch)
          have an artificiall life?
        </SourceQuote>

        <div className="max-w-md mx-auto">
          <PageFigure
            src={IMG('69906623ef12272ffdc952c7', 7)}
            alt="Engraved frontispiece of Leviathan: a crowned giant whose body is made of hundreds of small human figures rises over hills and a town, holding a sword and a bishop's crozier."
            href={pg(B.leviathan, 7)}
            source={<><em>Leviathan</em> (London, 1651), frontispiece</>}
          >
            In the Introduction Hobbes calls the state &ldquo;an Artificiall Man&rdquo;, with sovereignty as
            &ldquo;an Artificiall Soul, as giving life and motion to the whole body&rdquo;. The frontispiece draws
            it: a giant made of people.
          </PageFigure>
        </div>

        <p className={p}>
          The words for the matter left over came from the other side. Henry More called matter{' '}
          <Link href={pg(B.more, 22)}>&ldquo;stupid&rdquo;</Link>, and Anne Conway asked what progress{' '}
          <Link href={pg(B.conway, 106)}>dead matter</Link> could ever make. On these pages &ldquo;dead
          matter&rdquo; is the critics&apos; phrase. The mechanists said machine.
        </p>

        {/* 7 */}
        <h2 className={h2}>7. Life against death</h2>
        <p className={when}>1790 to 1904</p>

        <p className={p}>
          After the machine, life had to be defined against it. Kant, in 1790, says an organised being is{' '}
          <Link href={pg(B.kant, 283)}>not merely a machine</Link>, because it has a formative power of its own.
          Ten years later Xavier Bichat gave the definition the century kept:
        </p>

        <SourceQuote
          book={slug(B.bichat)}
          page={15}
          src={IMG('6a8f6204ddd2f57fe0f80809', 15)}
          pageAlt="The opening page of Bichat's Recherches physiologiques, with the heading Article premier"
          source={<>Xavier Bichat, <em>Recherches physiologiques sur la vie et la mort</em> (Paris, 1800)</>}
          original="On cherche dans des considérations abstraites la définition de la vie; on la trouvera, je crois, dans cet aperçu général : la vie est l’ensemble des fonctions qui résistent à la mort."
        >
          People seek the definition of life in abstract considerations; it will be found, I believe, in this
          general insight: life is the set of functions that resist death.
        </SourceQuote>

        <p className={p}>
          The power behind those functions got a name, Lebenskraft, vital force. In 1868 Thomas Huxley mocked
          it: &ldquo;What better philosophical status has &lsquo;vitality&rsquo; than &lsquo;aquosity&rsquo;?&rdquo;
          (<em>Lay Sermons</em>, <Link href={pg(B.huxley, 153)}>p. 137</Link>). Yet two pages earlier he describes
          living matter as kept going by{' '}
          <Link href={pg(B.huxley, 151)}>&ldquo;that continual death which is the condition of its manifesting
          vitality&rdquo;</Link>. The critics retired the word and kept Bichat&apos;s definition. By 1904 Rudolf
          Steiner could note that to speak of a life-force had lately been{' '}
          <Link href={pg(B.steiner, 245)}>the mark of an unscientific mind</Link>.
        </p>

        {/* 8 */}
        <h2 className={h2}>8. The Earth as a living being</h2>
        <p className={when}>1798 to 1851</p>

        <p className={p}>
          The German Romantics did not put a force inside the organism. Schelling, in 1799, defined the
          organism&apos;s existence as <Link href={pg(B.schelling, 275)}>a constant being reproduced</Link>, not a
          state of being, and he set it against the idea of a Lebenskraft. Gustav Fechner carried the thought to
          the whole of nature. In 1848 he wrote that the moderns had left nature{' '}
          <Link href={pg(B.nanna, 54)}>soulless</Link>. In 1851 he made the Earth a living being, and more alive
          than we are:
        </p>

        <SourceQuote
          book={slug(B.zendAvesta)}
          page={394}
          printedPage={388}
          src={IMG('69906312e7b7642c081de690', 394)}
          pageAlt="A page of Fechner's Zend-Avesta in German Fraktur type"
          source={<>Gustav Theodor Fechner, <em>Zend-Avesta</em> (Leipzig, 1851)</>}
          original="die Erde als ein in höherem Sinne lebendiges, selbstständigeres, individueller geartetes Wesen erscheinen zu lassen, als wir selbst sind, wogegen unser eigenes Leben an Fülle und Tiefe sehr in Nachtheil steht"
        >
          &hellip; the equally conspicuous differences between us and the Earth all combine to make the Earth
          appear as a living, more independent, more individually distinct being in a higher sense than we are
          ourselves, whereas our own life falls far short in fullness and depth
        </SourceQuote>

        <p className={p}>
          In the same book he told the modern story as a loss. The body scorns the soul and says its vital force
          will do just as well; &ldquo;then, finally, the vital force is also stripped away from it, and at last,
          everything is done by mechanical force&rdquo; (<Link href={pg(B.zendAvesta, 101)}>p. 95</Link>).
        </p>

        {/* 9 */}
        <h2 className={h2}>9. Life as it is lived</h2>
        <p className={when}>1873 to 1929</p>

        <p className={p}>
          Around 1900 the question moved from the living body to life as it is lived and valued. Nietzsche judged
          history by <Link href={pg(B.nietzsche, 43)}>whether it serves life</Link>. William James, closing his
          Gifford Lectures in 1902, quoted a recent writer with approval:
        </p>

        <SourceQuote
          book={slug(B.james)}
          page={527}
          printedPage={507}
          src={IMG('6990540f38e1fdee57b3681a', 527)}
          pageAlt="A page from the Conclusions of William James's Varieties of Religious Experience"
          source={<>William James, <em>The Varieties of Religious Experience</em> (1902)</>}
        >
          Not God, but life, more life, a larger, richer, more satisfying life, is, in the last analysis, the end
          of religion. The love of life, at any and every level of development, is the religious impulse.
        </SourceQuote>

        <p className={p}>
          Henri Bergson, in 1907: &ldquo;In reality, life is a movement, materiality is the inverse movement, and
          each of these two movements is simple&rdquo; (<em>L&apos;Évolution créatrice</em>,{' '}
          <Link href={pg(B.bergson, 289)}>p. 271</Link>). Alfred North Whitehead, in 1929: &ldquo;Life is a bid
          for freedom&rdquo; (<em>Process and Reality</em>, <Link href={pg(B.whitehead, 175)}>p. 159</Link>).
        </p>

        {/* 10 */}
        <h2 className={h2}>10. Aliveness becomes a feeling</h2>
        <p className={when}>1898 to 1910</p>

        <p className={p}>
          The English noun for a felt aliveness reaches the library&apos;s pages through New Thought, the American
          mind-cure movement. It treats life as a sensation that comes in degrees and can be raised. Thomas
          Troward, in 1904, made &ldquo;livingness&rdquo;{' '}
          <Link href={pg(B.trowardLectures, 20)}>a question of degree</Link>; in 1910 he wrote that Spirit&apos;s
          &ldquo;primary feeling of aliveness must be that of being alive all over&rdquo; (
          <em>The Creative Process in the Individual</em>, <Link href={pg(B.trowardCreative, 31)}>p. 25</Link>).
          William Walker Atkinson, writing as Yogi Ramacharaka, made it an exercise:
        </p>

        <SourceQuote
          book={slug(B.psychicHealing)}
          page={84}
          printedPage={80}
          src={IMG('6991bd2070254d38471e2640', 84)}
          pageAlt="A page headed Chapter IX, Pranic Treatments, from The Science of Psychic Healing"
          source={<>Yogi Ramacharaka, <em>The Science of Psychic Healing</em> (Chicago, 1906)</>}
        >
          Rub the hands to-gether briskly for a few minutes, and then swing them to-and-fro a little while, until
          they have that undefinable feeling of &ldquo;aliveness&rdquo; and be-ing full of Energy.
        </SourceQuote>

        <p className={p}>
          The same author, a year earlier, called <em>prāṇa</em>{' '}
          <Link href={pg(B.scienceOfBreath, 21)}>&ldquo;the Sanskrit term meaning &lsquo;Absolute
          Energy&rsquo;&rdquo;</Link>. The commentary printed with the Haṭhayogapradīpikā says prāṇa is{' '}
          <Link href={pg(B.hypCommentary, 144)}>vāyu, wind</Link>. From about then, Asian words for breath reach
          English as &ldquo;energy&rdquo;.
        </p>

        {/* Practices */}
        <h2 className={h2}>Ways people made life</h2>

        <p className={p}>
          Each definition came with a practice. Where life was a heat burning in a moisture, people rationed the
          fuel. Where it was a spirit made of vapour, they fed it vapours. Where it was a food in the air, they
          tried to catch the food. Where it was breath staying in the body, they held the breath. Where it was a
          soul that could lodge in matter, they made images and called it in.
        </p>

        <h3 className={h3}>Rationing the fire</h3>

        <p className={p}>
          Luigi Cornaro, the Venetian who wrote on the sober life in 1558, weighed his food. At seventy-eight,
          persuaded to eat a little more, he reports that his daily food &ldquo;was exactly weighed at
          twelve ounces, I increased it by two ounces to fourteen; I increased the measure of drink, which was
          fourteen ounces, to sixteen&rdquo;. Within ten days he was ill, and he recovered only by going back to his rule (in Ramazzini&apos;s{' '}
          <em>Opera omnia</em>, <Link href={pg(B.ramazzini, 923)}>p. 834</Link>). Francis Bacon, in 1623, changed
          the premise: the body&apos;s material{' '}
          <Link href={pg(B.fbacon, 17)}>could be repaired almost for ever</Link> if the manner of repair did not
          fail.
        </p>

        <h3 className={h3}>Feeding the spirit</h3>

        <p className={p}>
          Ficino&apos;s <em>De vita</em> (1489) is the library&apos;s fullest text on drawing life in. The
          spirit, being a vapour, is fed by what is like it:
        </p>

        <SourceQuote
          book={slug(B.ficino1529)}
          page={280}
          src={IMG('6969262b4fa3b04c6de87333', 280)}
          pageAlt="A page of Ficino's De vita in a Latin edition of 1529"
          source={<>Marsilio Ficino, <em>De vita</em> III.11 (edition of 1529)</>}
        >
          For this, wine acts as earth; the very scent of wine performs the role of water; song and sound move the
          air; and light represents the fiery element.
        </SourceQuote>

        <p className={p}>
          He sends the old among plants: &ldquo;Let them frequently spend time among green and sweet-smelling
          plants. For these, being living and breathing, breathe forth their essence to increase the spirit of
          man&rdquo; (<em>De triplici vita</em>, 1489, <Link href={pg(B.ficino1489, 90)}>p. 90</Link>).
        </p>

        <h3 className={h3}>A food of life in the air</h3>

        <p className={p}>
          Around 1600 the alchemists moved the source of life outside the body. Michael Sendivogius:
        </p>

        <SourceQuote
          book={slug(B.musaeum)}
          page={597}
          printedPage={579}
          src={IMG('c87fadfa-1543-44b9-a138-573c144246e6', 597)}
          pageAlt="A page of Sendivogius's Novum lumen chemicum in the Musaeum Hermeticum"
          source={<>Michael Sendivogius, <em>Novum lumen chemicum</em> (1604), in the <em>Musaeum Hermeticum</em> (1678)</>}
          original="Creatus homo de terra, ex aere vivit: est enim in aere occultus vitæ cibus, quem nos rorem de nocte, de die aquam vocamus rarefactam"
        >
          Man, created from the earth, lives from the air: for there is in the air a hidden food of life, which we
          call dew by night, and by day rarefied water, whose invisible spirit, once congealed, is better than the
          whole earth.
        </SourceQuote>

        <p className={p}>
          Johann Glauber, in 1659, put it more exactly: life is{' '}
          <Link href={pg(B.glauber, 160)}>dispersed invisibly in the air</Link>, like a little salt in much water.
          A medicine, then, had to be made alive itself.
        </p>

        <h3 className={h3}>Holding the breath</h3>

        <p className={p}>
          In India the definition of life became the method:
        </p>

        <SourceQuote
          book={slug(B.hyp)}
          page={58}
          src={IMG('6a0e54e98831ddc9459ad225', 58)}
          pageAlt="A page of the Haṭhayogapradīpikā in Sanskrit with commentary, printed in 1867"
          source={<>Svātmārāma, <em>Haṭhayogapradīpikā</em> II.3 (Sanskrit, 1867)</>}
          original="यावद्वायुः स्थितो देहे तावज्जीवनमुच्यते ॥ मरणं तस्य निष्क्रांतिस्ततो वायुं निरोधयेत्"
        >
          As long as the breath remains in the body, it is called life. Its departure is death. Therefore, one
          should restrain the breath.
        </SourceQuote>

        <p className={p}>
          The same page joins breath to mind: &ldquo;When the breath moves, the mind moves. When the breath is
          still, the mind becomes still.&rdquo; Chinese masters taught a breathing that needs neither nose nor
          mouth: &ldquo;The reason humans do not die lies within Embryonic Breathing&rdquo; (<em>Daozang
          jinghua</em>, <Link href={pg(B.taoistCanon, 123)}>p. 123</Link>). Zhang Boduan warned against forcing it: some,
          he says, <Link href={pg(B.daoyan, 210)}>store up cold breath and make themselves ill</Link>.
        </p>

        <h3 className={h3}>Elixirs</h3>

        <p className={p}>
          Ge Hong, about 320, explains why gold should lengthen life. Buried in the earth, gold never decays; of
          the two elixirs made with it he writes that &ldquo;they refine the human body, and can thus cause a person never to age and never to die. This is
          indeed borrowing external substances to strengthen oneself&rdquo; (<em>Baopuzi</em>,{' '}
          <Link href={pg(B.baopuzi, 62)}>p. 62</Link>). The Caraka Saṃhitā remembers a time when &ldquo;those
          devoted to rasāyana lived for thousands of years without aging, weakness, exhaustion, or death&rdquo; (
          <Link href={pg(B.caraka, 565)}>p. 565</Link>). In Europe, Paracelsus defined life to fit the remedy: it is{' '}
          <Link href={pg(B.paracelsus, 87)}>&ldquo;a certain balsamic mummy&rdquo;</Link>, what keeps the body
          from rotting.
        </p>

        <h3 className={h3}>Making things alive</h3>

        <p className={p}>
          Augustine preserves a passage of the Hermetic <em>Asclepius</em> on statues that people made and
          animated:
        </p>

        <SourceQuote
          book={slug(B.augustine)}
          page={204}
          src={IMG('699062f5ef12272ffdc8e9d5', 204)}
          pageAlt="A page of Augustine's City of God in a fifteenth-century printed edition, in two columns of gothic type"
          source={<>Augustine, <em>De civitate Dei</em> VIII.23 (printed edition, 15th century)</>}
        >
          Statues animated, full of sense and spirit, doing such great and many things; statues with foreknowledge
          of the future, predicting things which perhaps every prophet might be ignorant of in many and various
          matters;
        </SourceQuote>

        <p className={p}>
          Thomas Browne, in 1642, claimed to call a plant back from its ashes: &ldquo;This I make good by
          experience, and can from the ashes of a plant revive the plant, and from its cinders recall it to its
          stalk and leaves againe&rdquo; (<em>Religio Medici</em>, <Link href={pg(B.browne, 118)}>p. 114</Link>).
          Francesco Redi, in 1668, tested the older belief that life arises from rot: from corpses, unless seed is
          brought to them, <Link href={pg(B.redi, 87)}>no animal of any kind is born</Link>. And after Hobbes a
          self-moving engine could count as an artificial life without any rite at all.
        </p>

        <h3 className={h3}>Living places</h3>

        <p className={p}>
          Some places were already alive, and the work was to stand rightly toward them. Hildegard of Bingen, in
          the twelfth century:
        </p>

        <SourceQuote
          book={slug(B.hildegard)}
          page={245}
          printedPage={231}
          src={IMG('6953c67c77f38f6761bd9970', 245)}
          pageAlt="A page of Hildegard's Physica in a printed edition of the Latin text"
          source={<>Hildegard of Bingen, <em>Physica</em></>}
          original="Et tunc viriditas terre et graminum maxime vigent, quia aer tunc adhuc frigidus est et sol iam calidus, et tunc herbe viriditatem tam fortiter sugunt, ut agnus qui lac sugit"
        >
          At that time, the greenness of the earth and the grasses is at its strongest, because the air is still
          cold and the sun is already warm. The herbs drink in this greenness as strongly as a lamb drinks milk
        </SourceQuote>

        <p className={p}>
          A dissertation of 1688 says the ancients gave a guardian genius to{' '}
          <Link href={pg(B.wagner, 12)}>every kingdom, province, city and people</Link>. Han Yu, the Tang
          official exiled to Chaozhou, wrote that &ldquo;the spirits of the mountains and rivers provide
          protection to the people; the officials shall establish shrines and halls&rdquo; (in the{' '}
          <em>Peiwen yunfu</em>, <Link href={pg(B.peiwen, 34)}>p. 34</Link>).
        </p>

        {/* The word */}
        <h2 className={h2}>The word itself</h2>

        <p className={p}>
          The English noun &ldquo;aliveness&rdquo;, for something felt, first appears on the library&apos;s pages
          in 1898, in the autobiography of Helen Wilmans, a New Thought writer:
        </p>

        <SourceQuote
          book={slug(B.wilmans)}
          page={94}
          printedPage={88}
          src={IMG('6a9549e3643ca3182d7d69e8', 94)}
          pageAlt="The opening page of Chapter V of Helen Wilmans's A Search for Freedom"
          source={<>Helen Wilmans, <em>A Search for Freedom</em> (1898), ch. V</>}
        >
          The aptest word I can apply to myself as a child is &ldquo;aliveness.&rdquo; I was &mdash; in my own way
          &mdash; tremendously alive. That this aliveness was not expressed in great bodily activity is no reason
          for doubting that the condition existed.
        </SourceQuote>

        <p className={p}>
          She puts the word in quotation marks, as if it needed excusing, and on the same page says the aliveness
          showed in her love of living things and a pang at killing anything. On these pages the word is about
          130 years old. What it names is breath kept in the body, heat fed by moisture, a spirit fed by wine and
          light, a world that feels, an Earth more alive than we are.
        </p>

        <h2 className={h2}>Explore further</h2>

        <p className={p}>
          The <Ext href={ATLAS}>Aliveness Atlas</Ext> maps passages from the library on four kinds of aliveness:
          the felt, the world as alive, made things, and the inhabited world. Its{' '}
          <Ext href={VOCABULARY}>vocabulary map</Ext> links the words above to each other and to the pages they
          are quoted from. The library&apos;s own essays follow some of these threads further:{' '}
          <Link href="/articles/fechner-bohme">Fechner and Böhme</Link> on the ensouled world, and{' '}
          <Link href="/articles/harmony-map">Eleven Ideas About Harmony</Link>, where Ficino&apos;s spirit appears
          again.
        </p>
      </article>
    </ContentPageLayout>
  );
}
