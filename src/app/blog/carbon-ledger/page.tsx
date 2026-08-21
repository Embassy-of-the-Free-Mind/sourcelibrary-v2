import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

import { Footnote } from '@/components/blog/carbon-ledger/Footnote';
import { HeroStats } from '@/components/blog/carbon-ledger/HeroStats';
import { PullQuote } from '@/components/blog/carbon-ledger/PullQuote';
import { SectionDivider } from '@/components/blog/carbon-ledger/SectionDivider';
import { ForestPlot } from '@/components/blog/carbon-ledger/interactives/ForestPlot';
import { Equivalents } from '@/components/blog/carbon-ledger/interactives/Equivalents';
import { PathPicker } from '@/components/blog/carbon-ledger/interactives/PathPicker';
import { SpendTreemap } from '@/components/blog/carbon-ledger/interactives/SpendTreemap';
import { DisclosureBoard } from '@/components/blog/carbon-ledger/interactives/DisclosureBoard';
import { SensitivitySliders } from '@/components/blog/carbon-ledger/interactives/SensitivitySliders';
import { TokenSankey } from '@/components/blog/carbon-ledger/interactives/TokenSankey';
import { DailyTimeline } from '@/components/blog/carbon-ledger/interactives/DailyTimeline';
import { fmtCO2, toEquivalents, fmtCount } from '@/components/blog/carbon-ledger/format';

const HEADLINE_KG = 1805;
const HEADLINE_LOW_KG = 220;
const HEADLINE_HIGH_KG = 20000;

export const metadata: Metadata = {
  title: 'The Carbon Ledger of a Digital Library — Research Notes — Source Library',
  description:
    "Source Library has OCR'd 4.1 million pages and translated almost all of them into English using AI. We logged every API call. This is what it cost — in dollars, tokens, and carbon.",
  openGraph: {
    images: [{ url: 'https://images.sourcelibrary.org/gallery/a5d0c381-d4ea-42cd-8864-44457e7fda33/69500509f426a210d109c5bd-0.jpg', alt: 'Allegorical frontispiece of Athanasius Kircher\'s Ars Magna Lucis et Umbrae (1671)' }],
    title: 'The Carbon Ledger of a Digital Library',
    description:
      "4.1 million pages, OCR'd and translated by AI. We logged every API call. This is what it cost — in dollars, tokens, and carbon.",
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/gallery/a5d0c381-d4ea-42cd-8864-44457e7fda33/69500509f426a210d109c5bd-0.jpg', alt: 'Allegorical frontispiece of Athanasius Kircher\'s Ars Magna Lucis et Umbrae (1671)' }],
  },
  alternates: { canonical: '/blog/carbon-ledger' },
};

