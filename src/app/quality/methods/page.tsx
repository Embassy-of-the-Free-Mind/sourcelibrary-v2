import { Metadata } from 'next';
import type { ReactNode } from 'react';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import methods from '@/data/quality-methods.json';

// How we measure quality: the rules, the instruments, and what we cannot yet measure (#5918, #5937).
// Everything shown is read from src/data/quality-methods.json at build time; edit the register, not this page.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'How We Measure Quality — Source Library',
  description:
    'The rules Source Library holds its quality measurements to, every instrument we use (what it asks, what it cannot see, its latest result), and what we cannot yet measure.',
  alternates: { canonical: '/quality/methods' },
};

type Kind = 'accuracy' | 'judged' | 'screen' | 'by-eye';
type Instrument = {
  id: string;
  name: string;
  question: string;
  kind: Kind;
  scope: string;
  cadence: string;
  latest: { date: string; headline: string; source: string } | null;
  on_finding: string;
  blind_to: string;
  issue: number;
  status: string;
  link?: string;
};

const REPO = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/';
const ISSUE = `${REPO}issues/`;
/** A register source is a repo path or a full URL. */
const href = (s: string) => (s.startsWith('http') || s.startsWith('/') ? s : `${REPO}blob/main/${s}`);

const KIND: Record<Kind, { label: string; note: string; className: string }> = {
  accuracy: { label: 'Accuracy', note: 'compared with something people made', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  judged: { label: 'Judged', note: 'an AI judge reads our page', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  screen: { label: 'Screen', note: 'an automatic check that flags candidates', className: 'bg-stone-100 text-stone-700 border-stone-200' },
  'by-eye': { label: 'By eye', note: 'pages opened and read', className: 'bg-sky-50 text-sky-800 border-sky-200' },
};

const STATUS: Record<string, string> = {
  running: 'Running',
  'per-study': 'Per study',
  'per-run': 'Per run',
  planned: 'Not started',
};

function A({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a href={href(to)} className="text-amber-800 underline decoration-amber-800/30 underline-offset-2 hover:decoration-amber-800">
      {children}
    </a>
  );
}

function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="font-display text-2xl text-stone-900 mt-14 mb-4 scroll-mt-24">
      {children}
    </h2>
  );
}

// Where each kind of quality information lives. The hub links out; each register has one source.
const MAP: { path: string; name: string; what: string; kind: string }[] = [
  { path: '/quality', name: 'Quality Center', what: 'Where quality stands, the experiments, and how to take part.', kind: 'Hub' },
  { path: '/quality/methods', name: 'How we measure', what: 'This page: the rules, the instruments and the gaps.', kind: 'Register' },
  { path: '/research/quality/open', name: 'Open quality work', what: 'Known defects and the work under way, each linked to its issue.', kind: 'Register' },
  { path: `${REPO}blob/main/scripts/eval/EXPERIMENTS.md`, name: 'Experiment log', what: 'Every measurement we have run and what it concluded, newest first.', kind: 'Register' },
  { path: `${REPO}blob/main/scripts/eval/DECISIONS.md`, name: 'Decision ledger', what: 'What we currently do for each kind of text, and the evidence for it.', kind: 'Register' },
  { path: '/research/quality', name: 'How page quality is measured', what: 'The working paper behind the measurements.', kind: 'Report' },
  { path: '/research/canon-quality', name: 'How we check each canon', what: 'The canon-by-canon evidence, prepared for the Eternity working session.', kind: 'Report' },
  { path: '/research/page-errors', name: 'What goes wrong on a page', what: 'The defect classes, from pages read by eye.', kind: 'Report' },
  { path: '/about/models', name: 'AI models', what: 'Which models read and translate which texts.', kind: 'Reference' },
];

