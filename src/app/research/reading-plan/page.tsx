import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

// The reading plan: what it costs to read every book we hold, how quality comes first, and the open questions.
// Linked from /vision (year 1 and the budget footnote) and from the quality pages.
// Figures measured 2026-10-06. The derivation, with the queries behind each number, is in the private ops repo,
// costs/2026-10-06-production-cost-model.md. Update AS_OF and the figures together.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'The Reading Plan — Source Library Research',
  description:
    'What it costs to transcribe and translate every book Source Library holds, at three levels of quality, how each kind of page gets its engine, and the questions still open.',
  alternates: { canonical: '/research/reading-plan' },
};

const AS_OF = '6 October 2026';
const ISSUE = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/';

const LEVELS = [
  {
    name: 'One read, cheapest engine',
    how: 'Gemini Flash-Lite transcribes the page and translates it.',
    perThousand: '$2.20',
    perBook: '$0.60',
    finish: '$40,000',
    perHundredK: '$59,000',
  },
  {
    name: 'One read, stronger engine',
    how: 'Gemini Flash transcribes and translates.',
    perThousand: '$3.90',
    perBook: '$1.00',
    finish: '$69,000',
    perHundredK: '$103,000',
  },
  {
    name: 'Two reads, disagreements re-read',
    how: 'Flash reads the page and Flash-Lite reads it again. Where the two disagree, a stronger model reads the page and translates it.',
    perThousand: '$6.70',
    perBook: '$1.80',
    finish: '$118,000',
    perHundredK: '$176,000',
  },
];

const QUESTIONS: { n: number; q: string; a: string; status: 'running' | 'planned' | 'answered' }[] = [
  {
    n: 5924,
    q: 'Which engine reads Latin print best, century by century?',
    a: 'Latin is the largest share of what is left: about 7.5 million pages, mostly printed 1500–1700. Earlier tests found Flash only 0.3 points better than Flash-Lite on 1600s print, but much better on the earliest printed books. An open model (GLM-OCR) looked better still on 1600s print, on too few pages to decide. The test now under way reads random runs of three pages from random books in each century with every candidate. It scores them against published transcriptions of the same editions, with old letterforms normalized.',
    status: 'running',
  },
  {
    n: 5924,
    q: 'Is the strongest model worth its price?',
    a: 'Gemini Pro costs roughly five to ten times as much as Flash per page and has never been measured on our pages. The same test reads the earliest books and a random set of 1600s books with it. The answer sets the cost of the third level above.',
    status: 'running',
  },
  {
    n: 5313,
    q: 'How often do two reads of a page disagree?',
    a: 'The third level assumes 5% of pages need the stronger model. That rate is an estimate, not yet a measurement. A cheap per-page disagreement score is planned, and it would also flag garbled pages to readers.',
    status: 'planned',
  },
  {
    n: 5695,
    q: 'Does a better transcription change the English?',
    a: 'On ten random Latin pages printed after 1500, the transcription caused no translation error. In books printed before 1500 it did, through abbreviations: correcting the transcription raised the English from 2.5 to 5 of 5 on one page. So the money goes first to the oldest and hardest pages.',
    status: 'answered',
  },
  {
    n: 5660,
    q: 'Should we run our own GPU server?',
    a: 'Open engines on our own hardware already read Tibetan, where Gemini fails, and Chinese hand-copied books. A standing server costs about $250 a month. Whether it is worth that depends on the Latin answer above, because Latin is the only lane big enough to keep it busy.',
    status: 'running',
  },
  {
    n: 5730,
    q: 'Can we train our own models on the pages already corrected?',
    a: 'Latin long-s, Tibetan, Syriac, Persian and Chinese, in short GPU runs.',
    status: 'planned',
  },
];

