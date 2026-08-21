import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import GalileiStringsDemo from '@/components/blog/lab/GalileiStringsDemo';
import LyreReadingsDemo from '@/components/blog/lab/LyreReadingsDemo';
import BoethiusLadderDemo from '@/components/blog/lab/BoethiusLadderDemo';
import { FolioFigure, FolioPair } from '@/components/blog/lab/FolioFigure';

const HERO = 'https://images.sourcelibrary.org/archived/6955739df63a7571091720cf/80.jpg';
const HERO_ALT =
  'A page of the Boethius manuscript: two large hand-drawn diagrams of nested red arcs mapping the chromatic and enharmonic tetrachords, with string names and monochord numbers.';

export const metadata: Metadata = {
  title: 'The Playable Page - Source Library',
  description:
    'Old books are full of instruments diagrammed and silenced: monochord divisions, tetrachord arcs, interval tables. This note replicates three of them and strings them — Galilei\'s two-string bench, the Lyre of Mercury\'s disputed numbers, and the full two-octave system of ancient music from a Boethius manuscript, playable in all three genera.',
  alternates: {
    canonical: '/blog/playable-page',
  },
  openGraph: {
    title: 'The Playable Page',
    description:
      'Manuscript diagrams, replicated and strung: Galilei\'s two-string bench, the Lyre of Mercury read three ways, and Boethius\'s two-octave system playable in all three genera.',
    images: [{ url: HERO, alt: HERO_ALT }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: HERO, alt: HERO_ALT }],
  },
};

