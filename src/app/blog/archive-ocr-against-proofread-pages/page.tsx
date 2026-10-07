import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

// Source of every figure here: scripts/eval/results/en-ocr-ref-5124/report.md and the
// EXPERIMENTS.md entry for run en-ocr-ref-5124-2026-09 (PR #5216, issue #5124). Nothing
// below was measured for this note; if a number is not in the report, it does not belong here.

const HERO = 'https://images.sourcelibrary.org/archived/6990631aef12272ffdc8f4aa/324.jpg';
const HERO_ALT =
  'Page 300 of Sachau’s 1879 translation of al-Bīrūnī’s Chronology of Ancient Nations. The page prints “5180 years” twice; the Archive’s text file has 6180 both times.';

const TITLE = 'Checking the Archive’s OCR against proofread pages';
const DESCRIPTION =
  'On 122 English pages with an independent proofread transcription, the Internet Archive’s OCR text silently misreads about one printed number in seventy. Our own reader is better on the same page in every cohort. If you quote a date from Archive text, check the image.';

export const metadata: Metadata = {
  title: `${TITLE} - Research Notes - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description:
      'The Archive’s OCR text silently misreads about one printed number in seventy. Measured on 122 English pages with a proofread transcription.',
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/blog/archive-ocr-against-proofread-pages' },
};

const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mb-6';
const TH = 'text-left font-medium text-primary py-2 pr-4 border-b border-border-light';
const TD = 'py-2 pr-4 align-top border-b border-border-light text-secondary';
const A = 'text-accent-rust hover:underline';

const CHRONOLOGY_BOOK = '/book/6990631aef12272ffdc8f4aa';
const CHRONOLOGY_PAGE = '/book/the-chronology-of-ancient-nations-sachau/page/6990631aef12272ffdc8f5ef';
const SPINOZA_BOOK = '/book/695434421479a63c11088c27';
const SPINOZA_PAGE = '/book/ethic-demonstrated-in-geometrical-order-white-translation-spinoza/page/695434431479a63c11088ca1';
const MOONEY_BOOK = '/book/699079c0db8b55d19ec67ceb';
const MOONEY_PAGE = '/book/the-ghost-dance-religion-and-the-sioux-outbreak-of-1890-mooney/page/699079c0db8b55d19ec67deb';
const PORPHYRY_BOOK = '/book/69ad747b059a2da73405f323';
const PORPHYRY_PAGE = '/book/select-works-of-porphyry-on-abstinence-cave-of-the-nymphs-porphyry/page/69ad747b059a2da73405f3ea';
const LANE_BOOK = '/book/699079eadb8b55d19ec685b8';
const LANE_PAGE = '/book/arabian-society-in-the-middle-ages-lane/page/699079ebdb8b55d19ec686d9';

export default function ArchiveOcrAgainstProofreadPagesPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title={TITLE}
          subtitle="122 English pages that volunteers proofread against the same scans. The Archive's text misreads about one printed number in seventy and leaves no mark where it did."
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">28 September 2026 &middot; 8 min read</p>
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
          Two weeks ago we wrote that the Internet Archive&apos;s own OCR text is good enough to take,
          free, wherever it agrees with our reading on nineteen words in twenty. That test compares two
          machines with each other. This note compares both of them with a third party: 122 English
          pages that volunteers have proofread letter by letter against the same scans. On the same
          page, our reader is better on 57, the Archive&apos;s on 5, and 43 are a tie. The result that
          matters to anyone quoting from Archive text is smaller and worse, and it is preliminary. In
          this first measurement the Archive silently misreads about 1.5 percent of the numbers printed
          on a page, a 5180 that comes out as 6180, with nothing in the text to show that anything went
          wrong. If you are quoting a date, a page reference or a sum from Archive OCR, open the image.
        </p>
        <p className={P}>
          This partly corrects{' '}
          <Link href="/blog/free-reading" className={A}>The Reading We Did Not Have to Pay For</Link>,
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
            <Link href="/blog/how-we-measure-ocr-quality" className={A}>How We Measure OCR Quality</Link>{' '}
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
                <tr><td className={TD}>Before 1880, number-dense (22)</td><td className={TD}>6.4%</td><td className={TD}>4.0%</td><td className={TD}>11 / 1 / 7</td><td className={TD}>3 of 265 / 0 of 194</td><td className={TD}>3</td></tr>
                <tr><td className={TD}>1880&ndash;1930, prose (41)</td><td className={TD}>0.62%</td><td className={TD}>0.34%</td><td className={TD}>16 / 1 / 19</td><td className={TD}>0 of 12 / 0 of 12</td><td className={TD}>5</td></tr>
                <tr><td className={TD}>1880&ndash;1930, number-dense (34)</td><td className={TD}>3.5%</td><td className={TD}>4.9%</td><td className={TD}>15 / 2 / 10</td><td className={TD}>9 of 599 / 0 of 534</td><td className={TD}>7</td></tr>
                <tr><td className={TD}><strong>All (122)</strong></td><td className={TD}><strong>3.95%</strong> [2.3, 6.1]</td><td className={TD}><strong>2.62%</strong> [1.2, 4.6]</td><td className={TD}><strong>57 / 5 / 43</strong></td><td className={TD}><strong>13 of 886</strong> (1.5% [0.6, 2.7]) / <strong>0 of 750</strong></td><td className={TD}>17 (14%)</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted font-body mb-6">
            Error rates are pooled over the cell&apos;s pages; brackets are 95 percent bootstrap
            intervals. The paired columns count only the 105 pages both readers produced. A tie is a
            difference under 0.2 percentage points. Refusals are counted after the retry.
          </p>
          <p className={P}>
            Our reader is better on the same page in every cell, and the sign test on the paired pages
            gives p below 0.001. In the one cell where the Archive&apos;s pooled error rate is lower,
            1880 to 1930 number-dense, the difference is one page: a two-column index in Lane&apos;s{' '}
            <Link href={LANE_BOOK} className={A}>Arabian Society in the Middle Ages</Link>{' '}
            (1883) that our reader laid out as a row-wise table, reading across both columns instead
            of down each. That is an error of order, not of reading, and 39 of the 63 numbers our
            reader is scored as dropping in that cell are on{' '}
            <Link href={LANE_PAGE} className={A}>that one page</Link>.
          </p>
          <p className={P}>
            The Archive&apos;s worst page is not a misreading either. It is a page of Thomas
            Taylor&apos;s 1823{' '}
            <Link href={PORPHYRY_BOOK} className={A}>Select Works of Porphyry</Link>{' '}
            that Tesseract read as Greek: the English text comes out as{' '}
            <span lang="grc">ΟΝ ΤῊ ΟΑΥ̓Ε</span>&hellip;
            and scores an 87 percent error rate. Anyone can see that page is broken. The problem this
            note is about is the pages nobody can see are broken.
          </p>
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
            122 pages the Archive&apos;s text does this to 13 of the 886 numbers printed, or 1.5 percent
            with a 95 percent interval from 0.6 to 2.7, on nine different pages. On the 105 pages both
            readers produced, the count is 10 against 0. Ten events is a small base. Our reader produced
            no silent misread that survived the image check on any of its 750 numbers, and zero observed
            in 750 does not show that its rate is zero; it bounds the rate below about 0.4 percent at 95
            percent confidence. The honest statement is that the Archive&apos;s rate is somewhere between
            one in 170 and one in 40, and ours is below one in 250 and may be far lower. A dedicated
            numbers test is underway, in which every disagreement between the two engines on a printed
            number is adjudicated on the page image, together with an estimate of the errors both engines
            could share; it is tracked as{' '}
            <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5224" className={A} target="_blank" rel="noopener noreferrer">issue #5224</a>.
          </p>
          <p className={P}>
            The page at the top of this note is page 300 of Edward Sachau&apos;s 1879 translation of
            al-B&#299;r&#363;n&#299;&apos;s{' '}
            <Link href={CHRONOLOGY_BOOK} className={A}>The Chronology of Ancient Nations</Link>. It
            prints &ldquo;others as 5180 years&rdquo; in the text and &ldquo;5180 years&rdquo; again as a
            displayed line. The Archive&apos;s text file has 6180 in both places. We read{' '}
            <Link href={CHRONOLOGY_PAGE} className={A}>the page</Link>{' '}
            by eye to be sure and checked the Archive&apos;s file directly. A reader searching the
            Archive&apos;s text for the interval between Adam and Alexander would not find it, and a
            reader who copied the figure would copy the wrong one, with no sign that it was wrong.
          </p>
          <p className={P}>
            On{' '}
            <Link href={SPINOZA_PAGE} className={A}>a page</Link>{' '}
            of the 1883 White translation of Spinoza&apos;s{' '}
            <Link href={SPINOZA_BOOK} className={A}>Ethic Demonstrated in Geometrical Order</Link>,
            the printed cross-references &ldquo;Prop. 16, pt. 2&rdquo; and &ldquo;Prop. 11, pt. 2&rdquo;
            come out as Prop. 6 and Prop. 1. In James Mooney&apos;s 1896{' '}
            <Link href={MOONEY_BOOK} className={A}>The Ghost-Dance Religion</Link>, a source citation
            printed &ldquo;(G. D., 36; War, 8.)&rdquo; becomes 30 on{' '}
            <Link href={MOONEY_PAGE} className={A}>the page</Link>. The remaining cases in the run are
            of the same kind: a page reference in an index, a footnote, a year, each changed by one
            digit into another plausible number. Most of them are in the 1880 to 1930 number-dense
            cell, which is the cell a county history or a genealogy would fall in.
          </p>
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
            interpretive remarks inside a <code>&lt;note&gt;</code> tag, and on these pages the model put
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
            about one number in seventy on pages of this period and type, that the error leaves no
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
              at all, because a silent misread rate on printed numbers of around 1.5 percent, against
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
            finding is weaker. It rests on ten paired events, and it shows that the Archive&apos;s
            silent misreads exist at a rate worth acting on, not that ours are absent. The caveats
            limit the size of the numbers; the sign holds for characters and is preliminary for digits.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Pages named in this note</h2>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm font-body">
              <thead>
                <tr>
                  <th className={TH}>Book</th>
                  <th className={TH}>Page</th>
                  <th className={TH}>What the Archive&apos;s text did</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className={TD}><Link href={CHRONOLOGY_BOOK} className={A}>al-B&#299;r&#363;n&#299;, The Chronology of Ancient Nations, tr. Sachau (1879)</Link></td><td className={TD}><Link href={CHRONOLOGY_PAGE} className={A}>p. 300</Link></td><td className={TD}>5180 read as 6180, twice</td></tr>
                <tr><td className={TD}><Link href={SPINOZA_BOOK} className={A}>Spinoza, Ethic Demonstrated in Geometrical Order, tr. White (1883)</Link></td><td className={TD}><Link href={SPINOZA_PAGE} className={A}>p. 122</Link></td><td className={TD}>Prop. 16 read as 6, Prop. 11 as 1</td></tr>
                <tr><td className={TD}><Link href={MOONEY_BOOK} className={A}>Mooney, The Ghost-Dance Religion (1896)</Link></td><td className={TD}><Link href={MOONEY_PAGE} className={A}>p. 256</Link></td><td className={TD}>citation 36 read as 30</td></tr>
                <tr><td className={TD}><Link href={PORPHYRY_BOOK} className={A}>Porphyry, Select Works, tr. Taylor (1823)</Link></td><td className={TD}><Link href={PORPHYRY_PAGE} className={A}>p. 199</Link></td><td className={TD}>English read as Greek, 87% error rate</td></tr>
                <tr><td className={TD}><Link href={LANE_BOOK} className={A}>Lane, Arabian Society in the Middle Ages (1883)</Link></td><td className={TD}><Link href={LANE_PAGE} className={A}>p. 288</Link></td><td className={TD}>read correctly; our reader flattened the two-column index</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted font-body">
            Page numbers are reader pages in our copy, not the printed folio, except where the printed
            number is quoted. Method and code: <code>scripts/eval/en-ocr-reference-5124.mjs</code> in
            the public repository; the sealed registry of 216 drawn rows with every exclusion reason,
            the 122 reference transcriptions, both engines&apos; outputs and scores, and the full
            report with breakdowns by Archive OCR engine, scanner and OCR year are committed beside it
            under run <code>en-ocr-ref-5124-2026-09</code>. The run cost under fifty cents.
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
