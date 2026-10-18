import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import PageFigure from '@/components/articles/PageFigure';
import SourceQuote from '@/components/articles/SourceQuote';
import { CerChart, PairChart, type CerRow, type PairRow } from './OcrCharts';

// Source of every figure here: scripts/eval/results/en-ocr-ref-5124/report.md and the
// EXPERIMENTS.md entry for run en-ocr-ref-5124-2026-09 (PR #5216, issue #5124). Nothing
// below was measured for this note; if a number is not in the report, it does not belong here.

const HERO = 'https://images.sourcelibrary.org/archived/6990631aef12272ffdc8f4aa/324.jpg';
const HERO_ALT =
  'Page 300 of Sachau’s 1879 translation of al-Bīrūnī’s Chronology of Ancient Nations. The page prints “5180 years” twice; the Archive’s text file has 6180 both times.';

const TITLE = 'Checking the Archive’s OCR against proofread pages';
const DESCRIPTION =
  'On 122 English pages with an independent proofread transcription, the Internet Archive’s OCR text silently misreads about one printed number in a hundred. Our own reader is better on the same page in every cohort. If you quote a date from Archive text, check the image.';

export const metadata: Metadata = withArticleMeta('archive-ocr-against-proofread-pages', {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description:
      'The Archive’s OCR text silently misreads about one printed number in a hundred. Measured on 122 English pages with a proofread transcription.',
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/articles/archive-ocr-against-proofread-pages' },
});

const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mb-6';
const TH = 'text-left font-medium text-primary py-2 pr-4 border-b border-border-light';
const TD = 'py-2 pr-4 align-top border-b border-border-light text-secondary';
const LABEL = 'block font-sans text-xs text-muted not-italic mb-1';

// Books and the pages the note names. Each page image checked by eye against the run's reference
// text on 2026-10-18. The Porphyry copy is the one the run scored (its slug now redirects to a
// second copy of the book, whose page 199 is a different leaf), so the page link keeps it.
const CHRONOLOGY = 'the-chronology-of-ancient-nations-sachau';
const SPINOZA = 'ethic-demonstrated-in-geometrical-order-white-translation-spinoza';
const MOONEY = 'the-ghost-dance-religion-and-the-sioux-outbreak-of-1890-mooney';
const PORPHYRY = 'select-works-of-porphyry-on-abstinence-cave-of-the-nymphs-porphyry';
const LANE = 'arabian-society-in-the-middle-ages-lane';

const CHRONOLOGY_BOOK = `/book/${CHRONOLOGY}`;
const CHRONOLOGY_PAGE = `/book/${CHRONOLOGY}?page=324`;
const SPINOZA_BOOK = `/book/${SPINOZA}`;
const SPINOZA_PAGE = `/book/${SPINOZA}?page=122`;
const MOONEY_BOOK = `/book/${MOONEY}`;
const MOONEY_PAGE = `/book/${MOONEY}?page=256`;
const PORPHYRY_BOOK = `/book/${PORPHYRY}`;
const LANE_BOOK = `/book/${LANE}`;
const LANE_PAGE = `/book/${LANE}?page=288`;

const IMG = {
  chronology: 'https://images.sourcelibrary.org/archived/6990631aef12272ffdc8f4aa/324.jpg',
  spinoza: 'https://images.sourcelibrary.org/archived/695434421479a63c11088c27/122.jpg',
  mooney: 'https://images.sourcelibrary.org/archived/699079c0db8b55d19ec67ceb/256.jpg',
  porphyry: 'https://images.sourcelibrary.org/archived/69ad747b059a2da73405f323/199.jpg',
  lane: 'https://images.sourcelibrary.org/archived/699079eadb8b55d19ec685b8/288.jpg',
};

// Chart data: scripts/eval/results/en-ocr-ref-5124/report.md, "Per stratum" (pooled CER and its
// 95% bootstrap interval) and "Paired" (better / worse / tie counts). The point values are the
// ones in the article's table.
const REPORT = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/scripts/eval/results/en-ocr-ref-5124/report.md';
const CHART_SOURCE = (
  <>
    Numbers from the run&apos;s <a href={REPORT}>report</a> (run en-ocr-ref-5124-2026-09, 122 English
    pages scored against Wikisource and Project Gutenberg transcriptions); intervals are 95 percent
    bootstrap intervals. The table below gives the same figures.
  </>
);

