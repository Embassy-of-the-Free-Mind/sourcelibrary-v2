import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import HammerStringDemo from '@/components/blog/lab/HammerStringDemo';
import CommaSpiralDemo from '@/components/blog/lab/CommaSpiralDemo';
import SchismaSliverDemo from '@/components/blog/lab/SchismaSliverDemo';
import ShrutiTestDemo from '@/components/blog/lab/ShrutiTestDemo';
import SalmonTrialDemo from '@/components/blog/lab/SalmonTrialDemo';
import TartiniDemo from '@/components/blog/lab/TartiniDemo';
import GalileoRhythmDemo from '@/components/blog/lab/GalileoRhythmDemo';
import KeplerPlanetsDemo from '@/components/blog/lab/KeplerPlanetsDemo';
import KircherResonanceDemo from '@/components/blog/lab/KircherResonanceDemo';
import YueJiAffectDemo from '@/components/blog/lab/YueJiAffectDemo';
import EulerGradusDemo from '@/components/blog/lab/EulerGradusDemo';
import { FolioFigure, FolioPair } from '@/components/blog/lab/FolioFigure';

const HERO = 'https://images.sourcelibrary.org/artwork/art-sadeler-fabel-van-de-smid-en-de-hond.jpg';

export const metadata: Metadata = {
  title: 'The Sound Laboratory - Source Library',
  description:
    'Ten interactive stations that put twenty-five centuries of claims about harmony to the test — the smith\'s hammers, the Pythagorean comma, Bharata\'s two vīṇās, Salmon\'s Royal Society trial, Tartini\'s third tone, Galileo\'s rhythm-into-pitch continuum, Kepler\'s planet-songs, Kircher\'s sympathetic strings, the Record of Music\'s six sounds, and Euler\'s formula for sweetness. Bring headphones.',
  alternates: {
    canonical: '/blog/sound-laboratory',
  },
  openGraph: {
    title: 'The Sound Laboratory',
    description:
      'Twenty-five centuries of claims about harmony, testable with your own ears: five interactive stations, each anchored to a book in the library.',
    images: [{ url: HERO, alt: 'A smith at his anvil, hammer raised — Aegidius Sadeler, 1608' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: HERO, alt: 'A smith at his anvil, hammer raised — Aegidius Sadeler, 1608' }],
  },
};

