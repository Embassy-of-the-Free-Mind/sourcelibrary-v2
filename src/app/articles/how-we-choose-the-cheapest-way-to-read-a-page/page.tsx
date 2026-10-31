import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import PageFigure from '@/components/articles/PageFigure';
import { DesignCube } from './Diagrams';
import a6 from '@/data/ocr-read-surface-6740-a6.json';

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
  'Reading a page uses part of a weekly allowance charged in tokens. We tested pages per call, image size and thinking together on German and Latin books with typed editions.';

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

// Every number in the results comes from src/data/ocr-read-surface-6740-a6.json, written by
// scripts/eval/read-surface-6740/export-a6.mjs from the analysis of every run (Amendment 6 of the experiment file).
type Cell = { name: string; live: boolean; delta_cer_pp: number; delta_lo: number; delta_hi: number; cer_pp: number; usd_per_1k_pages: number;
  usd_per_1k_accepted: number; cpa_lo: number; cpa_hi: number; saving_vs_live: number; saving_lo: number; saving_hi: number; non_inferior: boolean };
type Study = { books: number; cells: Cell[]; optimum: string | null };
type Lang = { books: number; weighted: Study | null; unweighted: Study };
type Conf = { n_drawn: number; planted: string; passes: boolean; routes: Record<string, { written: string; wrong_text: string; usd_1k_accepted: number }>; paired: { n: number; a_only: number; b_only: number; both: number } };
type Backlog = { week_of_quota_at_least_usd: number; rows: { lang: string; pages: number; books: number; best: string; usd_live: number; usd_best: number; weeks_live: number; weeks_best: number }[] };
const LANGS = a6.langs as unknown as Record<string, Lang>;
const study = (l: string) => LANGS[l]?.weighted ?? LANGS[l]?.unweighted;
const cell = (l: string, name: string) => study(l)?.cells.find((c) => c.name === name) as Cell;
const live = (l: string) => study(l)?.cells.find((c) => c.live) as Cell;
const CONF = (a6 as unknown as { confirmation_de: Conf }).confirmation_de;
const BACKLOG = (a6 as unknown as { backlog: Backlog | null }).backlog;
const CONF2 = (a6 as unknown as { confirmation_de2: { n_drawn: number; n: number; o_only: number; a_only: number; wt: number } }).confirmation_de2;
const usd = (v: number) => `$${v < 20 ? v.toFixed(2) : Math.round(v).toLocaleString('en-GB')}`;
const pp = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
const pct = (v: number) => `${Math.round(100 * Math.abs(v))} percent`;
const times = (a: number, b: number) => `${(a / b).toFixed(1)} times`;
const n = (v: number) => v.toLocaleString('en-GB');

