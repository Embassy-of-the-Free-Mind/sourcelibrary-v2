import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import SourceQuote from '@/components/articles/SourceQuote';
import PageFigure from '@/components/articles/PageFigure';
import PythagorasIndex from './PythagorasIndex';
import PythagorasMap from './PythagorasMap';

// The list below the essay is every public work whose English translation contains "Pythagor*",
// built from the local corpus mirror on 2026-10-20 (full-text index over translations, 71,946 matching
// pages). The translation's own apparatus (<meta> page summaries, <gloss>, <vocab>, and <note>s that do not
// open with a printed-footnote marker) is removed before matching, so a page where only the translator's note
// names him does not count. Index, contents, errata and title pages are dropped; editions are grouped by work_id. A
// passage counts as "reports his words" when a regex finds Pythagoras with a verb of saying, teaching or
// forbidding, or a phrase like "according to Pythagoras": a pattern, not a reading. Dates are the
// catalogue's `year`, which is sometimes the work's date and sometimes the edition's.
// The Macrobius passage is copied from get_quote (book 699ef9feb3e659e2762a5731, p. 67) on 2026-10-20
// and the Latin read against the page image the same day (printed "molliētes ... ī aures eius malleoꝝ
// soni ... respondētes"; shown with the abbreviations expanded). The Reisch woodcut (p. 210) was opened by
// eye: Music with her instruments, and at the right a bearded man weighing hammers on a balance.
// The hero is Raphael's study for the School of Athens, public domain, mirrored in the artwork collection.

const SLUG = 'pythagoras-in-the-library';
const TITLE = 'Pythagoras in the Library';
const DESCRIPTION =
  'Every book in Source Library that names Pythagoras, from Aristotle and Euclid to the twentieth century: the passage, the page, and what each author said he taught.';
const HERO =
  'https://images.sourcelibrary.org/artwork/art-raphael-raffaello-pythagoras-mit-seinen-schulern-studie-fur-die-schule-von-athen-stanza-della-segnat.jpg';
const HERO_ALT =
  'Raphael’s drawing for the School of Athens: a bearded Pythagoras bent over a book on his knee, students leaning in around him.';

export const metadata: Metadata = withArticleMeta(SLUG, {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: { images: [{ url: HERO, alt: HERO_ALT }], title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: `/articles/${SLUG}` },
});

// Reader links, written out so scripts/maintenance/generate-article-books.mjs can find the books.
const BOOK = {
  macrobius: '/book/integer-nitidus-macrobius',
  reisch: '/book/margarita-philosophica-reisch-1',
};

const p = 'text-secondary leading-relaxed mb-6 font-body';
const h2 = 'text-2xl md:text-3xl text-primary mt-16 mb-6';

export default function PythagorasInTheLibraryPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="He wrote nothing that survives, and four thousand works in the library claim to know what he said"
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">20 October 2026 &middot; browse</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Pythagoras left no books. Everything we have of him comes from people who wrote about him: his followers,
          his critics, and two thousand years of writers who quoted him, repeated what others had quoted, and
          sometimes invented what they needed him to have said. This page gathers every work in the library that
          names him, in date order, with the passage and a link to the page.
        </p>

        <p className={p}>
          The same few stories come back again and again. He would not eat beans. He made his students keep silent
          for five years. He taught that the soul passes from body to body, and claimed to remember his own earlier
          lives. He held that number is the root of all things, and that the planets make music as they turn. One
          story explained how he found the musical ratios in the first place, and Macrobius and Boethius passed it on
          to the Middle Ages:
        </p>

        <SourceQuote
          book="integer-nitidus-macrobius"
          page={67}
          printedPage="XXIII"
          src="https://images.sourcelibrary.org/pages/699ef9feb3e659e2762a5731/0067-full.jpg"
          pageAlt="A page of Macrobius’s Commentary on the Dream of Scipio, Book Two, with a woodcut of an organist and a lute player above the text."
          source={<>Macrobius, <em>Commentary on the Dream of Scipio</em>, Book 2 (Venice, 1513)</>}
          original={<>Cum enim casu præteriret in publico fabros ignitum ferrum mollientes ictibus, in aures eius malleorum soni certo sibi respondentes ordine repente ceciderunt.</>}
        >
          For when by chance he passed by a public place where blacksmiths were softening glowing iron with blows,
          the sounds of the hammers, responding to each other in a fixed order, suddenly fell upon his ears.
        </SourceQuote>

        <p className={p}>
          Pythagoras has the smiths swap hammers, finds that the note follows the hammer and not the arm, and weighs
          them. Printers kept the scene alive. In Gregor Reisch’s encyclopedia of 1504, Music stands among her
          instruments, and at the right a bearded man weighs hammers on a balance.
        </p>

        <div className="max-w-md mx-auto">
          <PageFigure
            src="https://images.sourcelibrary.org/archived/69dbcb8c1040d1d5e20b7a3c/210.jpg"
            alt="Woodcut titled Typus Musice: a crowned woman holding a sheet of music among players of lute, harp, organ and flute; at the right a bearded man weighs hammers on a balance."
            href={`${BOOK.reisch}?page=210`}
            source={<>Gregor Reisch, <Link href={BOOK.reisch}><em>Margarita philosophica</em></Link> (1504), p. 210</>}
          />
        </div>

        <h2 className={h2}>A map of what they said he said</h2>

        <p className={p}>
          About eleven thousand passages in the library report something Pythagoras said, taught or forbade. On this
          map each dot is one of them, and passages that say similar things sit close together. The groups are
          drawn by a computer from the wording alone; the names are ours, written after reading each group. Grey
          dots did not fall clearly into any group. Slide the year to watch the stories arrive, hover a dot to read
          it, and click a group to see its earliest passages.
        </p>

        <p className={p}>
          Some of what the map shows is the Pythagoras every reader knows: the soul passing from body to body, the
          music of the spheres, number as the root of things. Some is a different man altogether. To the alchemists
          he was a speaker in the <em>Turba philosophorum</em>, the assembly of sages, saying that “clean water is
          from sulfur alone”, and later alchemists quoted him from it as an authority. To the herbalists he was a
          source of secret plant names: “Pythagoras calls it…” stands beside the names given by Osthanes and the
          Memphites. Neither is the historical Pythagoras, and both are part of what he meant to the people who
          wrote these books.
        </p>

        <PythagorasMap />

        <h2 className={h2}>Every book that names him</h2>

        <p className={p}>
          Each card below is one work. The passage shown is the one where the author comes closest to reporting what
          Pythagoras said, taught or forbade; those passages have a gold rule. The rest of the book’s mentions, and
          the same work in other editions, are folded underneath. Every page number opens the scan, so you can check
          the original beside the translation.
        </p>

        <PythagorasIndex />

        <p className="text-sm text-muted leading-relaxed mt-12 font-body">
          How the list was made: a search of the library’s English translations for every word beginning
          “Pythagor-” (Pythagoras, Pythagorean, Pythagoreans), across the public books on 20 October 2026. A page counts only when the
          book itself names him, not when only a translator’s note or summary does. Index, contents and errata pages
          are left out, and editions of the same work are grouped. A passage is marked as
          reporting his words when it pairs his name with a verb of saying, teaching or forbidding, or with a phrase
          such as “according to Pythagoras”; that is a pattern match, so it misses some and catches some it should
          not. Dates are the earliest the catalogue gives for the work, which for some books is the date of the
          edition. The passages are the library’s translations; the Macrobius quotation is checked against the Latin
          on the page.
        </p>
      </article>
    </ContentPageLayout>
  );
}
