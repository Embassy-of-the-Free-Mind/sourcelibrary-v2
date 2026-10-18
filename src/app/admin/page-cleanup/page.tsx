import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getSiteStats } from '@/lib/site-stats';
import {
  CHECK, DECISIONS, HANDLED_BY, NUMBERS, RULES, STEPS, TRIAGE,
  type Action, type StepStatus,
} from './data';

/**
 * /admin/page-cleanup — where the site cleanup stands: what the 17 October page check found,
 * the ground rules, the order of work with its pull requests, open decisions, every page in
 * the triage and every hard-coded count. Data lives in ./data.ts; update STEPS as PRs move.
 * The live figures come from getSiteStats(), the same source the numbers should all read.
 * Gate: the admin layout's requireAdmin(); noindex.
 */
export const metadata: Metadata = {
  title: 'Page cleanup',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export const dynamic = 'force-dynamic';

const REPO = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2';
const LINK = 'text-accent-rust hover:underline';

const GROUPS: { action: Action; title: string; note: string }[] = [
  { action: 'fix', title: 'Fix', note: 'Stays live; something on it is broken.' },
  { action: 'internal', title: 'Internal', note: 'Admins only, same URL. Never indexed.' },
  { action: 'draft', title: 'Draft', note: 'Admins only with a Draft bar; meant to go live later.' },
  { action: 'archive', title: 'Archive', note: 'Visitors go to the successor; admins can still open it.' },
  { action: 'merge', title: 'Merge', note: 'Overlapping pages; needs a decision on which one stays.' },
  { action: 'link', title: 'Link', note: 'Good page nobody can find.' },
];

const STATUS_TONE: Record<StepStatus, string> = {
  merged: 'bg-green-100 text-green-800',
  'in review': 'bg-amber-100 text-amber-800',
  'not started': 'bg-stone-100 text-stone-600',
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="grid gap-3 content-start min-w-0 scroll-mt-16">
      <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
      {children}
    </section>
  );
}

function Pr({ n }: { n: number }) {
  return <a href={`${REPO}/pull/${n}`} className={LINK}>#{n}</a>;
}

function visitors(v: number | null) {
  return v === null ? '–' : v.toLocaleString('en-GB');
}

