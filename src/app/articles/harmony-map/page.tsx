import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import SourceQuote from '@/components/articles/SourceQuote';

// Every quotation from a Source Library book is copied from the stored text of the page it links to, re-checked
// against /api/books/<id>/quote on 2026-10-21. Inline <term>/<gloss> markup on those pages is shown as the term in
// italics and the gloss in square brackets. Findings read only in an abstract or a secondary summary are reported
// with "reports" or "argues"; findings that could not be checked are left out (#7079).
// The ideas are Derek Lomas's research. The page sits beside the three harmony essays it links.

const TITLE = 'Harmony: Eleven Ideas and Their Sources';
const DESCRIPTION =
  'Eleven ideas about harmony, from diversity in wholeness to alignment between people and AI, each with its sources: Philolaus, Plato, Aristotle, Iamblichus, Huygens, Rameau and modern studies of consonance, synchrony and learning machines.';
const HERO = 'https://images.sourcelibrary.org/archived/69904dd67d19f3f2aac1d49d/99.jpg';
const HERO_ALT =
  "Robert Fludd's world monochord (1617): a hand from a cloud turns the tuning peg of a single string that runs from the earth up through the elements and planets to the stars, with the musical ratios marked on arcs beside it.";

export const metadata: Metadata = withArticleMeta('harmony-map', {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/articles/harmony-map' },
});

// Every book quoted or cited. Most are linked through shortlinks (/q/...), so they are listed here for the
// "Books in this article" grid, which is built from the /book/ links in this file.
const BOOK = {
  fludd: '/book/utriusque-cosmi-historia-1617-fludd',
  mullach: '/book/fragmenta-philosophorum-graecorum-mullach',
  bern: '/book/bern-burgerbibliothek-cod-402-aristotle',
  aldine: '/book/aristotelous-ta-problemata-meta-ton-tou-alex-aphrodis-proble',
  jowett: '/book/the-dialogues-of-plato-jowett-translation-plato',
  taylor: '/book/the-cratylus-phaedo-parmenides-and-timaeus-of-plato-taylor',
  diels: '/book/die-fragmente-der-vorsokratiker-diels',
  boethius: '/book/de-institutione-arithmetica-de-institutione-musica-friedlein',
  huygens: '/book/oeuvres-completes-tome-5-correspondance-1664-1665-huygens',
  rameauDemo: '/book/demonstration-du-principe-de-l-harmonie-rameau',
  rameauTraite: '/book/traite-de-l-harmonie-reduite-a-ses-principes-naturels-rameau',
  galileo: '/book/les-nouvelles-pensees-de-galilee-discorsi-e-dimostrazioni-galilei',
  ens: '/book/thaumaturgus-mathematicus-id-est-admirabilium-effectorum-e-ens',
  kircher: '/book/kircherus-jesuita-germanus-germaniae-redonatus-sive-artis-kircher',
  euler: '/book/tentamen-novae-theoriae-musicae-euler',
  helmholtz: '/book/on-the-sensations-of-tone-helmholtz',
  iamblichusMs: '/book/iamblichus-iamblikos-iamblichus',
  nicomachus: '/book/bodleian-library-ms-barocci-41-nicomachus',
  aristoxenus: '/book/greek-texts-on-music-mathematics-and-astronomy-cambridge-aristoxenus',
  ailly: '/book/de-legibus-et-sectis-contra-superstitiosos-astronomos-i-add-alliaco',
  ficino: '/book/ficino-letters-book-i-ficino',
  iamblichus1598: '/book/greek-de-vita-pythagorae-jamblichus',
  nauck: '/book/de-vita-pythagorica-liber-codex-florentinus-nauck',
  alexander: '/book/de-anima-ex-aristotelis-institutione-tr-hieronymus-donatus-alexander-aphrodisae',
  republic: '/book/platos-republic-greek-text-plato',
  phaedo: '/book/euthyphro-apology-crito-phaedo-phaedrus-loeb-l036-plato',
};

// Book slugs for SourceQuote.
const SLUG = {
  mullach: 'fragmenta-philosophorum-graecorum-mullach',
  aldine: 'aristotelous-ta-problemata-meta-ton-tou-alex-aphrodis-proble',
  huygens: 'oeuvres-completes-tome-5-correspondance-1664-1665-huygens',
  galileo: 'les-nouvelles-pensees-de-galilee-discorsi-e-dimostrazioni-galilei',
  aristoxenus: 'greek-texts-on-music-mathematics-and-astronomy-cambridge-aristoxenus',
  republic: 'platos-republic-greek-text-plato',
  phaedo: 'euthyphro-apology-crito-phaedo-phaedrus-loeb-l036-plato',
  iamblichus1598: 'greek-de-vita-pythagorae-jamblichus',
};

const IMG = (bookId: string, page: number) => `https://images.sourcelibrary.org/archived/${bookId}/${page}.jpg`;

// Shortlinks to the quoted pages (sourcelibrary.org/q/<code>).
const Q = {
  philolaus: '/q/Bl4pg3nqJosCv2TbwFy',
  deMundo244: '/q/BgTr2cktUMO26tCGVu8',
  deMundo245: '/q/BgTr2cktUMO26tCGVu9',
  deMundo246: '/q/BgTr2cktUMO26tCGVuA',
  metaphysics404: '/q/Bjby2leRswtiLndjiqa',
  metaphysics405: '/q/Bjby2leRswtiLndjiqb',
  jowett: '/q/BeqYUOswGqYzFfFK4ET',
  taylor: '/q/Bi8U9DBEefYYnTrjpUU',
  archytas: '/q/Bl4pQvqHtpd92ful2IN',
  boethius: '/q/Bh8whBRdKDTzq5GqCI2',
  huygens: '/q/Bh986H0gXEKZ5TZsAHY',
  rameauDemo: '/q/BnEPJjuFvMnr0c3WaAW',
  rameauTraite: '/q/Biw8j3PGu1cpL8xDFyJ',
  galileo: '/q/BgzOnt41NpKqw5JppXi',
  ens: '/q/BlAZEkqC9ZUAk41EjcE',
  kircher: '/q/BhNfWNHUUHVf42vtyFK',
  euler: '/q/BgOYCinqC2EgzHxs0wi',
  helmholtz: '/q/BgxPvZxw3dRO3oTuaJe',
  iamblichus88: '/q/BgTrATubZW3o3Sc7uKu',
  iamblichus89: '/q/BgTrATubZW3o3Sc7uKv',
  nicomachus: '/q/BgTrXAku9DUfcPnX4ey',
  aristoxenus: '/q/BgTqx7uqocf2yRQ80jo',
  ailly: '/q/BiPv4CE1dXM10UOxnGI',
  ficino: '/q/BhNkp1i55gVbNjEsJev',
  iamblichusMedicine: '/q/BhtyPlNQQyBWxx1P26y',
  iamblichusSpheres: '/q/BhtyPlNQQyBWxx1P26z',
  friendship: '/q/Bi8RtQQ1mzlq1Wy5fT5',
  alexander: '/q/BiPv3i0SRPtxTinamHg',
  republic443: '/q/BgTjff0MBbQTZUwcpGs',
  republic431: '/q/BgTjff0MBbQTZUwcpGX',
  phaedo: '/q/BgTma6xEUveMD9g1W8q',
};

