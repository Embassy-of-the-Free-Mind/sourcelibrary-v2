import { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { FolioFigure, FolioPair } from '@/components/blog/lab/FolioFigure';

const IMG = 'https://images.sourcelibrary.org/archived';
const HERO = `${IMG}/695573e7f63a757109172b1d/293.jpg`;

export const metadata: Metadata = {
  title: 'An Atlas of Lost Instruments - Source Library',
  description:
    'A keyed fiddle, a cat organ, a harp the wind plays, a box that composes, a quarrel over the megaphone, a violinist who heard a note nobody played, sand that draws the shape of a sound, and a keyboard with thirty-one notes to the octave. Nine things about music that were discovered, invented, or fought over in books this library holds — and the one thing our AI still cannot read.',
  alternates: {
    canonical: '/blog/atlas-of-lost-instruments',
  },
  openGraph: {
    title: 'An Atlas of Lost Instruments',
    description:
      'Nine discoveries, inventions and quarrels about sound, each from a book in the library — and the music on the page that no machine can yet read.',
    images: [{ url: HERO, alt: 'Plate XXII of Praetorius\'s Theatrum Instrumentorum, 1620: folk instruments including a keyed fiddle' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: HERO, alt: 'Plate XXII of Praetorius\'s Theatrum Instrumentorum, 1620: folk instruments including a keyed fiddle' }],
  },
};

const R = 'text-accent-rust hover:text-accent-rust underline';
const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-3xl text-primary mb-6 mt-14';

function Quote({ children, cite, href }: { children: ReactNode; cite: string; href: string }) {
  return (
    <blockquote className="border-l-2 border-accent-rust/40 pl-5 my-8 not-prose">
      <p className="text-secondary leading-relaxed font-body italic">{children}</p>
      <footer className="text-sm text-muted mt-2">
        &mdash;{' '}
        <Link href={href} className={R}>
          {cite}
        </Link>
      </footer>
    </blockquote>
  );
}

export default function AtlasOfLostInstrumentsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="An Atlas of Lost Instruments"
          subtitle="Nine things about sound that were discovered, invented, or fought over in books this library holds. And the one thing on their pages our AI still cannot read."
          image={HERO}
          imageAlt="Plate XXII of Praetorius's Theatrum Instrumentorum, 1620: a keyed fiddle, a straw fiddle, bells and a tambourine"
        >
          <p className="text-stone-400 text-sm mt-4">10 September 2026 &middot; 12 min read</p>
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
          The easy criticism of a library like this one is that it is all theory. Harmony of the spheres,
          ratios of the soul, the music of the planets: beautiful, and useless. The{' '}
          <Link href="/blog/sound-laboratory" className={R}>Sound Laboratory</Link> answered part of that
          by letting you test the old claims with your ears. This note takes the other half of the
          objection head on. We went looking through the books for things that actually happened:
          instruments that were built, effects that were heard for the first time, quarrels over who
          heard them first. Here are nine. Every one links to the page it comes from, in our own
          translation, beside the scan.
        </p>

        {/* I */}
        <h2 className={H2}>I. The keyed fiddle</h2>
        <p className={P}>
          Michael Praetorius spent the years around 1619 doing something nobody had done: cataloguing
          every instrument he could find, with measured woodcuts, in the second volume of his{' '}
          <Link href="/book/695573e7f63a757109172b1d" className={R}><em>Syntagma Musicum</em></Link>.
          Most of the plates show the court instruments you would expect. Plate XXII does not. It is a
          page of folk instruments, and lying across the middle of it is a bowed fiddle whose strings are
          stopped not by fingers but by a row of wooden keys. Praetorius calls it a <em>Schl&uuml;ssel
          Fiedel</em>. Sweden calls it the nyckelharpa and still plays it. This is among the earliest
          pictures of the instrument anywhere, and the first in a printed catalogue of instruments.
        </p>
        <FolioFigure
          src={`${IMG}/695573e7f63a757109172b1d/293.jpg`}
          alt="Plate XXII of the Theatrum Instrumentorum: a keyed fiddle, a straw fiddle, bells, a hurdy-gurdy and a tambourine"
          caption="Plate XXII. The keyed fiddle lies horizontally in the foreground; below it a xylophone of wooden bars laid across bundles of straw, which Praetorius names, without affection, the straw fiddle."
          href="/book/695573e7f63a757109172b1d?page=293"
          sourceLabel="Praetorius, Syntagma Musicum II, 1619"
        />
        <p className={P}>
          The same volume names the viola bastarda, the orpharion, the crumhorn, the rackett, and the
          scheitholt, a plank zither Praetorius bothered to measure. If you wanted a single book to
          rebuild the sound of 1619 from, this is it.
        </p>

        {/* II */}
        <h2 className={H2}>II. The cat organ</h2>
        <p className={P}>
          Athanasius Kircher&apos;s <em>Musurgia Universalis</em> (1650) is a thousand pages on everything
          sound can do, and buried in its chapter on keyboard mechanics is the most notorious instrument
          in the history of music. Kircher does not claim to have built it. He reports it, in the tone of
          a man passing on a good story.
        </p>
        <Quote cite="Kircher, The Minor Art of Consonance and Dissonance, 1662, p. 140" href="/book/69b51ed5c35d928cea4efe76?page=140">
          It is not long ago that such an instrument was made in Rome by an ingenious performer for a
          prince to dispel his melancholy. He took all the living cats of different sizes, as many as he
          could obtain, and enclosed them in a box &hellip; in such a way that their tails stuck out through
          holes. &hellip; He arranged the cats according to their different size, tonally, so that exactly one
          key with a spike came down onto each tail. &hellip; It caused such a &ldquo;cat-harmony&rdquo; that it
          moved the listeners to loud laughter; indeed, it could have moved the mice themselves to dance.
        </Quote>
        <FolioFigure
          src={`${IMG}/69b6b0fa96dc15d4a16cfb67/437.jpg`}
          alt="Engraving from Schott's Magia Universalis, 1674: a man holds a scroll of music before four donkeys; beside it a keyboard with a row of cat heads above the keys"
          caption="Kircher's student Kaspar Schott engraved it twenty-four years later, paired with a man conducting four donkeys. Figure II is the cat organ."
          href="/book/69b6b0fa96dc15d4a16cfb67?page=437"
          sourceLabel="Schott, Magia Universalis, 1674"
        />

        {/* III */}
        <h2 className={H2}>III. A harp the wind plays</h2>
        <p className={P}>
          Two hundred pages later in the same <em>Musurgia</em>, after a long description of a mechanical
          organ whose cylinder drives statues of blacksmiths to swing their hammers in time, Kircher
          stops to describe something he seems genuinely astonished by. It is a box of gut strings, all
          tuned to the same note, hung in a window where the wind can cross it.
        </p>
        <Quote cite="Kircher, Musurgia Universalis, vol. II, 1650, p. 380" href="/book/695592747bd6d2cd1d61a5c3?page=380">
          All the strings must be tuned to a unison or in octaves, so that a harmonious sound may follow.
          And it is truly marvelous and nearly a paradox how strings stretched in unison or in octaves
          can constitute various harmonies. Indeed, so that this musical phenomenon, which I do not
          know has been observed more deeply by anyone until now, may be explained &hellip; we shall begin
          from the egg.
        </Quote>
        <p className={P}>
          This is the aeolian harp, and this page is generally taken to be its first description. The
          paradox Kircher could not explain, how one string sounds several notes at once, is the
          overtone series, which nobody would lay out properly for another century. He heard it
          before anyone could account for it, and he wrote down that he had.
        </p>

        {/* IV */}
        <h2 className={H2}>IV. A box that composes</h2>
        <p className={P}>
          The <em>Musurgia</em>&apos;s Book VIII is titled &ldquo;Miraculous Music-making,&rdquo; and its
          miracle is a wooden chest full of slats. Each slat carries columns of numbers; you pick slats
          according to the metre of your Latin text, read the numbers off as scale degrees, and out comes
          four-part harmony that obeys the rules. Kircher called it the <em>Arca Musarithmica</em> and
          built several. It is the first machine for composing music, three centuries before the phrase
          &ldquo;algorithmic composition&rdquo; existed, and the book explains how to operate it.
        </p>
        <FolioFigure
          src={`${IMG}/695592747bd6d2cd1d61a5c3/500.jpg`}
          alt="Engraved plate of Kircher's Arca Musarithmica: a chest holding rows of numbered slats"
          caption="The musical-arithmetic chest. A layperson who could count syllables could produce a motet."
          href="/book/695592747bd6d2cd1d61a5c3?page=500"
          sourceLabel="Kircher, Musurgia Universalis, vol. II, 1650"
        />

        {/* V */}
        <h2 className={H2}>V. The quarrel over the megaphone</h2>
        <p className={P}>
          In 1671 Sir Samuel Morland, the Restoration&apos;s most inventive courtier, published a small book
          in English and Latin announcing a new instrument: a conical trumpet, the biggest over sixteen
          feet long, through which a voice could be carried the better part of a mile. He had tested it on the Thames.
        </p>
        <Quote cite="Morland, Tuba Stentoro-Phonica, 1671, p. 5" href="/book/69aebe60c0472fef6455a8f2?page=5">
          I carried this instrument down the river past the Bridge (accompanied by one or two gentlemen
          of my acquaintance) as far as a place called Cuckold&apos;s Point. Leaving it there in the hands
          of a Waterman, we rowed down very near Deptford. There, despite the noise of sailors &hellip;
        </Quote>
        <p className={P}>
          Two years later Kircher published <em>Phonurgia Nova</em>, and it is, in large part, a
          rebuttal. He had, he says, built exactly such a tube of iron plates twenty-two palms long in a
          storeroom of the Roman College, run its mouth out through an oval window into the garden, and
          used it for years to hear his doorkeepers announce visitors from the far gate. It had been in
          print, he insists, in the <em>Musurgia</em> of 1650. The book opens with a section of
          &ldquo;authentic testimonies&rdquo; on the question of priority, and one of the witnesses is
          candid enough to record both sides.
        </p>
        <Quote cite="Ghibbesius, in Kircher, Phonurgia Nova, 1673, p. 34" href="/book/69b6b01d96dc15d4a16cb021?page=34">
          It is a recent invention of the Academicians of the Royal Society of London, but the
          principal praise is attributed to the famous man, Sir Samuel Morland, Knight, as the first and
          only inventor. Although Athanasius Kircher cries out <em>Eureka</em>, and claims the honor and
          fame for himself.
        </Quote>
        <FolioPair>
          <FolioFigure
            src={`${IMG}/69aebe60c0472fef6455a8f2/10.jpg`}
            alt="Engraving of a man in profile blowing into a long flared speaking trumpet, with lines showing the spread of the sound"
            caption="Morland's Iconismus II: the voice leaves the bell in straight lines."
            href="/book/69aebe60c0472fef6455a8f2?page=10"
            sourceLabel="Morland, 1671"
          />
          <FolioFigure
            src={`${IMG}/695575b757e3b773024f22ad/156.jpg`}
            alt="Page of Kircher's Phonurgia Nova opening the section on the construction of the conical tube"
            caption="Kircher's answer: the section on building the conical tube, fifteen palms long."
            href="/book/695575b757e3b773024f22ad?page=156"
            sourceLabel="Kircher, 1673"
          />
        </FolioPair>
        <p className={P}>
          We hold both books, so you can judge the dispute from the primary sources, which is more
          than the Royal Society managed. The honest verdict is probably that both men built one and
          neither invented it: the ear trumpet is older than either, and Morland&apos;s contribution was
          to measure it and publish the distances.
        </p>

        {/* VI */}
        <h2 className={H2}>VI. The note nobody played</h2>
        <p className={P}>
          Giuseppe Tartini was the most famous violinist in Europe when, in 1754, he published a
          treatise claiming that two notes played loudly and perfectly in tune produce a third note,
          lower than either, that no one is playing. He gave the recipe.
        </p>
        <Quote cite="Tartini, Trattato di musica, 1754, p. 28" href="/book/6990585617295890441358e0?page=28">
          The same result will occur if the stated intervals are played by two violin players standing
          five or six paces apart, each playing their note at the same time, and always with a strong,
          sustained bowing. A listener placed exactly in the middle between the two players will hear
          this third sound much more clearly than if they were standing close to either individual player.
        </Quote>
        <p className={P}>
          Tartini&apos;s explanation, the collision of two volumes of moving air, was wrong. The
          observation was right. Difference tones are real, they are still called Tartini tones, and the
          physics took Helmholtz another century. You can hear one in{' '}
          <Link href="/blog/sound-laboratory" className={R}>Station V of the Sound Laboratory</Link>.
          The treatise has no English translation. [verify]
        </p>

        {/* VII */}
        <h2 className={H2}>VII. Sand that draws the shape of a sound</h2>
        <p className={P}>
          In 1787 a young lawyer in Wittenberg named Ernst Chladni published a book of
          <em> discoveries</em>, and used the word without embarrassment. He had bowed the edge of a
          metal plate sprinkled with sand and watched the sand leap away from the vibrating regions to
          settle along the lines of stillness. Each pitch drew a different figure. The book&apos;s
          copperplates are the first pictures of the shape of a vibration.
        </p>
        <FolioFigure
          src={`${IMG}/69905808172958904413516a/111.jpg`}
          alt="Copperplate of twenty square diagrams, numbered 127 to 146, each showing a symmetrical pattern of nodal lines"
          caption="Table X: twenty figures from a square plate. Chladni numbered every one and recorded the pitch that produced it."
          href="/book/69905808172958904413516a?page=111"
          sourceLabel="Chladni, Entdeckungen über die Theorie des Klanges, 1787"
        />
        <Quote cite="Chladni, Entdeckungen über die Theorie des Klanges, 1787, p. 55" href="/book/6990627b40bf901934ab9b7f?page=55">
          All the acoustic figures where 4, 5, or more circles exist entirely on their own, I have never
          seen in a regular form, but always modified &hellip; The pitch does not change at all in this
          process; however, the nature of the vibrations is greatly altered.
        </Quote>
        <p className={P}>
          This is the founding experiment of acoustics as a laboratory science, and this is the first
          edition of it. Napoleon, after watching the demonstration, paid for Chladni&apos;s larger{' '}
          <Link href="/book/6990580b17295890441351e7" className={R}><em>Acoustics</em></Link> of 1802 to be
          put into French. Nobody paid to put the <em>Discoveries</em> into English, and until this year
          nobody had. [verify]
        </p>

        {/* VIII */}
        <h2 className={H2}>VIII. Thirty-one notes to the octave</h2>
        <p className={P}>
          In 1555 Nicola Vicentino built a harpsichord with six rows of keys and thirty-one notes in every
          octave, so that the chromatic and enharmonic scales of the ancient Greeks could be played
          rather than argued about. He called it the archicembalo and wrote a book to defend it. We hold
          that book, <em>L&apos;antica musica ridotta alla moderna prattica</em>, though only its first
          pages have been read so far. What we hold in full is the argument it started. Zarlino, three
          years later, sketched his own instrument for the three Greek genera. And Francisco de Salinas,
          the blind organist of Salamanca, took the machine apart with arithmetic in 1577 and asked the
          only question that matters about a thirty-one-note keyboard: can anyone hear the difference?
        </p>
        <Quote cite="Salinas, De Musica Libri Septem, 1577, p. 178" href="/book/695575b157e3b773024f206d?page=178">
          These parts of a Comma, unless they exceed or equal half of a Comma, are perceived by the ears
          either not at all or only very slightly, as can be tested in consonances. &hellip; Indeed, the
          ear&apos;s sense is in no way able to judge the excesses by which one temperament exceeds
          another.
        </Quote>
        <p className={P}>
          Salinas is describing, in 1577, a threshold of pitch discrimination, and getting it roughly
          right: a third of a comma, he says, offends the ear &ldquo;very little.&rdquo; Modern
          psychoacoustics puts the just-noticeable difference for a sustained tone at about five cents,
          which is a quarter of a comma. A blind man arguing from arithmetic about what ears can do
          landed within a few cents of the answer.
        </p>

        {/* IX */}
        <h2 className={H2}>IX. Beyond Europe, and before it</h2>
        <p className={P}>
          Seven centuries before Praetorius, al-Farabi wrote the{' '}
          <Link href="/book/69dea2514d19ec2e9ba762be" className={R}><em>Grand Book of Music</em></Link>,
          the largest treatise on music of the medieval world, in Baghdad around 950. It measures the
          frets of the oud and the tunbur, describes how performers tune open strings &ldquo;by the
          method of sensory perception through the smaller consonances,&rdquo; and tables the rhythms
          &ldquo;famous among the Arabs in ancient times.&rdquo; Every one of its 195 pages is
          transcribed and translated here. It has had a French translation since the 1930s and, as far
          as we can find, no complete English one. [verify]
        </p>
        <p className={P}>
          And in 1555, the same year as Vicentino, a Franciscan named Juan Bermudo printed the{' '}
          <Link href="/book/69557dd157e3b773024f4041" className={R}><em>Declaraci&oacute;n de Instrumentos
          Musicales</em></Link> in Osuna: the first detailed account of the vihuela, the Spanish guitar&apos;s
          ancestor, with fret positions calculated from the monochord and a defence of a new
          seven-course instrument of his own design. It is the closest thing to a recording we have of
          how sixteenth-century Spain tuned. All 258 pages are translated. [verify: no prior English translation]
        </p>

        {/* Coda */}
        <h2 className={H2}>What the machine cannot read yet</h2>
        <p className={P}>
          There is one thing on these pages that none of this can reach. Praetorius prints tunings,
          Morley prints sight-singing exercises, the Gradual of 1360 is seven hundred pages of chant,
          and the Atalanta fugiens pairs every emblem with a three-voice fugue. Our OCR looks at every
          one of those staves and writes something like &ldquo;musical notation on a five-line stave
          with a C-clef on the third line, diamond-shaped notes.&rdquo; Then it moves on. It describes
          the music the way a tourist describes a menu in a language they cannot read.
        </p>
        <p className={P}>
          We counted. Across the books we have transcribed, the OCR describes notation on 13,647 pages
          in 852 books: 5,282 in modern engraved notation, 4,068 in the diamond-headed mensural notation
          of the sixteenth century, 3,760 in the square neumes of chant, 386 in tablature. Not one of
          them is machine-readable as music. The exception proves the rule: the only music in the
          library you can press play on is an{' '}
          <Link href="/book/6a58f512c6cd8f9871069afb?page=21" className={R}>1852 Shaker hymnal</Link>,
          and it works because the Shakers printed pitch as letters, which is reading, not seeing.
        </p>
        <p className={P}>
          Reading staff notation from a scan is a different problem from reading text, and the large
          vision models are still bad at it: on scanned piano scores the frontier models make a
          wrong note or rhythm on most of the notes they see, while a small specialist model trained
          on nothing but scores does twice as well. For sixteenth-century mensural print and for
          neumes, the tools that exist are the ones musicologists correct by hand. So we have done the
          unglamorous thing. The score pages are inventoried, the transcription store records which
          model wrote what, and there is a scorer that grades a transcription on pitch and rhythm
          separately, against references checked by a person. When a model arrives that can read
          Praetorius, it will find the pages waiting and a test it has to pass. Until then, the atlas
          has the pictures and the words. The music is still locked in the page.
        </p>

        <p className="text-sm text-muted mt-12 font-body">
          Method: the nine items were found by searching the translated corpus for instrument and
          technique vocabulary and reading the pages that came back; every claim above links to the page
          it rests on. The notation census is the output of the score-page inventory in the public
          repository (issue #4713). Sources for the state of optical music recognition are given in the
          repository&apos;s music-notation doc.
        </p>
      </article>
    </ContentPageLayout>
  );
}
