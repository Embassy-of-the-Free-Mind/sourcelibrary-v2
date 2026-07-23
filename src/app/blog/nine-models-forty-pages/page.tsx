import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Nine Models, Forty Pages - Research Notes - Source Library',
  description:
    "We benchmarked every OCR-capable model we could reach — Google's newest releases, three open-weight challengers, one self-hosted — on the same forty historical pages. The newest budget model lost to its own predecessor.",
  openGraph: {
    images: [
      {
        url: 'https://images.sourcelibrary.org/archived/69a5e9bb787d6e9b8d42e183/120.jpg',
        alt: "Page 109 of Eznik of Kołb's Ełc ałandoc' in the 1826 Venice printing — the Armenian page most models in our benchmark could not read.",
      },
    ],
    title: 'Nine Models, Forty Pages',
    description:
      "We benchmarked every OCR-capable model we could reach on the same forty historical pages. Google's newest budget model lost to its own predecessor.",
  },
  twitter: {
    card: 'summary_large_image',
    images: [
      {
        url: 'https://images.sourcelibrary.org/archived/69a5e9bb787d6e9b8d42e183/120.jpg',
        alt: "Page 109 of Eznik of Kołb's Ełc ałandoc' in the 1826 Venice printing.",
      },
    ],
  },
  alternates: {
    canonical: '/blog/nine-models-forty-pages',
  },
};

function ResultRow({
  model,
  delta,
  ci,
  record,
  p,
  note,
}: {
  model: string;
  delta: string;
  ci: string;
  record: string;
  p: string;
  note?: string;
}) {
  return (
    <tr className="border-b border-stone-200">
      <td className="py-2 pr-4 font-mono text-sm">{model}</td>
      <td className="py-2 pr-4 text-right font-mono text-sm">{delta}</td>
      <td className="py-2 pr-4 text-right font-mono text-sm text-muted">{ci}</td>
      <td className="py-2 pr-4 text-right font-mono text-sm">{record}</td>
      <td className="py-2 pr-4 text-right font-mono text-sm text-muted">{p}</td>
      <td className="py-2 text-sm text-muted">{note}</td>
    </tr>
  );
}

