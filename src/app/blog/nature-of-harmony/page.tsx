/* eslint-disable react/no-unescaped-entities */
import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import DissonanceDemo from '@/components/blog/DissonanceDemo';
import { BalmerSpectrum, ChladniFigure } from '@/components/blog/HarmonyVisuals';

const HERO = 'https://images.sourcelibrary.org/artwork/art-anima-mundi-the-world-soul.jpg';
const HERO_ALT = "Robert Fludd's 1617 engraving Integrae Naturae Speculum, Artisque Imago — Nature as a crowned virgin chained to the divine name above and to an ape (Art) on the terrestrial globe below.";

export const metadata: Metadata = {
  title: 'The Nature of Harmony - Source Library',
  description:
    'For twenty-five centuries and across five civilizations, people said the world is built like music — and split at once into those who heard a deep order and those who demanded to measure it. A history of that quarrel, from a plucked string in antiquity to the whole-number ratios inside the atom.',
  openGraph: {
    title: 'The Nature of Harmony',
    description:
      'A history of harmony and its measurers — Pythagoras and Aristoxenus, Plato, China and India, Fludd and Kepler, the Galileis and Descartes and Kircher — told through the books one library holds.',
    images: [{ url: HERO, alt: HERO_ALT }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: HERO, alt: HERO_ALT }],
  },
  alternates: { canonical: '/blog/nature-of-harmony' },
};

