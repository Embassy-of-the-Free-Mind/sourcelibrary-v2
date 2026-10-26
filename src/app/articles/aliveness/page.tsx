import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import SourceQuote from '@/components/articles/SourceQuote';
import PageFigure from '@/components/articles/PageFigure';

// Every quotation is copied from the stored text of the page it links to, re-checked against
// /api/books/<id>/quote?page=N on 26 October 2026 (#7458). Notes and glosses the translation inserts
// inside a quoted sentence are left out (the Zhuangzi page glosses qi; the Taoist canon page explains
// Taixi). Each claim is a verified claim in the aliveness knowledge base: the soul layer follows its
// ideas/01-lexicon.md, the table and the five shifts ideas/03-making-aliveness.md, the ten turning points
// ideas/02-turning-points.md.

const TITLE = 'What Is Alive? Ten Turning Points';
const DESCRIPTION =
  'How the answer to what makes a thing alive changed, from soul and breath to machine, force and feeling, and what people did in each age to keep or gain more life.';
// Cropped from the title page (scan 1) to the circle, so the title does not sit on the printed lettering.
const HERO = '/articles/aliveness/fludd-microcosm.jpg';
const HERO_ALT =
  "Title page of Robert Fludd's Utriusque cosmi historia (1617): a naked man stands with arms outstretched inside the circles of the heavens, labelled Microcosmus inside Macrocosmus, ringed by clouds.";

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