export default function QualityMethodsPage() {
  const instruments = methods.instruments as Instrument[];
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="How We Measure Quality"
          subtitle="The rules we hold our measurements to, every instrument we use and what it cannot see, and what we cannot yet measure."
        />
      }
    >
      <div className="max-w-4xl mx-auto font-body text-stone-700 text-lg leading-relaxed">
        <p className="text-sm text-stone-500 mt-8">
          As of {methods.as_of}. Part of the <a href="/quality" className="text-amber-800 underline underline-offset-2">Quality Center</a>.
          This page is generated from{' '}
          <A to="src/data/quality-methods.json">one register file</A>; each figure links to the write-up it comes from.
        </p>

        <nav className="mt-6 text-base">
          <a href="#rules" className="text-amber-800 underline underline-offset-2 mr-5">The rules</a>
          <a href="#instruments" className="text-amber-800 underline underline-offset-2 mr-5">The instruments</a>
          <a href="#gaps" className="text-amber-800 underline underline-offset-2 mr-5">What we cannot yet measure</a>
          <a href="#map" className="text-amber-800 underline underline-offset-2">Where things live</a>
        </nav>

        <H2 id="rules">The rules</H2>
        <ol className="list-decimal pl-6 space-y-3">
          {methods.rules.map((r) => (
            <li key={r.id}>
              {r.rule}{' '}
              <a href={href(r.source)} className="text-xs text-amber-800 underline underline-offset-2 whitespace-nowrap">source</a>
            </li>
          ))}
        </ol>

        <H2 id="instruments">The instruments</H2>
        <p>
          Each instrument answers one question and is blind to something. We say which, because a number is only as good as
          what produced it.
        </p>
        <p className="text-base mt-3">
          {(Object.keys(KIND) as Kind[]).map((k) => (
            <span key={k} className="inline-flex items-center mr-4 mb-2">
              <span className={`rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider mr-2 ${KIND[k].className}`}>{KIND[k].label}</span>
              <span className="text-stone-500 text-sm">{KIND[k].note}</span>
            </span>
          ))}
        </p>

        <div className="mt-6 space-y-6">
          {instruments.map((m) => (
            <section key={m.id} id={m.id} className="border border-stone-200 rounded-md p-5 bg-white scroll-mt-24">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <h3 className="font-display text-xl text-stone-900 mr-2">{m.name}</h3>
                <span className={`rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${KIND[m.kind].className}`}>{KIND[m.kind].label}</span>
                <span className="text-xs text-stone-500 uppercase tracking-wider">{STATUS[m.status] ?? m.status}</span>
              </div>
              <p className="italic text-stone-800">{m.question}</p>
              <dl className="mt-3 grid grid-cols-1 sm:grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-base">
                <dt className="text-stone-500">What it covers</dt>
                <dd>{m.scope}. {m.cadence[0].toUpperCase() + m.cadence.slice(1)}.</dd>
                <dt className="text-stone-500">Latest</dt>
                <dd>
                  {m.latest ? (
                    <>
                      {m.latest.headline} ({m.latest.date}).{' '}
                      <a href={href(m.latest.source)} className="text-xs text-amber-800 underline underline-offset-2 whitespace-nowrap">source</a>
                    </>
                  ) : m.link ? (
                    <A to={m.link}>See the page</A>
                  ) : (
                    <span className="text-stone-500">No result yet.</span>
                  )}
                </dd>
                <dt className="text-stone-500">When it finds something</dt>
                <dd>{m.on_finding}</dd>
                <dt className="text-stone-500">Cannot see</dt>
                <dd>{m.blind_to}</dd>
                <dt className="text-stone-500">Work log</dt>
                <dd><A to={`${ISSUE}${m.issue}`}>#{m.issue}</A></dd>
              </dl>
            </section>
          ))}
        </div>

        <H2 id="gaps">What we cannot yet measure</H2>
        <ul className="list-disc pl-6 space-y-3">
          {methods.gaps.map((g) => (
            <li key={g.issue}>
              {g.gap} <A to={`${ISSUE}${g.issue}`}>#{g.issue}</A>
            </li>
          ))}
        </ul>

        <H2 id="map">Where things live</H2>
        <p>
          The Quality Center is the hub. Registers are kept current from one source each; reports are dated studies and
          are not updated after they are published.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-base border-collapse">
            <thead>
              <tr className="text-left text-stone-500 text-sm border-b border-stone-200">
                <th className="py-2 pr-4 font-normal">Page</th>
                <th className="py-2 pr-4 font-normal">Kind</th>
                <th className="py-2 font-normal">What it is for</th>
              </tr>
            </thead>
            <tbody>
              {MAP.map((p) => (
                <tr key={p.path} className="border-b border-stone-100 align-top">
                  <td className="py-2 pr-4"><A to={p.path}>{p.name}</A></td>
                  <td className="py-2 pr-4 text-stone-500">{p.kind}</td>
                  <td className="py-2">{p.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="h-16" />
      </div>
    </ContentPageLayout>
  );
}
