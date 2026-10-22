import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import SourceQuote from '@/components/articles/SourceQuote';
import FigureIndex from '@/components/articles/figure-reception/FigureIndex';
import FigureMap from '@/components/articles/figure-reception/FigureMap';
import ThemeRiver from '@/components/articles/figure-reception/ThemeRiver';
import StoryTree from '@/components/articles/figure-reception/StoryTree';
import RareClaims from '@/components/articles/figure-reception/RareClaims';

// The second of the figure-reception pages (#7073), built with scripts/eval/figure-reception/ from the local
// corpus mirror on 2026-10-20: every public work whose English translation contains "Philola*", with the
// translation's own apparatus removed first. The map's themes were named by reading each theme's sample
// passages. Passages where "Philolaus" is a speaker in Reuchlin's De arte cabalistica (1517, and its reprints
// with Galatinus and Pico), or Philostratus' Philolaus of Citium, are set aside as their own grey-blue group
// before clustering (figures.json setAside), because they are not the Pythagorean.
// Claudianus Mamertus p. 174 (printed 120) checked 2026-10-22 with get_quote and by eye; the Latin is the letter-spaced
// text on the leaf. Quotations checked 2026-10-20 with get_quote: Copernicus p. 11 (the Greek is printed on the leaf; the
// translation is the library's) and Reuchlin p. 9. The hero is Copernicus' diagram of the spheres (p. 34),
// opened by eye: Sol at the centre, the Earth with the Moon's circle in fifth place.

const SLUG = 'philolaus-in-the-library';
const TITLE = 'Philolaus in the Library';
const DESCRIPTION =
  'Every book in Source Library that names Philolaus of Croton: the moving earth Copernicus found in Plutarch, the books Plato bought, and Reuchlin’s Pythagorean.';
const HERO = 'https://images.sourcelibrary.org/pages/606a74d7-2ac1-420b-924d-de761439fb3f/0034.jpg';
const HERO_ALT =
  'Copernicus’ diagram of the universe from De revolutionibus (1543): seven nested circles around the Sun, with the Earth and the Moon’s small circle in the fifth.';

export const metadata: Metadata = withArticleMeta(SLUG, {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: { images: [{ url: HERO, alt: HERO_ALT }], title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: `/articles/${SLUG}` },
});

const BOOK = {
  copernicus: '/book/de-revolutionibus-1543-first-edition-copernicus',
  gellius: '/book/aulus-gellius-noctes-atticae-aldine-press-2nd-ed-gellius',
  reuchlin: '/book/ioannis-revchlin-phorcensis-ll-doc-de-arte-cabalistica-reuchlin',
  hoogstraten: '/book/destructio-cabale-seu-cabalistice-perfidie-ab-ioanne-hoogstraten',
  campanella: '/book/the-city-of-the-sun-campanella',
  claudianus: '/book/claudiani-mamerti-opera-csel-xi-engelbrecht',
  pythagoras: '/articles/pythagoras-in-the-library',
};

const DATA = '/articles/philolaus-in-the-library';
const p = 'text-secondary leading-relaxed mb-6 font-body';
const h2 = 'text-2xl md:text-3xl text-primary mt-16 mb-6';

export default function PhilolausInTheLibraryPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="The first Pythagorean to write a book, and the name Copernicus found when he looked for someone who had moved the earth"
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
          Philolaus of Croton lived a generation before Plato and is said to have been the first Pythagorean to put
          the teaching in writing. Little of it survives, in quotations by later authors. In this library about five
          hundred works name him. This page gathers them, in date order, with the passage and the page, like
          the <Link href={BOOK.pythagoras}>page on Pythagoras</Link> that it follows.
        </p>

        <p className={p}>
          The best known of the quotations reached Copernicus through Plutarch. In the preface to{' '}
          <Link href={BOOK.copernicus}><em>On the Revolutions of the Heavenly Spheres</em></Link>, addressed to Pope
          Paul III, he explains where he found the courage to think the earth moves, and prints the Greek:
        </p>

        <SourceQuote
          book="de-revolutionibus-1543-first-edition-copernicus"
          page={11}
          src="https://images.sourcelibrary.org/pages/606a74d7-2ac1-420b-924d-de761439fb3f/0011.jpg"
          pageAlt="A page of the author’s preface to De revolutionibus, with four lines of Greek from Plutarch set into the Latin."
          source={<>Copernicus, <em>On the Revolutions of the Heavenly Spheres</em>, preface (Nuremberg, 1543)</>}
          original={<>οἱ μὲν ἄλλοι μένειν τὴν γῆν, Φιλόλαος δὲ Πυθαγόρειος κύκλῳ περιφέρεσθαι περὶ τὸ πῦρ κατακυκλῳ λοξὸν ὁμοιοτρόπως ἡλίῳ καὶ σελήνῃ.</>}
        >
          Others say that the Earth stands still, but Philolaus the Pythagorean says that it moves around the
          central fire in an oblique circle, much like the Sun and the Moon.
        </SourceQuote>

        <p className={p}>
          For Philolaus the centre of the world was not the sun but a fire, the hearth of the whole, with the
          earth and a counter-earth turning round it. After Copernicus that difference was often dropped, and he
          became a forerunner. In Campanella’s <Link href={`${BOOK.campanella}?page=72`}><em>City of the Sun</em></Link> the
          citizens “praise Ptolemy, admire Copernicus, but place Aristarchus and Philolaus before him.”
        </p>

        <p className={p}>
          The other story told most often is about his books. Aulus Gellius records{' '}
          <Link href={`${BOOK.gellius}?page=193`}>that Plato bought three books of Philolaus the Pythagorean</Link> at
          a price hard to believe, and later writers repeated it, sometimes adding that the <em>Timaeus</em> was
          taken from them.
        </p>

        <p className={p}>
          Some of what he wrote survives only because one later reader copied it out. Claudianus Mamertus, a priest
          of Vienne writing about 470, quotes the third of Philolaus’ books in his treatise{' '}
          <Link href={`${BOOK.claudianus}?page=174`}><em>On the State of the Soul</em></Link>:
        </p>

        <SourceQuote
          book="claudiani-mamerti-opera-csel-xi-engelbrecht"
          page={174}
          printedPage="120"
          src="https://images.sourcelibrary.org/pages/69942bf5b2f6748db4abc741/0174.jpg"
          pageAlt="A page of Engelbrecht’s 1885 edition of Claudianus Mamertus, chapter VII, with Philolaus’ words letter-spaced and the variant readings below."
          source={<>Claudianus Mamertus, <em>On the State of the Soul</em>, Book 2, chapter 7 (ed. Engelbrecht, Vienna, 1885)</>}
          original={<>anima inditur corpori per numerum et inmortalem eandemque incorporalem conuenientiam.</>}
        >
          The soul is placed into the body through number and an immortal and incorporeal harmony.
        </SourceQuote>

        <p className={p}>
          Later writers knew the fragment through him: Théophile Raynaud in 1622, Louis Dutens in 1766, August Boeckh
          in 1819. In the story tree below, under “Claudianus Mamertus’ fragment on the soul”, his page stands first
          and theirs follow.
        </p>

        <h2 className={h2}>A map of what they said he said</h2>

        <p className={p}>
          About 750 passages in the library pair the name Philolaus with something said, taught or written. Each dot
          is one of them, and passages that say similar things sit close together. The groups are drawn by a computer
          from the wording; the names are ours, written after reading each group.
        </p>

        <p className={p}>
          One group is not about the Pythagorean at all. In Johann Reuchlin’s{' '}
          <Link href={`${BOOK.reuchlin}?page=9`}><em>On the Art of the Kabbalah</em></Link> (1517), “Philolaus the
          younger, a Pythagorean, and Marranus, a Mahometan” meet in a tavern at Frankfurt to hear Simon the Jew
          explain the Kabbalah, and Philolaus speaks on almost every page. The dialogue was reprinted many times, and
          answered by its critics, among them Jacob Hoogstraten in his{' '}
          <Link href={BOOK.hoogstraten}><em>Destruction of the Cabala</em></Link> (1519). Those speeches are kept apart
          on the map, so they do not mix with what the ancient Philolaus was reported to say.
        </p>

        <FigureMap dataUrl={`${DATA}/map.json`} figure="Philolaus" />

        <h2 className={h2}>Which stories, when</h2>

        <p className={p}>
          The same passages counted by period: each band is one group from the map, and its height is that group’s
          share of what was written in those years. The number under each period is how many passages it holds. The
          wide violet band in the sixteenth century is Reuchlin’s Philolaus, printed again and again with the
          dialogue.
        </p>

        <ThemeRiver dataUrl={`${DATA}/map.json`} />

        <h2 className={h2}>How a story was passed on</h2>

        <p className={p}>
          Pick a story and every dated telling of it appears at its year, joined to the earlier telling, from a
          different book, whose wording is closest, when the two are close enough. This measures how alike two
          passages read, not whether one author had the other’s book open. Click a dot to read it and follow its line
          back.
        </p>

        <StoryTree mapUrl={`${DATA}/map.json`} treeUrl={`${DATA}/tree.json`} featured={['t2', 't0', 'claudianus', 't7', 't1000']} />

        <h2 className={h2}>Told once</h2>

        <p className={p}>
          The map and the tree show what was said about Philolaus again and again. This list is the other end: the
          things said about him that no other book in the library says in similar words, at most three from any one
          book. Some are stray facts, such as Franchino Gaffurio’s remark, in his <em>Theory of Music</em>, that after
          the comma “Philolaus himself measured even smaller particles.” Some are attributions others doubted: Juan
          Luis Vives, in his notes to Augustine’s <em>City of God</em>, mentions the Golden Verses of Pythagoras,
          “which others hand down as being by Philolaus the Pythagorean.” And some are not about the ancient man at all: in 1639
          Ismaël Boulliau gave the title <em>Philolaus</em> to his own book on the moving earth, and his opponents
          argued with “Philolaus” for years. A note says so where a passage is not what it seems. The list keeps them
          all, because this is where to look for what the usual story leaves out. A gold rule marks a passage that
          reports something he said.
        </p>

        <RareClaims dataUrl={`${DATA}/rare.json`} />

        <h2 className={h2}>Every book that names him</h2>

        <p className={p}>
          Each card is one work. The passage shown is the one where the author comes closest to reporting what
          Philolaus said or taught; those passages have a gold rule. Every page number opens the scan.
        </p>

        <FigureIndex dataUrl={`${DATA}/passages.json`} namePrefix="Philola"
          placeholder="Filter: central fire, Plato, harmony, Copernicus, Boeckh…" />

        <p className="text-sm text-muted leading-relaxed mt-12 font-body">
          How the list was made: a search of the library’s English translations for every word beginning
          “Philola-” across the public books on 20 October 2026. A page counts only when the book itself names him,
          not when only a translator’s note or summary does. Index, contents and errata pages are left out, and
          editions of the same work are grouped. A passage is marked as reporting his words when it pairs his name
          with a verb of saying or teaching, or with a phrase such as “according to Philolaus”; that is a pattern
          match, so it misses some and catches some it should not. A work is dated by when it was written. An ancient or medieval text read in a later edition takes its author’s death year, shown as “by”, with the edition’s year under it; its preface and appendices keep the edition’s year, since they are the editor’s. Pseudonymous texts and compilations of several authors keep the edition’s year. The Copernicus quotation is the library’s
          translation, with the Greek as the library transcribed it from the page.
        </p>
      </article>
    </ContentPageLayout>
  );
}