export default async function PageCleanupPage() {
  const stats = await getSiteStats();
  const today: [string, number][] = [
    ['Books', stats.totalBooks],
    ['Readable in English', stats.readableInEnglish],
    ['First English translations', stats.firstTranslationCount],
    ['Authors', stats.authorCount],
    ['Languages', stats.languageCount],
    ['Artworks', stats.artworkCount],
    ['Illustrations', stats.illustrationCount],
  ];
  const done = STEPS.filter((s) => s.status === 'merged').length;
  const inReview = STEPS.filter((s) => s.status === 'in review').length;

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 grid gap-10">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold text-stone-900">Page cleanup</h1>
        <p className="text-sm text-stone-600 max-w-3xl leading-relaxed">
          Every page route on main (commit {CHECK.commit}) was loaded on sourcelibrary.org on {CHECK.date},
          first as raw HTML and then in Chrome. This page tracks what the check found and the plan to clean it up.
          {' '}{STEPS.length} steps: {done} merged, {inReview} in review, {STEPS.length - done - inReview} not started.
        </p>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a href="#plan" className={LINK}>Plan</a>
          <a href="#decisions" className={LINK}>Decisions</a>
          <a href="#pages" className={LINK}>Pages</a>
          <a href="#numbers" className={LINK}>Numbers</a>
        </nav>
      </header>

      <Section id="found" title="What the check found">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {CHECK.figures.map(([n, label]) => (
            <div key={label} className="rounded border border-stone-200 bg-white px-3 py-2">
              <div className="text-xl font-semibold tabular-nums text-stone-900">{n}</div>
              <div className="text-xs text-stone-600 leading-snug">{label}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="rules" title="Ground rules">
        <ul className="grid gap-1.5 text-sm text-stone-700 list-disc pl-5 max-w-3xl">
          {RULES.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </Section>

      <Section id="plan" title="Order of work">
        <p className="text-sm text-stone-600">One concern per pull request. Each gets a preview and waits for a yes before merging.</p>
        <ol className="grid rounded border border-stone-200 bg-white divide-y divide-stone-100">
          {STEPS.map((s, i) => (
            <li key={s.title} className="px-3 py-3 grid gap-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-medium text-stone-900">
                  <span className="tabular-nums text-stone-500 mr-1.5">{i + 1}.</span>{s.title}
                </span>
                <span className={`text-xs rounded px-1.5 py-0.5 ${STATUS_TONE[s.status]}`}>{s.status}</span>
                {s.needsDecision ? <span className="text-xs rounded px-1.5 py-0.5 bg-red-50 text-red-700">waits on a decision</span> : null}
                {s.prs.length ? (
                  <span className="text-sm ml-auto flex gap-2">
                    {s.prs.map((n) => <Pr key={n} n={n} />)}
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-stone-600 leading-snug">{s.detail}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="decisions" title="Decisions waiting">
        <dl className="grid rounded border border-stone-200 bg-white divide-y divide-stone-100">
          {DECISIONS.map(([q, text]) => (
            <div key={q} className="px-3 py-2 grid sm:grid-cols-[14rem_1fr] gap-x-4 gap-y-0.5 text-sm">
              <dt className="font-medium text-stone-900">{q}</dt>
              <dd className="text-stone-700 leading-snug">{text}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="pages" title="Every page in the triage">
        <p className="text-sm text-stone-600">Visitors are humans over the 90 days before the check; a dash means not measured.</p>
        {GROUPS.map((g) => {
          const rows = TRIAGE.filter((r) => r[1] === g.action);
          if (!rows.length) return null;
          return (
            <div key={g.action} className="grid gap-2 min-w-0">
              <h3 className="text-sm font-semibold text-stone-900">
                {g.title} <span className="tabular-nums font-normal text-stone-500">({rows.length})</span>
                <span className="font-normal text-stone-600"> · {g.note}</span>
              </h3>
              <div className="overflow-x-auto rounded border border-stone-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-stone-500 border-b border-stone-200">
                    <tr>
                      <th className="px-3 py-2 font-medium">Page</th>
                      {g.action === 'archive' || g.action === 'merge' ? <th className="px-3 py-2 font-medium">Goes to</th> : null}
                      <th className="px-3 py-2 font-medium">Why</th>
                      <th className="px-3 py-2 font-medium text-right">Visitors</th>
                      <th className="px-3 py-2 font-medium">Done in</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 align-top">
                    {rows.map(([page, , to, why, v]) => (
                      <tr key={page}>
                        <td className="px-3 py-2 font-medium text-stone-900 min-w-[12rem]">{page}</td>
                        {g.action === 'archive' || g.action === 'merge' ? <td className="px-3 py-2 text-stone-700 min-w-[10rem]">{to}</td> : null}
                        <td className="px-3 py-2 text-stone-700 min-w-[16rem]">{why}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-stone-700">{visitors(v)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{HANDLED_BY[page] ? <Pr n={HANDLED_BY[page]} /> : <span className="text-stone-400">–</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </Section>

      <Section id="numbers" title="Hard-coded numbers">
        <p className="text-sm text-stone-600 max-w-3xl">
          Today&apos;s figures, from the daily stats every page should read (system_config.homepage_stats via getSiteStats()):
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {today.map(([label, n]) => (
            <div key={label} className="rounded border border-stone-200 bg-white px-3 py-2">
              <div className="text-lg font-semibold tabular-nums text-stone-900">{n.toLocaleString('en-GB')}</div>
              <div className="text-xs text-stone-600 leading-snug">{label}</div>
            </div>
          ))}
        </div>
        <p className="text-sm text-stone-600">Places that typed their own count instead ({NUMBERS.length}):</p>
        <div className="overflow-x-auto rounded border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500 border-b border-stone-200">
              <tr>
                <th className="px-3 py-2 font-medium">Where</th>
                <th className="px-3 py-2 font-medium">Says</th>
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 align-top">
              {NUMBERS.map(([where, file, says, note]) => (
                <tr key={where}>
                  <td className="px-3 py-2 font-medium text-stone-900 min-w-[10rem]">{where}</td>
                  <td className="px-3 py-2 text-stone-700 min-w-[12rem]">{says}</td>
                  <td className="px-3 py-2 text-stone-500 text-xs break-all min-w-[10rem]">{file}</td>
                  <td className="px-3 py-2 text-stone-700 min-w-[12rem]">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </main>
  );
}