// The books cited, roughly in the order they first appear.
const B = {
  fludd: '/book/utriusque-cosmi-historia-1617-fludd',
  diels: '/book/die-fragmente-der-vorsokratiker-diels',
  isidore: '/book/etymologiae-de-summo-bono-1483-incunabulum-seville',
  ficino1529: '/book/de-vita-libri-tres-three-books-on-life-1529-ficino',
  rbacon: '/book/de-retardatione-accidentium-senectutis-bacon',
  wenzel: '/book/unterhaltungen-uber-die-auffallendsten-neuern-wenzel',
  kant: '/book/kritik-der-urteilskraft-german-kant',
  schopenhauer: '/book/die-welt-als-wille-und-vorstellung-schopenhauer',
  wilmans: '/book/a-search-for-freedom-wilmans',
  phaedrus: '/book/euthyphro-apology-crito-phaedo-phaedrus-loeb-l036-plato',
  aristotleOpera: '/book/aristotelis-opera-complete-works-aristotle',
  hammond: '/book/aristotle-s-psychology-de-anima-and-parva-naturalia-hammond',
  hayy: '/book/philosophus-autodidactus-tufayl',
  menasseh: '/book/de-resurrectione-mortuorum-libri-iii-israel',
  plato: '/book/platonis-opera-republic-timaeus-critias-plato',
  lucretius: '/book/lucretius-navagero-andrea',
  plotinus: '/book/five-books-of-plotinus-taylor',
  ficino1582: '/book/les-trois-livres-de-la-vie-ficino',
  agrippa: '/book/three-books-of-occult-philosophy-agrippa',
  bruno: '/book/opera-latine-conscripta-vol-iii-de-magia-de-vinculis-bruno',
  weltseele: '/book/von-der-weltseele-schelling',
  nanna: '/book/nanna-oder-uber-das-seelenleben-der-pflanzen-fechner',
  haeckel: '/book/the-riddle-of-the-universe-haeckel',
  cudworth: '/book/the-true-intellectual-system-of-the-universe-cudworth',
  cavendish: '/book/observations-upon-experimental-philosophy-with-the-blazing-cavendish',
  spinoza: '/book/ethica-latin-original-spinoza',
  zhuangzi: '/book/zhuangzi-with-commentary-vol-3-zhuangzi',
  hyp: '/book/hathayogapradipika-sanskrit-1867-svatmarama',
  augustine: '/book/de-civitate-dei-augustine',
  secretum: '/book/secreta-secretorum-aristotelis-pseudo-aristotle',
  musaeum: '/book/musaeum-hermeticum-1677-edition-jennis',
  leviathan: '/book/leviathan-1651-first-edition-hobbes',
  bichat: '/book/recherches-physiologiques-sur-la-vie-et-la-mort-bichat',
  psychicHealing: '/book/the-science-of-psychic-healing-atkinson',
  zunsheng: '/book/vol-7-1782366595479',
  taoistCanon: '/book/essence-of-taoist-canon-masters',
  caraka: '/book/caraka-samhita-charaka',
  ramazzini: '/book/opera-omnia-medica-et-physiologica-ramazzini',
  ficino1489: '/book/three-books-on-life-ficino-2',
  baopuzi: '/book/baopuzi-neipian-inner-chapters-of-the-master-who-embraces-hong',
  paracelsus: '/book/five-books-on-long-life-paracelsus',
  browne: '/book/religio-medici-1642-first-edition-browne',
  fbacon: '/book/history-of-life-and-death-bacon',
  glauber: '/book/des-teutschlandts-wohlfart-4-darinnen-viel-herrliche-vnd-glauber',
  thoughtVibration: '/book/thought-vibration-or-the-law-of-attraction-in-the-thought-atkinson',
  peiwen: '/book/vol-515',
  wagner: '/book/diss-de-cognitione-naturali-existentiae-angelicae-wagner',
  kircher: '/book/obeliscus-pamphilius-kircher',
  tertullian: '/book/scripta-1550-tertullian',
  upanishads: '/book/the-upanishads-part-1-sbe-vol-1-trans',
  aristotleWorks: '/book/the-works-of-aristotle-vol-3-de-mundo-aristotle',
  elzevir: '/book/novum-testamentum-graece-elzevir-1633-textus-receptus-receptus',
  lascaris: '/book/lascaris-de-octo-partibus-orationis-greek-grammar-aldine-lascaris',
  basel: '/book/basel-universitatsbibliothek-an-iii-12-anonymous',
  abano: '/book/conciliator-differentiarum-philosophorum-et-medicorum-d-abano',
  regimen: '/book/regimen-sanitatis-add-arnoldus-de-villa-nova-phlebotomia-hippocrates-astronomia-',
  varchi: '/book/lezzioni-dell-accademia-fiorentina-varchi',
  gilbert: '/book/on-the-loadstone-and-magnetic-bodies-english-translation-gilbert',
  campanella: '/book/de-sensu-rerum-et-magia-campanella',
  discours: '/book/discours-de-la-methode-descartes',
  passions: '/book/passiones-animae-descartes',
  more: '/book/a-collection-of-several-philosophical-writings-of-dr-henry-more',
  conway: '/book/principia-philosophiae-antiquissimae-et-recentissimae-helmont',
  huxley: '/book/lay-sermons-addresses-and-reviews-huxley',
  steiner: '/book/theosophy-an-introduction-to-the-supersensible-knowledge-of-the-world',
  schelling: '/book/erster-entwurf-eines-systems-der-naturphilosophie-schelling-2',
  zendAvesta: '/book/zend-avesta-fechner',
  nietzsche: '/book/unzeitgemasse-betrachtungen-nietzsche',
  james: '/book/the-varieties-of-religious-experience-james',
  vitalReserves: '/book/on-vital-reserves-the-energies-of-men-james',
  bergson: '/book/l-evolution-creatrice-bergson',
  whitehead: '/book/process-and-reality-whitehead',
  trowardLectures: '/book/the-edinburgh-lectures-on-mental-science-troward',
  trowardCreative: '/book/the-creative-process-in-the-individual-troward',
  scienceOfBreath: '/book/science-of-breath-atkinson',
  hypCommentary: '/book/light-on-hatha-yoga-hathayogapradipika-with-commentaries-svatmarama',
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

// Aristotle's ladder of souls, drawn as nested boxes: each kind of soul contains the powers of the one
// outside it. The powers are the ones De anima II.2 lists as ways of living.
const LADDER = [
  { soul: 'Nutritive soul', who: 'plants, animals and people', powers: 'nourishment, growth, decay, generation' },
  { soul: 'Sensitive soul', who: 'animals and people', powers: 'sensation, desire, movement from place to place' },
  { soul: 'Rational soul', who: 'people', powers: 'intellect' },
];

function Ladder() {
  const box = (i: number): React.ReactNode => {
    const l = LADDER[i];
    return (
      <div className={`border border-accent-gold/60 rounded-sm ${i === 0 ? 'p-4 md:p-6' : 'p-3 md:p-5 mt-3'} ${i % 2 ? 'bg-white/60' : 'bg-cream'}`}>
        <p className="text-primary text-base md:text-lg">{l.soul}</p>
        <p className="text-xs text-muted font-body italic">{l.who}</p>
        <p className="text-sm text-secondary font-body mt-1">{l.powers}</p>
        {i + 1 < LADDER.length && box(i + 1)}
      </div>
    );
  };
  return (
    <figure className="not-prose my-10 max-w-xl mx-auto">
      {box(0)}
      <figcaption className="mt-2 text-sm text-muted leading-relaxed">
        Aristotle&apos;s ladder of living things, after <em>De anima</em> II. Each kind of soul holds the powers
        of the one around it: a plant only feeds and grows, an animal also senses and moves, a person also
        thinks.
      </figcaption>
    </figure>
  );
}

// What life was, where it lived and what people did, age by age (ideas/03-making-aliveness.md). On a phone
// each row stacks; from tablet width up it is a four-column table.
const ERAS: { era: string; was: string; where: string; did: string; quote: React.ReactNode }[] = [
  {
    era: 'Greece, 500 to 300 BCE',
    was: 'A soul that moves itself; a heat kept up',
    where: 'In the air breathed in, and the heat of the heart',
    did: 'Breathe; feed the inborn fire by age, much food for the growing, little for the old',
    quote: <>&ldquo;life is the maintenance of this heat&rdquo; (Aristotle, <Link href={pg(B.hammond, 416)}>p. 324</Link>)</>,
  },
  {
    era: 'China, from the 4th century BCE',
    was: 'Qi gathered',
    where: 'In the body’s essence, breath and spirit',
    did: 'Stop the leaks of the senses; embryonic breathing; elixirs of gold and cinnabar',
    quote: <>&ldquo;The ears are the apertures of jing essence, the eyes are the apertures of shen spirit, and the mouth is the aperture of qi vital breath&rdquo; (<em>Zunsheng bajian</em>, <Link href={pg(B.zunsheng, 82)}>p. 82</Link>)</>,
  },
  {
    era: 'India, from the Upaniṣads',
    was: 'Breath staying in the body',
    where: 'In prāṇa, which the commentators call wind',
    did: 'Regulate and hold the breath; rasāyana, rejuvenation by medicines',
    quote: <>&ldquo;As long as the breath remains in the body, it is called life&rdquo; (<em>Haṭhayogapradīpikā</em>, <Link href={pg(B.hyp, 58)}>p. 58</Link>)</>,
  },
  {
    era: 'Late antiquity',
    was: 'A soul or god that can lodge in matter',
    where: 'In statues and images prepared for it',
    did: 'Make statues and call the gods into them by rite',
    quote: <>&ldquo;Statues animated, full of sense and spirit&rdquo; (Augustine, <Link href={pg(B.augustine, 204)}>p. 204</Link>)</>,
  },
  {
    era: 'Medieval medicine, 1250 to 1600',
    was: 'An inborn heat burning a fixed store of moisture, like a lamp',
    where: 'In the heart and the radical moisture',
    did: 'Regimen: measured food, drink, sleep and exercise; temperance; the care of the old',
    quote: <>&ldquo;he who guards himself against superfluity and indigence by preserving equality and temperance will receive healthy salvation and length of days&rdquo; (<em>Secretum secretorum</em>, <Link href={pg(B.secretum, 33)}>p. 33</Link>)</>,
  },
  {
    era: 'Renaissance, 1480 to 1620',
    was: 'A spirit, a warm bright vapour of the blood, fed by the spirit of a living world',
    where: 'In the blood, and in the world around',
    did: 'Feed the spirit with wine, scent, song and sunlight; live among green plants; wear gold and gems',
    quote: <>&ldquo;wine acts as earth; the very scent of wine performs the role of water; song and sound move the air&rdquo; (Ficino, <Link href={pg(B.ficino1529, 280)}>p. 280</Link>)</>,
  },
  {
    era: 'Alchemy, 1350 to 1660',
    was: 'A balsam that keeps the body from rotting; a food of life in the air',
    where: 'In the quintessence, and in the dew',
    did: 'Distil the quintessence and the elixir; make gold drinkable; catch the food of life from the air',
    quote: <>&ldquo;there is in the air a hidden food of life&rdquo; (Sendivogius, <Link href={pg(B.musaeum, 597)}>p. 579</Link>)</>,
  },
  {
    era: 'The mechanists, 1630 to 1750',
    was: 'The motion of an engine',
    where: 'In springs and wheels, and the parts of the body',
    did: 'Build automata; repair the body, as Francis Bacon proposed',
    quote: <>&ldquo;why may we not say, that all Automata ... have an artificiall life?&rdquo; (Hobbes, <Link href={pg(B.leviathan, 15)}>p. 15</Link>)</>,
  },
  {
    era: 'The vitalists, 1790 to 1900',
    was: 'The functions that resist death; a vital force that spends itself',
    where: 'In the organisation of the body',
    did: 'Spare the stock of life; living itself was counted a slow dying',
    quote: <>&ldquo;life is the set of functions that resist death&rdquo; (Bichat, <Link href={pg(B.bichat, 15)}>p. 15</Link>)</>,
  },
  {
    era: 'New Thought, 1898 to 1910',
    was: 'A feeling, in degrees',
    where: 'In the person who feels it',
    did: 'Rub the hands until they feel alive; will it; “put LIFE into you”',
    quote: <>&ldquo;that undefinable feeling of &lsquo;aliveness&rsquo;&rdquo; (Ramacharaka, <Link href={pg(B.psychicHealing, 84)}>p. 80</Link>)</>,
  },
];

function Eras() {
  const label = 'md:hidden text-xs uppercase tracking-wide text-muted font-body';
  return (
    <div className="not-prose my-10 md:-mx-16">
      <div className="hidden md:grid grid-cols-[9rem_1fr_1fr_1.3fr] gap-x-5 border-b border-accent-gold/60 pb-2 text-xs uppercase tracking-wide text-muted font-body">
        <span>When</span>
        <span>What life was</span>
        <span>Where it lived</span>
        <span>What people did</span>
      </div>
      {ERAS.map((e) => (
        <div key={e.era} className="border-b border-accent-gold/30 py-4 grid gap-y-2 md:grid-cols-[9rem_1fr_1fr_1.3fr] md:gap-x-5">
          <p className="text-primary font-body text-sm md:text-sm">{e.era}</p>
          <div>
            <p className={label}>What life was</p>
            <p className="text-primary font-body text-sm">{e.was}</p>
          </div>
          <div>
            <p className={label}>Where it lived</p>
            <p className="text-secondary font-body text-sm">{e.where}</p>
          </div>
          <div>
            <p className={label}>What people did</p>
            <p className="text-secondary font-body text-sm">{e.did}</p>
            <p className="text-muted font-body text-xs italic mt-1">{e.quote}</p>
          </div>
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
          subtitle="Soul, breath, heat, machine, force and feeling: how the answer to what makes a thing alive changed, and what people did about it"
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">26 October 2026 &middot; 18 min read</p>
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
          is: a soul, a breath, a heat, a machine, a force, a feeling. Each answer changed what they did to stay
          alive.
        </p>

        <p className={p}>
          Every quotation links to the page it is printed on.
          The picture above is from the title page of Robert Fludd&apos;s{' '}
          <Link href={pg(B.fludd, 1)}>
            <em>Utriusque cosmi historia</em> (1617)
          </Link>
          : a man inside the circles of the heavens, the small world, <em>microcosmus</em>, inside the great one,{' '}
          <em>macrocosmus</em>.
        </p>

        <p className={p}>Eight words carried most of the argument:</p>

        <Lexicon />

        {/* Soul */}
        <h2 className={h2}>Life as soul</h2>

        <p className={p}>
          For most of the time these books cover, to be alive was to have a soul. The Greek word{' '}
          <em>empsychos</em>, &ldquo;ensouled&rdquo;, simply meant living. Plato made the soul the thing that moves
          itself:
        </p>

        <Quote href={pg(B.phaedrus, 498)} page={471} cite={<>Plato, <em>Phaedrus</em> 245e, Loeb edition (1913)</>}>
          For every body which derives motion from without is soulless, but that which has its motion within
          itself has a soul, since that is the nature of the soul
        </Quote>

        <h3 className={h3}>Aristotle&apos;s ladder</h3>

        <p className={p}>
          Aristotle turned the soul into a test anyone could apply. A thing is alive if it does any one of a
          short list of things:
        </p>

        <SourceQuote
          book={slug(B.aristotleOpera)}
          page={421}
          printedPage={413}
          src={IMG('699376e7b0a84a5763961e8f', 421)}
          pageAlt="A page of Aristotle's De anima in Greek, with notes, in Bekker's edition"
          source={<>Aristotle, <em>De anima</em> II.2, 413a, in <em>Aristotelis opera</em> (1831)</>}
          original="διωρίσθαι τὸ ἔμψυχον τοῦ ἀψύχου τῷ ζῆν. πλεοναχῶς δὲ τοῦ ζῆν λεγομένου, κἂν ἕν τι τούτων ἐνυπάρχῃ μόνον, ζῆν αὐτό φαμεν"
        >
          we must start our inquiry by distinguishing the ensouled from the unsouled by the presence of life.
          Since &ldquo;living&rdquo; is said in many ways, if even one of these exists, we say the thing is alive:
          such as intellect, sensation, local movement and rest, and furthermore the movement regarding
          nutrition, decay, and growth.
        </SourceQuote>

        <p className={p}>
          So plants live, &ldquo;for they clearly possess a power and a principle by which they receive growth and
          decay&rdquo;. The lowest of these powers is the one everything living shares. The nutritive soul, he
          says, is &ldquo;the first and most common faculty of the soul, according to which life belongs to
          all. Its works are to generate and to use food&rdquo; (<Link href={pg(B.aristotleOpera, 423)}>p.
          415</Link>). Above it the animals add sensation and movement, and people add thought. Each soul contains
          the ones below it, like boxes inside boxes:
        </p>

        <Ladder />

        <p className={p}>
          The ladder lasted two thousand years. In the twelfth century Ibn Tufayl told it as a story. His Hayy
          ibn Yaqzan grows up alone on an island, nursed by a gazelle. When she dies he cuts open her chest to
          find what has stopped, and finds the left chamber of the heart empty: &ldquo;I see only that my object
          was in it, then it departed and left it vacant&rdquo; (<Link href={pg(B.hayy, 82)}>p. 58</Link>). Later
          he opens a living animal to see what leaves:
        </p>

        <SourceQuote
          book={slug(B.hayy)}
          page={89}
          printedPage={65}
          src={IMG('69e7934280b52390feb18445', 89)}
          pageAlt="A page of Arabic text from Pococke's 1671 edition of Hayy ibn Yaqzan"
          source={<>Ibn Tufayl, <em>Hayy ibn Yaqzan</em> (Pococke&apos;s edition, Oxford, 1671)</>}
          original="فراي ذلك الفراغ مملوا بهوا بخاري شبه الضباب الابيض فادخل اصبعه فيه فوجده من الحرارة في حد كان يحرقه ومات ذلك الحيوان علي الفور فصح عنده ان ذلك البخار الرطب هو الذي كان يحرك هذا الحيوان"
        >
          He saw that void space full of a vaporous air, like a white mist. He inserted his finger into it and
          found it to be so hot that it burned him, and that animal died on the spot. So it became clear to him
          that this moist vapor was what had moved this animal
        </SourceQuote>

        <p className={p}>
          From this he concludes that each animal, many as its organs are, &ldquo;is one through that
          spirit&rdquo; (<Link href={pg(B.hayy, 90)}>p. 66</Link>). Jewish tradition gave the soul a ladder of
          its own. Menasseh ben Israel, citing the Midrash in 1636, writes that &ldquo;the soul of man has five
          names, namely Nefesh, Ruach, Neshamah, Chayah, and Yechidah&rdquo; (
          <em>De resurrectione mortuorum</em>, <Link href={pg(B.menasseh, 103)}>p. 59</Link>), and he matches the
          lowest, nefesh, to the vegetative soul and ruach to the sensitive one.
        </p>

        <h3 className={h3}>The soul of the world</h3>

        <p className={p}>
          If having a soul is being alive, then the cosmos, which moves itself, has a soul too. Plato&apos;s{' '}
          <em>Timaeus</em> says so:
        </p>

        <Quote href={pg(B.plato, 455)} page={455} cite={<>Plato, <em>Timaeus</em> 30b, in <em>Platonis opera</em> (1902)</>}>
          Thus, according to a likely account, one must say that this world came to be as a living creature,
          endowed with soul and intelligence, in truth, through the providence of the god.
        </Quote>

        <p className={p}>
          It was never agreed: Lucretius held that earth, sun and sky{' '}
          <Link href={pg(B.lucretius, 187)}>lack vital motion and sense</Link>. But Plotinus made all things{' '}
          <Link href={pg(B.plotinus, 260)}>parts of one universal animal</Link>. Ficino
          gave the world soul an instrument, a spirit through which it acts on bodies: in a French edition of
          1582, &ldquo;the Spirit of the World, which is the first instrument of the Soul of the World ... the most
          life-giving, the most forming, the most similar to light, the most similar to life&rdquo; (
          <Link href={pg(B.ficino1582, 236)}>fol. 100v</Link>). Agrippa and{' '}
          <Link href={pg(B.bruno, 565)}>Giordano Bruno</Link> took it up. In 1798 Schelling gave it a new name in
          German science:
        </p>

        <Quote href={pg(B.weltseele, 323)} page={305} cite={<>F. W. J. Schelling, <em>Von der Weltseele</em> (1798)</>}>
          Since this principle maintains the continuity of the inorganic and the organic worlds and links the
          whole of nature into a universal organism, we recognize in it once again that being which the most
          ancient philosophy presciently hailed as the common soul of nature
        </Quote>

        <p className={p}>
          Fechner, fifty years later, complained that the moderns had left nature{' '}
          <Link href={pg(B.nanna, 54)}>soulless</Link>.
        </p>

        <h3 className={h3}>The split</h3>

        <p className={p}>
          Descartes ended the ladder by keeping only its top rung, the thinking soul of people. As Ernst Haeckel
          summed it up in 1899, Descartes &ldquo;contended that man alone had a true &lsquo;soul,&rsquo; and,
          consequently, sensation and free will, and that the animals were mere automata, or machines, without
          will or sensibility&rdquo; (<em>The Riddle of the Universe</em>, <Link href={pg(B.haeckel, 122)}>p.
          99</Link>). Others refused the split. Ralph Cudworth kept a lowest life in nature itself, a
          &ldquo;Plastick and Vegetative Life of Nature the Lowest of all Lives, and Inferiour to the
          Sensitive&rdquo; (<Link href={pg(B.cudworth, 198)}>p. 180</Link>). Margaret Cavendish went the other
          way and put life into all matter:
        </p>

        <Quote href={pg(B.cavendish, 467)} page={51} cite={<>Margaret Cavendish, <em>Observations upon Experimental Philosophy</em> (1666)</>}>
          In short, all parts or degrees of Matter are living and knowing, but not all are self-moving, but onely
          the animate.
        </Quote>

        <p className={p}>
          Spinoza, in 1677, said the same of every individual thing: &ldquo;all of which, although in different
          degrees, are nevertheless animate&rdquo; (<em>Ethica</em>, <Link href={pg(B.spinoza, 52)}>p. 37</Link>).
        </p>

        {/* Table */}
        <h2 className={h2}>What life was, and what people did about it</h2>

        <p className={p}>
          What people did followed from what they took life to be. Physicians who thought it a heat burning in
          a moisture rationed food and drink. Ficino, for whom it was a vapour, fed it with vapours. Alchemists
          who found it in the air tried to catch it there. Yogis, for whom it was breath kept in the body, held
          the breath. Priests who thought a god could lodge in matter made statues and called it in.
        </p>

        <Eras />

        <p className={p}>Three of these practices, on their pages. Ficino on what feeds the spirit:</p>

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

        <p className={p}>Michael Sendivogius on the food of life in the air:</p>

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

        <p className={p}>And the Haṭhayogapradīpikā, where the definition of life becomes the method:</p>

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

        {/* Shifts */}
        <h2 className={h2}>Five shifts</h2>

        <p className={p}>
          <strong className="text-primary">1. From keeping a finite store to drawing life from the world.</strong>{' '}
          Medieval regimen rationed a fire that, in Roger Bacon&apos;s words, is &ldquo;the cause of extinguishing
          itself&rdquo; (<Link href={pg(B.rbacon, 138)}>p. 86</Link>). Cornaro, at seventy-eight, weighed his
          daily food at twelve ounces and fell ill when he raised it to fourteen (
          <Link href={pg(B.ramazzini, 923)}>p. 834</Link>). Ficino then fed the spirit from wine, song, light and
          the world&apos;s own spirit, and around 1600 the alchemists found a food of life in the air. China moved
          the other way, from swallowing gold, which Ge Hong called &ldquo;borrowing external substances to
          strengthen oneself&rdquo; (<Link href={pg(B.baopuzi, 62)}>p. 62</Link>), to refining the breath within.
        </p>

        <p className={p}>
          <strong className="text-primary">2. From fuel to repair, and back to a stock.</strong> Francis Bacon, in
          1623, said the body&apos;s material <Link href={pg(B.fbacon, 17)}>could be repaired almost for ever</Link>{' '}
          if the manner of repair did not fail. Around 1800 life became a stock again: if life is vital force put
          to work, then living is <Link href={pg(B.wenzel, 107)}>at the same time a gradual dying</Link>, and
          Bichat defined life as the functions that resist death.
        </p>

        <p className={p}>
          <strong className="text-primary">3. From installing a soul to building a mechanism.</strong> Statues
          received gods by rite, and plants, Thomas Browne claimed, could be called back from their ashes (
          <Link href={pg(B.browne, 118)}>p. 114</Link>). After Hobbes, a self-moving engine counted as &ldquo;an
          artificiall life&rdquo; with no rite at all.
        </p>

        <p className={p}>
          <strong className="text-primary">4. From a substance to a felt quality.</strong> By 1906 the practice was
          to rub the hands until they felt alive. W. W. Atkinson told his readers: &ldquo;Now I wish to put LIFE
          into you&rdquo; (<em>Thought Vibration</em>, <Link href={pg(B.thoughtVibration, 97)}>p. 62</Link>). The
          practice now worked on a sensation.
        </p>

        <p className={p}>
          <strong className="text-primary">5. What stayed: the inhabited land.</strong> In every period, places
          were treated as alive already, to be honoured rather than made. A dissertation of 1688 says the ancients gave a guardian genius to{' '}
          <Link href={pg(B.wagner, 12)}>every kingdom, province, city and people</Link>. Han Yu, the Tang official
          exiled to Chaozhou, wrote that &ldquo;the spirits of the mountains and rivers provide protection to the
          people; the officials shall establish shrines and halls&rdquo; (<em>Peiwen yunfu</em>,{' '}
          <Link href={pg(B.peiwen, 34)}>p. 34</Link>).
        </p>

        {/* Turning points */}
        <h2 className={h2}>Ten turning points</h2>

        <p className={p}>
          Ten moments when the answer changed, each with a line from the page where it was written.
        </p>

        <h3 className={h3}>1. Breath becomes soul</h3>
        <p className={when}>6th century BCE to about 210 CE</p>

        <p className={p}>
          Anaximenes, as later writers report him, made the soul air: &ldquo;Just as our soul,&rdquo; he says,
          &ldquo;being air, holds us together, so do breath and air encompass the whole world&rdquo; (Diels,{' '}
          <em>Die Fragmente der Vorsokratiker</em>, <Link href={pg(B.diels, 47)}>p. 26</Link>). In Genesis God
          blows the <Link href={pg(B.kircher, 268)}>breath of life</Link> into Adam&apos;s nostrils. By about 210
          Tertullian had made breath the test:
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
          India reached the same place on its own: &ldquo;Breath indeed is the oldest and the best&rdquo; (Müller,{' '}
          <em>The Upanishads</em>, <Link href={pg(B.upanishads, 184)}>p. 72</Link>).
        </p>

        <h3 className={h3}>2. Aristotle defines life by what a body does</h3>
        <p className={when}>About 350 BCE</p>

        <p className={p}>
          Before Aristotle, the Greek sign of a soul was moving oneself; Thales gave the magnet a soul{' '}
          <Link href={pg(B.aristotleWorks, 206)}>because it moves iron</Link>. Aristotle gave a definition:
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
          Elsewhere he adds that an animal is warm and moist, and{' '}
          <Link href={pg(B.aristotleWorks, 402)}>to live is to be so</Link>, while old age and the corpse are dry and
          cold. In China, at about the same time, Zhuangzi placed life in how the body&apos;s stuff is held
          together:
        </p>

        <Quote href={pg(B.zhuangzi, 140)} page={140} cite={<>Zhuangzi, &ldquo;Zhi bei you&rdquo;, in <em>Zhuangzi pangzhu</em> (1699)</>}>
          人之生氣之聚也聚則爲生. Human life is the gathering of qi. When it gathers, there is life; when it
          disperses, there is death.
        </Quote>

        <h3 className={h3}>3. Life becomes a gift</h3>
        <p className={when}>About 55 to 381 CE</p>

        <p className={p}>
          Christianity made the life that matters most something given, by a giver who makes alive. Paul sets the
          first Adam, made a living soul, against the last Adam, made{' '}
          <Link href={pg(B.elzevir, 620)}>a life-giving spirit</Link>. The Creed of 381 calls the Holy Spirit{' '}
          <Link href={pg(B.lascaris, 235)}>the giver of life</Link>. And John&apos;s Jesus promises life in excess.
          In this Greek gospel book of the eighth or ninth century the words run on without spaces:
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

        <h3 className={h3}>4. Life as a lamp</h3>
        <p className={when}>About 1250 to 1650</p>

        <p className={p}>
          Medieval Latin medicine gave the inborn heat a fuel, the &ldquo;radical moisture&rdquo;, and so turned
          life into a lamp with a fixed supply of oil. Pietro d&apos;Abano seats the heat in the moisture{' '}
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
          name in 1502 says the accidents of old age <Link href={pg(B.regimen, 238)}>can be slowed</Link>. Benedetto
          Varchi, lecturing in Florence in the sixteenth century, reports that many simply called natural heat
          &ldquo;life&rdquo;, since &ldquo;the natural heat lasts as long as the radical moisture lasts, from which
          it feeds and nourishes itself continuously, not otherwise than the flame of oil&rdquo; (<em>Lezzioni</em>,
          1590, <Link href={pg(B.varchi, 278)}>p. 253</Link>).
        </p>

        <h3 className={h3}>5. The living world becomes a programme</h3>
        <p className={when}>1482 to 1620</p>

        <p className={p}>
          In the Renaissance the world&apos;s soul became something one could use. Ficino wrote that the world is
          animated &ldquo;just as any animal is, and much more effectively&rdquo;, and that by fitting our spirit
          to the world&apos;s, its goods pass into us (<em>De vita</em>, <Link href={pg(B.ficino1529, 169)}>1529
          edition</Link>). Agrippa found it <Link href={pg(B.agrippa, 390)}>absurd</Link> that flies and worms
          should live while the whole world does not. William Gilbert, the physician whose <em>De magnete</em>{' '}
          (1600) treated the Earth as a great magnet, argued the same from the lodestone:
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

        <h3 className={h3}>6. The body becomes a machine</h3>
        <p className={when}>1637 to 1690</p>

        <p className={p}>
          Descartes asked his readers to look at the body as an engine, a body that &ldquo;having been made by the
          hands of God, is incomparably better ordered&rdquo; than any machine people can invent (
          <em>Discours de la méthode</em>, <Link href={pg(B.discours, 60)}>p. 56</Link>). Death, for him, is a
          principal part of the body <Link href={pg(B.passions, 71)}>breaking down</Link>, as a clock runs down.
          Thomas Hobbes then turned the question round in the first lines of <em>Leviathan</em>:
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
          matter&rdquo; is the critics&apos; phrase; the mechanists themselves wrote &ldquo;machine&rdquo;.
        </p>

        <h3 className={h3}>7. Life against death</h3>
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

        <h3 className={h3}>8. The Earth as a living being</h3>
        <p className={when}>1798 to 1851</p>

        <p className={p}>
          The German Romantics did not put a force inside the organism. Schelling, in 1799, defined the
          organism&apos;s existence as <Link href={pg(B.schelling, 275)}>a constant being reproduced</Link>, not a
          state of being. Gustav Fechner carried the thought to the whole Earth, and made it more alive than we
          are:
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

        <h3 className={h3}>9. Life as it is lived</h3>
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
          A few years later James measured it in a person: &ldquo;a man who energizes below his normal maximum
          fails by just so much to profit by his chance at life&rdquo; (<em>On Vital Reserves</em>,{' '}
          <Link href={pg(B.vitalReserves, 17)}>p. 8</Link>). Henri Bergson, in 1907: &ldquo;In reality, life is a
          movement, materiality is the inverse movement&rdquo; (<em>L&apos;Évolution créatrice</em>,{' '}
          <Link href={pg(B.bergson, 289)}>p. 271</Link>). Alfred North Whitehead, in 1929: &ldquo;Life is a bid
          for freedom&rdquo; (<em>Process and Reality</em>, <Link href={pg(B.whitehead, 175)}>p. 159</Link>).
        </p>

        <h3 className={h3}>10. Aliveness becomes a feeling</h3>
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
          showed in her love of living things and a pang at killing anything. In the library&apos;s books the
          word is about 130 years old. The earlier answers to the same question are the ones above.
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
