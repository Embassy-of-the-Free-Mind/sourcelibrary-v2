import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { SubPageHeader } from '@/components/layout/ContentPageLayout';
import provenance from '@/data/carbon-ledger/provenance.json';
import estimationLines from '@/data/carbon-ledger/estimation-lines.json';
import equivalents from '@/data/carbon-ledger/equivalents.json';
import perBook from '@/data/carbon-ledger/per-book.json';
import { fmtCO2 } from '@/components/blog/carbon-ledger/format';

export const metadata: Metadata = {
  title: 'Methodology — Carbon Ledger — Source Library',
  description: 'Every number, every assumption, every source for the Source Library AI carbon footprint estimate.',
  alternates: { canonical: '/blog/carbon-ledger/methodology' },
};

export default function MethodologyPage() {
  return (
    <ContentPageLayout bg="bg-cream">
      <SubPageHeader
        title="Methodology & data provenance"
        subtitle="Every datum traces to (a) recorded observation in our database, (b) reproducible computation from a public script, or (c) a primary source cited inline."
        backHref="/blog/carbon-ledger"
        backLabel="Back to the post"
      />
      <article className="prose-content max-w-none">

        <nav className="mt-8 text-sm space-y-1 font-mono text-stone-600">
          <a className="block hover:text-stone-900:text-stone-100" href="#measured">1. Measured inputs</a>
          <a className="block hover:text-stone-900:text-stone-100" href="#model">2. Bottom-up energy model</a>
          <a className="block hover:text-stone-900:text-stone-100" href="#lines">3. The six estimation lines</a>
          <a className="block hover:text-stone-900:text-stone-100" href="#equivalents">4. Equivalents</a>
          <a className="block hover:text-stone-900:text-stone-100" href="#sources">5. All sources</a>
          <a className="block hover:text-stone-900:text-stone-100" href="#unknowns">6. What we don&apos;t know</a>
          <a className="block hover:text-stone-900:text-stone-100" href="#known-issues">7. Known data-quality issues</a>
        </nav>

        <section id="measured" className="mt-12">
          <h2 className="text-2xl font-serif font-bold border-b border-stone-200 pb-2">
            1. Measured inputs
          </h2>
          <p className="mt-3 text-stone-700">
            These are recorded, not estimated. Re-runnable from the scripts in
            the source repository.
          </p>
          <h3 className="mt-6 font-semibold">Gemini pipeline (real billed totals)</h3>
          <table className="mt-2 text-sm w-full">
            <tbody className="divide-y divide-stone-200">
              <tr>
                <td className="py-1 pr-2">API calls</td>
                <td className="py-1 font-mono">8,032,886</td>
              </tr>
              <tr>
                <td className="py-1 pr-2">Input tokens</td>
                <td className="py-1 font-mono">23,644,100,054</td>
              </tr>
              <tr>
                <td className="py-1 pr-2">Output tokens</td>
                <td className="py-1 font-mono">6,921,374,368</td>
              </tr>
              <tr>
                <td className="py-1 pr-2">Pages processed</td>
                <td className="py-1 font-mono">22,599,950 (page-credits; backfilled May 2026)</td>
              </tr>
              <tr>
                <td className="py-1 pr-2">Real billed cost</td>
                <td className="py-1 font-mono">$19,588.33</td>
              </tr>
              <tr>
                <td className="py-1 pr-2">Tracking window</td>
                <td className="py-1 font-mono">2026-01-02 → 2026-05-25 (144 days)</td>
              </tr>
              <tr>
                <td className="py-1 pr-2">Project window</td>
                <td className="py-1 font-mono">2025-12-12 → 2026-05-25 (165 days, +15% scale-up)</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs text-stone-500">
            Source: <code className="font-mono">gemini_usage_daily</code> MongoDB collection. Aggregated by{' '}
            <code className="font-mono">scripts/gemini-usage-aggregate.mjs</code>.
          </p>

          <h3 className="mt-6 font-semibold">Claude Code (sampled)</h3>
          <table className="mt-2 text-sm w-full">
            <tbody className="divide-y divide-stone-200">
              <tr><td className="py-1 pr-2">Output tokens (extrapolated)</td><td className="py-1 font-mono">138,702,028</td></tr>
              <tr><td className="py-1 pr-2">Cache-read input tokens</td><td className="py-1 font-mono">43,515,829,041</td></tr>
              <tr><td className="py-1 pr-2">Cache-create input tokens</td><td className="py-1 font-mono">1,602,566,493</td></tr>
              <tr><td className="py-1 pr-2">Fresh input tokens</td><td className="py-1 font-mono">10,540,005</td></tr>
              <tr><td className="py-1 pr-2">Session files / total bytes</td><td className="py-1 font-mono">4,811 / 1.55 GB</td></tr>
              <tr><td className="py-1 pr-2">Sample fraction</td><td className="py-1 font-mono">11.9% by bytes (±20% extrapolation)</td></tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs text-stone-500">
            Source: <code className="font-mono">~/.claude/projects/-Users-dereklomas-sourcelibrary/</code>{' '}
            JSONL session logs. Each contains assistant message <code className="font-mono">usage</code> blocks emitted by the Anthropic API.
          </p>
        </section>

        <section id="model" className="mt-12">
          <h2 className="text-2xl font-serif font-bold border-b border-stone-200 pb-2">
            2. Bottom-up energy model
          </h2>
          <p className="mt-3 text-stone-700">
            Roofline analysis of transformer inference. Output tokens are
            memory-bandwidth-bound; input tokens are compute-bound; cache
            reads use ~10% of fresh input.<sup>[6][7]</sup>
          </p>
          <p className="mt-3 text-stone-700">
            Validated against MLPerf Inference v5.1 (Llama 3.1-70B on
            8×H200 = 31,391 tok/s at ~5.6 kW = 0.178 J/output-tok).<sup>[5]</sup>{' '}
            Our model predicts 0.114 J/output-tok for that workload — within 36%, so we apply a 1.56× correction.
          </p>
          <p className="mt-3 text-xs text-stone-500">
            Source: <code className="font-mono">scripts/co2-footprint-model.py</code>
          </p>
        </section>

        <section id="lines" className="mt-12">
          <h2 className="text-2xl font-serif font-bold border-b border-stone-200 pb-2">
            3. The six estimation lines
          </h2>
          <p className="mt-3 text-stone-700">
            Each is independent. Each makes different assumptions. The
            geometric mean of all centrals is{' '}
            <strong>{fmtCO2(estimationLines.summary.geometric_mean_kg)}</strong>.
          </p>
          <div className="mt-4 space-y-4">
            {estimationLines.lines.map((line) => (
              <div key={line.id} className="rounded border border-stone-200 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">
                      {line.id}. {line.name}
                    </h3>
                    <p className="text-xs font-mono text-stone-500 mt-0.5">{line.short}</p>
                  </div>
                  <div className="text-right font-mono text-sm">
                    <div className="text-stone-500">{fmtCO2(line.low_kg)}–{fmtCO2(line.high_kg)}</div>
                    <div className="font-bold">{fmtCO2(line.central_kg)}</div>
                  </div>
                </div>
                <p className="mt-2 text-sm text-stone-700">
                  <span className="font-semibold">Includes: </span>
                  {line.includes}
                </p>
                <p className="mt-1 text-sm text-stone-700">
                  <span className="font-semibold">Excludes / caveats: </span>
                  {line.excludes}
                </p>
                <p className="mt-1 text-xs text-stone-500 italic">{line.verdict}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-stone-500">
            Source: <code className="font-mono">scripts/co2-estimation-lines.py</code>
          </p>
        </section>

        <section id="equivalents" className="mt-12">
          <h2 className="text-2xl font-serif font-bold border-b border-stone-200 pb-2">
            4. Equivalents — conversion factors
          </h2>
          <p className="mt-3 text-stone-700">
            Every &quot;{fmtCO2(1805)} equals X burgers&quot; statement in the post
            uses the conversion factors below. Each is cited.
          </p>
          <table className="mt-4 text-sm w-full">
            <thead className="text-xs uppercase text-stone-500 border-b border-stone-200">
              <tr>
                <th className="text-left py-2">Unit</th>
                <th className="text-right py-2">kg CO₂e / unit</th>
                <th className="text-right py-2">Range</th>
                <th className="text-left py-2 pl-4">Primary source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {equivalents.equivalents.map((e) => (
                <tr key={e.id}>
                  <td className="py-2 pr-2">{e.icon} {e.name}</td>
                  <td className="py-2 font-mono text-right">{e.kg_co2e_per_unit}</td>
                  <td className="py-2 font-mono text-right text-stone-500">
                    {e.range_low}–{e.range_high}
                  </td>
                  <td className="py-2 pl-4 text-xs">
                    <a href={e.primary_source.url} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">
                      {e.primary_source.title}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section id="sources" className="mt-12">
          <h2 className="text-2xl font-serif font-bold border-b border-stone-200 pb-2">
            5. All sources
          </h2>
          <p className="mt-3 text-stone-700">
            Every <sup className="font-mono text-amber-700">[n]</sup> footnote in the post points
            here.
          </p>
          <ol className="mt-4 space-y-3 list-decimal list-inside text-sm">
            {provenance.footnotes.map((f) => (
              <li key={f.id} className="leading-snug">
                <span className="font-semibold">{f.claim}</span>{' '}
                <span className="text-stone-500 text-xs uppercase">[{f.type}]</span>
                <div className="ml-6 text-stone-600 mt-0.5">
                  Source: {f.source}
                  {'url' in f && f.url && (
                    <>
                      {' '}
                      <a className="underline text-blue-600" href={f.url} target="_blank" rel="noopener noreferrer">
                        ↗
                      </a>
                    </>
                  )}
                  {'reproducible_via' in f && f.reproducible_via && (
                    <span className="ml-2 font-mono text-xs">↻ {f.reproducible_via}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="unknowns" className="mt-12">
          <h2 className="text-2xl font-serif font-bold border-b border-stone-200 pb-2">
            6. What we don&apos;t know
          </h2>
          <ul className="mt-3 list-disc list-inside text-stone-700 space-y-2">
            <li>
              <strong>Anthropic per-token energy.</strong> Not published. Required disclosure under California SB 253 begins in 2026.
            </li>
            <li>
              <strong>Active parameter counts</strong> for Gemini Pro and Claude Opus. Best estimates ±50%.
            </li>
            <li>
              <strong>Production batch sizes</strong> for major providers. Estimated 12-128 depending on workload type and latency target.
            </li>
            <li>
              <strong>Grid intensity</strong> for Anthropic&apos;s deployment regions. We model 60% Project Rainier (Indiana, ~650 g/kWh) + 40% older AWS clusters (us-west-2 etc.). Mix may shift over time.
            </li>
            <li>
              <strong>Training amortization</strong> beyond what is implicit in Mistral&apos;s LCA. No comparable disclosure from Anthropic / Google / OpenAI.
            </li>
            <li>
              <strong>Long-context overhead factor</strong> for Claude Code. We apply ×2.0 based on TokenPowerBench (Dec 2025) which measured 3× per-token energy from 2K → 10K context. Source Library&apos;s ~155K-token contexts are extrapolated, not measured directly.
            </li>
          </ul>
        </section>

        <section id="known-issues" className="mt-12">
          <h2 className="text-2xl font-serif font-bold border-b border-stone-200 pb-2">
            7. Known data-quality issues
          </h2>
          <p className="mt-3 text-stone-700">
            During this audit, we found several issues in the upstream
            pipeline data. None invalidate the headline number, but worth
            knowing if you&apos;re reading deeply.
          </p>
          <ul className="mt-3 list-disc list-inside text-stone-700 space-y-2 leading-relaxed">
            <li>
              <strong>Translation page-count under-logging — FIXED 2026-05-25.</strong>{' '}
              The long-form translation endpoint had been logging ~0.45 page-credits per
              call (vs ~3 for OCR). Root cause: the batch-collector wrote{' '}
              <code className="font-mono">page_count: successCount</code>, which
              is the count of pages whose DB row was matched at result-collection time
              — zero for batches whose results were already collected on a prior pass.
              Separately, ~748K legacy <code className="font-mono">gemini_usage</code>{' '}
              records written before the April 2026 Supabase migration had{' '}
              <code className="font-mono">page_ids</code> populated but no{' '}
              <code className="font-mono">page_count</code> field. Both fixed in PRs{' '}
              #2006 and #2009, plus a backfill of the historical records. Translation
              ratio is now 1.83 pages/call, total page-credits 413K → 2.68M, consistent
              with the ~5.4M pages with translation text in the{' '}
              <code className="font-mono">pages</code> collection.
            </li>
            <li>
              <strong>Two translation type labels in history.</strong>{' '}
              Older records use <code className="font-mono">type: &quot;translate&quot;</code>{' '}
              (per-page, manual scripts) and newer records use{' '}
              <code className="font-mono">type: &quot;translation&quot;</code>{' '}
              (long-form, batched context — current default). A 2026-03 normalization
              consolidated the active code paths but ~250K legacy{' '}
              <code className="font-mono">translate</code> rows remain. Both are summed
              in this post&apos;s totals.
            </li>
            <li>
              <strong>Book-level status fields are abandoned (and now confirmed safe to delete).</strong>{' '}
              <code className="font-mono">books.ocr_status</code> and{' '}
              <code className="font-mono">books.translation_status</code> have
              4 and 10 entries respectively across 46K books. Status is tracked per-page
              now (via the <code className="font-mono">pages</code> collection) and
              per-book progress via <code className="font-mono">pages_ocr</code> /{' '}
              <code className="font-mono">pages_translated</code> counters. The legacy
              fields are not in the active Book TypeScript schema and not read by any
              public route; safe to drop in a future cleanup PR.
            </li>
            <li>
              <strong>Re-OCR rate is 1.18×, not 1.4×.</strong> Earlier
              drafts assumed more re-OCR than is actually happening. Now corrected.
              The <code className="font-mono">page_revisions</code> collection
              (164K rows) stores pre-overwrite snapshots, but only for pages that
              were re-OCR&apos;d, so it can&apos;t derive an absolute rate by itself
              — the API-log ratio of 7.24M OCR page-credits ÷ 6.14M unique OCR&apos;d
              pages is the authoritative source.
            </li>
            <li>
              <strong>Per-book denominator: 14,295 books with index/summary generated in window.</strong>{' '}
              The carbon-per-book averages divide window-total tokens by this count.
              Alternatives — 28K visible books, 15K with any OCR, 17K with any
              <code className="font-mono">pipeline_auto.last_updated</code> in window —
              would shift the per-book number 10–40%. We use index-generation because
              that&apos;s the phase that fires the full enrichment pass (summary +
              chapters + quality + collection assignment).
            </li>
            <li>
              <strong>Visual + Unknown language books may be OCR&apos;d unnecessarily.</strong>{' '}
              14,544 books with <code className="font-mono">language=Visual</code>{' '}
              (image-only manuscripts, alchemical plates) and 10,703 with{' '}
              <code className="font-mono">language=Unknown</code> have no OCR filter
              upstream — the pipeline runs Gemini on them and saves whatever
              auto-detect returns. Net impact on this post&apos;s totals is small
              because batch API discount is 50%, but it&apos;s wasted compute. Pending
              fix as of 2026-05-25.
            </li>
            <li>
              <strong>Claude Code token totals are sampled, not exhaustive.</strong>{' '}
              11.9% by bytes of the JSONL session logs, extrapolated linearly.
              Sampling error ~±20%. A full scan was attempted but stalled at
              98% due to slow I/O on the project directory.
            </li>
          </ul>
        </section>

        <section className="mt-16 border-t border-stone-200 pt-8 text-sm text-stone-500">
          <h3 className="font-semibold mb-2">Reproduce this</h3>
          <p>
            All scripts at{' '}
            <a className="underline" href="https://github.com/sourcelibrary/sourcelibrary/tree/main/scripts">
              github.com/sourcelibrary/sourcelibrary/scripts
            </a>
            . All data files in this repo&apos;s <code className="font-mono">/data</code> directory.
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
