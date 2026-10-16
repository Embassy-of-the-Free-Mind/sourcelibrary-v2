import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import { GradeRules, NotEnoughEvidence, ParetoPresentation, ParetoSummary, RosterTable, TRANSLATION } from '../ParetoCharts';

// Quality against price or time, per script (OCR) and per language (translation) (#5983, rebuilt in #6386, laid out
// around the decision in #6524, drawn as model-comparison scatters in #6776). The reader: someone at a desk choosing
// which model to run on a script or a language. They want, per chart, which engines sit on the frontier, which of
// those we can run today, and whether the chart is about reading the page or translating it. So the page opens with
// what we can run, then two separate halves (OCR, translation), each with its definition, its summary rows, one
// scatter per script or language, and its thin panels folded away; the method comes last.
// Every number is read at build time from src/data/ocr-pareto.json, src/data/translation-pareto.json and
// src/data/model-roster.json.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'OCR and Translation: Quality Against Price and Time | Source Library',
  description:
    'For each script we read and each language we translate: every engine we measured, plotted by quality against price per 1,000 pages or seconds a page, with the frontier, the engine in use, and which engines we can run today.',
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
          <h1 className="font-serif text-4xl md:text-5xl text-stone-900 mt-2">Which engine to run: quality against price and time</h1>
          <p className="text-lg text-stone-700 leading-relaxed mt-4">
            One chart per script and per language. Each dot is an engine we measured: higher reads or translates better,
            further left costs less or runs faster. The line is the frontier, the engines nothing else beats on both.
            Filled dots are engines we can run today; hollow ones we cannot.
          </p>
          <p className="text-base text-stone-600 mt-3">
            <a href="#roster" className={LINK}>What we can run today</a> {'·'} <a href="#ocr" className={LINK}>Transcription (OCR)</a> {'·'}{' '}
            <a href="#translation" className={LINK}>Translation</a> {'·'} <a href="#method" className={LINK}>Method and grades</a>
          </p>
        </header>

        <section id="roster" className="mt-10 scroll-mt-16 max-w-4xl">
          <h2 className="font-serif text-2xl text-stone-900 mb-2">What we can run today</h2>
          <RosterTable />
        </section>

        <section id="ocr" className="mt-16 scroll-mt-16">
          <h2 className="font-serif text-3xl md:text-4xl text-stone-900">Transcription (OCR)</h2>
          <p className="text-lg text-stone-700 mt-2 max-w-3xl">
            Reading the page image into text, scored as character accuracy against a typed transcription.
          </p>
          <div className="mt-6"><ParetoSummary /></div>
          <ParetoPresentation />
          <NotEnoughEvidence />
        </section>

        <section id="translation" className="mt-20 scroll-mt-16">
          <h2 className="font-serif text-3xl md:text-4xl text-stone-900">Translation</h2>
          <p className="text-lg text-stone-700 mt-2 max-w-3xl">
            Turning that text into English, scored on the 1 to 5 fidelity scale by blind AI judges (Claude Opus) against
            published translations.
          </p>
          <div className="mt-6"><ParetoSummary m={TRANSLATION} /></div>
          <ParetoPresentation m={TRANSLATION} />
          <NotEnoughEvidence m={TRANSLATION} />
        </section>

        <section id="method" className="max-w-3xl mt-16 text-stone-700 leading-relaxed space-y-3 scroll-mt-16">
          <h2 className="font-serif text-3xl text-stone-900">How these are measured</h2>
          <p>
            <strong className="text-stone-900">Transcription.</strong> Accuracy is one minus the character error rate against a
            typed text of the page, averaged over the pages, each page&rsquo;s error capped at 100%. Accuracy is measured
            only on pages an engine actually read. A page it refused, left empty, or declined to copy because it
            recognised a published text is not scored; the table counts those pages separately as &ldquo;did not
            read&rdquo;. &ldquo;Over half wrong&rdquo; counts the pages it read with more than half the characters wrong.
          </p>
          <p>
            <strong className="text-stone-900">Translation.</strong> Fidelity is a mean score from 1 to 5 given by blind
            Claude Opus judges, who read our English beside a published human translation of the page. It is model-judged:
            the judges have not yet been checked against human ratings (<a href={`${GH}issues/6203`} className={LINK}>#6203</a>).
            Scores from different judging rounds are never compared.
          </p>
          <p>
            <strong className="text-stone-900">The frontier.</strong> An engine is on the frontier when no other engine on
            the same pages is both at least as good and at least as cheap (or fast), and better on one. The grey line
            runs through every engine measured; the solid line only through the ones we can run today. The frontier is
            drawn from the averages, so two dots close together may not differ: the whiskers are each engine&rsquo;s 95%
            interval, and only the verdict sentence says whether a difference is real. A run not fit to rank draws no line.
          </p>
          <p>
            <strong className="text-stone-900">Against the engine we use.</strong> For each engine, the average difference
            per page from the engine in use on the same pages (a page stays in when an engine fails on it), with a 95%
            interval that resamples whole works, so the pages
            of one work count as one. Where the engine in use was run twice the same way, a difference must also be larger
            than the spread between its two runs (the shaded band on a plot); where the two runs disagree outright, the
            verdict is withheld. Every section says whether this rerun noise was measured.
            Only a Decide section calls an engine better or worse; a Directional one says what the evidence points toward.
            &ldquo;Within the margin&rdquo; means the whole interval lies within 1 point a page (transcription) or 0.10 on
            the 1 to 5 scale (translation) of the engine in use; one margin per measure, never tuned per chart.
          </p>
          <p>
            <strong className="text-stone-900">Price.</strong> Dollars billed per 1,000 pages: Gemini at its metered Batch
            rate, other APIs at their billed rate, rented GPUs at the whole rental shared by running time. A run through a
            command-line tool on our subscription is billed nothing; it is placed at the API price for the same requests,
            for comparison only, and marked &dagger;. An engine with no price on record is listed under the chart instead.
          </p>
          <p>
            <strong className="text-stone-900">Time.</strong> Many of these runs went through command-line tools on our
            subscriptions, where a page costs time and quota rather than dollars. The time view plots the median seconds a
            page, taken from each run&rsquo;s own meter on those pages. A run that did not time its pages is listed under
            the chart as not measured; no time is estimated.
          </p>
          <p>
            <strong className="text-stone-900">Available today.</strong> Whether we can run an engine now, and by which
            route, is read from the rules in the repository (the paid Gemini API runs Flash-Lite only; other Gemini models
            run through the Antigravity command-line tool if it still offers them; Claude runs only on the Claude
            subscription; open models on a leased GPU; Tesseract is not used) and from a recorded list of the models the
            command-line tool offers. Each engine&rsquo;s row names its source.
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