export default function SoundLaboratoryPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Sound Laboratory"
          subtitle="Twenty-five centuries of claims about harmony. Your ears are the instrument."
          image={HERO}
          imageAlt="A smith at his anvil, hammer raised — Aegidius Sadeler's engraving of the smith and the dog, 1608"
        >
          <p className="text-stone-400 text-sm mt-4">16 July 2026 &middot; 10 experiments &middot; headphones recommended</p>
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
          <Link href="/blog/nature-of-harmony" className="text-accent-rust hover:text-accent-rust underline">The Nature of Harmony</Link>{' '}
          told the story: twenty-five centuries of people claiming the world is built like music, and
          the long quarrel between those who heard a cosmic order and those who demanded to measure it.{' '}
          <Link href="/blog/show-me-the-number" className="text-accent-rust hover:text-accent-rust underline">Show Me the Number</Link>{' '}
          made the argument. This note is the bench. Each station below takes one claim from a book in
          this library and puts it where its authors said it belonged — in front of your ears. None of
          this is a recording; every sound is synthesized in your browser, live, from the numbers in
          the sources.
        </p>

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">I. Weigh the hammers</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          The founding legend, told by{' '}
          <Link href="/book/de-institutione-musica-15th-c-ms-boethius" className="text-accent-rust hover:text-accent-rust underline">Boethius</Link>{' '}
          and pictured in{' '}
          <Link href="/book/theorica-musicae-gaffurius" className="text-accent-rust hover:text-accent-rust underline">Gaffurius&apos;s <em>Theorica Musicae</em></Link>{' '}
          (1480), says Pythagoras heard concord in a smithy and traced it to the hammers&apos; weights:
          double the weight, get the octave. It is a beautiful story, and it is false — as{' '}
          <Link href="/book/dialogo-della-musica-antica-et-della-moderna-galilei" className="text-accent-rust hover:text-accent-rust underline">Vincenzo Galilei</Link>{' '}
          showed by actually doing it in 1581. Frequency follows the <em>square root</em> of tension:
          the octave needs four times the weight, and the legend&apos;s two-to-one delivers not the
          octave but the tritone. Length behaves; weight does not. Try both.
        </p>
        <HammerStringDemo />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">II. The circle that won&apos;t close</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          If the pure fifth is sacred, twelve of them stacked end to end should return you to where you
          began, seven octaves up. They don&apos;t. The spiral overshoots by a small, stubborn remainder
          — the Pythagorean comma — and every tuning system in history is a different way of hiding it.
          The cleanest solution came from a Ming prince:{' '}
          <Link href="/book/complete-works-on-music-and-tuning-vol-1" className="text-accent-rust hover:text-accent-rust underline">Zhu Zaiyu</Link>{' '}
          (1584) made every fifth equal to the twelfth root of two — shaving each one by two cents,
          less than most ears can find — and the circle closed for the first time. Even drawing
          pitch as a circle had to be invented: the earliest circular pitch diagrams we hold are in{' '}
          <Link href="/book/musicae-compendium-descartes" className="text-accent-rust hover:text-accent-rust underline">Descartes&apos;s first book</Link>,
          the <em>Compendium Musicae</em> of 1618, and two of his folios are tucked into the station
          below. Stack the fifths yourself and listen to the comma churn against the root; then let
          the prince fix it.
        </p>
        <CommaSpiralDemo />
        <p className="text-secondary leading-relaxed mb-8 font-body">
          And Descartes did more than draw the circle — he drew the <em>leftover</em>. On another
          folio of the same little book, the octave is cut as a pie whose division doesn&apos;t come
          out even: a sliver marked <em>Schisma</em> is wedged in to absorb the remainder, between
          two string-numbers, 486 and 480, that are both trying to be the note D. Below, his
          engraving is awake: drag the sliver shut and you perform, with one finger, the repair
          that took tuning theory two thousand years.
        </p>
        <SchismaSliverDemo />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">III. The two vīṇās</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          The oldest quantitative claim about hearing we hold is Sanskrit. The{' '}
          <Link href="/book/dattilam-treatise-on-music-dattila?page=24" className="text-accent-rust hover:text-accent-rust underline"><em>Dattilam</em></Link>{' '}
          (1st century CE) defines the śruti as the smallest pitch difference the ear can detect and
          counts twenty-two of them in the octave — a just-noticeable-difference claim, stated two
          thousand years before psychophysics had the term. And{' '}
          <Link href="/book/natyasastra-of-bharata-muni-vol-1-muni" className="text-accent-rust hover:text-accent-rust underline">Bharata&apos;s <em>Nāṭyaśāstra</em></Link>{' '}
          supplies the protocol: two identical vīṇās, one detuned step by step against the other until
          the steps exhaust themselves. That is an experiment, and you are the apparatus. Twenty-two per
          octave works out to about fifty-five cents per śruti; a trained modern ear resolves several
          times finer. Measure yours.
        </p>
        <FolioPair>
          <FolioFigure
            src="https://images.sourcelibrary.org/gallery/69ef2b6c85daccce30f2e66d/69ef2b6c85daccce30f2e6db-0.jpg?v=1780586760763"
            alt="A seventeenth-century Mughal line drawing of a kneeling musician playing a bīn, the stick-zither rudra vīṇā"
            caption={<>A bīn player — the rudra vīṇā of Bharata&apos;s tradition — in a seventeenth-century Mughal drawing, reproduced in Strangways.</>}
            href="/book/the-music-of-hindostan-strangways?page=110"
            sourceLabel="The Music of Hindostan (1914)"
          />
          <FolioFigure
            src="https://images.sourcelibrary.org/gallery/69ef2b7985daccce30f2e810/69ef2b7985daccce30f2e8ae-0.jpg?v=17817236117"
            alt="Chromolithograph of two vīṇās: a rudra vīṇā with two painted gourd resonators and a peacock-bodied mayuri vīṇā with its bow"
            caption={<>Two vīṇās, as the śaraṇa protocol requires — a rudra vīṇā and a peacock-bodied mayuri vīṇā, from Day&apos;s 1891 survey of South Indian instruments.</>}
            href="/book/the-music-and-musical-instruments-of-southern-india-and-the-day?page=158"
            sourceLabel="Day, Music of Southern India (1891)"
          />
        </FolioPair>
        <ShrutiTestDemo />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">IV. Salmon before the Royal Society</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          By the 1670s the question had moved from cosmology to the concert room: should instruments be
          tuned to the pure ratios, or to the compromises that keep every key playable?{' '}
          <Link href="/book/an-essay-to-the-advancement-of-musick-salmon" className="text-accent-rust hover:text-accent-rust underline">Thomas Salmon</Link>{' '}
          spent three decades insisting on the mathematics, and his campaign ended as an experiment: in
          1705, viols fretted for just intonation were played before the Royal Society and judged, by
          ear, to general approval. A generation later{' '}
          <Link href="/book/tentamen-novae-theoriae-musicae-euler" className="text-accent-rust hover:text-accent-rust underline">Euler</Link>{' '}
          went further and proposed a formula — a computable degree of agreeableness for any interval.
          Here is Salmon&apos;s trial, blind, at your desk: the same intervals in just and equal
          temperament, in random order. The fifths differ by two cents, the thirds by fourteen — which
          is why the argument was always really about thirds.
        </p>
        <FolioFigure
          src="https://images.sourcelibrary.org/gallery/69aebe72a103e42dc941438e/69aebe72a103e42dc941439b-0.jpg?v=17816670555"
          alt="Faithorne's engraved frontispiece: a woman plays a lute in a formal garden while a hand from a cloud holds a musical score"
          caption={<>Faithorne&apos;s frontispiece to the <em>Essay</em> — a hand from a cloud holds the thesis, set to music: <em>Concordiâ res parvae crescunt, discordiâ maximae dilabuntur</em>: by concord small things grow; by discord the greatest fall apart.</>}
          href="/book/an-essay-to-the-advancement-of-musick-salmon?page=13"
          sourceLabel="Salmon, Essay (1672)"
        />
        <SalmonTrialDemo />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">V. The tone nobody is playing</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          In 1754{' '}
          <Link href="/book/trattato-di-musica-secondo-la-vera-scienza-dell-armonia-tartini" className="text-accent-rust hover:text-accent-rust underline">Giuseppe Tartini</Link>{' '}
          founded a whole theory of harmony on a sound that isn&apos;t there: play two strong tones and
          a third, lower one appears — the difference between them, manufactured somewhere in the ear
          itself. It is the strangest empirical demonstration in the harmony literature, because the
          laboratory is inside you.
        </p>
        <TartiniDemo />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">VI. Rhythm, sped up</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          If Tartini&apos;s ear manufactures tones, what is a tone to begin with? In the{' '}
          <Link href="/book/discorsi-e-dimostrazioni-matematiche-intorno-a-due-nuove-galilei" className="text-accent-rust hover:text-accent-rust underline"><em>Discorsi</em></Link>{' '}
          (1638), Galileo grounded consonance in coincidence: strings sound sweet together when
          their pulses strike the ear in step, harsh when the pattern never settles. Taken
          seriously, that claim dissolves the boundary between two things we experience as utterly
          different — rhythm and pitch. A two-against-three drum pattern and a perfect fifth are
          the same object at different speeds. That is a claim a slider can test: nothing changes
          below but the rate.
        </p>
        <FolioFigure
          src="https://images.sourcelibrary.org/gallery/69af0a2069627f8eeaa1b8ac/69af0a2069627f8eeaa1ba97-1.jpg?v=1781667093876"
          alt="Engraving of five numbered pendulums with the consonances — diapason, diapente, diatessaron — drawn as arcs between them"
          caption={<>Galileo&apos;s argument as Kircher drew it fifteen years later: five pendulums, and the consonances — diapason, diapente, diatessaron — as arcs between the swings that coincide. Not from the <em>Discorsi</em>; from Kircher&apos;s <em>Mundus Subterraneus</em>, which we also hold.</>}
          href="/book/mundus-subterraneus-tomus-ii-kircher?page=491"
          sourceLabel="Mundus Subterraneus II (1665)"
        />
        <GalileoRhythmDemo />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">VII. The planets, auditioned</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          The grandest claim in the whole literature is Kepler&apos;s: that the heavens are a
          polyphonic choir, each planet singing a glissando between its slowest motion at aphelion
          and its fastest at perihelion. His{' '}
          <Link href="/book/the-harmony-of-the-world-kepler?page=325" className="text-accent-rust hover:text-accent-rust underline"><em>Harmonices Mundi</em></Link>{' '}
          (1619) tabulates the extremes planet by planet and assigns each its interval — Saturn a
          major third, Mars a fifth, Earth a bare semitone. A margin note beside the Earth&apos;s
          entry may be the darkest joke in the history of astronomy:{' '}
          <Link href="/book/the-harmony-of-the-world-kepler?page=336" className="text-accent-rust hover:text-accent-rust underline">&ldquo;The Earth sings MI FA MI, so that we may observe from the symbol that even in our own home we obtain Misery and Famine.&rdquo;</Link>{' '}
          Kepler&apos;s numbers, unlike the smith&apos;s hammers, were real measurements — which
          means we can grade them. Four centuries of refined orbital elements are the answer key.
        </p>
        <KeplerPlanetsDemo />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">VIII. The string that answers</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          For Athanasius Kircher, the deepest evidence that harmony was woven into nature was
          sympathy: pluck a string, and an untouched string tuned in unison answers across the
          room, while its mistuned neighbours keep silent. His{' '}
          <Link href="/book/kircher-musurgia-universalis-vol-ii-1650-kircher" className="text-accent-rust hover:text-accent-rust underline"><em>Musurgia Universalis</em></Link>{' '}
          (1650) treats the effect as natural magic — consonance acting at a distance. The modern
          name for his magic is resonance, and the demonstration works exactly as he describes: the
          answer comes only when the tuning matches.
        </p>
        <FolioPair>
          <FolioFigure
            src="https://images.sourcelibrary.org/gallery/695592747bd6d2cd1d61a5c3/695592757bd6d2cd1d61a741-0.jpg?v=17718766663"
            alt="A personified wind head blows rays onto a string marked A through F, showing how pressing it at different division points yields different notes"
            caption={<>Wind as plectrum, from the wind-harp chapter: press the string at a division point and the remainder sounds the octave, the fifth (<em>necessariò quintam sonabit</em>), the fifteenth — one string, many voices, by pure arithmetic.</>}
            href="/book/kircher-musurgia-universalis-vol-ii-1650-kircher?page=382"
            sourceLabel="Musurgia Universalis II, p382"
          />
          <FolioFigure
            src="https://images.sourcelibrary.org/gallery/695592747bd6d2cd1d61a5c3/695592757bd6d2cd1d61a73f-0.jpg?v=17718766731"
            alt="Diagram of a wind-harp: a box of strings sounded by wind entering through an opening, with no player"
            caption={<>Two pages earlier, the wind-harp: strings that sound with no player at all.</>}
            href="/book/kircher-musurgia-universalis-vol-ii-1650-kircher?page=380"
            sourceLabel="Musurgia Universalis II, p380"
          />
        </FolioPair>
        <KircherResonanceDemo />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">IX. The sound of a state of mind</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          The oldest empirical claim about music and emotion we hold is Chinese. The{' '}
          <Link href="/book/the-sacred-books-of-china-li-ki-part-2-sbe-vol-28-trans?page=107" className="text-accent-rust hover:text-accent-rust underline"><em>Record of Music</em></Link>{' '}
          opens by listing six states of mind and the sound each one stamps on the voice:{' '}
          <Link href="/book/the-sacred-books-of-china-li-ki-part-2-sbe-vol-28-trans?page=107" className="text-accent-rust hover:text-accent-rust underline">&ldquo;When the mind is moved to sorrow, the sound is sharp and fading away&rdquo;</Link>
          ; anger is coarse and fierce, reverence straightforward and humble, and{' '}
          <Link href="/book/the-sacred-books-of-china-li-ki-part-2-sbe-vol-28-trans?page=107" className="text-accent-rust hover:text-accent-rust underline">&ldquo;when it is moved to love, the sound is harmonious and soft.&rdquo;</Link>{' '}
          For the Record this is statecraft, not aesthetics — the same passage reads the music of an
          age as a diagnostic of its government. But underneath sits a testable psychological claim:
          that the six signatures are legible. If they are, you should be able to hear a phrase
          built to one description and name the state of mind blind.
        </p>
        <FolioFigure
          src="https://images.sourcelibrary.org/gallery/69907b1f5f855ec553e70c6b/69907b1f5f855ec553e70cbe-0.jpg"
          alt="Color plate of Yu Boya, seated by a rock, playing the guqin"
          caption={<>The claim as a story: Yu Boya at his qin. His friend Ziqi could hear mountains and flowing water in his playing; when Ziqi died, Yu Boya broke the instrument — no one was left who could hear the meaning. Plate from Doré&apos;s survey of Chinese religion, another book on these shelves.</>}
          href="/book/recherches-sur-les-superstitions-en-chine-vol-12-dore?page=83"
          sourceLabel="Doré, Recherches sur les superstitions en Chine XII"
        />
        <YueJiAffectDemo />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">X. Grade the formula</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          Salmon&apos;s 1705 trial (Station IV) put temperaments to an audience; a generation later{' '}
          <Link href="/book/tentamen-novae-theoriae-musicae-euler" className="text-accent-rust hover:text-accent-rust underline">Leonhard Euler</Link>{' '}
          removed the audience altogether. His <em>Tentamen novae theoriae musicae</em> (1739)
          assigns every interval a <em>gradus suavitatis</em> — a degree of agreeableness computed
          from the prime factors of its ratio. It is the boldest reduction in this whole story:
          taste itself, made arithmetic. Two and a half centuries before anyone said
          &ldquo;empirical aesthetics,&rdquo; the formula was on the table; what was missing was
          the panel of listeners. That&apos;s you.
        </p>
        <EulerGradusDemo />

        <hr className="border-border-light my-12" />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">The bench stays open</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          Ten stations in, a shape emerges: this is the history of empirical aesthetics, run in
          miniature — Bharata detuning his vīṇās, Galilei hanging his weights, Salmon staging his
          viols before the Royal Society, Euler writing taste as a formula, and now a reader with
          headphones adjudicating all of them at a desk. Some claims survived their audit (Kircher&apos;s
          strings answer; the Earth really does sing a semitone), some died gloriously (weigh the
          hammers), and the deepest — that what pleases the ear can be computed — is still an open
          question you just generated data on. If a station misbehaves, or you know a claim from the
          old books that belongs on this bench, use the suggest-an-edit link below — this note is a
          living instrument, and corrections are the point.
        </p>
        <FolioFigure
          src="https://images.sourcelibrary.org/gallery/e48a21de-4db2-4c94-a71a-e952b9fa5393/69500507f426a210d109c2be-0.jpg?v=1773156760813"
          alt="The Musurgia Universalis frontispiece: an angelic choir sings a notated canon above the celestial globe, with Pythagoras and the smithy at the base"
          caption={<>What the untested faith looked like at full magnificence: the <em>Musurgia</em> frontispiece — a thirty-six-voice angelic canon notated on a banner, Musica enthroned on the celestial globe, and, tucked at the base, the smithy where this page began.</>}
          href="/book/musurgia-universalis-universal-music-kircher?page=7"
          sourceLabel="Kircher, Musurgia Universalis (1650)"
        />
      </article>
    </ContentPageLayout>
  );
}