const EXT = {
  harmonyInDesign: 'https://doi.org/10.1016/j.sheji.2022.01.001',
  opposites: 'https://doi.org/10.5040/9781350466654.ch-010',
  resonance: 'https://doi.org/10.3389/fnbot.2022.850489',
  lahdelma: 'https://doi.org/10.1177/2041669516655812',
  weinreich: 'https://doi.org/10.1121/1.381677',
  uhlhaas: 'https://doi.org/10.1016/j.neuron.2006.09.020',
  chimera: 'https://arxiv.org/abs/nlin/0407045',
  tononi: 'https://doi.org/10.1073/pnas.91.11.5033',
  fries: 'https://doi.org/10.1016/j.neuron.2015.09.034',
  lerdahl: 'https://doi.org/10.1525/mp.2007.24.4.329',
  kuramoto: 'https://doi.org/10.1016/S0167-2789(00)00094-4',
  trappist: 'https://arxiv.org/abs/1703.04166',
  klimesch: 'https://doi.org/10.1111/ejn.14192',
  zhmud: 'https://doi.org/10.1163/156852889x00189',
  butterfield: 'https://doi.org/10.48550/arxiv.1902.03480',
  plomp: 'https://doi.org/10.1121/1.1909741',
  mcdermott2010: 'https://doi.org/10.1016/j.cub.2010.04.019',
  sethares: 'https://sethares.engr.wisc.edu/consemi.html',
  harrison: 'https://doi.org/10.1037/rev0000169',
  krumhansl: 'https://doi.org/10.1037/0033-295X.89.4.334',
  papadopoulos: 'https://arxiv.org/abs/2512.23259',
  bowling: 'https://doi.org/10.1073/pnas.1505768112',
  tsimane: 'https://doi.org/10.1038/nature18635',
  fusion: 'https://doi.org/10.1038/s41467-020-16448-6',
  delleFave: 'https://doi.org/10.3389/fpsyg.2016.00030',
  hasson: 'https://doi.org/10.1016/j.tics.2011.12.007',
  dikker: 'https://doi.org/10.1016/j.cub.2017.04.002',
  shadlen: 'https://doi.org/10.1016/S0896-6273(00)80822-3',
  large: 'https://doi.org/10.1525/mp.2016.33.3.319',
  colombo: 'https://doi.org/10.1007/s11229-018-01932-w',
  fleming: 'https://doi.org/10.31234/osf.io/zsr78',
  hinton: 'https://papers.cnl.salk.edu/PDFs/Learning%20and%20Relearning%20in%20Boltzmann%20Machines%201986-3239.pdf',
  kirkpatrick: 'https://doi.org/10.1126/science.220.4598.671',
  distilling: 'https://arxiv.org/abs/1503.02531',
  friston: 'https://doi.org/10.1038/nrn2787',
  helmholtzMachine: 'https://doi.org/10.1162/neco.1995.7.5.889',
  harmonicLoss: 'https://arxiv.org/abs/2502.01628',
  bostrom: 'https://doi.org/10.1007/s11023-012-9281-3',
  dpo: 'https://arxiv.org/abs/2305.18290',
  kirk: 'https://arxiv.org/abs/2310.06452',
  padmakumar: 'https://arxiv.org/abs/2309.05196',
  karwowski: 'https://doi.org/10.48550/arxiv.2310.09144',
  prh: 'https://arxiv.org/abs/2405.07987',
  groger: 'https://arxiv.org/abs/2602.14486',
};

const p = 'text-secondary leading-relaxed mb-6 font-body';
const h2 = 'text-2xl md:text-3xl text-primary mt-16 mb-6';
const ul = 'text-secondary leading-relaxed mb-6 font-body list-disc pl-6 space-y-2';

// A quotation shown without its page picture, linked to the page by its shortlink.
function Quote({ href, cite, children }: { href: string; cite: React.ReactNode; children: React.ReactNode }) {
  return (
    <blockquote className="border-l-2 border-accent-gold/60 pl-6 my-8">
      <div className="text-secondary leading-relaxed italic font-body">{children}</div>
      <p className="text-xs text-muted mt-2 not-italic">
        {cite} &middot; <Link href={href}>sourcelibrary.org{href}</Link>
      </p>
    </blockquote>
  );
}

