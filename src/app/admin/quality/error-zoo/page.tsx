import type { Metadata } from 'next';
import Link from 'next/link';
import QualityLoopLinks from '../../QualityLoopLinks';
import ErrorHeatGrid from '@/app/quality/ErrorHeatGrid';
import { DEFECT_STEP_BOUNDS } from '@/lib/error-zoo-heat';
import zoo from '../../../../../scripts/eval/error-zoo/site-2026-11-11.json';
import queue from '../../../../../scripts/eval/error-zoo/repair-queue-2026-11-12.json';

/**
 * The error zoo on the site (#244 step 2): where errors cluster (language × half-century), which classes they fall
 * into, and which router cell owns the pages with a serious finding. Static: it renders two files in the repo,
 * site-2026-11-11.json (aggregates from zoo-stats.py, #6420) and repair-queue-2026-11-12.json (repair-queue.mjs).
 * Rebuild both on gex45 (/root/jobs/error-zoo-v2) and commit them to refresh. Quoted specimens stay in the
 * claude.ai artifact: per-page evidence is not committed to a repo that is mirrored publicly.
 */
export const metadata: Metadata = {
  title: 'Error zoo',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

const SPECIMENS_URL = 'https://claude.ai/artifact/5JkkHvq7mnsmkJDqaHxUPK';
const LINK = 'text-accent-rust hover:underline';
const fmt = (n: number) => n.toLocaleString('en-US');
const STATUSES = ['no-route', 'needs-second-read', 'queued', 'deferred', 'not-confirmed'] as const;
const STATUS_WORDS: Record<string, string> = {
  'no-route': 'no route', 'needs-second-read': 'needs a second read', queued: 'queued',
  deferred: 'deferred', 'not-confirmed': 'not confirmed',
};

type QueueCell = { route: string | null; decision: string | null; statuses: Record<string, number> };
type QueueRow = QueueCell & { cell: string; total: number };

/** Cells with fewer pages than this go in a folded list, so the classes below stay in reach. */
const BIG_CELL = 10;

function QueueTable({ cells }: { cells: QueueRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-stone-500">
          <tr>
            <th className="px-2 py-1 font-medium">Cell</th>
            <th className="px-2 py-1 font-medium">Route</th>
            <th className="px-2 py-1 font-medium">Decision</th>
            <th className="px-2 py-1 font-medium text-right">Pages</th>
            {STATUSES.map(s => <th key={s} className="px-2 py-1 font-medium text-right whitespace-nowrap">{STATUS_WORDS[s]}</th>)}
          </tr>
        </thead>
        <tbody>
          {cells.map(c => (
            <tr key={c.cell} className="border-t border-stone-200 align-top">
              <td className="px-2 py-1.5"><Link href={`/admin/router#cell-${c.cell}`} className={LINK}>{c.cell}</Link></td>
              <td className="px-2 py-1.5 whitespace-nowrap">{c.route ?? <span className="text-stone-400">none</span>}</td>
              <td className="px-2 py-1.5 text-stone-600">{c.decision ?? <span className="text-stone-400">none</span>}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(c.total)}</td>
              {STATUSES.map(s => <td key={s} className="px-2 py-1.5 text-right tabular-nums text-stone-600">{c.statuses[s] ? fmt(c.statuses[s]) : ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ErrorZooPage() {
  const cells = Object.entries(queue.by_cell as Record<string, QueueCell>)
    .map(([cell, c]) => ({ cell, ...c, total: Object.values(c.statuses).reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.total - a.total);
  const big = cells.filter(c => c.total >= BIG_CELL);
  const small = cells.filter(c => c.total < BIG_CELL);
  const classes = [...zoo.classes].sort((a, b) => (b.sev?.serious ?? 0) - (a.sev?.serious ?? 0));
  return (
    <main className="px-4 py-5 sm:px-6 max-w-6xl mx-auto grid grid-cols-[minmax(0,1fr)] gap-6">
      <header className="grid gap-1">
        <QualityLoopLinks current="/admin/quality/error-zoo" />
        <h1 className="text-xl font-semibold text-stone-900">Error zoo</h1>
        <p className="text-xs text-stone-500">
          Built {zoo.built} from {fmt(zoo.n_pages)} reviewed pages ({Object.entries(zoo.sources).map(([k, v]) => `${k} ${fmt(v as number)}`).join(', ')}).
          Repair queue built {queue.built_at.slice(0, 10)} against router table {queue.router_table}.
          Quoted specimens: <a href={SPECIMENS_URL} className={LINK}>the artifact</a>. Public view: <Link href="/quality#language-and-period" className={LINK}>Quality Center</Link>.
        </p>
      </header>

      <section className="grid gap-2">
        <h2 className="text-base font-semibold text-stone-900">Public map: severe defects per 1,000 words, two random draws pooled</h2>
        <p className="text-sm text-stone-600">
          The view on /quality. Weekly audit (findings rated serious; {fmt(zoo.defects.n_weekly)} pages) plus paired-fifths-check
          (defects rated misleads or wrong text; {fmt(zoo.defects.n_fifths)} pages), {fmt(zoo.defects.n_books)} books, {fmt(zoo.defects.words)} words.
          Each draw is scaled to the served-grades (7866) severe_per_1k by language: weekly ×{zoo.defects.factors.weekly},
          fifths ×{zoo.defects.factors.fifths}. Method and the agreement it rests on: scripts/eval/error-zoo/pooled-defects.py.
        </p>
        <ErrorHeatGrid data={zoo.defects.heat} unit="per1k" bounds={DEFECT_STEP_BOUNDS} what="errors that change the sense per 1,000 words" />
      </section>

      <section className="grid gap-2">
        <h2 className="text-base font-semibold text-stone-900">By OCR engine, within each language</h2>
        <p className="text-sm text-stone-600">
          Same pages and scale as the map above, split by the engine that made the transcription read (admin only: model
          names stay off reader pages). Engines are routed by language and script, so compare across a row, not down the
          totals. Period and book are not held fixed: an engine given older or harder books in a language will look
          worse for it. Totals:{' '}
          {Object.entries(zoo.defects.engine_totals).filter(([, t]) => t.pages >= 40).map(([e, t]) => `${e} ${t.value} (${fmt(t.pages)} pages, ${fmt(t.books)} books)`).join(' · ')}.
        </p>
        <ErrorHeatGrid data={zoo.defects.by_engine} unit="per1k" bounds={DEFECT_STEP_BOUNDS} what="errors that change the sense per 1,000 words" />
      </section>

      <section className="grid gap-2">
        <h2 className="text-base font-semibold text-stone-900">By script type, within each language</h2>
        <p className="text-sm text-stone-600">
          Same pages and scale. Print or manuscript as the router decides it (lane-judge-sampler scriptClass): the
          page&apos;s own script tag, then pages.script_type, then the book&apos;s majority among its pages here. This is the
          router&apos;s second cell axis, so a dark square here is a router cell to test. &quot;Unknown&quot; is large: those
          pages carry no script mark at all, which is itself a gap to fill. Totals:{' '}
          {Object.entries(zoo.defects.script_totals).map(([s, t]) => `${s} ${t.value} (${fmt(t.pages)} pages, ${fmt(t.books)} books)`).join(' · ')}.
        </p>
        <ErrorHeatGrid data={zoo.defects.by_script} unit="per1k" bounds={DEFECT_STEP_BOUNDS} what="errors that change the sense per 1,000 words" />
      </section>

      <section className="grid gap-2">
        <h2 className="text-base font-semibold text-stone-900">By words on the page, within each language</h2>
        <p className="text-sm text-stone-600">
          Same pages and scale, binned by the page&apos;s own word count (the rate&apos;s denominator). Sparse pages score
          worse partly by arithmetic: a title page, a plate caption or a page of marginalia carries one misread heading
          over few words. Read it as where the rate is fragile, not as proof that dense pages are read better. Totals:{' '}
          {Object.entries(zoo.defects.density_totals).map(([s, t]) => `${s} ${t.value} (${fmt(t.pages)} pages)`).join(' · ')}.
        </p>
        <ErrorHeatGrid data={zoo.defects.by_density} unit="per1k" bounds={DEFECT_STEP_BOUNDS} what="errors that change the sense per 1,000 words" />
      </section>

      <section className="grid gap-2">
        <h2 className="text-base font-semibold text-stone-900">Where errors cluster: weekly random audit</h2>
        <p className="text-sm text-stone-600">
          One page each from random visible non-English books, every severity recorded: {fmt(zoo.n_uniform)} pages,{' '}
          {fmt(zoo.uniform_books)} books, {fmt(zoo.uniform_serious)} with a serious finding. The map holds the dated pages in
          languages with 40 or more of them ({fmt(zoo.heat_uniform.cells.reduce((s, c) => s + c.pages, 0))} pages). The fair
          picture of the library; thin in places. This is the view on /quality.
        </p>
        <ErrorHeatGrid data={zoo.heat_uniform} />
      </section>

      <section className="grid gap-2">
        <h2 className="text-base font-semibold text-stone-900">Where errors cluster: all review stores</h2>
        <p className="text-sm text-stone-600">
          All {fmt(zoo.n_pages)} pages. More coverage, but most stores were aimed at suspect books and record only serious
          findings, so shares run high. Read it for where the suspect books are, not as a rate.
        </p>
        <ErrorHeatGrid data={zoo.heat_all} />
      </section>

      <section className="grid gap-2">
        <h2 className="text-base font-semibold text-stone-900">Repair queue by router cell</h2>
        <p className="text-sm text-stone-600">
          {fmt(queue.n)} pages with a serious finding:{' '}
          {STATUSES.filter(s => (queue.by_status as Record<string, number>)[s]).map(s => `${STATUS_WORDS[s]} ${fmt((queue.by_status as Record<string, number>)[s])}`).join(' · ')}.
          Each cell links to its row on the router.
        </p>
        <QueueTable cells={big} />
        {small.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-stone-600">
              {small.length} smaller cells, under {BIG_CELL} pages each ({fmt(small.reduce((s, c) => s + c.total, 0))} pages)
            </summary>
            <QueueTable cells={small} />
          </details>
        )}
      </section>

      <section className="grid gap-2">
        <h2 className="text-base font-semibold text-stone-900">Error classes</h2>
        <p className="text-sm text-stone-600">
          Every class in the page-error taxonomy that was seen, most serious findings first. Specimens are in <a href={SPECIMENS_URL} className={LINK}>the artifact</a>.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-stone-500">
              <tr>
                <th className="px-2 py-1 font-medium">Class</th>
                <th className="px-2 py-1 font-medium text-right">Findings</th>
                <th className="px-2 py-1 font-medium text-right">Pages</th>
                <th className="px-2 py-1 font-medium text-right">Serious</th>
                <th className="px-2 py-1 font-medium">Caught by</th>
                <th className="px-2 py-1 font-medium">Fix</th>
              </tr>
            </thead>
            <tbody>
              {classes.map(c => (
                <tr key={c.code} className="border-t border-stone-200 align-top">
                  <td className="px-2 py-1.5 min-w-[14rem]">
                    <div className="font-medium text-stone-900">{c.code} · {c.name}</div>
                    <div className="text-stone-500">{c.sees}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(c.n ?? 0)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(c.pages ?? 0)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(c.sev?.serious ?? 0)}</td>
                  <td className="px-2 py-1.5 text-stone-600 min-w-[12rem]">{c.detector}</td>
                  <td className="px-2 py-1.5 text-stone-600 min-w-[12rem]">{c.fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