export default function CheapestReadPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="Every page we read uses part of a weekly allowance, charged by the tokens a model reads and writes. Two settings decide most of that cost. We tested them together, against human-typed editions of the same pages."
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">31 October 2026 &middot; 12 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Page 25 of Johann Rudolph Glauber&apos;s <Link href={`${GLAUBER}?page=25`}><em>Furni Novi Philosophici</em></Link>,
          printed in 1649, explains why Mercurius will not stay with gold and silver in the fire. Until a model reads
          it, the page is a picture: you can look at it, but you cannot search it, quote it or have it translated.
          About 24,000 books on the site are pictures only, several million pages. We read them through a
          subscription whose weekly allowance is used up by the tokens each call consumes: the images and instructions the
          model reads, and everything it writes back, including the reasoning it does before it answers. So the question
          is not how many calls a page takes but how much of the allowance it uses, and how to spend less of it without
          reading any worse. This note is about how we found out, and what we found when we stopped testing one setting at
          a time.
        </p>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>What a page costs</h2>
          <p className={P}>
            We price each page by the model&apos;s own count of the tokens its calls used, at Google&apos;s list price for Gemini
            Flash: a dollar figure that stands for a share of the allowance, not money we pay per page. Today we read 4
            consecutive pages in one call with the model thinking as little as it can. That costs {usd(live('de').usd_per_1k_accepted)} for
            every 1,000 German pages it reads acceptably. The chart below shows all nine combinations of pages per call and
            thinking that we tested, by cost and by error rate. The error rate barely moves; the cost moves 25-fold.
          </p>
          <PageFigure src={`${IMG}/f7-efficiency-frontier.png`} alt="Two charts, German and Latin, of error rate against cost for nine reading settings. The error rate is nearly flat; cost ranges over a factor of about 25. Reading 8 pages a call with low thinking is the cheapest German setting." >
            Error rate (character error rate against a typed edition) against cost a 1,000 accepted pages, for the nine
            settings, German ({study('de')?.books} books) and Latin ({study('la')?.books} books), 31 October 2026. Orange: today&apos;s setting. Blue line:
            settings no other beats on both.
          </PageFigure>
          <p className={P}>
            For German, reading 8 pages a call at low thinking costs {usd(cell('de', '8 a call, low').usd_per_1k_accepted)} a 1,000 accepted pages,{' '}
            {pct(cell('de', '8 a call, low').saving_vs_live)} less than today (95 percent interval {pct(cell('de', '8 a call, low').saving_lo)} to {pct(cell('de', '8 a call, low').saving_hi)}), with an
            error rate {pp(cell('de', '8 a call, low').delta_cer_pp)} points from today&apos;s. Letting the model think more costs{' '}
            {times(cell('de', '4 a call, high').usd_per_1k_accepted, live('de').usd_per_1k_accepted)} as much at high and changes the German error rate by less than a tenth of a point.
            {BACKLOG && BACKLOG.rows.find((r) => r.lang === 'de') && (() => { const r = BACKLOG.rows.find((x) => x.lang === 'de')!; return <> The {n(r.books)} German books waiting to be read hold {n(r.pages)} pages. At today&apos;s
            setting that is about {usd(r.usd_live)} of allowance; at 8 pages a call about {usd(r.usd_best)}.</>; })()}
          </p>
          {BACKLOG && <PageFigure src={`${IMG}/f8-backlog.png`} alt="Bar chart: the allowance needed to read the waiting German and Latin pages at today's setting and at the cheapest setting that reads as well." >
            The allowance needed to give the waiting German and Latin pages a first reading, at today&apos;s setting and at the cheapest
            setting that reads as well. Page counts measured 31 October 2026.
          </PageFigure>}
        </section>

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
            measure, and the rule for choosing. The rule was to take the setting with the fewest calls a page (later corrected to the least allowance a page) whose
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
          <h2 className={H2}>Fewer settings, more books</h2>
          <p className={P}>
            After the first fifteen runs we changed the design, and wrote down why before reading another page. First, the
            cost: we had been counting calls, and the allowance counts tokens. A model that thinks hard makes the same number
            of calls but writes several thousand tokens of reasoning for every page, so the setting that looked cheapest by
            calls was among the dearest by tokens. Second, the books: forty books a language are few to speak for thousands.
            Third, we asked which settings were worth testing at all. From the runs already made we simulated how large an
            effect the next test could detect, and dropped what fell below it: image size, whose effect on accuracy was a
            few hundredths of a point, and a one-line hint in the instructions about the long s, which no earlier test of our
            prompts had found to matter.
          </p>
          <p className={P}>
            That left two settings, pages per call and thinking, at three levels each: nine combinations. Instead of reading
            the same 40 books nine times, we read every book that has a typed edition we can match to our scan, {LANGS.de?.books} German
            and {LANGS.la?.books} Latin, each at today&apos;s setting and at three of the other eight, so that every pair of settings
            shares about the same number of books. Each comparison is still made within a book. The results were weighted so
            that each era and typeface counts as much as it does among the books waiting to be read.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>What we found</h2>
          <PageFigure src={`${IMG}/f4-feasible-cost.png`} alt="Contour maps of cost a 1,000 accepted pages over pages a call and thinking, German and Latin, with the settings whose error rate is not shown to be within one point of today's hatched." >
            Cost a 1,000 accepted pages over pages per call and thinking. Hatched: settings whose error rate could be more than
            1 point above today&apos;s (upper end of the 95 percent interval). Orange diamond: today. Blue star: the cheapest setting that reads as well.
          </PageFigure>
          <p className={P}>
            <strong>Thinking is the expensive setting.</strong> At 4 pages a call, medium thinking costs{' '}
            {times(cell('de', '4 a call, medium').usd_per_1k_accepted, live('de').usd_per_1k_accepted)} as much as low for German and{' '}
            {times(cell('la', '4 a call, medium').usd_per_1k_accepted, live('la').usd_per_1k_accepted)} for Latin. It buys nothing measurable in German. In Latin it
            lowers the error rate by {Math.abs(cell('la', '4 a call, medium').delta_cer_pp).toFixed(1)} points ({pp(cell('la', '4 a call, medium').delta_lo)} to {pp(cell('la', '4 a call, medium').delta_hi)}), a real gain at
            a price we do not pay for a first reading that a correction pass follows.
          </p>
          <p className={P}>
            <strong>For German, 8 pages a call is the cheapest setting that reads as well.</strong> Its error rate is{' '}
            {pp(cell('de', '8 a call, low').delta_cer_pp)} points from today&apos;s (95 percent interval {pp(cell('de', '8 a call, low').delta_lo)} to {pp(cell('de', '8 a call, low').delta_hi)}), and it holds in every
            century with enough books to tell. Our first run, which counted calls, had said the opposite: Gemini cuts off
            more of the longer replies, and each cut call is paid for. Counted in tokens, the larger calls still win.
          </p>
          <p className={P}>
            <strong>For Latin, today&apos;s setting stays.</strong> 8 pages a call would cost{' '}
            {pct(cell('la', '8 a call, low').saving_vs_live)} less, but its error rate rises by {pp(cell('la', '8 a call, low').delta_cer_pp)} points ({pp(cell('la', '8 a call, low').delta_lo)} to{' '}
            {pp(cell('la', '8 a call, low').delta_hi)}), over the one point we allowed. The cause is visible on the page: with eight images in one
            call, the model reads the long s of a 17th-century Latin page as an f.
          </p>
          <PageFigure src={`${IMG}/f6-corners.jpg`} alt="Two scanned pages, one German in Fraktur and one Latin in roman type, each beside three readings of its first lines with the words that differ from the typed edition highlighted." wide>
            The first lines of a German page (Rohr, <em>Einleitung zur Ceremoniel-Wissenschaft</em>, 1729, p. 697; Internet Archive,
            public domain) and a Latin page (Rossi, <em>Pinacotheca imaginum</em>, p. 18; Internet Archive, CC0), read at three settings.
            Highlighted: words that differ from the typed edition. The German readings differ in two or three spellings; at 8 pages a call the Latin reading turns long s into f.
          </PageFigure>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Checking on real pages</h2>
          <p className={P}>
            The books with typed editions are not the books waiting to be read, and their texts are on the open web, where a
            model may have seen them. So before anything changes, the German result was tried on {CONF?.n_drawn} pages from {CONF?.n_drawn} books
            in the queue, drawn so that each era counts as it does there, read both ways as the reading lane would, and judged
            against the page image by a second model that did not know which reading was which.
          </p>
          {CONF && <p className={P}>
            Of the pages each setting would have written, today&apos;s setting was accepted on {CONF.routes['agy-flash-low@4']?.written} and 8 pages
            a call on {CONF.routes['agy-flash-low@8']?.written}. Page for page, 8 pages a call was the better reading {CONF.paired.a_only} times and never the worse. It
            cost {usd(CONF.routes['agy-flash-low@8']?.usd_1k_accepted)} a 1,000 accepted pages against {usd(CONF.routes['agy-flash-low@4']?.usd_1k_accepted)}. But
            {' '}{CONF.routes['agy-flash-low@8']?.wrong_text.split('/')[0]} of its {CONF.routes['agy-flash-low@8']?.wrong_text.split('/')[1]} pages carried a word that changes the sense, such as <em>Menge</em>, a crowd,
            where the page prints <em>Metzge</em>, a slaughter. Today&apos;s setting made the same misreadings on those pages, and
            three more. The rule we wrote before the test set a fixed ceiling on such pages, and both settings are over it,
            so {CONF.passes ? 'the change passes' : 'nothing changes yet'}. Whether the bar should be today&apos;s own error rate, as our newer rule
            for comparing readings says, is a decision for a person, not for the test.
          </p>}
          <p className={P}>
            Because that rule was written before we saw it fail both settings, we wrote a second one that compares 8 pages a
            call with today&apos;s reading directly, and tried it on {CONF2.n_drawn} new books, drawn so that each era and typeface counts as it
            does in the queue. Page for page, 8 pages a call was the better reading on {CONF2.o_only} books and the worse on {CONF2.a_only}. Both
            settings misread a word that changes the sense on {CONF2.wt} of {CONF2.n} pages, and 8 pages a call cost half as much for each page it read
            acceptably. It still did not pass: on one page the judge called a misread phrase &ldquo;invented&rdquo; for 8 pages a call and
            &ldquo;added&rdquo; for today&apos;s setting, which made exactly the same misreading, and our rule allows no invented text at all.
            Whether to read that word as written is, again, for a person to decide.
          </p>
          <p className={P}>
            One finding stands on its own. On these hundred waiting pages, today&apos;s German reading put at least one
            sense-changing misreading on 8 of the 70 pages it wrote (about 11 percent, between 6 and 21 at 95 percent confidence).
            That is what readers of a first German reading should expect until a correction pass has been over it.
          </p>
          <p className={P}>
            The accepted readings of those queue pages were not thrown away: the better one of each, where a page had one,
            is now its text in the library.
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
            away, their calls counted against the budget, and the runs made again with fewer calls at a time. On the
            last day two more. Our own image server had begun sending a recompressed copy of half the scans, so a run
            would no longer have read the same bytes as the runs before it; the originals now come straight from storage
            and are checked against the earlier runs byte for byte. And a daily limit on calls to the most expensive
            thinking level, set after one job had once locked the allowance for days, stopped two runs halfway; they were
            finished under a raised limit, written into the record.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>What changes</h2>
          <p className={P}>
            For now, nothing: both languages keep 4 pages a call at low thinking. The German change waits on a person&apos;s
            decision about the bar, which two tests on real pages now put plainly. What has changed is how we count: a reading setting is now judged by the tokens it uses for each
            page it reads acceptably, not by its calls, and every test reads as many books as have a typed edition rather
            than a fixed forty.
          </p>
          <p className={P}>
            The full record, with the preregistration, the six amendments, every run, the code and the dataset, is in{' '}
            <a href={RECORD}>the experiment file</a>. The method is the point of this note: decide the rule before the data,
            read the same books under every setting you compare, measure against a text people typed, count the cost the way
            it is charged, start small and grow only where the answer is still open, and write down every change of plan
            before it is used.
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
