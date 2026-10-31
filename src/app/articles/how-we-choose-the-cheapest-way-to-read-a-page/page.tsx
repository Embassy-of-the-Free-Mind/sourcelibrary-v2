import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import PageFigure from '@/components/articles/PageFigure';
import { DesignCube, RunsChart, type RunPoint } from './Diagrams';

// Source of every figure here: scripts/eval/experiments/2026-10-30-read-surface-box-behnken-6740.md (the design, its
// preregistration and four amendments, the runs and the confirmation), and for the German staged test the three #7701
// records: 2026-10-29-first-read-no-stored-text-7701.md, 2026-10-29-cheap-routes-7701.md and
// 2026-10-30-german-cheaper-first-reads-7701.md. If a number is not in those files, it does not belong here.

const SLUG = 'how-we-choose-the-cheapest-way-to-read-a-page';
const HERO = 'https://images.sourcelibrary.org/archived/6a26c3beaad44c98627cb64a/25.jpg';
const HERO_ALT =
  'Page 25 of Glauber’s Furni Novi Philosophici (1649), printed in Fraktur under the running head “Philosophischer Oefen”: a passage on Mercurius, gold and silver in the fire.';
const TITLE = 'How we choose the cheapest way to read a page';
const DESCRIPTION =
  'Reading a page costs a model call. We tested pages per call, image size and thinking together, on German and Latin pages with typed editions, to find the cheapest setting that reads as well.';

export const metadata: Metadata = withArticleMeta(SLUG, {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: { images: [{ url: HERO, alt: HERO_ALT }], title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: `/articles/${SLUG}` },
});

const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mb-6';
const TH = 'text-left font-medium text-primary py-2 pr-4 border-b border-border-light';
const TD = 'py-2 pr-4 align-top border-b border-border-light text-secondary';

const GLAUBER = '/book/furni-novi-philosophici-oder-beschreibung-einer-new-glauber';
const CHLADNI = '/book/entdeckungen-uber-die-theorie-des-klanges-chladni-2';
const FAUST = '/book/faust-ein-fragment-goethe';
const GOTIBERIS = '/book/gotiberis-hoc-est-de-goticis-per-hispaniam-regibus-e-candidus';
const IMG = '/articles/how-we-choose-the-cheapest-way-to-read-a-page';
const RECORD = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/scripts/eval/experiments/2026-10-30-read-surface-box-behnken-6740.md';

// One dot per run: production-equivalent agy calls a page and the mean character error rate of the target pages
// (unread targets take their one-a-call reading), from the experiment record's run table.
const RUNS: RunPoint[] = [
  { lang: 'German', label: 'live, run 1 (4 a call, image as served, low)', calls: 0.461, cer: 0.0096, live: true },
  { lang: 'German', label: 'live, run 2', calls: 0.375, cer: 0.0092, live: true },
  { lang: 'German', label: '1 a call, 1,600 px, low', calls: 1.0, cer: 0.0092 },
  { lang: 'German', label: '4 a call, 1,024 px, low', calls: 0.521, cer: 0.009 },
  { lang: 'German', label: '4 a call, 2,400 px, low', calls: 0.65, cer: 0.0089 },
  { lang: 'German', label: '8 a call, 1,024 px, low', calls: 0.486, cer: 0.0088 },
  { lang: 'German', label: '8 a call, 1,600 px, low', calls: 0.486, cer: 0.0094 },
  { lang: 'German', label: '8 a call, 2,400 px, low', calls: 0.604, cer: 0.0088 },
  { lang: 'German', label: '4 a call, 1,600 px, medium thinking', calls: 0.343, cer: 0.0086 },
  { lang: 'German', label: '8 a call, 1,600 px, high thinking', calls: 0.446, cer: 0.005 },
  { lang: 'Latin', label: 'live, run 1 (4 a call, image as served, low)', calls: 0.362, cer: 0.0215, live: true },
  { lang: 'Latin', label: 'live, run 2', calls: 0.25, cer: 0.0177, live: true },
  { lang: 'Latin', label: '1 a call, 1,600 px, low', calls: 1.059, cer: 0.0235 },
  { lang: 'Latin', label: '4 a call, 1,024 px, low', calls: 0.388, cer: 0.0191 },
  { lang: 'Latin', label: '4 a call, 2,400 px, low', calls: 0.422, cer: 0.0233 },
  { lang: 'Latin', label: '8 a call, 1,024 px, low', calls: 0.241, cer: 0.0373 },
  { lang: 'Latin', label: '8 a call, 1,600 px, low', calls: 0.174, cer: 0.0217, pick: true },
  { lang: 'Latin', label: '8 a call, 2,400 px, low', calls: 0.275, cer: 0.0242 },
  { lang: 'Latin', label: '4 a call, 1,600 px, medium thinking', calls: 0.306, cer: 0.0172 },
  { lang: 'Latin', label: '8 a call, 1,600 px, high thinking', calls: 0.166, cer: 0.0158 },
];