const CER: CerRow[] = [
  { cell: 'Before 1880, prose', books: 25, archive: { v: '6.6', lo: 1.47, hi: 15.5 }, ours: { v: '1.5', lo: 0.33, hi: 3.15 } },
  { cell: 'Before 1880, number-dense', books: 22, archive: { v: '6.4', lo: 3.12, hi: 11.04 }, ours: { v: '4.0', lo: 0.88, hi: 9.31 } },
  { cell: '1880–1930, prose', books: 41, archive: { v: '0.62', lo: 0.41, hi: 0.87 }, ours: { v: '0.34', lo: 0.19, hi: 0.5 } },
  { cell: '1880–1930, number-dense', books: 34, archive: { v: '3.5', lo: 1.79, hi: 5.77 }, ours: { v: '4.9', lo: 1.17, hi: 10.99 } },
  { cell: 'All', books: 122, archive: { v: '3.95', lo: 2.33, hi: 6.07 }, ours: { v: '2.62', lo: 1.17, hi: 4.55 }, strong: true },
];

const PAIRED: PairRow[] = [
  { cell: 'Before 1880, prose', ours: 15, tie: 7, archive: 1 },
  { cell: 'Before 1880, number-dense', ours: 11, tie: 7, archive: 1 },
  { cell: '1880–1930, prose', ours: 16, tie: 19, archive: 1 },
  { cell: '1880–1930, number-dense', ours: 15, tie: 10, archive: 2 },
  { cell: 'All', ours: 57, tie: 43, archive: 5, strong: true },
];