const STATUS = {
  running: { label: 'In progress', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  planned: { label: 'Not started', className: 'bg-stone-100 text-stone-600 border-stone-200' },
  answered: { label: 'Answered', className: 'bg-amber-50 text-amber-800 border-amber-200' },
} as const;

export default function ReadingPlanPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The reading plan"
          subtitle="What it costs to read every book we hold, how quality comes first, and what we still need to find out"
        >
          <p className="text-stone-400 text-sm mt-4">
            Figures as of {AS_OF} &middot; part of the <Link href="/vision" className="underline hover:text-stone-200">five-year plan</Link>
          </p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="max-w-3xl">
        <section className="border-l-2 border-accent-rust pl-5 md:pl-6 mb-10">
          <h2 className="text-xs uppercase tracking-[0.16em] text-muted font-semibold mb-4">Where we are</h2>
          <p className="text-secondary leading-relaxed mb-4">
            Source Library holds about 93,000 scanned books. Nearly 20,000 of them can be read in English today. The rest
            come to about 16 million pages still to be transcribed and 18 million still to be translated. Most of those
            books are not yet on the public shelves; they go up as they become readable.
          </p>
          <p className="text-secondary leading-relaxed">
            Every page goes through two steps: the scan is transcribed, then the transcription is translated. A page can
            only be as good as its transcription. In our measurements, most of the worst English started with a misread, so
            the plan spends most on reading pages well.
          </p>
        </section>

        <section id="cost" className="mb-12 scroll-mt-24">
          <h2 className="text-xl md:text-2xl text-primary mb-2 text-balance border-t-2 border-stone-800 pt-4">Three levels of quality, and what each costs</h2>
          <p className="text-muted leading-relaxed mb-4">
            Machine cost only, at the batch rates we pay today, with 15% added for retries and failed pages. An average book
            has about 265 pages.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[36rem]">
              <thead>
                <tr className="text-left text-muted border-b border-stone-300">
                  <th className="py-2 pr-3 font-semibold">Level</th>
                  <th className="py-2 px-3 font-semibold text-right">Per 1,000 pages</th>
                  <th className="py-2 px-3 font-semibold text-right">Per book</th>
                  <th className="py-2 px-3 font-semibold text-right">Everything we hold</th>
                  <th className="py-2 pl-3 font-semibold text-right">Each 100,000 new books</th>
                </tr>
              </thead>
              <tbody>
                {LEVELS.map(l => (
                  <tr key={l.name} className="border-b border-stone-200 align-top">
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-primary">{l.name}</div>
                      <div className="text-secondary mt-1">{l.how}</div>
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums">{l.perThousand}</td>
                    <td className="py-3 px-3 text-right tabular-nums">{l.perBook}</td>
                    <td className="py-3 px-3 text-right tabular-nums font-semibold">{l.finish}</td>
                    <td className="py-3 pl-3 text-right tabular-nums">{l.perHundredK}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-secondary leading-relaxed mt-4">
            <strong>Re-reading what is already done.</strong> About 9 million pages have a transcription and 6 million a
            translation, a little over a third of them from the cheapest engine. Re-reading those on the stronger engine
            costs about $15,000. Re-reading them with two reads and disagreements re-read costs about $31,000.
          </p>
          <p className="text-secondary leading-relaxed mt-4">
            Not included: picking out illustrations, search indexing, servers and human review. Those are in the{' '}
            <Link href="/vision" className="text-accent-rust hover:underline">five-year budget</Link>, which sets aside 2.3
            cents a page so that every book can be read more than once as models improve.
          </p>
        </section>

        <section id="choosing" className="mb-12 scroll-mt-24">
          <h2 className="text-xl md:text-2xl text-primary mb-2 text-balance border-t-2 border-stone-800 pt-4">Quality first: the best engine for each kind of page</h2>
          <p className="text-secondary leading-relaxed mb-4">
            No engine is best everywhere. We choose one for each kind of page by measuring. Pages are drawn at random, one
            run per book, and scored against published transcriptions and translations of the same edition. An engine
            replaces the current one only when it is better by more than the difference between two runs of the same
            engine.
          </p>
          <ul className="list-disc pl-5 space-y-2 text-secondary leading-relaxed">
            <li>On Latin printed in the 1600s the stronger engine is barely better, so the cheaper one is good enough.</li>
            <li>On books printed before 1500 the stronger engine made about a third as many errors in a small first test, so those pages get it while the test is repeated on more books.</li>
            <li>On Tibetan, an open engine running on our own hardware reads pages where Gemini invents text.</li>
          </ul>
          <p className="text-secondary leading-relaxed mt-4">
            So we expect the real cost of a quality-first plan to land between the second and third levels above. The third is
            the ceiling.
          </p>
        </section>

        <section id="questions" className="mb-12 scroll-mt-24">
          <h2 className="text-xl md:text-2xl text-primary mb-2 text-balance border-t-2 border-stone-800 pt-4">Open questions</h2>
          <p className="text-muted leading-relaxed mb-2">Each links to its public issue, which is the current record.</p>
          <ul>
            {QUESTIONS.map((it, i) => (
              <li key={`${it.n}-${i}`} className="grid grid-cols-[1fr_auto] md:grid-cols-[4.5rem_1fr_auto] gap-x-4 gap-y-1 py-4 border-b border-stone-200 items-baseline">
                <a href={`${ISSUE}${it.n}`} className="font-mono text-sm text-accent-rust hover:underline">#{it.n}</a>
                <div className="col-span-2 md:col-span-1 md:col-start-2 row-start-2 md:row-start-1 min-w-0">
                  <div className="font-semibold text-primary">{it.q}</div>
                  <p className="text-secondary text-[0.95rem] leading-relaxed mt-1">{it.a}</p>
                </div>
                <div className="col-start-2 md:col-start-3 row-start-1 justify-self-end">
                  <span className={`inline-block whitespace-nowrap rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${STATUS[it.status].className}`}>
                    {STATUS[it.status].label}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-sm text-muted">
          How quality is measured, and what we know is still wrong:{' '}
          <Link href="/research/quality" className="text-accent-rust hover:underline">the working paper</Link> and{' '}
          <Link href="/research/quality/open" className="text-accent-rust hover:underline">open quality work</Link>.
        </p>
      </article>
    </ContentPageLayout>
  );
}
