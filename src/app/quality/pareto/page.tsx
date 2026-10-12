import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import { GradeRules, NotMeasured, ParetoPresentation, ParetoSummary, TRANSLATION } from '../ParetoCharts';

// Cost against quality, per script (OCR) and per language (translation) (#5983, rebuilt in #6386, laid out
// around the decision in #6524). Two readers, both in a hurry: whoever runs the pipeline ("should we switch engines
// for this script, and is it worth the cost?") and a scholar or partner ("how far can I trust my language?"). So the
// page opens with one summary row per script and per language, each section leads with its verdict sentence and a
// plot of differences from the engine in use, what cannot be ranked is one list, and the method comes last.
// Every number is read at build time from src/data/ocr-pareto.json and src/data/translation-pareto.json.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'OCR and Translation Cost Against Quality | Source Library',
  description:
    'For each script we read and each language we translate: what each engine costs per 1,000 pages, how well it does against a typed text or a published translation, whether it is measurably better than the engine we use, and how far the evidence can be trusted.',
  alternates: { canonical: '/quality/pareto' },
};

const LINK = 'text-amber-800 underline decoration-amber-800/30 underline-offset-2 hover:decoration-amber-800';
const GH = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/';

export default function ParetoPage() {
  return (
    <ContentPageLayout header={<SiteHeader variant="light" />} bg="bg-cream" maxWidth="wide">
      {/* Exempt from the site's scroll reveal (ScrollReveal.tsx): a full-page capture or a print otherwise shows
          blank space where the charts should be (#6217). */}
      <div data-reveal-skip="">
        <header className="max-w-3xl">
          <p className="text-sm uppercase tracking-wider text-stone-600">
            <Link href="/quality" className="hover:text-amber-800">Quality Center</Link>
          </p>
          <h1 className="font-serif text-4xl md:text-5xl text-stone-900 mt-2">What it costs to read and translate a page, and how well</h1>
          <p className="text-lg text-stone-700 leading-relaxed mt-4">
            For each script and each language: is any engine clearly better than the one we use, by how much, and at
            what cost? The two tables answer that. The detail for each row is below them.
          </p>
          <p className="text-base text-stone-600 mt-3">
            <a href="#ocr" className={LINK}>Reading in detail</a> {'·'} <a href="#translation" className={LINK}>Translating in detail</a> {'·'}{' '}
            <a href="#not-measured" className={LINK}>Not measured yet</a> {'·'} <a href="#method" className={LINK}>Method and grades</a>
          </p>
        </header>

        <section id="summary" className="mt-10 scroll-mt-16">
          <h2 className="font-serif text-2xl text-stone-900 mb-2">Reading the page (OCR)</h2>
          <ParetoSummary />
          <h2 className="font-serif text-2xl text-stone-900 mt-10 mb-2">Translating it into English</h2>
          <ParetoSummary m={TRANSLATION} />
          <p className="text-sm text-stone-600 mt-4 max-w-3xl">
            Gain is the average difference per page from the engine in use, on the same pages. Cost compares billed
            prices per 1,000 pages. <a href="#method" className={LINK}>What the grades mean</a>.
          </p>
        </section>

        <h2 id="ocr" className="font-serif text-3xl text-stone-900 mt-16 scroll-mt-16">Reading the page: each script in detail</h2>
        <ParetoPresentation />
        <h2 id="translation" className="font-serif text-3xl text-stone-900 mt-16 scroll-mt-16">Translating into English: each language in detail</h2>
        <ParetoPresentation m={TRANSLATION} />

        <section id="not-measured" className="mt-16 scroll-mt-16">
          <h2 className="font-serif text-3xl text-stone-900 mb-3">Not measured well enough yet</h2>
          <NotMeasured />
        </section>

        <section id="method" className="max-w-3xl mt-16 text-stone-700 leading-relaxed space-y-3 scroll-mt-16">
          <h2 className="font-serif text-3xl text-stone-900">How these are measured</h2>
          <p>
            <strong className="text-stone-900">Reading.</strong> Accuracy is one minus the character error rate against a
            typed text of the page, averaged over the pages, each page&rsquo;s error capped at 100%. A refused, empty or
            unplaceable read counts as 100% error, for every engine alike. &ldquo;Over half wrong&rdquo; counts those pages.
          </p>
          <p>
            <strong className="text-stone-900">Translating.</strong> Fidelity is a mean score from 1 to 5 given by blind
            Claude Opus judges, who read our English beside a published human translation of the page. It is model-judged:
            the judges have not yet been checked against human ratings (<a href={`${GH}issues/6203`} className={LINK}>#6203</a>).
            Scores from different judging rounds are never compared.
          </p>
          <p>
            <strong className="text-stone-900">Against the engine we use.</strong> For each engine, the average difference
            per page from the engine in use on the same pages (a page stays in when an engine fails on it), with a 95%
            interval that resamples whole works, so the pages
            of one work count as one. Where the engine in use was run twice the same way, a difference must also be larger
            than the spread between its two runs (the shaded band on a plot); where the two runs disagree outright, the
            verdict is withheld.
            Only a Decide section calls an engine better or worse; a Directional one says what the evidence points toward.
            &ldquo;Within the margin&rdquo; means the whole interval lies within 1 point a page (reading) or 0.10 on the 1
            to 5 scale (translating) of the engine in use; one margin per measure, never tuned per chart.
          </p>
          <p>
            <strong className="text-stone-900">Cost.</strong> Dollars billed per 1,000 pages: Gemini at its metered Batch
            rate, other APIs at their billed rate, rented GPUs at the whole rental shared by running time. A run through a
            command-line tool on our subscription is billed nothing, so its row says &ldquo;$0 via subscription&rdquo;;
            the table under each plot also gives the API price for the same requests. An engine with no billed price
            on record says &ldquo;no price&rdquo;.
          </p>
          <div>
            <p><strong className="text-stone-900">Grades.</strong></p>
            <GradeRules />
          </div>
          <p>
            Some Latin and Early English references were found by matching our own engine&rsquo;s reading, which favours that
            engine; those pages are shown apart and graded not fit. What the sample check found:{' '}
            <Link href="/quality#chart-limits" className={LINK}>limits of these charts</Link>.{' '}
            <a href={`${GH}blob/main/scripts/eval/build-ocr-pareto.mjs`} className={LINK}>Source code</a>.
          </p>
        </section>
      </div>
    </ContentPageLayout>
  );
}