export default function NatureOfHarmonyPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Nature of Harmony"
          subtitle="One idea, five traditions, twenty-five centuries — and the argument it never stopped starting"
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">Part I of two &middot; 15 July 2026 &middot; 18 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link href="/blog" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Pluck a taut string; then pluck one exactly half as long. The two sounds fuse into something the ear hears almost
          as a single note — the octave. Two-thirds of the length gives the fifth; three-quarters, the fourth. These are not
          matters of taste. They are small whole numbers, hiding in a plucked string, and every musical culture on earth has
          found them. From that plain fact grew one of the largest ideas human beings have ever had: that the whole world is
          built, like music, on proportion — that reality is, at bottom, a harmony.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          And from the very same fact grew an argument that has never once stopped. The instant someone declares the cosmos a
          harmony, someone else asks: can you prove it, or is that a lovely picture you have mistaken for a fact? Every age has
          had both people — pattern-seers who heard a deep order, and measurers who demanded a number. This is the history of
          their quarrel, told across five civilizations and twenty-five centuries through the books, translated and citable to
          the page, that a single library happens to hold. (The sequel,{' '}
          <Link href="/blog/show-me-the-number" className="text-accent-rust hover:text-accent-rust underline">Show Me the Number</Link>,
          asks whether the argument has finally met its strangest subject: artificial intelligence.)
        </p>

        <hr className="border-border-light my-12" />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">The first quarrel</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          The two temperaments took the field together, at the very start. The legend has Pythagoras pass a smithy, hear the
          hammers ring in concord, and discover that the sweet intervals answer to simple ratios — the octave 2:1, the fifth
          3:2, the fourth 4:3. Whether or not it happened at a forge, the Pythagoreans built a cosmos on it: number is the
          substance of things, the heavens themselves sound a <em>harmonia</em>, and to know the world is to know its
          proportions. The pattern-seer was born fully formed.
        </p>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          So, at once, was his opponent. Within a century Aristoxenus — a pupil of Aristotle, and the earliest music theorist
          we can still read — told the Pythagoreans they had it backwards: music is judged by the trained ear, not by
          arithmetic, and an interval is what a listener actually hears, not what a ratio decrees. Measure the phenomenon; do
          not deduce it from numbers you happen to find beautiful. Twenty-two centuries before Helmholtz located consonance in
          the ear, the measurer had already planted his flag — and both sides sit on the same shelf here, Aristoxenus's{' '}
          <Link href="/book/aristoxeni-musici-antiquissimi-harmonicorum-elementorum-ed" className="text-accent-rust hover:text-accent-rust underline">
            <em>Harmonic Elements</em>
          </Link>{' '}
          beside the Pythagorean line carried by Ptolemy and Nicomachus.
        </p>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          Between them stands the book that handed the whole idea to the West. In Plato's{' '}
          <Link href="/book/timaeus-ms-digby-23-plato" className="text-accent-rust hover:text-accent-rust underline"><em>Timaeus</em></Link>,
          the craftsman-god fashions the very soul of the world out of musical ratios — the octave, the fifth, the fourth, the
          whole-tone — so that the cosmos is not merely described by harmony but literally built of it. Every figure who
          follows, Fludd and Kepler and Kircher alike, is an heir of that one sentence.
        </p>

        <hr className="border-border-light my-12" />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">The same discovery, everywhere</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          And it was not a Western idea. The deepest version of resonance is Chinese. Two thousand years ago,{' '}
          <em>gǎnyìng</em> (感應) — sympathetic resonance — was the master principle of the cosmos: things of the same kind
          answer one another across a field of <em>qi</em>, with no contact and no push. The stock image for it, in the{' '}
          <em>Zhuangzi</em> and the <em>Huainanzi</em>, was precisely Hooke's, seventeen centuries early — pluck the <em>gong</em>{' '}
          string on one zither and the <em>gong</em> string of another, untouched across the room, sounds in reply. Where the
          West kept <em>harmony</em>, a static ratio, China made <em>resonance</em>, a living response, the deepest thing there
          is. Nor were the ratios a Western fingerprint: Chinese theorists generated their twelve pitch-pipes from the yellow
          bell by the cycle of fifths by the third century BCE, and around 1584 the prince{' '}
          <Link href="/book/complete-works-on-music-and-tuning-vols-4-5" className="text-accent-rust hover:text-accent-rust underline">Zhu Zaiyu</Link>{' '}
          computed equal temperament — the twelfth root of two — a decade before any European, in the very decade Kepler was
          nesting his Platonic solids.
        </p>

        <figure className="my-12">
          <Link href="/book/complete-works-on-music-and-tuning-vols-4-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.sourcelibrary.org/pages/69c6614901a26ccff09f5036/0098.jpg"
              alt="A tuning diagram from Zhu Zaiyu's Complete Works on Music and Tuning — a graduated ladder of pitch-pipes with circular pitch-markers."
              className="w-full max-w-2xl mx-auto rounded-lg shadow-md"
            />
          </Link>
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            China's ladder of pitches — Zhu Zaiyu's twelve <em>lülü</em>, each length fixed by ratio from the yellow bell.{' '}
            <em>Complete Works on Music and Tuning</em>, 1596.{' '}
            <Link href="/book/complete-works-on-music-and-tuning-vols-4-5" className="text-accent-rust hover:text-accent-rust not-italic">View in Source Library &rarr;</Link>
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          India gave the intuition its most absolute form and, in the same breath, tested it. Sound there is{' '}
          <em>Nāda Brahman</em> — vibration as the ultimate reality, the cosmos sounded into being; <em>OM</em> is its first
          syllable, and every audible note a shard of the divine.
        </p>

        <figure className="my-8">
          <blockquote className="border-l-2 border-accent-rust/40 pl-5 italic text-secondary font-body leading-relaxed">
            Om!—This syllable is the entire world. Its further explanation is as follows: The past, the present, the future—everything is simply the word Om.
          </blockquote>
          <figcaption className="text-sm text-muted mt-2 pl-5 not-italic">
            — Māṇḍūkya Upanishad, p. 391.{' '}
            <Link href="/q/BgTWpKOzEuBoNwN1WoP" className="text-accent-rust hover:text-accent-rust underline">sourcelibrary.org/q/BgTWpKOzEuBoNwN1WoP</Link>
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          Yet the same tradition was ferociously exact. To fix the twenty-two microtonal <em>śrutis</em> that divide the octave,
          Bharata's{' '}
          <Link href="/book/natyashastram-sanskrit-text-ed" className="text-accent-rust hover:text-accent-rust underline"><em>Nāṭyaśāstra</em></Link>{' '}
          set two <em>vīṇās</em> side by side, tuned them identically, then lowered one by a single <em>śruti</em> and slid the
          whole instrument down, step by step, until the two answered as one again — counting the intervals by ear. A
          metaphysics as absolute as any ever written, and an experiment to test it, in the same book — the pattern-seer and the
          measurer not merely in one culture but in one mind.
        </p>

        <figure className="my-12">
          <Link href="/book/life-scenes-of-buddha-2nd-century-ce-limestone-amravati-andhra-pradesh-sculpture">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.sourcelibrary.org/artwork/art-lute-in-life-scenes-of-buddha-2nd-century-ce-amravati.jpg"
              alt="A carved stone relief of Indian court musicians playing a lute and a transverse flute, Amravati, 2nd century CE."
              className="w-full max-w-2xl mx-auto rounded-lg shadow-md"
            />
          </Link>
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            Court music of the Nāṭyaśāstra's age — Amravati, 2nd century CE, the world in which Bharata set two vīṇās against
            each other to count the śrutis by ear.{' '}
            <Link href="/book/life-scenes-of-buddha-2nd-century-ce-limestone-amravati-andhra-pradesh-sculpture" className="text-accent-rust hover:text-accent-rust not-italic">View in Source Library &rarr;</Link>
          </figcaption>
        </figure>

        <hr className="border-border-light my-12" />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">Fludd's world was one tuned string</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          In 1617 the pattern-seer reached his fullest flight. Robert Fludd — physician, alchemist, Hermeticist — published a
          two-thousand-page account of the whole cosmos as a single musical instrument. At the centre of its famous
          frontispiece (above) he set an ape, chained beneath Nature's feet: not a beast of contempt, but <em>Art</em> — human
          skill — personified as Nature's ape, holding up a gridded model of the world it sits on. And the world itself, for
          Fludd, was one string.
        </p>

        <figure className="my-8">
          <blockquote className="border-l-2 border-accent-rust/40 pl-5 italic text-secondary font-body leading-relaxed">
            The instrument of this melody — namely, the machine of the world — is like a monochord, whose string, through which
            the consensus of parts is introduced, is the intermediate matter of the whole world. The Author in this music,
            however, is the soul of the world or the essence-making light.
          </blockquote>
          <figcaption className="text-sm text-muted mt-2 pl-5 not-italic">
            — Robert Fludd, <em>Utriusque Cosmi Historia</em>, vol. 1, p. 81 (1617).{' '}
            <Link href="/q/BeuuQTww378Jbpb3oC9" className="text-accent-rust hover:text-accent-rust underline">sourcelibrary.org/q/BeuuQTww378Jbpb3oC9</Link>
          </figcaption>
        </figure>

        <figure className="my-12">
          <Link href="/book/utriusque-cosmi-historia-tomus-primus-de-macrocosmi-fludd/page/69593413b282844d7b277b15">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.sourcelibrary.org/pages/69593413b282844d7b277aaf/0102.jpg"
              alt="Fludd's engraving of the world-monochord: a single string from a sun-faced tuning peg down to the earth, crossed by arcs marking the octave, fifth, and fourth."
              className="w-full max-w-md mx-auto rounded-lg shadow-md"
            />
          </Link>
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            The world-monochord — one string from the sun-faced peg to the earth, divided by the octave, fifth, and fourth
            across fire, air, water, and earth. Fludd, 1617.{' '}
            <Link href="/book/utriusque-cosmi-historia-tomus-primus-de-macrocosmi-fludd/page/69593413b282844d7b277b15" className="text-accent-rust hover:text-accent-rust not-italic">View in Source Library &rarr;</Link>
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          Fludd even ran the numbers, hanging real effects on every interval — the Moon sounding a fifth with the earth to drive
          the tides, and so on. It is a full theory of the world, built on musical ratios, and it is also, as physics, almost
          entirely wrong. Which is exactly the measurer's opening.
        </p>

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">Kepler: show me the number</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          Johannes Kepler — imperial mathematician, fresh from wringing three laws of planetary motion out of Tycho Brahe's
          observations — appended to his own <em>Harmony of the World</em> a point-by-point demolition of Fludd. The remarkable
          thing is that he was not attacking harmony. He believed in the music of the spheres as devoutly as Fludd did. He was
          attacking a <em>method</em>.
        </p>

        <figure className="my-8">
          <blockquote className="border-l-2 border-accent-rust/40 pl-5 italic text-secondary font-body leading-relaxed">
            A "Worldly Harmony" that is perceived by the mind alone and not the eyes … is truly not only lacking in substance
            and "kernel," but it is not even the "husk." Indeed, it is a shadow without a body, and the dream of a shadow.
          </blockquote>
          <figcaption className="text-sm text-muted mt-2 pl-5 not-italic">
            — Johannes Kepler, <em>Apology for the Harmony of the World</em>, p. 46 (1622).{' '}
            <Link href="/q/Bg70gtiOQIGdJQX0RRe" className="text-accent-rust hover:text-accent-rust underline">sourcelibrary.org/q/Bg70gtiOQIGdJQX0RRe</Link>
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          His demand reduces to three words — <em>show me the number</em> — and he backed it with the discovery of a lifetime:
          the hunt for those very harmonies, in Tycho's measured planetary speeds, is where the Third Law was found. Demand the
          number, and the harmony does not die; it grounds. But one honest wrinkle proves the ethic of the whole story. The
          same book that gave us the true Third Law also gave us Kepler's five Platonic solids, nested inside the planetary
          orbits — a scheme he loved, that fit the data tolerably, and that is simply wrong.
        </p>

        <figure className="my-12">
          <Link href="/book/mysterium-cosmographicum-1596-first-edition-kepler">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Kepler_Platonic_Solids.tif/lossy-page1-1100px-Kepler_Platonic_Solids.tif.jpg"
              alt="Kepler's engraving of the nested Platonic solids model of the solar system — cube, tetrahedron, dodecahedron, icosahedron, and octahedron set between the planetary spheres, on an ornate goblet base."
              className="w-full max-w-lg mx-auto rounded-lg shadow-md"
            />
          </Link>
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            The beautiful, wrong idea — Kepler's nested Platonic solids, which he believed fixed the size of the cosmos. It
            survived contact with the data well enough to keep, and it is simply wrong. <em>Mysterium Cosmographicum</em>, 1596
            (plate via Wikimedia Commons; our own copy lacks its foldout).{' '}
            <Link href="/book/mysterium-cosmographicum-1596-first-edition-kepler" className="text-accent-rust hover:text-accent-rust not-italic">View in Source Library &rarr;</Link>
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          Even the great empiricist could not fully sort the discovered from the imposed inside his own masterpiece.
          Measurement disciplines analogy; it does not purify it. Discovery is a mixture — always — and the work is telling
          which is which.
        </p>

        <hr className="border-border-light my-12" />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">The measurers take it to the bench</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          Fludd's cosmic string drew the measurers out. One was already at work before him:{' '}
          <Link href="/book/dialogo-della-musica-antica-et-della-moderna-galilei" className="text-accent-rust hover:text-accent-rust underline">Vincenzo Galilei</Link>{' '}
          — lutenist, theorist, and father of the astronomer — who in 1581 did the unthinkable and <em>tested</em> the sacred
          Pythagorean ratios. Hang weights on strings instead of shortening them, he found, and the octave no longer answers to
          2:1 but to 4:1; the numbers are not holy, they depend on what you actually do to the string. His son{' '}
          <Link href="/book/discorsi-e-dimostrazioni-matematiche-intorno-a-due-nuove-galilei" className="text-accent-rust hover:text-accent-rust underline">Galileo</Link>{' '}
          finished the thought in 1638: consonance is sweet when the pulses two strings send to the eardrum fall into step, and
          harsh when they never quite agree — consonance moved out of the number and into the body that hears it. Then came the
          encyclopedists of sound:{' '}
          <Link href="/book/traite-de-l-harmonie-universelle-mersenne" className="text-accent-rust hover:text-accent-rust underline">Marin Mersenne</Link>{' '}
          measured the true frequencies of vibrating strings across the twelve hundred pages of his <em>Harmonie Universelle</em>{' '}
          (1636). And a young{' '}
          <Link href="/book/musicae-compendium-descartes" className="text-accent-rust hover:text-accent-rust underline">René Descartes</Link>{' '}
          — who would soon set out to mechanize the whole universe — opened his very first book by grounding human feeling
          itself in resonance:
        </p>

        <figure className="my-8">
          <blockquote className="border-l-2 border-accent-rust/40 pl-5 italic text-secondary font-body leading-relaxed">
            This alone seems to make the human voice the most pleasing sound of all: that it is, of all things, the most attuned
            to our own spirits. And so, perhaps, a friend's voice pleases us more than an enemy's, through a sympathy or
            antipathy of our feelings — on the very principle by which, they say, a sheepskin stretched over one drum falls
            silent when struck, while a wolfskin over another drum resonates.
          </blockquote>
          <figcaption className="text-sm text-muted mt-2 pl-5 not-italic">
            — René Descartes, <em>Compendium of Music</em>, p. 1 (written 1618).{' '}
            <Link href="/q/BhI8eaAwF31xcf5TJAE" className="text-accent-rust hover:text-accent-rust underline">sourcelibrary.org/q/BhI8eaAwF31xcf5TJAE</Link>
          </figcaption>
        </figure>

        <DissonanceDemo
          title="Hear what Galileo heard"
          caption="Two pure tones. Slide the second one across the octave: at the simple ratios — 2:1, 3:2, 4:3 — the pulses fall into step and the sound locks; in between, you hear the beating his theory predicts. The frequencies, their ratio, and the beat rate update live."
          sourceHref="/book/discorsi-e-dimostrazioni-matematiche-intorno-a-due-nuove-galilei"
          sourceLabel="Galileo, Discorsi (1638)"
        />

        <p className="text-muted text-sm mb-8 font-body italic">
          This bench has nine siblings — the smith&apos;s hammers weighed, Kepler&apos;s planets
          auditioned, Tartini&apos;s ghost tone summoned — in{' '}
          <Link href="/blog/sound-laboratory" className="text-accent-rust hover:text-accent-rust underline not-italic">The Sound Laboratory</Link>.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          The word Descartes reaches for is the hinge of the whole story: <em>resonare</em>. By 1650 sympathetic resonance was
          no longer a metaphor at all — it was a repeatable experiment. Athanasius Kircher, in his vast{' '}
          <Link href="/q/BeiyEhG4alMIcmBHPmr" className="text-accent-rust hover:text-accent-rust underline"><em>Musurgia Universalis</em></Link>,
          stretched nine strings on a board, struck one, and watched the others answer untouched — and, crucially, sorted the
          sympathetic from the stubborn:
        </p>

        <figure className="my-12">
          <Link href="/book/universal-musical-work-volume-ii-musurgia-universalis-kircher">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.sourcelibrary.org/pages/69520516ab34727b1f04245b/0225.jpg"
              alt="Kircher's page on the sympathetic-string experiment, with a diagram of nine horizontal strings labelled from Nete to Hypate."
              className="w-full max-w-md mx-auto rounded-lg shadow-md"
            />
          </Link>
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            Sympathy on a bench — Kircher's nine strings, <em>Nete</em> to <em>Hypate</em>: strike one and every string tuned in
            consonance answers on its own, while the dissonant ones stay dead. <em>Musurgia Universalis</em>, 1650.{' '}
            <Link href="/book/universal-musical-work-volume-ii-musurgia-universalis-kircher" className="text-accent-rust hover:text-accent-rust not-italic">View in Source Library &rarr;</Link>
          </figcaption>
        </figure>

        <figure className="my-8">
          <blockquote className="border-l-2 border-accent-rust/40 pl-5 text-secondary font-body leading-relaxed">
            If you strike this first string, F, with a plectrum, it will cause all the strings that are isotonous to it to
            resound, no matter how untouched they remain … all strings consonant with the hypate are moved … Dissonant strings,
            however, being unable to be moved by this friendly provocation, will persist in their stubbornness.
          </blockquote>
          <figcaption className="text-sm text-muted mt-2 pl-5">
            — Athanasius Kircher, <em>Musurgia Universalis</em> II, p. 225 (1650).{' '}
            <Link href="/q/BeiyEhG4alMIcmBHPmr" className="text-accent-rust hover:text-accent-rust underline">sourcelibrary.org/q/BeiyEhG4alMIcmBHPmr</Link>
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          Twenty-eight years before Hooke, Kircher had <em>gǎnyìng</em> on a bench — resonance as a fact he could produce at
          will, consonant strings answering and dissonant ones sullen. And then Robert Hooke, in his 1678 lecture{' '}
          <Link href="/q/BeotePnbpWFLEZ4QfUJ" className="text-accent-rust hover:text-accent-rust underline"><em>Of Spring</em></Link>{' '}
          — the very lecture that states Hooke's Law — carried the vibrating string into the substance of matter itself,
          proposing that particles cohere or repel exactly as strings answer or ignore one another, by consonance and
          dissonance. The measurers only gained ground from there.
        </p>

        <hr className="border-border-light my-12" />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">Resonance becomes physics — and where ratios really live</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          Chladni scattered sand on vibrating plates and watched it collect into nodal figures; Rameau and Tartini and, above
          all, Helmholtz turned consonance into acoustics and physiology. And then the vibrating string left the concert hall
          entirely. In 1926 Heisenberg, explaining the helium spectrum, reached for a frankly Hookean picture — two coupled
          pendulums trading energy — and named the quantum effect after the mechanical one: <em>resonance</em>. It became the
          exchange interaction, the effect that holds molecules together. The Pythagorean hunch, at the scale of the atom, is
          simply true: an electron's allowed orbits are the ones where a whole number of wavelengths fits, and hydrogen emits
          only the discrete lines that integer arithmetic permits. Matter really does have a discrete set of tones.
        </p>

        <BalmerSpectrum />
        <p className="text-secondary leading-relaxed mb-8 font-body">
          But "reality is ratios" is too loose, and getting it precise is the whole gift of the quarrel. Integer ratios are not
          fundamental to resonance. A single driven oscillator — a wine glass, a swing — has no privileged ratios at all; its
          response is a smooth curve peaking when the drive <em>matches</em> its own frequency. Whole numbers become privileged
          only under three conditions: a <strong>boundary</strong> that confines a wave (a string, an atom's orbit), a
          <strong> coupling</strong> tight enough that two oscillators lock (the mathematics of orbital resonance and the
          empty Kirkwood gaps of the asteroid belt), or <strong>perception</strong> folding overtones together — for when Plomp
          and Levelt measured which intervals actually sound consonant, in 1965, the governing variable was not integer ratio
          but roughness. Even musical harmony is ratio-<em>derived</em>, not ratio-<em>fundamental</em>. So Fludd was half right,
          in a way you can state exactly: ratio is real where there is a boundary, a closed loop, or genuine coupling, and
          everywhere else "harmony" is only matching and amplitude.
        </p>

        <ChladniFigure />

        <hr className="border-border-light my-12" />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">Coda: and now, a machine</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          The history could rest here, at the threshold it took twenty-five centuries to reach. But we have just built something
          that makes the oldest question new — an artificial imitator, Fludd's ape grown real, that holds a model of the world
          and, in bounded domains, outperforms the source it learned from. And the word we reach for to name how we hope to live
          alongside it is the oldest word in this essay: we want to be in <em>harmony</em> with it. Descartes already told us why
          a voice can move us, because it is "attuned to our own spirits," and asked in the same breath whether that attunement
          is a true sympathy or a drumhead we have merely struck. Whether there is a <em>number</em> behind human–AI harmony —
          a real, measurable law, or only a beautiful picture — is Kepler's question, asked of the strangest instrument we have
          ever tried to tune. It is the subject of{' '}
          <Link href="/blog/show-me-the-number" className="text-accent-rust hover:text-accent-rust underline">Part II, "Show Me the Number."</Link>
        </p>

        <hr className="border-border-light my-12" />

        <h3 className="font-serif text-lg text-primary mb-4 mt-8">The shelf</h3>
        <p className="text-secondary leading-relaxed mb-6 font-body text-base">
          Every source in this essay — four traditions across twenty-five centuries, the original Greek, Sanskrit, Chinese,
          Italian, French, Latin, or German behind each link — is held and translated at Source Library. A representative span,
          in order:
        </p>
        <ul className="text-secondary font-body text-base leading-relaxed mb-8 space-y-1 list-none pl-0">
          {[
            ['c.700 BCE', 'Māṇḍūkya Upanishad', 'Sanskrit', '/book/the-thirteen-principal-upanishads-trans'],
            ['c.360 BCE', 'Plato, Timaeus', 'Greek', '/book/timaeus-ms-digby-23-plato'],
            ['c.330 BCE', 'Aristoxenus, Harmonic Elements', 'Greek', '/book/aristoxeni-musici-antiquissimi-harmonicorum-elementorum-ed'],
            ['c.200 CE', 'Bharata, Nāṭyaśāstra', 'Sanskrit', '/book/natyashastram-sanskrit-text-ed'],
            ['1581', 'Vincenzo Galilei, Dialogue on Ancient and Modern Music', 'Italian', '/book/dialogo-della-musica-antica-et-della-moderna-galilei'],
            ['1596', 'Zhu Zaiyu, Complete Works on Music and Tuning', 'Chinese', '/book/complete-works-on-music-and-tuning-vols-4-5'],
            ['1596', 'Kepler, The Cosmographic Mystery', 'Latin', '/book/mysterium-cosmographicum-1596-first-edition-kepler'],
            ['1617', 'Fludd, Utriusque Cosmi Historia, vol. 1', 'Latin', '/book/utriusque-cosmi-historia-tomus-primus-de-macrocosmi-fludd'],
            ['1618', 'Descartes, Compendium of Music', 'Latin', '/book/musicae-compendium-descartes'],
            ['1622', 'Kepler, Apology for the Harmony of the World', 'Latin', '/book/apology-for-the-harmony-of-the-world-kepler'],
            ['1636', 'Mersenne, Harmonie Universelle', 'French', '/book/traite-de-l-harmonie-universelle-mersenne'],
            ['1638', 'Galileo, Two New Sciences', 'Italian', '/book/discorsi-e-dimostrazioni-matematiche-intorno-a-due-nuove-galilei'],
            ['1650', 'Kircher, Musurgia Universalis', 'Latin', '/book/universal-musical-work-volume-ii-musurgia-universalis-kircher'],
            ['1678', 'Hooke, Of Spring', 'English', '/book/lectures-de-potentia-restitutiva-or-of-spring-hooke'],
            ['1722', 'Rameau, Treatise on Harmony', 'French', '/book/traite-de-l-harmonie-rameau'],
            ['1863', 'Helmholtz, On the Sensations of Tone', 'German', '/book/on-the-sensations-of-tone-helmholtz'],
          ].map(([yr, title, lang, href]) => (
            <li key={href} className="flex gap-3 py-1 border-t border-border-light first:border-t-0">
              <span className="text-muted text-sm tabular-nums shrink-0 w-20">{yr}</span>
              <span>
                <Link href={href} className="text-accent-rust hover:text-accent-rust underline">{title}</Link>
                <span className="text-muted text-sm"> &middot; {lang}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-muted text-sm mb-8 font-body italic">
          Primary-source quotations are verified verbatim against Source Library; the translations are Source Library's own
          (the Descartes page revised by Claude Opus 4.8). Fludd's first volume and Kepler's <em>Apology</em> against him have,
          as far as we can establish, never before appeared in English.
        </p>

      </article>
    </ContentPageLayout>
  );
}
