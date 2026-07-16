import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import HammerStringDemo from '@/components/blog/lab/HammerStringDemo';
import CommaSpiralDemo from '@/components/blog/lab/CommaSpiralDemo';
import ShrutiTestDemo from '@/components/blog/lab/ShrutiTestDemo';
import SalmonTrialDemo from '@/components/blog/lab/SalmonTrialDemo';
import TartiniDemo from '@/components/blog/lab/TartiniDemo';

const HERO = 'https://images.sourcelibrary.org/artwork/art-sadeler-fabel-van-de-smid-en-de-hond.jpg';

export const metadata: Metadata = {
  title: 'The Sound Laboratory - Source Library',
  description:
    'Five interactive stations that put twenty-five centuries of claims about harmony to the test — the smith\'s hammers, the Pythagorean comma, Bharata\'s two vīṇās, Salmon\'s Royal Society trial, and Tartini\'s third tone. Bring headphones.',
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
          <p className="text-stone-400 text-sm mt-4">16 July 2026 &middot; 5 experiments &middot; headphones recommended</p>
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
          less than most ears can find — and the circle closed for the first time. Stack the fifths
          yourself and listen to the comma churn against the root; then let the prince fix it.
        </p>
        <CommaSpiralDemo />

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

        <hr className="border-border-light my-12" />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">The bench stays open</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          Five stations in, the old quarrel looks different: the ancients were not just theorizing
          about harmony, they were <em>experimenting</em> — Bharata with his vīṇās, Galilei with his
          weights, Salmon with his viols — and their claims are still runnable. More stations are
          planned:{' '}
          <Link href="/book/the-harmony-of-the-world-kepler" className="text-accent-rust hover:text-accent-rust underline">Kepler&apos;s planetary intervals</Link>{' '}
          checked against modern orbits, Kircher&apos;s sympathetic strings, and the{' '}
          <Link href="/book/the-sacred-books-of-china-li-ki-part-2-sbe-vol-28-trans?page=106" className="text-accent-rust hover:text-accent-rust underline"><em>Record of Music</em></Link>&apos;s
          claim that modes carry moral weather. If a station misbehaves, or you know a claim from the
          old books that belongs on this bench, use the suggest-an-edit link below — this note is a
          living instrument, and corrections are the point.
        </p>
      </article>
    </ContentPageLayout>
  );
}