export default function CarbonLedgerPage() {
  const eq = toEquivalents(HEADLINE_KG);

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Carbon Ledger of a Digital Library"
          subtitle="What it costs the atmosphere to turn dead languages into searchable text"
          image="https://images.sourcelibrary.org/gallery/a5d0c381-d4ea-42cd-8864-44457e7fda33/69500509f426a210d109c5bd-0.jpg"
          imageAlt="Allegorical frontispiece of Athanasius Kircher's Ars Magna Lucis et Umbrae (1671)"
        >
          <p className="text-stone-400 text-sm mt-4">
            26 May 2026 &middot; ~10 min read
          </p>
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
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library has OCR&apos;d <strong>4.1 million pages</strong> of
          historical text and translated almost all of them into English
          using AI. We logged every API call. This is what it cost — in
          dollars, in tokens, and in carbon.
        </p>

        <HeroStats kg={HEADLINE_KG} />

        <h2 id="what-we-measured">What we measured</h2>
        <p>
          The library has about <strong>14,977 books</strong> with pages in
          it, of which <strong>13,819</strong> are now readable in English
          (≥90% of pages translated). Most originals are in languages nobody
          reads anymore — Latin, early modern German, Hebrew, Tibetan. To
          get there, every page goes through image recognition,
          transcription, translation, illustration extraction, indexing.
        </p>
        <p>
          Over the past five and a half months, that pipeline made{' '}
          <strong>8.0 million API calls</strong>, used{' '}
          <strong>30.6 billion tokens</strong>, racked up{' '}
          <strong>22.6 million page-credits</strong>, and cost{' '}
          <strong>$19,588</strong>.<Footnote id={1} />
        </p>
        <p>
          The dollar bill is in MongoDB. The carbon bill is harder to read,
          so we tried six different ways to estimate it.
        </p>

        <h2 id="the-receipt">The receipt</h2>
        <p>
          Every Gemini API call writes a row to a MongoDB collection called{' '}
          <code>gemini_usage_daily</code>. These numbers are recorded, not
          estimated.<Footnote id={1} />
        </p>
        <div className="not-prose">
          <table className="text-sm font-mono w-full my-6">
            <tbody className="divide-y divide-stone-200">
              <tr><td className="py-1.5 text-stone-600">API calls</td><td className="py-1.5 text-right tabular-nums">8,032,886</td></tr>
              <tr><td className="py-1.5 text-stone-600">Input tokens</td><td className="py-1.5 text-right tabular-nums">23,644,100,054</td></tr>
              <tr><td className="py-1.5 text-stone-600">Output tokens</td><td className="py-1.5 text-right tabular-nums">6,921,374,368</td></tr>
              <tr><td className="py-1.5 text-stone-600">Page-credits processed</td><td className="py-1.5 text-right tabular-nums">22,599,950</td></tr>
              <tr><td className="py-1.5 text-stone-600">Spend (USD)</td><td className="py-1.5 text-right tabular-nums">$19,588.33</td></tr>
              <tr><td className="py-1.5 text-stone-600">Window</td><td className="py-1.5 text-right">Jan 2 – May 25, 2026</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          About a third went to translation, a third to OCR. The biggest
          surprise was <strong>image extraction</strong> — detecting
          illustrations, plates, and diagrams in scanned pages — which alone
          cost ~$3,300.
        </p>

        <SpendTreemap />

        <p>
          The activity wasn&apos;t spread evenly. The pipeline ramped up in
          January, hit a steady working rate in March, and peaked around
          new collection imports. Quiet days mean we were either fixing
          things or sleeping.
        </p>

        <DailyTimeline />

        <h2 id="one-book-at-a-time">One book at a time</h2>
        <p>
          The pipeline doesn&apos;t use one AI model. It uses two: Gemini 3
          Flash for hard scripts (Hebrew, Tibetan, Arabic) and BPH
          manuscripts, Gemini 3.1 Flash-Lite for clean Latin-script European
          text.<Footnote id={1} /> Flash-Lite is half the price. The router
          picks by language.
        </p>
        <p>
          Pick a model and a serving mode below. The frontier models (Pro,
          Opus) are counterfactuals — what if we used them instead? The
          spread is about <strong>240×</strong>.
        </p>

        <PathPicker />

        <PullQuote attribution="The cheapest path">
          One quarter-pound burger&apos;s worth of carbon = roughly{' '}
          <span className="text-emerald-700">7,000 books</span> processed
          on Flash-Lite via the batch API.<br />
          Or <span className="text-red-700">~30 books</span> on Claude Opus
          running real-time.
        </PullQuote>

        <p>
          The Flash-Lite + batch path is what some sustainability
          researchers call <em>distillation gains</em> — a smaller model,
          compressed from a larger one via supervised training, can produce
          comparable output on simpler tasks (OCR of clean Latin script)
          for a small fraction of the energy. Pair it with batch serving,
          where the GPU works at higher utilization, and per-token energy
          drops sharply.
        </p>
        <p>
          Routing matters. Source Library uses Flash-Lite for ~16% of calls
          and Flash for ~83%; the rest is split among other variants. If
          we&apos;d used Pro for everything, the carbon bill would be ~30×
          higher. If we&apos;d used Opus, ~80× higher.
        </p>

        <h2 id="six-ways">Six ways to estimate the same number</h2>
        <p>
          There is no single right way to estimate carbon emissions from AI
          usage. Anthropic publishes nothing.<Footnote id={9} /> Google
          published one paper in August 2025.<Footnote id={3} /> Mistral
          published one cradle-to-grave life-cycle assessment in
          July.<Footnote id={4} /> Every other &quot;AI carbon
          footprint&quot; number you&apos;ve read — including this one — is
          an extrapolation.
        </p>
        <p>
          Here are six independent methods, applied to this project. The
          bottom-up family (rooflines + bridge factors) clusters around
          100–700 kg. The top-down family (extrapolating from real
          production measurements) clusters around 5,000–50,000 kg. The
          geometric mean is <strong>{fmtCO2(HEADLINE_KG)} CO₂e</strong> —
          about{' '}
          <strong>{fmtCount(eq.amsLhr)} return flights AMS↔London</strong>,{' '}
          <strong>{fmtCount(eq.burgers)} beef burgers</strong>, or{' '}
          <strong>{fmtCount(eq.carKm)} km</strong> of driving.
          <Footnote id={10} />
        </p>

        <ForestPlot />

        <p>
          The 50× gap between the bottom-up family (~100–340 kg, blue) and
          the top-down family (~5,400–54,000 kg, red) is the most honest
          finding in this whole exercise. Bottom-up methods assume optimal
          batching, peak utilization, no real-world overhead. Top-down
          methods extrapolate from production measurements that include
          every kind of overhead. Both are valid. Neither is right.
        </p>
        <p>
          Closing the gap further requires disclosure from Anthropic (none
          yet — required starting 2026 under California SB 253) and a
          second-generation paper from Google.<Footnote id={9} />
        </p>
        <p>
          To see how each lever in the bottom-up model affects the answer,
          push the sliders below. The blue dot is your current estimate;
          the amber line is the geometric mean of all six methods; the grey
          dots are the other methods&apos; centrals.
        </p>

        <SensitivitySliders />

        <h2 id="the-other-half">The other half: dev work</h2>
        <p>
          The Gemini pipeline is roughly 60% of the project&apos;s AI
          footprint. The other 40% comes from a different AI —
          Anthropic&apos;s Claude Opus — which helped <em>write the
          code</em> for the site, the pipeline, the ingestion scripts, the
          search interface, this blog post. Over the same window,
          that&apos;s about 280,000 conversation turns.<Footnote id={2} />
        </p>
        <p>
          The token economics are wildly different. Of the ~45 billion
          tokens that flowed through Claude during development,{' '}
          <strong>43.5 billion were cache reads</strong> — the same context
          (file contents, prior conversation, tool definitions) re-read on
          every turn. Cache reads cost about <strong>one tenth</strong> of
          fresh input tokens because the KV cache skips the model&apos;s
          MLP forward pass entirely.<Footnote id={7} />
        </p>

        <TokenSankey />

        <PullQuote attribution="The cache crossover">
          Cache reads make up <span className="text-stone-500">96%</span>{' '}
          of the token count<br />but only{' '}
          <span className="text-red-700">~25%</span> of the energy.
        </PullQuote>

        <p>
          If prompt caching didn&apos;t exist and every cache read had to
          be a fresh forward pass, the same dev work would have consumed
          roughly 30-50× more energy. The cache turns long-context agent
          loops from prohibitively expensive into merely expensive. It is,
          structurally, one of the single most important sustainability
          levers in modern AI serving.
        </p>

        <SectionDivider
          imageUrl="https://images.sourcelibrary.org/gallery/69526359ab34727b1f046d5a/69568fa01479a63c1108cdb0-0.jpg"
          alt="An alchemical engraving from Mutus Liber (1677) depicting figures collecting morning dew from sheets stretched on poles."
          caption="Collecting morning dew, an emblem of distillation"
          source="Mutus Liber (1677), Plate 4 — Source Library"
        />

        <h2 id="what-it-looks-like">What {fmtCO2(HEADLINE_KG)} looks like</h2>
        <p>
          The geometric mean of the six methods is{' '}
          <strong>{fmtCO2(HEADLINE_KG)} CO₂e</strong>. The plausible range
          is roughly 100 kg to 50,000 kg. Here is what that looks like in
          things you can picture:
        </p>

        <Equivalents kg={HEADLINE_KG} lowKg={HEADLINE_LOW_KG} highKg={HEADLINE_HIGH_KG} />

        <p>
          For comparison, an average person in the Netherlands emits
          roughly 8,400 kg of CO₂ per year.<Footnote id={15} /> Source
          Library&apos;s five-and-a-half-month AI footprint is about
          one-fifth of one person&apos;s annual emissions — and produced
          13,819 books readable in English (≥90% of pages translated).
        </p>

        <h2 id="why-the-gap">Why the gap is so wide</h2>
        <p>
          The reason no third party can estimate AI carbon emissions
          accurately is that the people who can measure them — the
          providers — mostly don&apos;t publish. Google has published one
          paper.<Footnote id={3} /> Mistral has published one
          cradle-to-grave LCA.<Footnote id={4} /> Anthropic, OpenAI, xAI,
          and Meta have published essentially nothing
          comparable.<Footnote id={9} />
        </p>

        <DisclosureBoard />

        <p>
          California&apos;s Climate Corporate Data Accountability Act
          (SB 253) requires US companies with over $1 billion in annual
          revenue doing business in California to report Scope 1 and 2
          emissions starting in 2026, with Scope 3 from 2027. All five of
          the empty rows above clear that threshold. So within a year, the
          gap on this chart should narrow considerably — or someone gets
          sued.
        </p>

        <SectionDivider
          imageUrl="https://images.sourcelibrary.org/gallery/695234ddab34727b1f044cd2/6959117cecb01322b3069ae8-0.jpg"
          alt="Figure XII from the Book of Lambspring: two figures atop a mountain under the sun and moon."
          caption="Conjunction of opposites — the alchemical Coniunctio"
          source="The Book of Lambspring, in The Hermetic Museum (1893)"
        />

        <h2 id="the-trade">The trade</h2>
        <p>
          At the central estimate, this library&apos;s AI work for the past
          five and a half months emitted roughly as much CO₂ as{' '}
          <strong>seven economy round-trip flights from Amsterdam to
          London</strong>.<Footnote id={13} /> The honest range is wider:
          two to eighty round-trips, depending on which estimation method
          you trust. For that, ~4 million pages of text that were
          previously inaccessible — 17th-century printer&apos;s Latin,
          fraktur German, unvocalized Hebrew, dead languages, dead
          handwriting — are now searchable in English.
        </p>
        <p>
          The counterfactual matters. The alternative to AI digitization
          isn&apos;t no digitization — it&apos;s manual digitization.
          Hiring transcribers. Renting facilities. Flying scholars in. We
          haven&apos;t modeled that footprint, but a single transatlantic
          flight per scholar per year would dwarf the AI number within
          months.
        </p>
        <p>
          The other counterfactual: routing every workload through the
          biggest available model. Using Claude Opus instead of Gemini
          Flash for OCR would push the carbon footprint roughly{' '}
          <strong>80× higher</strong>. The pipeline saves carbon by picking
          the smallest model that&apos;s good enough — exactly the same
          logic that makes prompt caching, batching, and distillation the
          most effective sustainability levers in modern AI serving.
        </p>
        <p>
          Almost none of this should be taken as a defense of AI&apos;s
          broader carbon trajectory. Datacenter electricity demand in the
          US is on track to roughly double between 2025 and 2030, driven
          largely by AI buildout. Most of that growth is being met with
          natural gas, not renewables. The path of a single
          cultural-heritage project is not the path of the industry.
        </p>
        <p>
          But for this particular project, on these particular
          measurements, the trade looks defensible: a few flights&apos;
          worth of carbon, in exchange for a library that people in São
          Paulo and Jakarta can read.
        </p>

        <PullQuote attribution="The trade, in one line">
          A few transatlantic flights of carbon for a library you can read
          from anywhere on Earth.
        </PullQuote>

        <h2 id="what-would-close-it">What would close the gap</h2>
        <p>
          The 50× spread on our estimate is not because we&apos;re
          careless. It&apos;s because the data needed to narrow it
          doesn&apos;t exist publicly.
        </p>
        <ol>
          <li>
            Per-token energy disclosure from Anthropic — comparable to
            Google&apos;s Aug 2025 paper. With this, the Claude Code
            portion of the estimate moves from a ~10× range to ~2×.<Footnote id={9} />
          </li>
          <li>
            Active parameter counts for Gemini Pro and Claude Opus. The
            roofline model can&apos;t pin down per-token energy without
            knowing how big the model is per forward pass.<Footnote id={8} />
          </li>
          <li>
            Production batch-size distributions. A model running at
            batch=128 is 4-8× more energy-efficient per token than at
            batch=8. We don&apos;t know what mix providers
            run.<Footnote id={6} />
          </li>
          <li>
            A second Google paper. Or a Meta one. Or an OpenAI one. One
            paper from one provider, however careful, is not enough to
            calibrate the field.
          </li>
        </ol>
        <p>
          California&apos;s SB 253 helps. Starting in 2026 it requires
          every US company over $1B revenue doing business in California
          to disclose Scope 1 and 2 emissions. Anthropic, OpenAI, xAI, and
          Meta all qualify. By late 2026, the empty rows on the scoreboard
          above should fill in — or someone gets sued by the California
          Attorney General.
        </p>

        <div className="not-prose my-12 rounded-lg border border-stone-200 bg-stone-50 p-6">
          <h3 className="font-serif text-xl font-bold mb-3">
            Notes on this exercise
          </h3>
          <ul className="space-y-2 text-sm text-stone-700 leading-relaxed">
            <li>
              <strong>Things this number does include:</strong> Gemini API
              calls for OCR + translation + image extraction + indexing +
              summary; Claude Code conversations for software development;
              data-center cooling + idle compute + PUE; a share of training
              amortization; a share of hardware manufacturing emissions.
            </li>
            <li>
              <strong>Things this number does not include:</strong> the
              MacBook running the dev environment (~30 kg CO₂ over the
              window); the Hetzner GPU running CLIP image embeddings; the
              Vercel + MongoDB Atlas + Cloudflare runtime serving the
              public site; you reading this page (~0.5 g CO₂ for the page
              load).
            </li>
            <li>
              <strong>Honesty:</strong> every number is sourced. Every
              method has assumptions. We may be off by 5× either way. When
              new data arrives, this page will update — see the change log
              on{' '}
              <Link className="underline" href="/blog/carbon-ledger/methodology">
                /methodology
              </Link>.
            </li>
          </ul>
        </div>

        <p className="text-sm text-stone-600">
          Full data, all six estimation methods, every primary source, and
          every assumption are documented at{' '}
          <Link className="underline" href="/blog/carbon-ledger/methodology">
            /blog/carbon-ledger/methodology
          </Link>
          .
        </p>
      </article>

    </ContentPageLayout>
  );
}
