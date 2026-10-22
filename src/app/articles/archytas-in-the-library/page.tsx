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

// The third of the figure-reception pages (#7073), built with scripts/eval/figure-reception/ from the local
// corpus mirror on 2026-10-20: every public work whose English translation contains "Archyt*", with the
// translation's own apparatus removed first. The map's themes were named by reading each theme's sample
// passages. Three passages naming Archytas of Amphissa, the poet Athenaeus quotes on apples, are set aside
// before clustering (figures.json setAside).
// Checked 2026-10-20 with get_quote and by eye: Gellius p. 349 (printed 158; the Latin read against the page
// image, abbreviations expanded, the printer's "oculta" kept), Stanley p. 481 (printed 583; the engraved
// portrait), and Kircher p. 446 (the hero: the plate "Columba Architae magnetica arte exhibita", a dove on a
// line flying beneath a great dial held out of the clouds, a man on a hill below).

const SLUG = 'archytas-in-the-library';
const TITLE = 'Archytas in the Library';
const DESCRIPTION =
  'Every book in Source Library that names Archytas of Tarentum: the flying wooden dove, doubling the cube, his anger at a careless farm manager, and a fever cure.';
const HERO = 'https://images.sourcelibrary.org/pages/69527376ab34727b1f04948a/0446.jpg';
const HERO_ALT =
  'Engraving from Kircher’s Magnes (1641) titled “Columba Architae”: a dove on a line flies beneath a great dial held out of the clouds, while a man on a hill holds the line.';

export const metadata: Metadata = withArticleMeta(SLUG, {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: { images: [{ url: HERO, alt: HERO_ALT }], title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: `/articles/${SLUG}` },
});

const BOOK = {
  gellius: '/book/aulus-gellius-noctes-atticae-aldine-press-2nd-ed-gellius',
  kircher: '/book/magnes-sive-de-arte-magnetica-kircher',
  stanley: '/book/the-history-of-philosophy-complete-edition-1687-stanley',
  eutocius: '/book/archimedes-on-sphere-and-cylinder-with-eutocius-heron-alexandria',
  cicero: '/book/scripta-philosophica-cicero',
  secrets: '/book/the-book-of-secrets-liber-aggregationis-magnus',
  horace: '/book/horatii-flacci-opera-horace',
  pythagoras: '/articles/pythagoras-in-the-library',
  philolaus: '/articles/philolaus-in-the-library',
};

const DATA = '/articles/archytas-in-the-library';
const p = 'text-secondary leading-relaxed mb-6 font-body';
const h2 = 'text-2xl md:text-3xl text-primary mt-16 mb-6';

export default function ArchytasInTheLibraryPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="Plato’s friend, a general seven times over, the geometer who doubled the cube, and the maker of a wooden dove that flew"
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
          Archytas of Tarentum was a Pythagorean of Plato’s time, a mathematician and the leading man of his city.
          About eight hundred works in this library name him. This page gathers them in date order, with the
          passage and the page, like the pages on <Link href={BOOK.pythagoras}>Pythagoras</Link> and{' '}
          <Link href={BOOK.philolaus}>Philolaus</Link>.
        </p>

        <p className={p}>
          Thomas Stanley’s <Link href={`${BOOK.stanley}?page=481`}><em>History of Philosophy</em></Link> (1687)
          gives the outline from Diogenes Laertius: he “was generally admired for all sorts of virtue,” he was
          “seven times General of his own countrymen, whereas all others were but once,” and it was through him that
          Plato escaped when Dionysius of Syracuse meant to kill him.
        </p>

        <div className="max-w-md mx-auto">
          <PageFigure
            src="https://images.sourcelibrary.org/pages/69ae955b14ec9b78c4cede73/0481.jpg"
            alt="Engraved full-length portrait of Archytas: a bearded man in a draped robe, one hand on his chest and the other held out, with a landscape and a cave behind him."
            href={`${BOOK.stanley}?page=481`}
            source={<>Thomas Stanley, <em>The History of Philosophy</em> (London, 1687), p. 583</>}
          />
        </div>

        <p className={p}>
          The story later readers liked best was the dove. Aulus Gellius, in the <em>Attic Nights</em>, sets it
          beside the tall tales told of Democritus and decides it deserves belief:
        </p>

        <SourceQuote
          book="aulus-gellius-noctes-atticae-aldine-press-2nd-ed-gellius"
          page={349}
          printedPage="158"
          src="https://images.sourcelibrary.org/pages/69b2220708069e96e8431f39/0349.jpg"
          pageAlt="A page of the Aldine Gellius in italic type, ending the chapter with four lines of Greek from Favorinus."
          source={<>Aulus Gellius, <em>Attic Nights</em>, Book 10 (Venice: Aldus, 1515)</>}
          original={<>Nam et plerique nobilium Graecorum, et Phauorinus philosophus memoriarum ueterum exequentissimus, adfirmatissime scripserunt: simulachrum columbae e ligno ab Archyta ratione quadam, disciplinaque mechanica factum uolasse: ita erat scilicet libramentis suspensum, et aura spiritus inclusa, atque oculta concitum.</>}
        >
          For many of the noble Greeks and Favorinus, a philosopher most diligent in ancient records, have written
          most firmly that a wooden image of a dove was made by Archytas according to a certain rational method and
          mechanical skill, and that it flew; so truly was it balanced by counterweights and impelled by the enclosed
          and hidden spirit of air.
        </SourceQuote>

        <p className={p}>
          Ficino retold it, and in 1641 Athanasius Kircher gave it a plate in his book on the magnet,{' '}
          <Link href={`${BOOK.kircher}?page=446`}><em>Magnes</em></Link>: “the magnetic dove presented by the art of
          Archytas”, flying on a line beneath a great dial.
        </p>

        <p className={p}>
          The mathematicians remembered something else. Eutocius, commenting on Archimedes, lists the ways the
          ancients found two mean proportionals between two lines, the problem of doubling the cube, and{' '}
          <Link href={`${BOOK.eutocius}?page=277`}>Archytas is said to have found them through half-cylinders</Link>.
          The moralists remembered his temper. Cicero praises Archytas, “who, when he had become rather angry with
          his farm manager, said: <Link href={`${BOOK.cicero}?page=85`}>What way would I have punished you, had I not
          been angry</Link>”, and the story was copied into collections of moral examples and the medieval allegory
          of the game of chess. The medical compilers gave him a cure. In the <em>Book of Secrets</em> attributed to
          Albertus Magnus, “<Link href={`${BOOK.secrets}?page=72`}>Archytas said: if the heart of a vulture is taken
          while it is alive and suspended over a patient suffering from quartan fever, it eradicates it</Link>.” And
          in one of Horace’s odes the drowned Archytas asks a passing sailor not to leave him unburied, as the{' '}
          <Link href={`${BOOK.horace}?page=96`}>commentary in a Horace of 1490</Link> explains.
        </p>

        <h2 className={h2}>A map of what they said he said</h2>

        <p className={p}>
          About 560 passages in the library pair the name Archytas with something said, taught or written. Each dot is
          one of them, and passages that say similar things sit close together. The groups are drawn by a computer
          from the wording; the names are ours, written after reading each group. The largest group is the broadest:
          lives, letters and the treatises that circulated under his name.
        </p>

        <FigureMap dataUrl={`${DATA}/map.json`} figure="Archytas" />

        <h2 className={h2}>Which stories, when</h2>

        <p className={p}>
          The same passages counted by period: each band is one group from the map, and its height is that group’s
          share of what was written in those years. The number under each period is how many passages it holds.
        </p>

        <ThemeRiver dataUrl={`${DATA}/map.json`} />

        <h2 className={h2}>How a story was passed on</h2>

        <p className={p}>
          Pick a story and every dated telling of it appears at its year, joined to the earlier telling, from a
          different book, whose wording is closest, when the two are close enough. This measures how alike two
          passages read, not whether one author had the other’s book open. Click a dot to read it and follow its line
          back.
        </p>

        <StoryTree mapUrl={`${DATA}/map.json`} treeUrl={`${DATA}/tree.json`} featured={['t8', 't1', 't0', 't2']} />

        <h2 className={h2}>Every book that names him</h2>

        <p className={p}>
          Each card is one work. The passage shown is the one where the author comes closest to reporting what
          Archytas said or taught; those passages have a gold rule. Every page number opens the scan.
        </p>

        <FigureIndex dataUrl={`${DATA}/passages.json`} namePrefix="Archyt"
          placeholder="Filter: dove, Plato, Horace, angry, cube, Tarentum…" />

        <p className="text-sm text-muted leading-relaxed mt-12 font-body">
          How the list was made: a search of the library’s English translations for every word beginning
          “Archyt-” across the public books on 20 October 2026. A page counts only when the book itself names him,
          not when only a translator’s note or summary does. Index, contents and errata pages are left out, and
          editions of the same work are grouped. A passage is marked as reporting his words when it pairs his name
          with a verb of saying or teaching, or with a phrase such as “according to Archytas”; that is a pattern
          match, so it misses some and catches some it should not. A work is dated by when it was written. An ancient or medieval text read in a later edition takes its author’s death year, shown as “by”, with the edition’s year under it; its preface and appendices keep the edition’s year, since they are the editor’s. Pseudonymous texts and compilations of several authors keep the edition’s year. The Gellius quotation is the library’s translation;
          the Latin was read against the page, with its abbreviations expanded.
        </p>
      </article>
    </ContentPageLayout>
  );
}