export default function CheapestReadPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="Every page we read costs a call to a model, and the calls are rationed. Three settings decide how many a page takes. We tested them together, against human-typed editions of the same pages."
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">31 October 2026 &middot; 10 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Page 25 of Johann Rudolph Glauber&apos;s <Link href={`${GLAUBER}?page=25`}><em>Furni Novi Philosophici</em></Link>,
          printed in 1649, explains why Mercurius will not stay with gold and silver in the fire. Until a model reads
          it, the page is a picture: you can look at it, but you cannot search it, quote it or have it translated.
          About 24,000 books on the site are pictures only, almost seven million pages. We read them through a
          subscription that allows a fixed number of model calls a week, so the number of calls a page takes decides
          how fast those books become readable. This note is about how we decide that number, and what we found when we
          stopped testing one setting at a time.
        </p>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>Three settings</h2>
          <p className={P}>
            A first reading of a page is one call to Gemini Flash with the page image attached and our standard
            transcription instructions. Three settings shape that call. The first is how many pages go into it: one
            page, or four or eight consecutive pages of the same book read together, each returned between its own
            markers. More pages a call means fewer calls, unless the model drops or muddles a page, or the call is
            refused and every page in it has to be read again one at a time. The second is the size of the image. Our
            scans run from about 1,300 to 6,600 pixels on the long side, and a smaller image is quicker to send and to
            read, but small type may blur. The third is how long the model thinks before it answers: low, medium or
            high. Thinking costs time and may or may not help it read.
          </p>
          <p className={P}>
            Until this week we had tested these one at a time. For German print, a run on 24 pages compared reading 4
            pages a call with reading 4 and then correcting; a second run on 60 pages settled that the correction pass
            was not needed; a third compared 4 pages a call with 8 and with three cheaper engines. Each answered its own
            question. None could say whether 8 pages a call might work at a smaller image size, or whether more
            thinking would make 8 pages safe. Settings interact, and one-at-a-time tests cannot see interactions.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Fifteen runs instead of twenty-seven</h2>
          <p className={P}>
            Three settings at three levels each make 27 combinations. Reading the same 40 pages at all 27 would cost
            over a thousand calls a language. A Box-Behnken design, published by George Box and Donald Behnken in 1960,
            gets most of the same information from 15 runs: it reads the twelve combinations at the middle of each edge of the
            cube, where two settings sit at an extreme and the third in the middle, plus the centre three times. The
            three centre runs are identical, so the spread between them shows how much the result moves when nothing
            changes. A curved surface fitted through the 15 results then predicts all 27 combinations, including the
            corners nobody read.
          </p>
          <DesignCube />
          <p className={P}>
            We wrote the design down and committed it before the first call: the levels, the pages, what we would
            measure, and the rule for choosing. The rule was to take the setting with the fewest calls a page whose
            predicted error rate is no more than one percentage point above today&apos;s setting, at the edge of its 95
            percent interval, and only if it saves at least a tenth of the calls. Writing the rule first matters
            because there are many ways to read a surface after the fact, and some of them will always flatter a
            change.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>The same pages in every run</h2>
          <p className={P}>
            Every run read the same target page of the same 80 books: 40 German books whose text the Deutsches
            Textarchiv has typed by hand, and 40 Latin books typed by the CAMENA project. A human-typed edition of the
            page is what makes this a measurement of accuracy and not just of agreement between two machines: we count
            the characters the model got wrong against the typed page. Reading the same pages in every run is called
            blocking. It means the difference between two runs is the difference between two settings, not between two
            sets of pages, some harder than others.
          </p>
          <p className={P}>
            To test pages a call, each target page had its seven neighbours: at 8 pages a call the whole window went
            in one call, at 4 the target and three of its neighbours, at 1 the target alone. Only the target is
            scored; every page read counts in the calls. One page per book, so that one long book cannot dominate. And
            before any scoring, every target image was opened by eye beside its typed text: two Latin images turned out
            to show the leaf before or after the one the edition types, and those two books left every run.
          </p>
          <PageFigure
            src={`${IMG}/chladni-46-1024.jpg`}
            alt="Three lines of Fraktur from Chladni’s Entdeckungen über die Theorie des Klanges, page 46, as the model receives them when the page image is shrunk to 1,024 pixels on its long side."
            href={`${CHLADNI}?page=46`}
            source={<>Chladni, <em>Entdeckungen über die Theorie des Klanges</em> (1787), page 46</>}
          >
            Three lines of Chladni&apos;s 1787 treatise on sound, from a scan 3,996 pixels tall, as the model sees them
            when the whole page is shrunk to 1,024 pixels. Even at that size the letters are there. Below, the same
            lines at 2,400 pixels.
          </PageFigure>
          <PageFigure
            src={`${IMG}/chladni-46-2400.jpg`}
            alt="The same three lines of Fraktur from Chladni’s page 46 at 2,400 pixels on the long side."
            href={`${CHLADNI}?page=46`}
            source={<>Chladni, <em>Entdeckungen über die Theorie des Klanges</em> (1787), page 46</>}
          />
        </section>

        <section className="mb-16">
          <h2 className={H2}>Two phases, and when to stop</h2>
          <p className={P}>
            A test that might change how millions of pages are read deserves a large sample, and a test that will
            probably change nothing does not. Our German tests followed a staged pattern that we now use on purpose. The first phase is small: 30 pages, enough to tell
            whether a question is worth asking. In the first German run, reading 4 pages a call and then correcting
            was accepted on 23 of 24 written pages, judged by a second model against the page image. The second phase
            goes back to the same question with more pages only when the first leaves it open: reading 4 pages a call
            without the correction matched it page for page, but on 24 pages one disagreement each way was too few to
            decide, so the sample went to 60, where the cheaper reading held at 42 of 44. The third phase asked
            whether anything cheaper still would do and stopped where the answer was clear: two engines that run on
            our own graphics card read Fraktur so badly, 2 and 3 pages accepted of 18, that more pages could not have
            rescued them.
          </p>
          <p className={P}>
            This design used the same idea inside one experiment. On the first evening we decided that our earlier
            readings should count as prior knowledge, and that once the first runs were in, the next runs should go
            where the surface was least certain near the cheap end, instead of reading all fifteen. So after
            ten runs the order changed: the remaining runs were picked one batch at a time, by how much each would
            narrow the uncertainty about the settings that could save calls, and a language stopped when every such
            setting was decided one way or the other. The earlier readings turned out to be thin, 49 pages, all at one
            corner of the cube, so they shaped the surface only near that corner. Each change of plan was written into
            the record before the runs it governed, with the reason.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>What we found</h2>
          <RunsChart runs={RUNS} />
          <p className={P}>
            <strong>For German, nothing is cheaper than what we do now.</strong> Reading 8 pages a call should halve
            the calls, but Gemini cuts off more of the longer replies with its content filter, and every page of a cut
            call has to be read again one at a time. On our DTA pages, many of them from famous books such as{' '}
            <Link href={`${FAUST}?page=130`}><em>Faust</em></Link>, those cuts are frequent. At 8 pages a call German
            took 0.49 calls a page, against 0.46 for the live setting on the same account. (We read through two
            subscription accounts, and the filter cut more replies on one than on the other, so each comparison here is
            made on one account.) Image size made no difference to
            accuracy that we could measure: at 1,024 pixels the error rate was within a tenth of a point of the
            full-size image.
          </p>
          <p className={P}>
            <strong>For Latin, 8 pages a call at 1,600 pixels reads as well and takes fewer calls.</strong> Latin is
            cut far less often, so the larger calls keep their saving: 0.17 calls a page against 0.31 for the live
            setting, with an error rate 0.2 points higher, inside the margin we set (95 percent interval from −0.35 to
            +0.85 points). But not every 8-page setting is safe. At 1,024 pixels the Latin error rate rose by 1.8
            points and one page carried wrong text: eight small images in one call is too much shrinking for a Latin
            page set in small roman type, like the 1587 <Link href={`${GOTIBERIS}?page=20`}><em>Gotiberis</em></Link>.
            The fitted surface had smoothed that run away, which is why a setting that was actually read must also pass
            on its own measured difference.
          </p>
          <p className={P}>
            <strong>More thinking reads a little better and takes much longer.</strong> A 4-page call at medium
            thinking took two to four minutes, against under a minute at low, close to the five-minute limit the
            command line allows a call. Thinking cannot lower the number of calls directly, since the pages go in the
            same calls. But at high thinking, 8 Latin pages a call came out 0.4 points more accurate than today&apos;s
            setting and needed a third fewer calls than it on the same account: eight pages went into each call and
            few of those replies were cut off. Each page took about twice as long. That is the next setting to try on real pages.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>What went wrong on the way</h2>
          <p className={P}>
            Three things, each written into the record when it was found. The scoring script at first ate the text
            between two centred speaker names: Goethe&apos;s Margarethe was marked with arrows on either side, and the
            script read everything between one closing arrow and the next opening one as a tag. A perfect reading of
            the <Link href={`${FAUST}?page=130`}><em>Faust</em></Link> page scored an error rate of 88 percent until
            the bug was found. Then Gemini&apos;s refusals, which arrive as polite messages in place of a transcription,
            were at first scored as wrong text; they are now counted as pages not delivered, which is what they are.
            And on the second evening the first batch of runs at medium thinking timed out wholesale, because we had
            started too many calls at once on a machine that other jobs were also using. Those eight runs were thrown
            away, their calls counted against the budget, and the runs made again with fewer calls at a time.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>What changes</h2>
          <p className={P}>
            German keeps 4 pages a call. For Latin, the setting the design chose was then read on 30 new pages waiting
            in the queue, against today&apos;s setting on the same pages, and judged against the page images by a second
            model that did not know which reading was which. It did not hold. On the pages each reading would have
            written, today&apos;s setting was accepted on 12 of 12 and the new one on 13 of 14, but one of those 14
            carried wrong text: the page prints <em>indiga</em>, lacking, and the reading gave the commoner{' '}
            <em>indigna</em>, unworthy, which changes the sense of the line. One wrong word in fourteen pages is over
            the bar we set before the test, so nothing changes. It also showed how different the queue is from the
            test pages: more than half the drawn Latin pages could not be written by either setting: many quote Greek
            or Hebrew, which our checks hold back from this reader, and on others Gemini cut its reply short. The saving from 8 pages a call was
            smaller there too, 16 percent fewer calls rather than half.
          </p>
          <p className={P}>
            The full record, with the preregistration, the four amendments, every run and the code, is in{' '}
            <a href={RECORD}>the experiment file</a>. The method itself is the point of this note: decide the rule
            before the data, read the same pages in every run, measure against a text people typed, start small and
            grow only where the answer is still open, and write down every change of plan before it is used.
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