// The shortlink, for the source line of a SourceQuote.
function Short({ href }: { href: string }) {
  return (
    <>
      {' '}&middot; <Link href={href}>sourcelibrary.org{href}</Link>
    </>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Statement({ children }: { children: React.ReactNode }) {
  return <div className="text-lg text-primary leading-relaxed mb-6 font-body">{children}</div>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <strong className="text-primary">{children}</strong>;
}

export default function HarmonyMapPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="What harmony is, where it fails, and what it would mean for people, machines and the natural world"
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">21 October 2026 &middot; 25 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Harmony is one of the oldest ideas in the library and one of the most loosely used. It names a chord, a
          well-ordered city, a healthy body and the motion of the planets, and lately a hoped-for relation between
          people and the machines they are building. This page sets out eleven ideas about what harmony is, which
          are Derek Lomas&apos;s research, and gives each one the primary sources it rests on, the strongest
          objections to it, and the questions it leaves open.
        </p>

        <p className={p}>
          The ideas build on each other. The first says what harmony is. The next five say how it works and where
          the word has been stretched too far: harmony against lock, levels of wholeness, the two harmonies of
          number, the five phenomena the word covers, and the old gap between feeling a harmony and calculating it.
          The seventh and eighth ask how the idea could become science. The last three apply it to intelligence,
          to alignment between people and AI, and to wellbeing, peace and sustainability. Three essays tell parts
          of the story at length:{' '}
          <Link href="/articles/nature-of-harmony">The Nature of Harmony</Link>, on the measurers of musical ratio
          from Pythagoras to Kepler;{' '}
          <Link href="/articles/show-me-the-number">Show Me the Number</Link>, on whether human&ndash;AI harmony
          can be measured; and <Link href="/articles/harmonic-justice">Harmonic Justice</Link>, on money and fair
          exchange as problems of proportion.
        </p>

        <p className={p}>
          The picture above is Robert Fludd&apos;s world monochord, from his{' '}
          <Link href={`${BOOK.fludd}?page=99`}>
            <em>Utriusque cosmi historia</em> of 1617
          </Link>
          : one string running from the earth to the stars, with a hand reaching out of a cloud to tune it.
        </p>

        {/* 1 */}
        <h2 className={h2}>1. Harmony is diversity in wholeness</h2>

        <Statement>
          <p className="mb-4">
            Harmony is diversity in wholeness, where the parts and the whole strengthen each other. Dissonance
            belongs inside harmony; it is not its opposite. The opposite of harmony is disintegration, and it takes
            two forms:
          </p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li><Label>homogenization</Label>, a whole with no diversity left: unison, lock, monoculture;</li>
            <li><Label>fragmentation</Label>, diversity with no whole: noise.</li>
          </ul>
          <p>Ratios, consonance and mode-locking are one way harmony happens. They are not its definition.</p>
        </Statement>

        <p className={p}>
          The starting point is the definition in Lomas and Xue&apos;s{' '}
          <Ext href={EXT.harmonyInDesign}>
            <em>Harmony in Design</em>
          </Ext>{' '}
          (2022): harmony is &ldquo;the process of integrating diverse parts into a whole, such that both the
          parts and the whole are mutually strengthened.&rdquo; Their central conclusion is that &ldquo;harmony
          is not pure agreement or &lsquo;sameness.&rsquo;&rdquo; They also separate dissonance from disharmony:
          dissonance can be resolved and strengthen the whole, while disharmony is a misfit that detracts from it.
        </p>

        <p className={p}>
          The oldest statement of the idea is Philolaus&apos;s. Harmony is needed only because things are unlike:
        </p>

        <SourceQuote
          book={SLUG.mullach}
          page={110}
          printedPage={1}
          src={IMG('6a3f02bb97e91e1768f68204', 110)}
          pageAlt="A page of Greek fragments of Philolaus with Latin translation below, in Mullach's edition"
          source={<>Philolaus, in Mullach, <em>Fragmenta philosophorum graecorum</em> II (Paris, 1881)<Short href={Q.philolaus} /></>}
        >
          Now, things that were similar and of the same kind had no need of harmony; but things that were
          dissimilar and neither of the same kind nor of equal rank, had to be locked together by such a harmony
          if they were to be held together in a world.
        </SourceQuote>

        <p className={p}>
          The treatise <em>On the Cosmos</em> (<em>De Mundo</em>), handed down under Aristotle&apos;s name, makes
          the same point and quotes Heraclitus for it. The text here is from a manuscript of about 1490 in{' '}
          <Link href={BOOK.bern}>Bern, Burgerbibliothek Cod. 402</Link>:
        </p>

        <Quote href={Q.deMundo245} cite={<>Pseudo-Aristotle, <em>De Mundo</em> 5, 396b, Bern Cod. 402, p. 245</>}>
          Perhaps nature strives for opposites and desires to create harmony from these, not from like things.
          &hellip; This same thing was also said by the obscure <em>Heraclitus</em> [pre-Socratic philosopher known for the doctrine of unity in opposition]: &ldquo;Couplings are wholes and
          not wholes, concurring and differing, concordant and discordant, and from all things one, and from one
          all things.&rdquo;
        </Quote>

        <p className={p}>
          Its example from politics is a city that holds together people unlike each other:
        </p>

        <Quote href={Q.deMundo244} cite={<>Pseudo-Aristotle, <em>De Mundo</em> 5, 396b, Bern Cod. 402, p. 244</>}>
          It is as if some were to wonder about a city, how it remains constituted from opposing peoples: I mean
          poor and rich, young and old, weak and strong, wicked and good. They are ignorant that this is the most
          wonderful thing about political harmony
        </Quote>

        <p className={p}>
          Aristotle reports the Pythagorean table of ten paired principles, &ldquo;Limit and Unlimited; Odd and
          Even; One and Plurality&rdquo; and the rest, in the{' '}
          <Link href={Q.metaphysics405}>
            <em>Metaphysics</em> (Aldine edition, 1552, p. 376)
          </Link>
          . Lomas and Xue extend that table across cultures and domains in{' '}
          <Ext href={EXT.opposites}>
            <em>The Harmony of Opposites in Design and Philosophy</em>
          </Ext>{' '}
          (2025), where they argue that the harmony of opposites &ldquo;is not found by choosing the middle ground
          between extremes but by supporting the strength of both parts.&rdquo; Herbert Simon&apos;s 1962 account
          of nearly decomposable systems gives one formal shape to the idea: in the short run each component acts
          &ldquo;approximately independent&rdquo; of the others, and in the long run each depends on the others
          &ldquo;in only an aggregate way.&rdquo; Tononi, Sporns and Edelman{' '}
          <Ext href={EXT.tononi}>report</Ext> (1994) a measure of neural complexity that is high only when
          segregation and integration coexist, and low for systems that are either fully independent or fully
          synchronized.
        </p>

        <p className={p}>
          <Label>The guard clause.</Label> &ldquo;The parts are strengthened&rdquo; is what separates harmony
          from mere wholeness. Without it the definition can be used to sacrifice the parts to the whole. The word
          has been used that way: Bastiat called markets already harmonious, and in Chinese internet slang
          &ldquo;to be harmonized&rdquo; means to be censored (see{' '}
          <Link href="/articles/harmonic-justice">Harmonic Justice</Link>, &ldquo;Two uses of harmony&rdquo;). So the
          definition is never stated without the clause.
        </p>

        <p className={p}>
          <Label>Tensions.</Label> If everything is diverse and whole, the definition explains nothing; the answer
          is to measure harmony before the outcome it is meant to predict (idea 7). Aristotle&apos;s objection,
          as Lomas and Xue report it, is that harmony does not contain virtue nor virtue harmony: talk of harmony
          across domains may be a metaphor that hides more than it shows.
        </p>

        <p className={p}>
          <Label>Open questions.</Label> What measure of degree works across levels? Can &ldquo;the parts are
          strengthened&rdquo; be measured without bringing in a theory of the good?
        </p>

        {/* 2 */}
        <h2 className={h2}>2. Harmony is not lock</h2>

        <Statement>
          &ldquo;Too much harmony&rdquo; is a category mistake. What goes wrong is <Label>lock</Label>: coupling so
          strong that the parts&apos; differences collapse into sameness. Harmony is fit that keeps its tension;
          lock is fit with the tension gone. Harmony stays just short of lock, and that near-miss keeps systems
          alive: it gives them cycles, sustain and character.
        </Statement>

        <p className={p}>
          <Label>Slight mistuning pleases and sustains.</Label> In an online study of 410 listeners rating 15 piano
          chords, Lahdelma and Eerola found that &ldquo;the mildly dissonant minor ninth, major ninth, and minor
          seventh chords were rated highest for preference, regardless of musical sophistication&rdquo;{' '}
          (<Ext href={EXT.lahdelma}>2016</Ext>). Weinreich&apos;s work on the coupled strings of a piano note{' '}
          (<Ext href={EXT.weinreich}>1977</Ext>) reports that the aftersound depends on how finely the unisons are
          tuned, and that a good tuner can use fine tuning of the unisons to make it more uniform.
        </p>

        <p className={p}>
          <Label>Strong coupling collapses diversity.</Label> Lomas, Lin and colleagues note that
          &ldquo;synchronization also requires a sort of weakness in coupling&rdquo; (
          <Ext href={EXT.resonance}>
            <em>Resonance as a Design Strategy for AI and Social Robots</em>
          </Ext>
          , 2022). In the brain, Lomas and Xue put health in a dynamic balance of synchronization and
          desynchronization (RP.69), with too much of either unhealthy; Uhlhaas and Singer{' '}
          (<Ext href={EXT.uhlhaas}>2006</Ext>) report that schizophrenia, epilepsy, autism, Alzheimer&apos;s and
          Parkinson&apos;s are associated with abnormal neural synchronization.
        </p>

        <p className={p}>
          <Label>Machines freeze.</Label> Paul Smolensky&apos;s harmony theory (1986) lets a network choose values
          that raise its harmony, with the randomness set by a computational temperature that is lowered towards
          zero. He writes that &ldquo;the machine will eventually &lsquo;freeze&rsquo; into a completion that
          maximizes the harmony,&rdquo; and that &ldquo;the decision-making process resembles the crystallization of
          a liquid into a solid.&rdquo; The remedy is to stay above zero (idea 8).
        </p>

        <p className={p}>
          <Label>Tensions.</Label> Abrams and Strogatz report{' '}
          (<Ext href={EXT.chimera}>2004</Ext>) that arrays of identical oscillators can split into
          &ldquo;phase-locked oscillators coexist with drifting ones&rdquo;: the so-called chimera states.
          That supports the idea, but the step from oscillators to societies should not be pushed hard.
        </p>

        <p className={p}>
          <Label>Open question.</Label> Can &ldquo;distance from lock&rdquo; be measured as a general quantity,
          for example as detuning relative to the width of the locking region?
        </p>

        {/* 3 */}
        <h2 className={h2}>3. Levels of wholeness</h2>

        <Statement>
          <p className="mb-4">
            Harmony is nested: note, chord, song, album, culture; or self, family, state, nature. Each level is a
            whole made of the level below. Two things follow:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>what is dissonant at one level can be harmonious at the next, so judging harmony means first saying which level is being judged;</li>
            <li>the hierarchy lasts when coupling is strong within each level and weak between levels, with the levels running at different speeds.</li>
          </ul>
        </Statement>

        <p className={p}>
          Following Chenyang Li&apos;s reading of the <em>Great Learning</em>, Lomas and Xue set harmony at nested
          levels (individual, interpersonal, societal, the natural world), with harmony possible within and
          between them. Plato already pictures the virtue of a city as a chord across its ranks:
        </p>

        <Quote href={Q.republic431} cite={<>Plato, <Link href={BOOK.republic}><em>Republic</em></Link> IV, 431e&ndash;432a, p. 165</>}>
          Instead, it is literally stretched through the whole, producing a chord between the weakest, the
          strongest, and those in the middle
        </Quote>

        <p className={p}>
          In tonal music theory, as Lomas and Xue read it, a chord is harmonious for where the piece is going: dissonance creates a tension that
          points somewhere, and resolution is judged against a tonal centre. Lerdahl and Krumhansl test a
          four-part model of tonal tension against listeners&apos; continuous ratings and report that the
          components &ldquo;combine to predict the rise and fall in tension in the course of listening&rdquo;{' '}
          (<Ext href={EXT.lerdahl}>2007</Ext>). In the brain, Pascal Fries proposes &ldquo;that synchronization
          affects communication between neuronal groups&rdquo; (<Ext href={EXT.fries}>2015</Ext>).
        </p>

        <p className={p}>
          <Label>For alignment.</Label> Sycophancy is harmony at the level of the note that loses the album. A
          reply that pleases now but wears down someone&apos;s judgment over a year is consonant locally and
          disharmonious overall, so evaluations of AI systems should run over long horizons, not single turns. The
          hierarchy can collapse in two ways: one fast level, such as an AI feedback loop, sets the pace for every
          slower one; or one level absorbs the others and everything becomes the same.
        </p>

        <p className={p}>
          <Label>Open questions.</Label> How should harmony be weighed across levels? Which level is the
          &ldquo;album&rdquo; for a relationship between a person and an AI?
        </p>

        {/* 4 */}
        <h2 className={h2}>4. Number holds two harmonies</h2>

        <Statement>
          <p className="mb-4">
            The Pythagorean argument runs: the cosmos is ordered by number, number contains harmony, so harmony
            appears throughout the cosmos, and music is one place it shows. The argument holds once two corrections
            are made.
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <Label>Number has two harmonies.</Label> Commensurable ratios lock coupled systems that lose energy:
              the source of consonance, fusion and entrainment. Maximally incommensurable ratios survive in systems
              that conserve energy: the source of robustness and freedom from interference. Both belong to the
              whole.
            </li>
            <li><Label>Number also contains disorder.</Label> Which harmony a given system shows is an empirical question.</li>
          </ul>
        </Statement>

        <p className={p}>The thesis, as Aristotle reports it:</p>

        <SourceQuote
          book={SLUG.aldine}
          page={404}
          printedPage={375}
          src={IMG('6a08561349638a50931c26f9', 404)}
          pageAlt="A page of Aristotle's Metaphysics, Book A, in the Aldine Greek edition of 1552"
          source={<>Aristotle, <em>Metaphysics</em> A.5, 985b23&ndash;986a3, Aldine edition (Venice, 1552)<Short href={Q.metaphysics404} /></>}
        >
          Since all other things seemed to be modeled in their whole nature after numbers, and numbers are the first
          things in all of nature, they supposed the elements of numbers to be the elements of all existing things.
          They even thought that the whole heaven was a harmony and a number.
        </SourceQuote>

        <p className={p}>
          Philolaus&apos;s own claim is about knowledge: &ldquo;And indeed all things that are known have a number.
          For it is not possible for anything to be either thought of or known without this&rdquo; (
          <Link href={Q.philolaus}>Mullach, p. 1</Link>). In the <em>Timaeus</em> the world-soul is built from
          harmonic ratios. In{' '}
          <Link href={Q.jowett}>Jowett&apos;s translation (p. 478)</Link>, the god divides the soul-stuff
          &ldquo;in the ratios of 1, 2, 3, 4, 9, 8, 27,&rdquo; and &ldquo;in the former intervals he introduced
          ratios of thirds (3:2), of fourths (4:3), of ninths (9:8), and the interval of a fourth he filled up with
          a ninth, leaving a remnant which is in the ratio of 256:243.&rdquo; Thomas Taylor&apos;s introduction of
          1793 explains the means that do the filling:{' '}
          &ldquo;6, 4, 3 are in harmonic proportion, for 4 is exceeded by 6 by 2 (which is a third part of 6), and
          4 exceeds 3 by 1 (which is the third part of 3)&rdquo; (<Link href={Q.taylor}>p. 407</Link>). Archytas,
          quoted by Porphyry, names them: &ldquo;There are three means in music: one is the arithmetic, the second
          is the geometric, and the third is the subcontrary&rdquo; (<Link href={Q.archytas}>Diels, p. 334</Link>).
          Boethius divides music into three kinds, &ldquo;cosmic&rdquo; music, &ldquo;human&rdquo; music and the
          music of instruments (<Link href={Q.boethius}>ed. Friedlein, p. 187</Link>).
        </p>

        <p className={p}>
          <Label>Commensurability locks.</Label> The first recorded case of coupled oscillators falling into step
          is in a letter Christiaan Huygens wrote in February 1665:
        </p>

        <SourceQuote
          book={SLUG.huygens}
          page={264}
          printedPage={244}
          src={IMG('69ac5f457f20875486da3eb7', 264)}
          pageAlt="A printed page of Huygens's correspondence for 1665 in the Oeuvres complètes"
          source={<>Christiaan Huygens, letter of 1665, <em>Oeuvres complètes</em> V (The Hague, 1893)<Short href={Q.huygens} /></>}
        >
          It is that these two clocks, hanging side by side at a distance of one or two feet, keep such an exact
          accuracy between them that the two Pendulums always beat together without ever varying. After marvelling
          at this for some time, I finally found that it happened through a kind of sympathy
        </SourceQuote>

        <p className={p}>
          Strogatz&apos;s review of the Kuramoto model (<Ext href={EXT.kuramoto}>2000</Ext>) reports that above a
          threshold of coupling &ldquo;some of the oscillators spontaneously synchronise, while others remain
          incoherent.&rdquo; Luger and colleagues report (<Ext href={EXT.trappist}>2017</Ext>) that the seven
          planets of TRAPPIST-1 form a chain &ldquo;with three-body resonances linking every member.&rdquo;
        </p>

        <p className={p}>
          <Label>Incommensurability survives.</Label> In conservative systems, results going back to the KAM
          theorem are reported to show that motions with sufficiently irrational frequency ratios survive small
          disturbances while rational ones break up, with the golden-mean case the most robust. Wolfgang Klimesch
          proposes (<Ext href={EXT.klimesch}>2018</Ext>) that the golden mean, &ldquo;as the &lsquo;most irrational number&rsquo;, enables the best possible
          frequency separation&rdquo; between brain rhythms. That is a hypothesis, not established structure.
        </p>

        <p className={p}>
          <Label>The remainder is real arithmetic.</Label> Philolaus already found that the octave does not divide
          evenly: &ldquo;Thus harmony contains five <em>epogdoa</em> and two <em>dieses</em> [semitones
          or small intervals]&rdquo; (<Link href={Q.philolaus}>Mullach, p. 1</Link>). No power of 3/2 equals a power
          of 2, so twelve pure fifths overshoot seven octaves by the Pythagorean comma, 3<sup>12</sup>/2<sup>19</sup>,
          about 23.46 cents. Twelve notes to the octave works because 7/12 is a close fraction for
          log<sub>2</sub>(3/2) &asymp; 0.58496 (the next good one is 31/53). Equal temperament divides the octave by
          the twelfth root of two, an irrational ratio: its fifths are about 1.96 cents narrow and its major thirds
          about 13.7 cents wide.
        </p>

        <p className={p}>
          <Label>Tensions.</Label> Aristotle already caught the Pythagoreans fitting the world to the number:
        </p>

        <Quote href={Q.metaphysics404} cite={<>Aristotle, <Link href={BOOK.aldine}><em>Metaphysics</em></Link> A.5, 986a3&ndash;12, Aldine edition, p. 375</>}>
          If there was a gap anywhere, they hurried to fill it so that their entire system would be coherent. I
          mean, for example, that since the <em>decad</em> [the number ten] is thought to be perfect and to
          encompass the whole nature of numbers, they say the bodies moving in the heavens are ten. But since only
          nine are visible, they create a tenth, the <em>counter-earth</em> [antichthon].
        </Quote>

        <p className={p}>
          Mathematics contains far more disorder than harmony, and we notice the harmonious cases. Derek
          Lomas&apos;s answer is that dissonance and the irrational belong inside harmony&apos;s wholeness; each
          level still owes an account of the conditions under which harmony appears. Leonid Zhmud{' '}
          <Ext href={EXT.zhmud}>argues</Ext> (1989) that &ldquo;all is number&rdquo; is Aristotle&apos;s gloss
          rather than an early Pythagorean slogan. And Sabine Hossenfelder&apos;s <em>Lost in Math</em> (2018;{' '}
          <Ext href={EXT.butterfield}>review</Ext>) argues that trust in mathematical beauty has led fundamental
          physics astray, so the appeal of a harmony is no evidence for it.
        </p>

        <p className={p}>
          <Label>Open question.</Label> Is there one mathematical account in which rational lock and irrational
          survival are two regimes of one principle: Philolaus&apos;s limit and unlimited, formalized?
        </p>

        {/* 5 */}
        <h2 className={h2}>5. Ratios are one manifestation: five things called harmony</h2>

        <Statement>
          <p className="mb-4">
            One word covers five different phenomena. Keeping them apart stops &ldquo;harmony&rdquo; from meaning
            everything:
          </p>
          <ol className="list-decimal pl-6 space-y-1 mb-4">
            <li><Label>Modes</Label>: the frequencies a body can vibrate at, set by its shape.</li>
            <li><Label>Resonance</Label>: energy flowing into a body when a drive matches one of its modes.</li>
            <li><Label>Locking</Label>: nonlinear oscillators adjusting each other until they settle into simple ratios.</li>
            <li><Label>Consonance</Label>: a listener hearing sounds as smooth or fused.</li>
            <li><Label>Tonal harmony</Label>: a grammar of tension and resolution over time.</li>
          </ol>
          <p>
            On this view small whole-number ratios have two independent physical origins, the boundary modes of
            ideal strings and pipes and nonlinear locking, and integer spectra belong to the lyre, not to vibration
            in general.
          </p>
        </Statement>

        <p className={p}>
          <Label>Modes.</Label> Rameau put the harmony inside the sounding body itself: &ldquo;Every sonorous body,
          taken individually, is always understood to carry with it the same harmony that it makes resonate; it is
          its generator&rdquo; (<Link href={Q.rameauDemo}><em>Démonstration du principe de l&apos;harmonie</em>, 1750, p. viii</Link>).
        </p>

        <p className={p}>
          <Label>Resonance.</Label> Lomas, Lin and colleagues define it: &ldquo;Sympathetic Resonance occurs when
          external, forced oscillations are aligned to a system&apos;s own natural oscillations and this results in
          amplification and synchronization.&rdquo; Where resonance and consonance meet is the oldest experiment in
          the subject, a string sounding untouched. Galileo&apos;s explanation, in Mersenne&apos;s French of 1639,
          compares it to timed breaths swinging a pendulum:
        </p>

        <SourceQuote
          book={SLUG.galileo}
          page={110}
          printedPage={90}
          src={IMG('69a684647ab725b59be411fb', 110)}
          pageAlt="The opening of Article XXI in Les nouvelles pensées de Galilée, 1639"
          source={<>Galileo, <em>Les nouvelles pensées de Galilée</em>, tr. Mersenne (Paris, 1639), Art. XXI<Short href={Q.galileo} /></>}
        >
          Explaining why a struck Lute or Spinet string causes other unstruck strings to vibrate, which are in
          unison, at the octave, and at the fifth.
        </SourceQuote>

        <p className={p}>
          Early modern books collected the effect as experiment and wonder: Gaspar Ens shows how &ldquo;to make the
          string of a lute tremble perceptibly without being touched by anyone&rdquo; (
          <Link href={Q.ens}>1636, p. 142</Link>), and Kircher tells of a bass viol hung on a wall that &ldquo;resonated
          and sounded by itself at intervals several times&rdquo; when the church organ played (
          <Link href={Q.kircher}>1662, p. 168</Link>).
        </p>

        <p className={p}>
          <Label>Consonance.</Label> No single account explains it. Euler put a number on it: &ldquo;the smaller
          this number is found to be, the sweeter or easier to perceive the consonance will be&rdquo; (
          <Link href={Q.euler}><em>Tentamen novae theoriae musicae</em>, 1739, p. 59</Link>). Helmholtz is usually
          summarized as explaining dissonance by the beating of nearby partials (
          <Link href={Q.helmholtz}><em>On the Sensations of Tone</em>, p. 204</Link>), and Plomp and Levelt (
          <Ext href={EXT.plomp}>1965</Ext>) report that simple tones sound most dissonant at about a quarter of a
          critical bandwidth apart. McDermott and Lehr (<Ext href={EXT.mcdermott2010}>2010</Ext>) report that
          &ldquo;only the preference for harmonic spectra was consistently correlated with preferences for
          consonant over dissonant chords.&rdquo; Sethares (<Ext href={EXT.sethares}>1993</Ext>) shows that tuning
          and timbre go together: the minima of a timbre&apos;s dissonance curve define its scale, and for harmonic
          timbres &ldquo;they occur at the &lsquo;nearby&rsquo; simple ratios 1:1, 2:1, 3:2, 4:3, 5:4, and
          5:3.&rdquo; Harrison and Pearce (<Ext href={EXT.harrison}>2020</Ext>) conclude that consonance is
          &ldquo;a composite phenomenon&rdquo; of interference, periodicity or harmonicity, and cultural familiarity.
        </p>

        <p className={p}>
          <Label>Tonal harmony.</Label> Rameau&apos;s <em>Traité</em> of 1722 rests it on &ldquo;the bass, which we
          call fundamental, and which must proceed in this case by consonant intervals. These are those of the
          third, the fourth, the fifth, and the sixth&rdquo; (<Link href={Q.rameauTraite}>p. 185</Link>).
          Krumhansl and Kessler (<Ext href={EXT.krumhansl}>1982</Ext>) report &ldquo;very stable rating profiles
          reflecting the tonal hierarchies in major and minor keys.&rdquo;
        </p>

        <p className={p}>
          <Label>The founding story, corrected.</Label> Iamblichus tells how Pythagoras heard consonant hammers in
          a smithy and traced the difference to their weights:
        </p>

        <Quote href={Q.iamblichus89} cite={<>Iamblichus, <em>On the Pythagorean Life</em> 26.115&ndash;118, <Link href={BOOK.iamblichusMs}>Greek manuscript</Link>, p. 89</>}>
          he determined the difference of the sound &hellip; having accurately grasped the weights and equal
          inclinations of the hammers
        </Quote>

        <p className={p}>
          He then has Pythagoras reproduce the intervals with strings hung with weights, and{' '}
          <Link href={Q.nicomachus}>Nicomachus</Link> tells the story too. It cannot work as told. A string&apos;s
          frequency goes with the square root of its tension, so weights in the ratio 2:1 give a ratio of about
          1.41, not an octave; the octave needs four times the weight. The simple ratios hold for string lengths.
          Vincenzo Galilei pointed this out in 1589, as Papadopoulos reports (<Ext href={EXT.papadopoulos}>2025</Ext>):
          &ldquo;to obtain the octave of a note emitted by a stretched string, the tension of the string must be
          multiplied by four and not by two.&rdquo;
        </p>

        <p className={p}>
          <Label>Tensions.</Label> Consonant does not mean pleasant: the mildly dissonant chords won Lahdelma and
          Eerola&apos;s study. Liking consonance is not universal. McDermott and colleagues found that the
          Tsimane&apos; of Bolivia &ldquo;rated consonant and dissonant chords and vocal harmonies as equally
          pleasant&rdquo; while still disliking roughness, and concluded that consonance preferences &ldquo;are thus
          unlikely to reflect innate biases&rdquo; (<Ext href={EXT.tsimane}>2016</Ext>). Yet fusion looks
          widespread: &ldquo;Both groups were more likely to mistake note combinations related by simple integer
          ratios as single sounds&rdquo; (McPherson and colleagues, <Ext href={EXT.fusion}>2020</Ext>). Writers on
          Schoenberg&apos;s &ldquo;emancipation of the dissonance&rdquo; and on Adorno argue that tonal consonance is a
          historical idiom, not a natural ground.
        </p>

        {/* 6 */}
        <h2 className={h2}>6. Feeling harmony and thinking it</h2>

        <Statement>
          <p className="mb-4">
            From the start, harmony has been both felt and calculated, and how the two relate is still unclear.
            Harmony is at once a mathematical, a physical, a psychological and a social phenomenon, and it sits where
            three old open problems cross:
          </p>
          <ol className="list-decimal pl-6 space-y-1">
            <li>why mathematics describes physics;</li>
            <li>how physical processes become felt experience;</li>
            <li>how parts make wholes.</li>
          </ol>
        </Statement>

        <p className={p}>
          <Label>Ear against number.</Label> Aristoxenus set the ear beside the intellect, against those before
          him who argued from number:
        </p>

        <SourceQuote
          book={SLUG.aristoxenus}
          page={24}
          src={IMG('6993891e0f04c37dcfa6084a', 24)}
          pageAlt="A manuscript page of Aristoxenus's Elements of Harmonics in Greek"
          source={<>Aristoxenus, <em>Elements of Harmonics</em>, Greek manuscript<Short href={Q.aristoxenus} /></>}
        >
          For with hearing, we judge the magnitudes of the intervals; but with the intellect, we observe their
          powers &hellip; But for the musician, the ruling principle is almost the accuracy of sensation
        </SourceQuote>

        <p className={p}>
          In Iamblichus&apos;s telling, harmony began as a problem of measurement. Pythagoras was wondering
          &ldquo;whether he might be able to devise some stable and unmistakable instrumental aid for hearing, such
          as sight has through the compass and the ruler&rdquo; (<Link href={Q.iamblichus88}>Greek manuscript, p. 88</Link>).
        </p>

        <p className={p}>
          <Label>A partial bridge.</Label> Single sources such as voices produce harmonic spectra. Brains may have
          evolved to read harmonicity as a sign of one source, so the felt sense of harmony may be number taken
          into the body over evolution. That would explain why harmony feels good; it would not explain what the
          feeling is like. Bowling and Purves argue for this vocal-similarity account (
          <Ext href={EXT.bowling}>2015</Ext>): &ldquo;the more voice-like a tone combination is, the more we should
          &lsquo;like&rsquo; it.&rdquo;
        </p>

        <p className={p}>
          The older books put feeling and number together through the soul. Pierre d&apos;Ailly, citing Macrobius,
          writes that &ldquo;in this life every soul is captivated by musical sounds because it carries into the
          body the memory of the music whose glory it had in heaven&rdquo; (<Link href={Q.ailly}>1480, p. 30</Link>).
          Ficino asks: &ldquo;Since, therefore, there is such a communion between the music of the soul and the
          body, what is the wonder if both body and soul are tempered by the same man?&rdquo; (
          <Link href={Q.ficino}><em>Epistolae</em> I, fol. 128r</Link>). And Iamblichus describes Pythagoras
          treating the passions with music: &ldquo;He used appropriate and congruent melodies for each of these
          vices, as if mixing salutary medicines&rdquo; (<Link href={Q.iamblichusMedicine}>1598 edition, p. 70</Link>).
        </p>

        <p className={p}>
          In lived experience, across 12 nations and 2,799 people, Delle Fave and colleagues found that
          &ldquo;inner harmony predominated among psychological definitions&rdquo; of happiness (
          <Ext href={EXT.delleFave}>2016</Ext>). Hasson and colleagues argue that &ldquo;neural processes in one
          brain are coupled to the neural processes in another brain via the transmission of a signal through the
          environment&rdquo; (<Ext href={EXT.hasson}>2012</Ext>), and Dikker and colleagues report that synchrony
          across students&apos; brains over a semester predicted class engagement (<Ext href={EXT.dikker}>2017</Ext>).
        </p>

        <p className={p}>
          <Label>Tensions.</Label> Fusion appears widespread, but liking consonance is learned (idea 5). Binding by
          synchrony, the idea that neural synchrony unifies what we perceive, is contested; Shadlen and Movshon
          examine it critically (<Ext href={EXT.shadlen}>1999</Ext>).
        </p>

        <p className={p}>
          <Label>Open questions.</Label> Does the stability of neural mode-locking predict felt consonance across
          cultures, apart from learning? Large and Kim report a dynamical model that predicts cross-cultural
          regularities and, with learning added, Indian and Western listeners&apos; perception of Hindustani ragas
          (<Ext href={EXT.large}>2016</Ext>). And what remains once the evolutionary &ldquo;why&rdquo; is answered?
        </p>

        {/* 7 */}
        <h2 className={h2}>7. Harmony as a research programme</h2>

        <Statement>
          <p className="mb-4">Harmony can be a framework and a theory at once:</p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li>a hard core that is not tested directly (idea 1);</li>
            <li>hypotheses specific to each level, which must predict new facts.</li>
          </ul>
          <p>
            &ldquo;Survival of the harmonized&rdquo; faces the same charge of circularity as &ldquo;survival of the
            fittest,&rdquo; and has the same way out: measure harmony before the outcome it is supposed to predict.
            The comparison is with natural selection and with spectroscopy, which Derek Lomas reads as research
            programmes of the same shape.
          </p>
        </Statement>

        <p className={p}>
          Two warnings come from the tradition itself. The counter-earth (idea 4) is the move to avoid: patching
          the system after the fact to keep the number. And the hammer story (idea 5) was repeated for centuries
          without being tried. Lomas and Xue add a warning of their own: there is a danger in mistaking measures of
          harmony for the concept of harmony, especially in computational optimization (RP.75).
        </p>

        <p className={p}>
          <Label>Candidate tests.</Label> Each predicts something that could fail:
        </p>
        <ul className={ul}>
          <li>differentiation multiplied by integration predicts resilience better than either alone;</li>
          <li>a coupling window: diversity and joint productivity both peak at intermediate coupling;</li>
          <li>friction between agents peaks at near agreement, as roughness peaks at small separations between tones;</li>
          <li>sweeps of the temperature-like parameter in AI fine-tuning trace an interior optimum (idea 10).</li>
        </ul>

        <p className={p}>
          <Label>Tensions.</Label> Anything built on Karl Friston&apos;s free-energy principle inherits its debate
          about falsifiability: Colombo and Wright note that it &ldquo;has been called a postulate, an unfalsifiable
          principle, a natural law, and an imperative&rdquo; (<Ext href={EXT.colombo}>2021</Ext>). Integrated
          information theory is contested more sharply still; an open letter of 2023 called it pseudoscience (
          <Ext href={EXT.fleming}>Fleming and colleagues</Ext>). The programme prefers the more modest measures.
        </p>

        <p className={p}>
          <Label>Open question.</Label> What is the first measure of harmony that could fail a prediction at two
          levels?
        </p>

        {/* 8 */}
        <h2 className={h2}>8. From metaphor to mechanism: harmony above zero temperature</h2>

        <Statement>
          <p className="mb-4">
            Resonance became a mechanism once one equation was shown to hold in every medium. For harmony the
            candidate is Smolensky&apos;s harmony function, which measures how well many soft, partly conflicting
            constraints are satisfied at once. Pure maximization freezes, so the mechanism is harmony maximization
            at a temperature above zero:
          </p>
          <p className="text-center text-xl my-4">&minus;F = H + T&middot;S</p>
          <p>
            H is fit, the whole. S is entropy, the diversity of states left open. T is the rate of exchange between
            them. At T = 0 the system locks; at high T it becomes noise. Diversity in wholeness is the optimum at
            moderate T.
          </p>
        </Statement>

        <p className={p}>
          Hinton and Sejnowski state the link to energy directly: &ldquo;Smolensky&apos;s harmony is equivalent to
          our energy (with a sign reversal)&rdquo; (<Ext href={EXT.hinton}>1986</Ext>). Temperature as a
          computational parameter is older than Smolensky; it is reported to come from statistical mechanics by way
          of the Metropolis algorithm, and Kirkpatrick, Gelatt and Vecchi made it a general method of optimization
          by &ldquo;a detailed analogy with annealing in solids&rdquo; (<Ext href={EXT.kirkpatrick}>1983</Ext>). The
          sampling temperature of every large language model rescales its outputs before the softmax, which means
          sampling from a Boltzmann distribution (<Ext href={EXT.distilling}>Hinton, Vinyals and Dean, 2015</Ext>).
        </p>

        <p className={p}>
          Friston&apos;s principle has self-organizing systems minimize a variational free energy, and &ldquo;the
          third formulation expresses free energy as complexity minus accuracy&rdquo; (
          <Ext href={EXT.friston}>2010</Ext>). The Helmholtz machine of Dayan, Hinton, Neal and Zemel is named for
          the same lineage: &ldquo;Following Helmholtz, we view the human perceptual system as a statistical inference
          engine&rdquo; (<Ext href={EXT.helmholtzMachine}>1995</Ext>). Lomas and Xue suggested that harmony
          measures could serve as objective functions for AI (RP.72&ndash;73), and Lomas, Lin and colleagues that
          &ldquo;the ability to measure resonance in interactions could aid AI-human interactions by enabling a
          meaningful &lsquo;objective function&rsquo; for optimization.&rdquo;
        </p>

        <p className={p}>
          <Label>Tensions.</Label> The proposal uses the free-energy identity, not the free-energy principle, and
          the two should be kept apart. The &ldquo;harmonic loss&rdquo; of Baek, Liu, Tyagi and Tegmark (
          <Ext href={EXT.harmonicLoss}>2025</Ext>) is named for inverse-distance weighting; the authors report better
          interpretability, less data needed to generalize and less grokking than with cross-entropy, but the paper
          does not connect the name to musical or philosophical harmony, so it gives this thesis little support.
        </p>

        <p className={p}>
          <Label>Open question.</Label> Is there something like temperature in social and ecological systems
          (exploration, noise, play), and does the optimum of harmony shift with it?
        </p>

        {/* 9 */}
        <h2 className={h2}>9. Intelligence is harmonizing</h2>

        <Statement>
          <p className="mb-4">
            Harmonizing is what intelligence is: integrating diverse motivations into coherent action that supports
            the whole. An intelligence that does not support wellbeing and sustainability is not so smart.
          </p>
          <p>
            This directly denies Nick Bostrom&apos;s orthogonality thesis. It can be read two ways. As a definition
            (call only harmonizers intelligent) it is coherent, but it wins the word, not the world: the narrow
            optimizer still runs. As a substantive claim it says harmonizing systems beat narrow optimizers over
            long horizons, because the dissonance a narrow optimizer creates comes back to it, while over short
            horizons the optimizer can win first. Alignment is then the problem of the short horizon: shorten the
            loop between harm to the whole and what the system senses.
          </p>
        </Statement>

        <p className={p}>
          Bostrom&apos;s thesis (<Ext href={EXT.bostrom}>2012</Ext>): &ldquo;Intelligence and final goals are
          orthogonal axes along which possible agents can freely vary. In other words, more or less any level of
          intelligence could in principle be combined with more or less any final goal.&rdquo; If that is true,
          more intelligence does not by itself make a system more harmonizing, and the claim needs an argument
          that blocks it.
        </p>

        <p className={p}>
          The wager is Plato&apos;s in the <em>Republic</em>: the inwardly harmonious soul is the just one, and
          orthogonality plays the part of Thrasymachus. In Book IV the just man is tuned like the fixed notes of a
          scale, the lowest, the highest and the middle:
        </p>

        <SourceQuote
          book={SLUG.republic}
          page={210}
          printedPage={186}
          src={IMG('69937706b0a84a57639627bb', 210)}
          pageAlt="A page of the Greek text of Plato's Republic, Book IV"
          source={<>Plato, <em>Republic</em> IV, 443d&ndash;e<Short href={Q.republic443} /></>}
        >
          harmonized the three parts of his soul just as if they were the three defining notes of a musical
          scale
        </SourceQuote>

        <p className={p}>
          Iamblichus credits Pythagoras with a harmony that reaches inward and outward at once: &ldquo;He fostered
          friendship of all toward all: whether of gods toward men through piety and scientific care; or of
          doctrines toward one another; or in general of the soul toward the body; or of the rational toward the
          irrational&rdquo; (<Link href={Q.friendship}>ed. Nauck, 1884, p. 49</Link>). Smolensky&apos;s harmony is
          integration as computation (idea 8), and Tononi, Sporns and Edelman&apos;s complexity measure is its
          neural counterpart (idea 1).
        </p>

        <p className={p}>
          <Label>A sharper version is needed.</Label> A harmony is not a soul. In the <em>Phaedo</em> Socrates
          answers Simmias, who held that the soul is an attunement of the body:
        </p>

        <SourceQuote
          book={SLUG.phaedo}
          page={348}
          printedPage={321}
          src={IMG('69937e41d85e1d5bbdf3295a', 348)}
          pageAlt="A page of the Phaedo in the Loeb edition, Greek facing English"
          source={<>Plato, <em>Phaedo</em> 93a, tr. H. N. Fowler (Loeb, 1914)<Short href={Q.phaedo} /></>}
        >
          A harmony, then, is quite unable to move or make a sound or do anything else that is opposed to its
          component parts.
        </SourceQuote>

        <p className={p}>
          Alexander of Aphrodisias separates the harmony from what it produces: &ldquo;For it is not the same thing
          for a cithara to be tuned by harmony and to emit sounds. For it is already tuned by harmony, even if it
          emits no sounds&rdquo; (<Link href={Q.alexander}><em>De anima</em>, Latin tr. Donatus, 1495, p. 56</Link>).
          An intelligence needs what a mere harmony lacks: the capacity to hold a pitch against drift.
        </p>

        <p className={p}>
          <Label>Open questions.</Label> Is there evidence that harmonizing agents outperform narrow ones over
          long horizons, in ecology, in firms or in simulations of many agents? What does shortening the loop look
          like in practice for AI systems?
        </p>

        {/* 10 */}
        <h2 className={h2}>10. Alignment as harmony</h2>

        <Statement>
          Alignment between people, AI and the natural world should be designed as <em>harmonia</em>: unlike
          parties fitted into a ratio, with a remainder, around a shared reference. It should not be designed as
          making the parties alike. Optimizing for approval at low temperature drives towards unison, which is
          homogenization. The aim is coupling that keeps differences and resolves dissonance at the right level.
        </Statement>

        <p className={p}>
          <Label>Unlike things need harmony; like things need none.</Label> That is Philolaus again (idea 1). Balance
          of power counts for more than matching values, as <em>De Mundo</em> puts it:
        </p>

        <Quote href={Q.deMundo246} cite={<>Pseudo-Aristotle, <em>De Mundo</em> 5, 396b&ndash;397a, Bern Cod. 402, p. 246</>}>
          And of this agreement, it is equality and the fact that none of them is more powerful than another. For
          heavy things have an equal resistance to light things, and hot things to cold things, with nature teaching
          in the greater matters that equality is in some way the savior of concord.
        </Quote>

        <p className={p}>
          <Label>The resonance trap.</Label> Lomas and Xue write that &ldquo;resonance, based on shared
          similarities, is the counterpart to harmony; harmony can emerge from natural resonances&rdquo; (RP.7).
          Resonance amplifies likeness, so an objective that rewards resonance alone rewards likeness, and that
          is the route to sycophancy. The thing to aim at is harmony, the fit of unlike parts. Lomas, Lin and
          colleagues already flag that robots able to build resonant rapport could persuade or manipulate people
          more effectively. Goodhart&apos;s law applies to any such score; Karwowski and colleagues report for
          reinforcement learning that &ldquo;increasing optimisation of an imperfect proxy beyond some critical
          point decreases performance on the true objective&rdquo; (<Ext href={EXT.karwowski}>2023</Ext>). And the
          sociologist Hartmut Rosa argues that resonance needs the other to stay partly uncontrollable (see{' '}
          <Link href="/articles/show-me-the-number">Show Me the Number</Link>).
        </p>

        <p className={p}>
          <Label>Alignment as annealing.</Label> The objective used to tune language models on human preferences
          has a closed-form optimum that reweights the reference model by exp(reward/&beta;), a Boltzmann
          reweighting in which &beta; plays the part of temperature (Rafailov and colleagues,{' '}
          <Ext href={EXT.dpo}>2023</Ext>). Kirk and colleagues found that this tuning &ldquo;substantially decreases
          the diversity of outputs sampled for a given input&rdquo; (<Ext href={EXT.kirk}>2024</Ext>). Padmakumar
          and He found that &ldquo;writing with InstructGPT (but not the GPT3) results in a statistically
          significant reduction in diversity&rdquo; across authors&apos; essays (<Ext href={EXT.padmakumar}>2024</Ext>).
          Soudry and colleagues proved (2018) that gradient descent on the logistic loss over separable data grows
          the weights without bound while converging in direction to the max-margin solution. The hypothesis
          drawn from this: optimizing for approval at low effective temperature homogenizes both the model&apos;s
          outputs and its users&apos;, and temperature and diversity are tunable parameters with an optimum in the
          interior.
        </p>

        <p className={p}>
          <Label>Coupling heuristics</Label> from the physics of oscillators:
        </p>
        <ul className={ul}>
          <li>unison is the default attractor, so homogenization is what happens unless something prevents it;</li>
          <li>damp rather than detune: add friction, delay or disagreement rather than cutting the coupling;</li>
          <li>tune the scale to both instruments: harmony between a person and an AI needs its own scale, not one imported from human pairs;</li>
          <li>beware a companion tuned sharply to one person, which rings long: an echo chamber.</li>
        </ul>

        <p className={p}>
          <Label>A reference pitch.</Label> Pairwise tuning drifts, as the comma shows, so two parties tuned only
          to each other build up error. Harmony across unlike parties needs a reference that neither owns, and
          how the comma is shared out is a question of justice. The danger is one listener claiming to hold the
          pitch for everyone, as Iamblichus says Pythagoras did:
        </p>

        <SourceQuote
          book={SLUG.iamblichus1598}
          page={97}
          printedPage={71}
          src={IMG('69c88efc6c6f3cc53c85b25e', 97)}
          pageAlt="A page of Iamblichus's Life of Pythagoras in the Greek and Latin edition of 1598"
          source={<>Iamblichus, <em>De vita Pythagorae</em> 15.65&ndash;67, Greek and Latin (Franeker, 1598)<Short href={Q.iamblichusSpheres} /></>}
        >
          He alone heard and understood, more fully than any other mortal, the universal harmony and consonance of
          the spheres and the stars that move within them.
        </SourceQuote>

        <p className={p}>
          <Label>Measure the album</Label>: evaluate at the right level and over the long horizon (idea 3). And a
          three-question test for any system of people, AI and nature: is it more differentiated, with people,
          cultures and species keeping distinct voices? Is it more integrated, with the parts informing and
          supporting each other? Are the parts strengthened, not only the whole? Integration without
          differentiation is homogenization; differentiation without integration is fragmentation; a strong whole
          with weakened parts is the totalitarian failure.
        </p>

        <p className={p}>
          <Label>Context and critiques.</Label> Huh and colleagues hypothesize that representations in large
          networks are converging &ldquo;toward a shared statistical model of reality, akin to Plato&apos;s concept of
          an ideal reality&rdquo; (<Ext href={EXT.prh}>2024</Ext>). That is beautiful, and also a monoculture risk.
          The authors list its limits themselves: &ldquo;Our argument only holds for intelligences that are optimized
          to perform well on many tasks,&rdquo; and &ldquo;researcher bias and collective preferences within the AI
          community have shaped the trajectory of model development,&rdquo; so convergence may measure a shared
          design culture rather than a deep structure. Gröger and colleagues report (<Ext href={EXT.groger}>2026</Ext>)
          that once similarity is calibrated for model scale, global convergence mostly disappears and only shared
          local structure survives. A harmonized agent cannot correct its partner (idea 9), and
          &ldquo;harmony&rdquo; has served power (idea 1).
        </p>

        {/* 11 */}
        <h2 className={h2}>11. Wellbeing, peace and sustainability</h2>

        <Statement>
          <p className="mb-4">The three are the same activity at different levels:</p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li><Label>wellbeing</Label> is harmonizing within: motives, body, attention;</li>
            <li><Label>peace</Label> is harmonizing between: persons, groups, nations;</li>
            <li><Label>sustainability</Label> is harmonizing with the whole, and across time.</li>
          </ul>
          <p>
            Like tonal harmony, sustainability is held together by a centre that lasts the length of the piece. A
            civilization that is consonant this quarter and ruinous next century is a chord that never resolves.
          </p>
        </Statement>

        <p className={p}>
          Lomas and Xue propose the harmonization of humankind and nature as a concise definition of sustainable
          design (RP.98), on top of their nested levels from the individual to the natural world (idea 3).
        </p>

        <p className={p}>
          <Label>Wellbeing.</Label> Inner harmony is the commonest psychological element in lay definitions of
          happiness across twelve nations (idea 6). Health in the brain is a balance of synchrony, not a maximum of
          it (idea 2). And the Pythagoreans, in Iamblichus&apos;s account, used song as medicine for the passions,
          with evening songs that rendered the disciples&apos; thoughts &ldquo;quiet, giving them peaceful and favorable sleep&rdquo; (
          <Link href={Q.iamblichusMedicine}>1598 edition, p. 70</Link>).
        </p>

        <p className={p}>
          <Label>Peace.</Label> <em>De Mundo</em>&apos;s city of rich and poor, young and old, holds together as
          political harmony (idea 1), and equality is &ldquo;in some way the savior of concord&rdquo; (idea 10).
          Iamblichus&apos;s friendship of all toward all runs from the citizen to the foreigner to the body&apos;s
          peace with its own contrary powers (idea 9).
        </p>

        <p className={p}>
          <Label>Across time.</Label> A chord is harmonious for where the piece is going (idea 3), and resolution
          is judged over the whole, not the moment.
        </p>

        <p className={p}>
          <Label>Tensions.</Label> &ldquo;Harmonious society&rdquo; has been the language of censorship. That is why
          the clause that the parts flourish is required (idea 1).
        </p>

        <p className={p}>
          <Label>Open question.</Label> The ecological question of whether diversity brings stability is the
          natural test of &ldquo;harmony with the whole,&rdquo; and it has not yet been brought into this account.
        </p>

        {/* Objections */}
        <h2 className={h2}>Objections to the programme</h2>

        <p className={p}>
          The history of harmony has examples of both kinds of science: the progressive kind that keeps predicting
          new things, and the degenerating kind that only patches its failures, like the counter-earth. The
          strongest objections, and what would answer them:
        </p>

        <ul className={ul}>
          <li>
            <Label>Circularity.</Label> If everything is diverse and whole, the definition explains nothing. It is
            answered only when a measure taken before the outcome has predicted something that could have failed
            (idea 7).
          </li>
          <li>
            <Label>Only a metaphor.</Label> Resonance went from metaphor to mechanism once one equation held in
            every medium; harmony needs the same, and the candidate is Smolensky&apos;s harmony function in its
            free-energy form (idea 8).
          </li>
          <li>
            <Label>An instrument of power.</Label> The answer is the requirement that the parts flourish too, which
            is not optional (idea 1).
          </li>
          <li>
            <Label>Selection.</Label> Putting dissonance and the irrational inside harmony moves the objection onto
            the ratio-centred version, but each level still owes an account of when harmony appears (idea 4).
          </li>
          <li>
            <Label>Inherited fragility</Label> from the free-energy principle and integrated information theory
            (idea 7); <Label>beauty misleads</Label> (idea 4); <Label>Goodhart</Label>, so any harmony score needs a
            held-out check (idea 10).
          </li>
          <li>
            <Label>The soul is not a harmony</Label> and <Label>orthogonality</Label>: an argument about alignment
            has to say where the capacity to hold a pitch against drift comes from (idea 9).
          </li>
          <li>
            <Label>The limits of convergence</Label> (idea 10) and <Label>tonality as a historical idiom</Label>{' '}
            (idea 5).
          </li>
        </ul>

        <p className={p}>
          <Label>Weak evidence often cited as strong.</Label>
        </p>
        <ul className={ul}>
          <li>
            Iamblichus wrote his life of Pythagoras around 300 CE, as an admirer: read it as what the tradition
            believed, not as history.
          </li>
          <li>&ldquo;All is number&rdquo; is Aristotle&apos;s gloss, as Zhmud argues (idea 4).</li>
          <li>The hammer experiment, as told, gives the wrong intervals (idea 5).</li>
          <li>A golden-mean architecture of brain rhythms is a proposal, not established structure (idea 4).</li>
          <li>Pleasure in consonance is shaped by culture, even though perceptual fusion looks universal (idea 5).</li>
          <li>Synchrony as the brain&apos;s binding mechanism is contested (idea 6).</li>
        </ul>

        <p className="text-sm text-muted leading-relaxed mt-12">
          The ideas on this page are Derek Lomas&apos;s research, developed from his papers with Haian Xue and
          with Albert Lin and colleagues. Quotations from books in the library are Source Library&apos;s English
          translations, or the printed English for English books (Jowett, Taylor, Holder, the Loeb{' '}
          <em>Phaedo</em>), copied from the pages they link to; a word in italics followed by square brackets is the
          original term with the page&apos;s gloss. Studies and papers outside the library are linked where they
          are cited. Where a finding has been checked only in an abstract or a summary, the text says that the
          authors &ldquo;report&rdquo; or &ldquo;argue&rdquo; it. Smolensky (1986), Simon (1962) and Soudry and
          colleagues (2018) are cited from the published papers without a link.
        </p>
      </article>
    </ContentPageLayout>
  );
}