export default function PlayablePagePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Playable Page"
          subtitle="Manuscript diagrams are instruments with the sound left out. Put it back."
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">19 July 2026 &middot; 3 instruments &middot; headphones recommended</p>
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
          told the story,{' '}
          <Link href="/blog/show-me-the-number" className="text-accent-rust hover:text-accent-rust underline">Show Me the Number</Link>{' '}
          made the argument, and{' '}
          <Link href="/blog/sound-laboratory" className="text-accent-rust hover:text-accent-rust underline">the Sound Laboratory</Link>{' '}
          built the bench. This note goes one step further into the books themselves. The old
          treatises are full of instruments that were diagrammed and then silenced — monochord
          divisions, tetrachord arcs, string tables with every pitch worked out to the integer —
          waiting five centuries for a reader who could hear them. Below, three of those diagrams
          are replicated and strung. Nothing is a recording; every sound is synthesized live from
          the numbers on the page.
        </p>

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">I. The falsifier&apos;s own apparatus</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          The Sound Laboratory&apos;s{' '}
          <Link href="/blog/sound-laboratory" className="text-accent-rust hover:text-accent-rust underline">first station</Link>{' '}
          weighs the smith&apos;s hammers and watches the legend break. What we did not notice until
          we read further into{' '}
          <Link href="/book/dialogo-della-musica-antica-et-della-moderna-galilei" className="text-accent-rust hover:text-accent-rust underline">Vincenzo Galilei&apos;s <em>Dialogo</em></Link>{' '}
          is that the falsifier left build instructions. On p.&thinsp;145 he describes the exact
          bench: &ldquo;if one takes two strings of the same length, thickness, and quality; if
          these are stretched to unison over a flat surface, and one of them is deprived of half
          its length by means of a bridge, fret, or even the fingers of the hand, one will hear
          (as has been said before) the Diapason consonance every time they are struck together or
          one after the other&rdquo; &mdash; and, a line later, &ldquo;From these observations, the
          use of the Monochord easily took its origin&rdquo;{' '}
          (<a href="https://sourcelibrary.org/q/BeoftnrTNYqCao3dYsz" className="text-accent-rust hover:text-accent-rust underline">verified verbatim</a>).
          The presets below are his sentence, word for word. The weight pan is the half of the
          story he put on trial: a string answers weight only by its square root, so the
          legend&apos;s two-to-one lands on the tritone, and an octave costs fourfold.
        </p>
        <GalileiStringsDemo />
        <FolioFigure
          src="https://images.sourcelibrary.org/gallery/69ac83c55d2908b26341c442/69ac83c55d2908b26341c4c4-0.jpg"
          alt="Woodcut monochord division from Zarlino's Le istitutioni harmoniche: a long ruled diagram dividing a string into tetrachords with numerical ratios."
          caption={<>The instrument as the orthodoxy drew it: a monochord division from Gioseffo Zarlino&apos;s <em>Le istitutioni harmoniche</em> (1558). Zarlino was Galilei&apos;s teacher — and the <em>Dialogo</em>&apos;s chief target.</>}
          href="/book/69ac83c55d2908b26341c442?page=130"
          sourceLabel="Zarlino, Le istitutioni harmoniche (1558)"
        />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">II. Four numbers, three laws</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          Boethius gives Mercury&apos;s lyre four strings in the proportions
          6&thinsp;&middot;&thinsp;8&thinsp;&middot;&thinsp;9&thinsp;&middot;&thinsp;12 — the same
          numbers as the hammers. But the authorities could not agree which <em>end</em> was low.
          Galilei lays out the dispute on p.&thinsp;144: Plutarch&apos;s camp &ldquo;applied the
          number six to the first, eight to the second, nine to the third, and twelve to the fourth
          and last named&rdquo; — six on the lowest string — while the Zarlino camp assigns the
          numbers &ldquo;exactly the opposite&rdquo; way{' '}
          (<a href="https://sourcelibrary.org/q/BeoftnrTNYqCao3dYsy" className="text-accent-rust hover:text-accent-rust underline">verified verbatim</a>).
          His diagnosis, same page: Plutarch&apos;s numbers cannot be monochord divisions — they
          only make sense as <em>weights</em>, while the reversed order reads them as measures of
          length. The direction of a scale is the fossil of a physical hypothesis. And a hypothesis
          about sound is audible: each reading is a different law, so the same four numbers sing
          three different chords. That is how you know for sure — authority picks a direction; the
          bench picks the law.
        </p>
        <LyreReadingsDemo />
        <p className="text-secondary leading-relaxed mb-8 font-body">
          Two honest footnotes. The struck-hammer reading is the one a browser cannot fully settle:
          our tone follows the cube-root scaling of similar solid bodies, but in a real smithy the
          <em> anvil</em> sings its own note almost regardless of the hammer — and Galilei himself
          guessed that direction wrong, writing that the twelve-pound hammer &ldquo;made the high
          sound.&rdquo; To know that for sure you need iron, not a web page. And the legend never
          agreed with itself about its own data: in Boethius&apos;s telling there are five hammers
          and Pythagoras rejects one as dissonant —{' '}
          <a href="https://sourcelibrary.org/q/BeoftnrTNYqCao3dYt3" className="text-accent-rust hover:text-accent-rust underline">Galilei replays that arithmetic</a>{' '}
          — while Gaffurius&apos;s woodcut draws six.
        </p>

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">III. The page that begs to be played</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          In our fifteenth-century{' '}
          <Link href="/book/de-institutione-musica-15th-c-ms-boethius" className="text-accent-rust hover:text-accent-rust underline">Boethius manuscript</Link>,
          the whole two-octave system of ancient music is drawn as nested arcs in red ink — string
          names, interval spans, and the monochord number of every string, in ladders for the
          chromatic and enharmonic genera. Below, the same ladder is replicated and strung. The
          drawn length of each string is true to its number on the 9,216 ruler, and the diatonic
          division reproduces the manuscript tradition&apos;s canonical integers exactly: 9216,
          8192, 7776&hellip;down to 2304, two octaves up. Switch the genus and the brass strings
          — the movable notes — re-divide, just as the facing diagrams on the page do; the
          chromatic pulls Lichanos up to an F&#9839;, and the enharmonic lands on genuine
          quarter-tones, notes that fall between the frets of every modern instrument.
        </p>
        <FolioPair>
          <FolioFigure
            src={HERO}
            alt={HERO_ALT}
            caption={<>The original: chromatic and enharmonic wing-diagrams, hand-drawn c.&thinsp;1490, with the string numbers written along the arcs.</>}
            href="/book/de-institutione-musica-15th-c-ms-boethius?page=80"
            sourceLabel="Boethius, De institutione musica"
          />
          <FolioFigure
            src="https://images.sourcelibrary.org/gallery/695688febe7c607c5f03c1da/69569e3b1479a63c110927ca-0.jpg"
            alt="Gaffurius's 1492 woodcut of the smithy legend: six men strike an anvil with hammers marked IIII, VI, VIII, VIIII, XII and XVI, with a reader's handwriting in the margins."
            caption={<>Where the numbers entered legend: Gaffurius&apos;s smithy, with an early reader re-inking the hammer arithmetic in the margins. The playable version lives at Station I of the Sound Laboratory.</>}
            href="/book/theorica-musicae-gaffurius?page=46"
            sourceLabel="Gaffurio, Theorica musicae (1492)"
          />
        </FolioPair>
        <BoethiusLadderDemo />

        <hr className="border-border-light my-12" />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">Every diagram is a score</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          A monochord division is not an illustration <em>about</em> music; it is music, stored in
          the only medium its author had. The three instruments on this page took an afternoon to
          string because the hard work was done centuries ago — the numbers are on the pages,
          worked out to the integer. The library holds many more: division tables in Zarlino and
          Salinas, interval ladders in Gaffurius, circle diagrams in Descartes, tuning grids from
          Ming China. We intend to keep stringing them. If there is a page you want to hear, tell
          us with the suggest-an-edit link below.
        </p>
      </article>
    </ContentPageLayout>
  );
}