export default function ArchiveOcrAgainstProofreadPagesPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="122 English pages that volunteers proofread against the same scans. The Archive's text misreads about one printed number in a hundred and leaves no mark where it did."
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">28 September 2026 &middot; 8 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Two weeks ago we wrote that the Internet Archive&apos;s own OCR text is good enough to take,
          free, wherever it agrees with our reading on nineteen words in twenty. That test compares two
          machines with each other. This note compares both of them with a third party: 122 English
          pages that volunteers have proofread letter by letter against the same scans. On the same
          page, our reader is better on 57, the Archive&apos;s on 5, and 43 are a tie. The result that
          matters to anyone quoting from Archive text is smaller and worse, and it is preliminary. In
          this first measurement the Archive silently misreads about 1 percent of the numbers printed
          on a page, a 5180 that comes out as 6180, with nothing in the text to show that anything went
          wrong. If you are quoting a date, a page reference or a sum from Archive OCR, open the image.
        </p>
        <p className={P}>
          This partly corrects{' '}
          <Link href="/articles/free-reading">The Reading We Did Not Have to Pay For</Link>,
          which reported 66,322 pages accepted from the Archive on the strength of agreement with our
          own reading. Agreement between two readers is not accuracy, and that note said so. What it
          could not say, because nothing independent of both readers had been measured, is how large
          the gap was or where it fell. Now we know one place it falls: in the digits.
        </p>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>What was measured</h2>
          <p className={P}>
            The reference pages are the first English pages in our OCR benchmark, built the way{' '}
            <Link href="/articles/how-we-measure-ocr-quality">How We Measure OCR Quality</Link>{' '}
            describes: one interior page per book, sealed before anyone looked at an engine&apos;s
            output, with an independent transcription of that leaf as the truth. For 87 pages the truth
            is a proofread <em>Page:</em> transcription on English Wikisource made from the same
            Internet Archive scan we hold. For 35 more it is Project Gutenberg&apos;s HTML text of the
            same edition, cut at its printed page breaks. Every page&apos;s leaf identity was checked
            against the image before scoring, because the Archive&apos;s leaf numbering and our page
            numbering do not always agree; 25 of the first 134 images turned out to be a neighbouring
            leaf, 14 were recovered by searching the neighbours, and the rest were excluded with the
            reason recorded.
          </p>
          <p className={P}>
            Two readings of each page were scored against the truth. The first is the Archive&apos;s own
            text file for that leaf, produced by ABBYY FineReader or Tesseract depending on the year the
            Archive ran it. The second is a fresh reading by our production engine, Gemini Flash-Lite,
            with the production prompt, one page at a time, and one retry when the model refused. The
            score is character error rate on letters and digits after trimming an engine&apos;s unmatched
            running heads. The 122 books fall into four cells by date of edition and by whether the page
            is dense with numbers, which here means the reference carries at least six numbers of two
            to four digits.
          </p>
          <p className={P}>
            The question behind the design was practical. We had proposed routing some English Archive
            books past the paid reader entirely, and a spot check of four family-history books that the
            earlier test had accepted found years misread, 1836 as 1886. Dates in a county history or a
            genealogy are the whole point of the page, so a misread digit there is not a typo but a
            false fact. We wanted to know how often it happens, measured against something independent
            of both readers.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>What the numbers say</h2>
          <p className={P}>
            The table gives, for each cell, the pooled character error rate of each reading, the count
            of pages on which one reading beat the other by more than a fifth of a percentage point, and
            the number misreads described in the next section. The two cells before 1880 hold fewer than
            thirty books each and are exploratory; the two cells from 1880 to 1930 are large enough to
            be directional but not to decide anything alone.
          </p>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm font-body">
              <thead>
                <tr>
                  <th className={TH}>Cell (books)</th>
                  <th className={TH}>Archive error rate</th>
                  <th className={TH}>Our reader</th>
                  <th className={TH}>Same page: ours better / Archive better / tie</th>
                  <th className={TH}>Silent number misreads, Archive / ours</th>
                  <th className={TH}>Our reader refused</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className={TD}>Before 1880, prose (25)</td><td className={TD}>6.6%</td><td className={TD}>1.5%</td><td className={TD}>15 / 1 / 7</td><td className={TD}>1 of 10 / 0 of 10</td><td className={TD}>2</td></tr>
                <tr><td className={TD}>Before 1880, number-dense (22)</td><td className={TD}>6.4%</td><td className={TD}>4.0%</td><td className={TD}>11 / 1 / 7</td><td className={TD}>2 of 265 / 0 of 194</td><td className={TD}>3</td></tr>
                <tr><td className={TD}>1880&ndash;1930, prose (41)</td><td className={TD}>0.62%</td><td className={TD}>0.34%</td><td className={TD}>16 / 1 / 19</td><td className={TD}>0 of 12 / 0 of 12</td><td className={TD}>5</td></tr>
                <tr><td className={TD}>1880&ndash;1930, number-dense (34)</td><td className={TD}>3.5%</td><td className={TD}>4.9%</td><td className={TD}>15 / 2 / 10</td><td className={TD}>6 of 599 / 0 of 534</td><td className={TD}>7</td></tr>
                <tr><td className={TD}><strong>All (122)</strong></td><td className={TD}><strong>3.95%</strong> [2.3, 6.1]</td><td className={TD}><strong>2.62%</strong> [1.2, 4.6]</td><td className={TD}><strong>57 / 5 / 43</strong></td><td className={TD}><strong>9 of 886</strong> (1.0% [0.3, 2.0]) / <strong>0 of 750</strong></td><td className={TD}>17 (14%)</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted font-body mb-6">
            Error rates are pooled over the cell&apos;s pages; brackets are 95 percent bootstrap
            intervals. The paired columns count only the 105 pages both readers produced. A tie is a
            difference under 0.2 percentage points. Refusals are counted after the retry.
          </p>
          <CerChart rows={CER} max={16} ticks={[0, 4, 8, 12, 16]} source={CHART_SOURCE} />
          <PairChart rows={PAIRED} source={CHART_SOURCE} />
          <p className={P}>
            Our reader is better on the same page in every cell, and the sign test on the paired pages
            gives p below 0.001. In the one cell where the Archive&apos;s pooled error rate is lower,
            1880 to 1930 number-dense, the difference is one page: a two-column index in Lane&apos;s{' '}
            <Link href={LANE_BOOK}>Arabian Society in the Middle Ages</Link>{' '}
            (1883) that our reader laid out as a row-wise table, reading across both columns instead
            of down each. That is an error of order, not of reading, and 39 of the 63 numbers our
            reader is scored as dropping in that cell are on{' '}
            <Link href={LANE_PAGE}>that one page</Link>.
          </p>
          <div className="max-w-md mx-auto">
            <PageFigure
              src={IMG.lane}
              alt="Printed page 268 of the index to Lane's Arabian Society in the Middle Ages, two columns of entries from Arafat to Buffalo, each followed by page numbers."
              href={LANE_PAGE}
              source={<>Lane, <em>Arabian Society in the Middle Ages</em> (1883), index, p. 268</>}
            >
              The index page our reader read across both columns as one table. The Archive&apos;s text
              reads each column top to bottom.
            </PageFigure>
          </div>
          <p className={P}>
            The Archive&apos;s worst page is not a misreading either. It is a page of Thomas
            Taylor&apos;s 1823{' '}
            <Link href={PORPHYRY_BOOK}>Select Works of Porphyry</Link>{' '}
            that Tesseract read as Greek: the English text comes out as{' '}
            <span lang="grc">ΟΝ ΤῊ ΟΑΥ̓Ε</span>&hellip;
            and scores an 87 percent error rate. Anyone can see that page is broken. The problem this
            note is about is the pages nobody can see are broken.
          </p>
          <SourceQuote
            book={PORPHYRY}
            page={199}
            printedPage={173}
            src={IMG.porphyry}
            pageAlt="Printed page 173 of Taylor's Porphyry, On the Cave of the Nymphs: a full page of clear English roman type with one footnote."
            source={<>Porphyry, <em>Select Works</em>, tr. Thomas Taylor (1823)</>}
          >
            <p className="mb-3">
              <span className={LABEL}>Printed</span>
              And again, that the gate, which is pervious by men, should be said to be turned towards
              the north wind&hellip;
            </p>
            <p>
              <span className={LABEL}>The Archive&apos;s text file</span>
              <span lang="grc">Απᾶ αραίη, &#123;παῦ &#123;Π6 ραίβ, Ψ ΒΊΟΝ 15. ρθυνίοβ ὈΥ͂ ΤΠΕΏ,</span>&hellip;
            </p>
          </SourceQuote>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>Silent number misreads</h2>
          <p className={P}>
            A conventional OCR engine that cannot read a character usually leaves a trace. It writes{' '}
            <em>1s79</em> for 1879, <em>ii</em> for 11, <em>loi</em> for 101. Those are visibly garbled: a
            reader, or a program, can see that something is wrong and go to the image. The dangerous case
            is the one where the engine reads a printed number as a different, well-formed number. We
            call that a silent misread, and we counted it strictly: the page must print the
            reference&apos;s number, which we checked by opening the image for every candidate, and the
            engine must have written a different number one glyph away.
          </p>
          <p className={P}>
            This finding is preliminary, and the numbers should be read with their intervals. Across the
            122 pages the Archive&apos;s text does this to 9 of the 886 numbers printed, or 1.0 percent
            with a 95 percent interval from 0.3 to 2.0, on six different pages. (Corrected on 18 October
            2026: an earlier version counted 13. Re-reading the Archive&apos;s text files showed that four
            of them, such as &ldquo;Prop. 1 6&rdquo; for 16, are the right digits split by a space, and they
            are no longer counted as misreads.) On the 105 pages both
            readers produced, the count is 8 against 0. Eight events is a small base. Our reader produced
            no silent misread that survived the image check on any of its 750 numbers, and zero observed
            in 750 does not show that its rate is zero; it bounds the rate below about 0.4 percent at 95
            percent confidence. The honest statement is that the Archive&apos;s rate is somewhere between
            one in 340 and one in 50, and ours is below one in 250 and may be far lower. A dedicated
            numbers test is underway, in which every disagreement between the two engines on a printed
            number is adjudicated on the page image, together with an estimate of the errors both engines
            could share; it is tracked as{' '}
            <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5224" target="_blank" rel="noopener noreferrer">issue #5224</a>.
          </p>
          <p className={P}>
            The page at the top of this note is page 300 of Edward Sachau&apos;s 1879 translation of
            al-B&#299;r&#363;n&#299;&apos;s{' '}
            <Link href={CHRONOLOGY_BOOK}>The Chronology of Ancient Nations</Link>. It
            prints &ldquo;others as 5180 years&rdquo; in the text and &ldquo;5180 years&rdquo; again as a
            displayed line. The Archive&apos;s text file has 6180 in both places. We read{' '}
            <Link href={CHRONOLOGY_PAGE}>the page</Link>{' '}
            by eye to be sure and checked the Archive&apos;s file directly. A reader searching the
            Archive&apos;s text for the interval between Adam and Alexander would not find it, and a
            reader who copied the figure would copy the wrong one, with no sign that it was wrong.
          </p>
          <SourceQuote
            book={CHRONOLOGY}
            page={324}
            printedPage={300}
            src={IMG.chronology}
            pageAlt="Printed page 300 of Sachau's Chronology of Ancient Nations; the figure 5180 years appears in the first paragraph and again as a line set on its own in the middle of the page."
            source={<>al-B&#299;r&#363;n&#299;, <em>The Chronology of Ancient Nations</em>, tr. Sachau (1879)</>}
          >
            <p className="mb-3">
              <span className={LABEL}>Printed</span>
              For some of them count the interval between Adam and Alexander as 5069 years, others as
              5180 years.
            </p>
            <p>
              <span className={LABEL}>The Archive&apos;s text file</span>
              For some of them count the interval between Adam and Alexander as 5069 years, others as
              6180 years.
            </p>
          </SourceQuote>
          <p className={P}>
            On{' '}
            <Link href={SPINOZA_PAGE}>a page</Link>{' '}
            of the 1883 White translation of Spinoza&apos;s{' '}
            <Link href={SPINOZA_BOOK}>Ethic Demonstrated in Geometrical Order</Link>,
            the printed cross-references &ldquo;Prop. 16, pt. 2&rdquo; and &ldquo;Prop. 11, pt. 2&rdquo;
            come out as &ldquo;Prop. 1 6&rdquo; and &ldquo;Prop, 1 1&rdquo;: the digits are right but split
            by a space, so a search for Prop. 16 misses them and our scorer read them as two numbers. In
            James Mooney&apos;s 1896{' '}
            <Link href={MOONEY_BOOK}>The Ghost-Dance Religion</Link>, a source citation
            printed &ldquo;(G. D., 36; War, 8.)&rdquo; becomes 30 on{' '}
            <Link href={MOONEY_PAGE}>the page</Link>. The remaining cases in the run are
            of that second kind: a page reference in an index, a footnote, a year, each changed by one
            digit into another plausible number. Most of them are in the 1880 to 1930 number-dense
            cell, which is the cell a county history or a genealogy would fall in.
          </p>
          <div className="max-w-md mx-auto">
            <PageFigure
              src={IMG.spinoza}
              alt="Printed page 72 of White's translation of Spinoza's Ethic, Part 2, with the cross-references Corol. 11, pt. 2 and Prop. 16, pt. 2 near the top and Prop. 11, pt. 2 lower down."
              href={SPINOZA_PAGE}
              source={<>Spinoza, <em>Ethic Demonstrated in Geometrical Order</em>, tr. White (1883), p. 72</>}
            >
              The page prints &ldquo;Prop. 16, pt. 2&rdquo; in the first paragraph and &ldquo;Prop. 11,
              pt. 2&rdquo; in the demonstration of Prop. XX.
            </PageFigure>
          </div>
          <SourceQuote
            book={MOONEY}
            page={256}
            printedPage={860}
            src={IMG.mooney}
            pageAlt="Printed page 860 of Mooney's Ghost-Dance Religion, a dense page of small type ending a paragraph with the citation (G. D., 36; War, 8.)."
            source={<>Mooney, <em>The Ghost-Dance Religion</em> (1896)</>}
          >
            <p className="mb-3">
              <span className={LABEL}>Printed</span>
              &hellip;joined Big Foot or went on to Pine Ridge. (G. D., 36; War, 8.)
            </p>
            <p>
              <span className={LABEL}>The Archive&apos;s text file</span>
              &hellip;Joined Big Foot or went on to Pine Ridge. (G. D., 30&apos;; War, 8.)
            </p>
          </SourceQuote>
          <p className={P}>
            The reference itself is not perfect. On four numbers where the engines disagreed with
            Wikisource, the image sided with the engines: the volunteers had made the error. Those
            four are excluded from the counts above. The reference error rate is small but it is not
            zero, and a measurement that trusted the reference blindly would have charged the engines
            with four misreads they did not make.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>Where our reader is worse</h2>
          <p className={P}>
            Three things count against our own engine in this run, and they should be said as plainly
            as the number misreads.
          </p>
          <p className={P}>
            It refuses. On 34 of the 122 pages the model declined to transcribe on the first attempt,
            and on 17 it still declined after a retry, which is 14 percent of pages with an interval
            from 9 to 21. These are recitation refusals: the model recognises a published text and will
            not reproduce it. The Archive&apos;s reader never refuses anything. A page our reader will
            not read is a page the Archive has read, and on the evidence here its reading of a prose
            page from 1880 to 1930 is good.
          </p>
          <p className={P}>
            It drops numbers. Where the Archive loses 3.7 percent of the numbers printed, our reader
            loses 8.4 percent. On the paired pages that is 63 numbers against 28, and 39 of the 63 are
            the one index page described above; but the pooled figure is what it is.
          </p>
          <p className={P}>
            It files footnotes as notes. The production prompt asks the model to mark its own
            interpretive remarks inside a <span>&lt;note&gt;</span> tag, and on these pages the model put
            the printed footnotes there too. Any surface of ours that hides notes hides those footnotes.
            That is a defect in our text, not the Archive&apos;s, and it is being tracked separately.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>What this changes in the earlier note</h2>
          <p className={P}>
            The earlier note took a book&apos;s Archive text when the median agreement with our own
            reading across the sampled pages was 0.85 or better, and argued that where two independent
            readers match on nineteen words in twenty, the free text is at least as reliable as the
            text we would have paid for. That argument is about words. A silent digit misread changes
            one word on a page, and a book that agrees at 0.93 has room for many of them. Nothing in
            the agreement score sees a 5180 that became 6180, because the score does not know that
            one word on the page matters more than the others.
          </p>
          <p className={P}>
            The 66,322 accepted pages were not re-measured here; this run drew its own sample, one
            page per book, from a different pool. So this note does not say how many of those pages
            carry a misread digit. It says that the Archive&apos;s reader makes this kind of error at
            about one number in a hundred on pages of this period and type, that the error leaves no
            trace in the text, and that the acceptance test was never designed to catch it. Those
            pages still carry the label that says where their text came from. A reader who finds one
            can reach us from the page, and the label is what will let us replace them in bulk when a
            better reading arrives.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>Proposed routing, not yet applied</h2>
          <p className={P}>
            The run was made to answer a routing question: for which English Archive books may the
            Archive&apos;s own text replace a paid reading? The proposal below follows from the numbers
            above. It has not been applied. It waits on a human decision, as every engine decision in
            the library does.
          </p>
          <ol className="list-decimal pl-6 mb-6 space-y-3 text-secondary leading-relaxed font-body">
            <li>
              Our reader stays the default for English. The Archive lane earns no number-dense cohort
              at all, because a silent misread rate on printed numbers of around 1 percent, against
              none found in 750, is disqualifying for exactly the pages where numbers are the content.
            </li>
            <li>
              One candidate cohort, at the directional grade only: pages from 1880 to 1930 whose Archive
              text contains no number of two to four digits and is at least 90 percent Latin-script
              letters. There the Archive&apos;s error rate is 0.6 percent against our 0.3, and there is
              no number to get wrong. The script test is not optional; the Porphyry page above is why.
            </li>
            <li>
              When our reader refuses a page after the retry, write the Archive&apos;s text for that
              page rather than nothing.
            </li>
            <li>
              Prose before 1880 is not earned: 6.6 percent against 1.5.
            </li>
          </ol>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>What this cannot say</h2>
          <p className={P}>
            The pool is books that Wikisource volunteers chose to proofread or Distributed Proofreaders
            chose to transcribe. Those are, by selection, legible and well known. A random page from our
            English Archive holdings is likely to be harder than these, and 4,888 English Archive books
            we hold had no independent text at all by these matchers; that list is now the transcription
            queue.
          </p>
          <p className={P}>
            The run measured our reader one page at a time, not in the batch mode that production uses
            for most pages, and it made one pass with no replication. The two cells before 1880 hold 25
            and 22 books, under the threshold at which we treat a cell as more than exploratory. It
            covers no French and no English printed before 1600; both remain open. The leaf checks were
            made by a model and cross-checked against the engines, and 13 of them are queued for a
            human to confirm. And the reference error is not zero, as the four Wikisource cases show.
          </p>
          <p className={P}>
            None of that touches the direction of the character-error result: on every kind of page
            measured, our reader is closer to the printed text than the Archive&apos;s. The number
            finding is weaker. It rests on eight paired events, and it shows that the Archive&apos;s
            silent misreads exist at a rate worth acting on, not that ours are absent. The caveats
            limit the size of the numbers; the sign holds for characters and is preliminary for digits.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Method and data</h2>
          <p className="text-sm text-muted font-body">
            Page numbers in the captions are the printed folios; each picture opens that page in our
            reader. Method and code: <span>scripts/eval/en-ocr-reference-5124.mjs</span> in
            the public repository; the sealed registry of 216 drawn rows with every exclusion reason,
            the 122 reference transcriptions, both engines&apos; outputs and scores, and the full
            report with breakdowns by Archive OCR engine, scanner and OCR year are committed beside it
            under run <span>en-ocr-ref-5124-2026-09</span>. The run cost under fifty cents.
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
