import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import SourceQuote from '@/components/articles/SourceQuote';
import PageFigure from '@/components/articles/PageFigure';
import FigureIndex from '@/components/articles/figure-reception/FigureIndex';
import FigureMap from '@/components/articles/figure-reception/FigureMap';
import ThemeRiver from '@/components/articles/figure-reception/ThemeRiver';
import StoryTree from '@/components/articles/figure-reception/StoryTree';
import RareClaims from '@/components/articles/figure-reception/RareClaims';
import { DielsThemes, OutsideDiels } from '@/components/articles/figure-reception/Diels';

// The list below the essay is every public work whose English translation contains "Pythagor*",
// built from the local corpus mirror on 2026-10-20 (full-text index over translations, 71,946 matching
// pages). The translation's own apparatus (<meta> page summaries, <gloss>, <vocab>, and <note>s that do not
// open with a printed-footnote marker) is removed before matching, so a page where only the translator's note
// names him does not count. Index, contents, errata and title pages are dropped; editions are grouped by work_id. A
// passage counts as "reports his words" when a regex finds Pythagoras with a verb of saying, teaching or
// forbidding, or a phrase like "according to Pythagoras": a pattern, not a reading. Dates are when a work was
// written (scripts/eval/figure-reception/dating.py), not the edition's year.
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
  diels: '/book/die-fragmente-der-vorsokratiker-diels',
};

const DATA = '/articles/pythagoras-in-the-library';
const ERA_INTROS = {
  antiquity: 'Works written before 600, most of them read here in later editions: Plato and Aristotle, Plutarch, Philostratus, Porphyry and Iamblichus on his life, Boethius.',
  '600': 'Byzantine compilers (the Suda, Psellus, Tzetzes), Arabic alchemy, Carolingian commentators.',
  '1200': 'Scholastics and encyclopedists: Albertus Magnus, Thomas Aquinas, Vincent of Beauvais, Dante.',
  '1450': 'Ficino, Pico and Reuchlin, and the first printed books.',
  undated: 'Books with no date in the catalogue.',
};

const p = 'text-secondary leading-relaxed mb-6 font-body';
const h2 = 'text-2xl md:text-3xl text-primary mt-16 mb-6';

export default function PythagorasInTheLibraryPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="He wrote nothing that survives, and four thousand works in the library name him"
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
            source={<>Gregor Reisch, <em>Margarita philosophica</em> (1504), p. 210</>}
          />
        </div>

        <h2 className={h2}>A map of what they said he said</h2>

        <p className={p}>
          About twelve thousand passages in the library report something Pythagoras said, taught or forbade. On this
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
          Egyptians. Neither is the historical Pythagoras, and both are part of what he meant to the people who
          wrote these books.
        </p>

        <FigureMap dataUrl={`${DATA}/map.json`} figure="Pythagoras" />

        <h2 className={h2}>Which stories, when</h2>

        <p className={p}>
          The same passages, counted by period. Each band is one of the groups on the map, and its height is that
          group’s share of what was written in those years. Grey dots from the map are left out, and the number
          under each period is how many passages it holds, so the thin early periods can be read with care.
        </p>

        <ThemeRiver dataUrl={`${DATA}/map.json`} />

        <h2 className={h2}>How a story was passed on</h2>

        <p className={p}>
          Pick a story and every dated telling of it appears at its year. A line joins each telling to the earlier
          one, from a different book, whose wording is closest to it, when the two are close enough. Where nothing
          earlier comes near, the telling starts a line of its own. This measures how alike two passages read, not
          whether one author had the other’s book open: two writers copying the same lost source look the same as
          one copying the other. Click a dot to read it and follow its line back.
        </p>

        <StoryTree mapUrl={`${DATA}/map.json`} treeUrl={`${DATA}/tree.json`} dielsUrl={`${DATA}/diels.json`} featured={['hammers', 't16', 't32', 't33']} />

        <h2 className={h2}>What Diels collected, and what he left out</h2>

        <p className={p}>
          Hermann Diels gathered the ancient evidence for the early Greek thinkers in{' '}
          <Link href={`${BOOK.diels}?page=48`}><em>Die Fragmente der Vorsokratiker</em></Link>, and scholars still cite
          it by his numbers. In the third edition (1912), which the library holds, Pythagoras has two chapters: chapter
          4, on his life, limited to the oldest witnesses down to Aristotle’s school, and chapter 45, on the
          Pythagorean school, with Aristotle’s reports, the oral sayings and symbols, and Aristoxenus’ precepts. In the
          later Diels–Kranz they are chapters 14 and 58. Diels left the legends out on purpose, and he sent the reader
          to Xenophanes, Heraclitus, Empedocles and Ion for what they said of him.
        </p>

        <div className="max-w-md mx-auto">
          <PageFigure
            src="https://images.sourcelibrary.org/pages/6a3f0220661123baf6fe9d4e/0048.jpg"
            alt="A page of Diels’s Fragmente der Vorsokratiker: the end of the Anaximenes chapter, then the heading 4. Pythagoras, a German paragraph explaining what the chapter includes, and the first testimonies in Greek from Herodotus."
            href={`${BOOK.diels}?page=48`}
            source={<>Hermann Diels, <em>Die Fragmente der Vorsokratiker</em>, 3rd ed. (Berlin, 1912), vol. 1, p. 27: the start of the chapter on Pythagoras</>}
          />
        </div>

        <p className={p}>
          On this page a small grey label, such as “Diels 45 C 3”, marks a passage that retells a Diels entry; it
          opens that entry in the scan. The labels come from comparing the sense of each passage with each entry,
          checked by reading samples: about nine in ten were right. For Pythagoras the test is strict, because his
          chapters touch almost every subject, so many retellings go unlabelled. Beans are in Diels, yet only one
          passage in six about them carries a label. Read the bars below as floors.
        </p>

        <p className={p}>
          What they show most clearly is the themes that never touch Diels. The alchemists’ Pythagoras, the herbs and
          secret plant names that Pliny gives in his name, the soul set free in the pure ether at the end of the Golden
          Verses: none of their passages retells an entry in his chapters.
        </p>

        <DielsThemes mapUrl={`${DATA}/map.json`} dielsUrl={`${DATA}/diels.json`} />

        <p className={p + ' mt-10'}>
          These are the claims about Pythagoras that two or more authors repeat and that Diels’s chapters do not
          contain. Claude read each candidate against the full text of both chapters and kept those that retell no
          entry; the 150 claims repeated by the most authors were read. At the top is the Pythagoras of the{' '}
          <em>Turba philosophorum</em>, teaching the alchemists how to fix sulphur, and Pliny’s Pythagoras, who ranked mustard first among sharp
          remedies. The smithy where he heard the hammers is further down.
        </p>

        <OutsideDiels dielsUrl={`${DATA}/diels.json`} mapUrl={`${DATA}/map.json`} />

        <h2 className={h2}>Told once</h2>

        <p className={p}>
          The map and the tree show what was said about Pythagoras again and again. This list is the other end: the
          things said about him that no other book in the library says in similar words, at most three from any one
          author. The alchemists made him one of their masters: a Viennese guide of 1751 notes that in the{' '}
          <em>Turba</em> “Pythagoras himself everywhere and always called our dewy subject a spittle of the moon.”
          The fortune-tellers sold him: an 1889 handbook of cartomancy names a chapbook of “Pythagoras’s Wheel of
          Fortune.” And in the papers of the Bavarian Illuminati, printed in 1787, “Pythagoras” is a member’s code
          name, sending in an essay on how he means to stop spending too much. The list keeps the spurious, the
          garbled and the borrowed names with the rest, with a note where a passage is not what it seems, because
          this is where to look for what the usual story leaves out. A gold rule marks a passage that reports
          something he said.
        </p>

        <RareClaims dataUrl={`${DATA}/rare.json`} dielsUrl={`${DATA}/diels.json`} />

        <h2 className={h2}>Every book that names him</h2>

        <p className={p}>
          Each card below is one work. The passage shown is the one where the author comes closest to reporting what
          Pythagoras said, taught or forbade; those passages have a gold rule. The rest of the book’s mentions, and
          the same work in other editions, are folded underneath. Every page number opens the scan, so you can check
          the original beside the translation.
        </p>

        <FigureIndex dataUrl={`${DATA}/passages.json`} dielsUrl={`${DATA}/diels.json`} namePrefix="Pythagor" eraIntros={ERA_INTROS}
          placeholder="Filter: beans, monochord, Samos, transmigration, Ficino…" />

        <p className="text-sm text-muted leading-relaxed mt-12 font-body">
          How the list was made: a search of the library’s English translations for every word beginning
          “Pythagor-” (Pythagoras, Pythagorean, Pythagoreans), across the public books on 20 October 2026. A page counts only when the
          book itself names him, not when only a translator’s note or summary does. Index, contents and errata pages
          are left out, and editions of the same work are grouped. A passage is marked as
          reporting his words when it pairs his name with a verb of saying, teaching or forbidding, or with a phrase
          such as “according to Pythagoras”, or with a verb that introduces a quotation of him (“speaks thus:”); passages found that way after the map was drawn are placed beside their nearest neighbours on it; that is a pattern match, so it misses some and catches some it should
          not. The “Told once” list compares every passage that names him, by the sense of its words, with every passage by other authors, and keeps the claims with nothing close; soft-hidden duplicate pages are left out everywhere. The Diels labels compare each passage that reports or attributes something to him with each numbered entry of his chapter in the 1912 edition, by the sense of the words; a passage that closely retells a labelled one takes its label; the thresholds were set by reading samples, and the few wrong labels found are corrected by hand. Four pages of that edition have no transcription yet (pp. 31–32 and 317, 319); their entries were read from the scans. The one-line summaries in “Outside Diels” are Claude’s, and an editor’s note printed inside an old text is dated by its edition when it names a writer who lived long after the text’s author. A work is dated by when it was written. An ancient or medieval text read in a later edition takes its author’s death year, shown as “by”, with the edition’s year under it; its preface and appendices keep the edition’s year, since they are the editor’s. Pseudonymous texts and compilations of several authors keep the edition’s year. The passages are the library’s translations; the Macrobius quotation is checked against the Latin
          on the page.
        </p>
      </article>
    </ContentPageLayout>
  );
}