export default function NineModelsFortyPagesPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Nine Models, Forty Pages"
          subtitle="Google's newest budget model lost to its own predecessor on historical documents — and an open-weight model reached parity on the pages it can read"
          image="https://images.sourcelibrary.org/archived/69a5e9bb787d6e9b8d42e183/120.jpg"
          imageAlt="Page 109 of Eznik of Kołb's Ełc ałandoc' in the 1826 Venice printing — the Armenian page most models in our benchmark could not read."
        >
          <p className="text-stone-400 text-sm mt-4">23 July 2026 &middot; 9 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        {/* Lead */}
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Last week Google announced two new Gemini models. We run four million pages of AI-transcribed
          historical text on the previous generation, so instead of reading the benchmarks in the press
          release, we ran our own: the same forty pages of blackletter, Fraktur, polytonic Greek,
          pointed Hebrew, classical Chinese, and 19th-century Armenian type, against every OCR-capable
          model we could reach. Two days and about thirteen dollars later, our reference dataset
          held 1,737 scored transcriptions across models from five labs, served three different
          ways. The most
          newsworthy result was the one we least expected: <em>on historical documents, Google&rsquo;s
          newest budget model is slightly &mdash; but systematically &mdash; worse than the model it
          replaces.</em>
        </p>

        <h2 className="text-2xl font-serif text-primary mt-10 mb-4">The test</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The benchmark is the reference set we built for our{' '}
          <Link href="/blog/did-the-ai-read-this" className="text-accent hover:underline">
            memorization work
          </Link>
          : forty pinned pages from our own scans, each paired with an independent scholarly
          transcription of a passage printed on that page. The set has a property most OCR benchmarks
          lack &mdash; a <strong>memorization control</strong>. Twelve pages carry canonical text
          (the <em>Iliad</em>&rsquo;s opening, Genesis 1, the <em>Daodejing</em>) that frontier models
          have plausibly memorized and can recite without reading; twenty-eight carry text almost
          certainly absent from training data (editors&rsquo; prefaces, biographical front matter,
          mid-text passages of works digitized nowhere else). Score the two classes separately and you
          can tell a model that <em>reads</em> from a model that <em>remembers</em>.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Scoring is deliberately conservative: the reference must appear as an in-order subsequence of
          the model&rsquo;s output, a guard decides whether the passage is genuinely present
          (&ldquo;aligned&rdquo;), and character accuracy is measured only on the reference span, with
          orthographic conventions of early printing (u/v, i/j, long-s, ligatures) folded away. All
          comparisons below are <strong>paired per page</strong> &mdash; each model against the same
          page&rsquo;s score for the reference model &mdash; with an exact sign test and a bootstrap
          confidence interval. The full dataset, including every raw transcription, is published as{' '}
          <a
            href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/tree/main/scripts/eval/dataset/v0.3"
            className="text-accent hover:underline"
          >
            v0.3 on GitHub
          </a>
          .
        </p>

        <h2 className="text-2xl font-serif text-primary mt-10 mb-4">
          Finding 1: the newest model lost to its predecessor
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The reference model is <code>gemini-3.5-flash-lite</code>, released the week of the test. Its
          predecessor, <code>gemini-3.1-flash-lite</code> &mdash; the model that runs our production
          pipeline &mdash; beat it on 19 of 38 shared pages and lost on 3 (mean +0.30 percentage
          points, exact sign test p&nbsp;=&nbsp;0.0009). The effect is small, but it is not noise: it
          survives multiple-comparison correction across all eleven contrasts we ran. Whatever got
          better in the new generation &mdash; and the announcement emphasized coding, knowledge work,
          and chart parsing &mdash; reading 16th-century print was not part of it.
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-stone-300 text-sm text-muted">
                <th className="py-2 pr-4">vs gemini-3.5-flash-lite</th>
                <th className="py-2 pr-4 text-right">mean &Delta;</th>
                <th className="py-2 pr-4 text-right">95% CI</th>
                <th className="py-2 pr-4 text-right">W/T/L</th>
                <th className="py-2 pr-4 text-right">sign p</th>
                <th className="py-2">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              <ResultRow model="gemini-3.6-flash" delta="+0.72pp" ci="[+0.33, +1.20]" record="26/9/3" p="1.5e-5" note="3× the price" />
              <ResultRow model="gemini-3.1-flash-lite" delta="+0.30pp" ci="[−0.00, +0.57]" record="19/16/3" p="8.6e-4" note="the predecessor" />
              <ResultRow model="claude-sonnet-5" delta="−0.17pp" ci="[−1.37, +0.69]" record="13/9/5" p="0.10" note="" />
              <ResultRow model="qwen3-vl-plus" delta="−0.44pp" ci="[−1.19, +0.13]" record="5/12/6" p="1.0" note="open weights; reads 24/41 pages" />
              <ResultRow model="mistral-ocr" delta="−0.71pp" ci="[−1.56, −0.00]" record="7/12/14" p="0.19" note="$1 per 1,000 pages" />
              <ResultRow model="qwen-vl-max" delta="−0.83pp" ci="[−1.67, −0.02]" record="5/4/12" p="0.14" note="" />
              <ResultRow model="deepseek-ocr" delta="−1.77pp" ci="[−2.62, −1.08]" record="0/0/16" p="3.1e-5" note="reads 16/41 pages" />
              <ResultRow model="gemma-4-31b (self-hosted)" delta="−4.11pp" ci="[−5.91, −2.40]" record="2/4/19" p="2.2e-4" note="L40S GPU, QAT quant" />
              <ResultRow model="gemma-3-27b" delta="−7.24pp" ci="[−10.62, −4.14]" record="1/2/21" p="1.1e-5" note="" />
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Pricing makes the regression sharper. The new lite model costs roughly four times its
          predecessor per output token. For a workload like ours &mdash; output-heavy transcription at
          library scale &mdash; the July generation is a price increase for slightly worse reading.
        </p>

        <h2 className="text-2xl font-serif text-primary mt-10 mb-4">
          Finding 2: an open-weight model reached parity &mdash; with an asterisk the size of Armenia
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Alibaba&rsquo;s <code>qwen3-vl-plus</code> is statistically indistinguishable from
          Google&rsquo;s newest flash-lite on the pages both can read: &minus;0.44pp with a confidence
          interval straddling zero, five wins, six losses, twelve ties. On Greek, Latin, and classical
          Chinese it posts the best or near-best quality numbers in the entire table. A year ago no
          open-weight model was within five points of frontier OCR on this material.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The asterisk: <em>&ldquo;the pages both can read&rdquo;</em> is doing enormous work in that
          sentence. Qwen aligned on 24 of 41 pages. It read zero of the eight Armenian pages &mdash;
          and it did not fail honestly. It produced fluent, confidently formatted, entirely fabricated
          Armenian text, a failure mode we&rsquo;ve written about before as{' '}
          <Link href="/blog/confident-hallucinator" className="text-accent hover:underline">
            the confident hallucinator
          </Link>
          . For a library, a model that invents plausible text on scripts it cannot read is worse than
          one that refuses.
        </p>

        <h2 className="text-2xl font-serif text-primary mt-10 mb-4">
          Finding 3: coverage separates models; accuracy mostly doesn&rsquo;t
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Above the Gemma tier, every model&rsquo;s accuracy on pages it can align clusters within
          about one percentage point. What actually separates the field is <em>which scripts a model
          can read at all</em>: the Gemini family aligns 36&ndash;40 of 41 pages, Mistral-OCR 34,
          Gemma-4 26, Qwen 24, DeepSeek-OCR 16. Armenian is the starkest column &mdash; our production
          model reads all eight pages at 97.2%; among everything else only Mistral-OCR (4/8) and
          self-hosted Gemma-4 (3/8) read any. And each model fails differently: Qwen fabricates;
          DeepSeek-OCR silently skips lines (its skip-penalizing score drops 4.5 points, the widest
          gap in the table); and the new Gemini generation introduced a failure the incumbents never
          showed &mdash; refusing pages of canonical text as suspected training-data recitation,
          killing 2 of 3 runs on one Hero of Alexandria page. Three failure modes, three different
          operational risks: fabrication corrupts silently, skipping loses text, refusal blocks
          exactly the famous passages readers most want.
        </p>

        <h2 className="text-2xl font-serif text-primary mt-10 mb-4">
          Finding 4: the serving stack is part of the model
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          We ran Gemma three ways, and the same weights behaved as three different systems.
          Google&rsquo;s free API served Gemma-4 beautifully &mdash; when it answered at all; most
          requests stalled for five minutes and died, a lottery that made systematic evaluation
          impossible. Scaleway&rsquo;s paid serverless API ran Gemma-3 flawlessly. And self-hosting
          Gemma-4 on a rented GPU produced thousands of tokens of <em>empty</em> output &mdash; the
          runtime was routing the model&rsquo;s entire answer into a hidden reasoning channel and
          discarding it (a{' '}
          <a href="https://github.com/ollama/ollama/issues/16184" className="text-accent hover:underline">
            known Ollama bug
          </a>
          ; one configuration flag fixed it, after which 120 of 120 calls succeeded). None of this is
          visible in any leaderboard. If you evaluate a model without recording who served it and how,
          you are not measuring what you think you are measuring &mdash; our dataset now tags serving
          provider on every row.
        </p>

        <h2 className="text-2xl font-serif text-primary mt-10 mb-4">What it cost, and what we&rsquo;re doing</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The entire campaign &mdash; nine models, three serving providers, 1,678 scored runs,
          including renting and configuring a GPU server twice &mdash; cost about thirteen dollars and
          two days of wall-clock time, most of it waiting. That is the real finding for anyone running
          an AI-dependent pipeline: <em>model churn is now cheap to answer empirically.</em> Every
          &ldquo;should we switch?&rdquo; that used to be a meeting is an afternoon and pocket change,
          provided the reference set exists.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We are not switching anything. Our production pair &mdash; the year-old flash-lite for bulk
          work, flash for premium material &mdash; survived a nine-model challenge with its position
          strengthened: still the only stack that reads every script we hold, still the cheapest per
          page, still zero refusals. The eval&rsquo;s job was to prove that with numbers rather than
          inertia, and to tell us exactly where the field is moving: open-weight quality is arriving
          script by script, and the next model we test will be judged on Armenian first.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Dataset v0.3 &mdash; forty-four pages (including four within-work canonicity pairs from
          a parallel workstream), licensed-or-hashed references, 1,737 raw transcriptions with
          re-derivable scores, and the statistics tooling &mdash; is{' '}
          <a
            href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/tree/main/scripts/eval/dataset/v0.3"
            className="text-accent hover:underline"
          >
            on GitHub
          </a>
          , alongside the harness that produced it. If you maintain a model we didn&rsquo;t test, the
          bar is forty pages high and costs about a dollar to clear.
        </p>
      </article>
    </ContentPageLayout>
  );
}
