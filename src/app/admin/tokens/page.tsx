import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { requireSpendViewer } from '@/lib/spend-report';
import {
  accountWeeks, dollarsPerPoint, freshness, mergeJobs, mergeSignals, READING_STALE_HOURS, usageCells, type AccountWeek,
} from '@/lib/token-usage';
import { getTokenUsage } from '@/lib/token-usage-read';
import { JobTable, UsageOverTime, WasteTrends } from './TokenCharts';

/**
 * /admin/tokens (#8201): where the Claude subscription tokens go. For Derek deciding what to run next:
 * is any account about to cap or about to waste quota, what used it, and what looks wasteful.
 * Renderer only: each machine pushes one ops_reports document (scripts/maintenance/token-usage-push.mjs).
 * Same gate as /admin/spend, because it names accounts and private projects. Refused on partner hosts
 * (tenant-global-paths), sent noindex (next.config.ts).
 */
export const metadata: Metadata = {
  title: 'Tokens',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const hours = (h: number) => (h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);

function Section({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-3 content-start min-w-0">
      <h2 className="text-base font-semibold text-stone-900">{title}</h2>
      {intro && <p className="text-xs text-stone-500 max-w-3xl leading-snug">{intro}</p>}
      {children}
    </section>
  );
}

/** One account's week: the state in words, because a colour alone says nothing to a colour-blind reader. */
function weekState(w: AccountWeek, now: Date): { label: string; tone: string } {
  if (w.percent == null) return { label: 'No meter reading', tone: 'text-red-700' };
  if (w.reading_age_hours != null && w.reading_age_hours > READING_STALE_HOURS) return { label: `Meter last read ${hours(w.reading_age_hours)} ago`, tone: 'text-red-700' };
  if (w.percent >= 100) return { label: 'At its cap', tone: 'text-red-700' };
  if (w.caps_in_hours != null) return { label: `Caps in ${hours(w.caps_in_hours)}, before its reset`, tone: w.caps_in_hours <= 48 ? 'text-red-700' : 'text-amber-700' };
  const left = w.resets_at ? (Date.parse(w.resets_at) - now.getTime()) / 3600e3 : null;
  // Early in a week a low burn is not yet waste: only call it when the reset is close enough to matter.
  if (w.unused_at_reset != null && w.unused_at_reset >= 5 && left != null && left <= 48) return { label: `About ${Math.round(w.unused_at_reset)}% will go unused`, tone: 'text-amber-700' };
  if (w.pace_percent != null && w.percent < w.pace_percent) return { label: 'Under even pace', tone: 'text-stone-600' };
  return { label: 'Over even pace', tone: 'text-stone-600' };
}

function WeekMeter({ w, now }: { w: AccountWeek; now: Date }) {
  const state = weekState(w, now);
  const left = w.resets_at ? (Date.parse(w.resets_at) - now.getTime()) / 3600e3 : null;
  return (
    <div className="rounded border border-stone-200 bg-white px-4 py-3 grid gap-1.5 content-start min-w-0">
      <div className="flex justify-between gap-2 items-baseline">
        <span className="text-xs text-stone-700 truncate" title={w.account}>{w.account}</span>
        <span className="text-lg font-semibold text-stone-900 tabular-nums">{w.percent ?? '—'}%</span>
      </div>
      <div className="relative h-2 rounded bg-stone-100" role="img" aria-label={`${w.percent ?? 'unknown'} percent used; even pace would be ${w.pace_percent == null ? 'unknown' : Math.round(w.pace_percent)} percent`}>
        <div className="absolute inset-y-0 left-0 rounded bg-[#2a78d6]" style={{ width: `${Math.min(100, w.percent ?? 0)}%` }} />
        {w.pace_percent != null && <div className="absolute -inset-y-1 w-0.5 bg-stone-900" style={{ left: `${w.pace_percent}%` }} />}
      </div>
      <div className={`text-xs font-medium ${state.tone}`}>{state.label}</div>
      <div className="text-[11px] text-stone-500 leading-snug">
        {w.burn != null && w.budget != null ? `Burning ${w.burn.toFixed(1)}%/h (last 6 h), sustainable ${w.budget.toFixed(1)}%/h` : 'No burn figure'}
        {left != null && left > 0 ? ` · resets in ${hours(left)}` : ''}
      </div>
    </div>
  );
}

export default async function TokensPage() {
  await requireSpendViewer();
  const { docs, meters } = await getTokenUsage();
  const now = new Date();

  if (!docs.length) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-8 text-sm text-stone-700">
        <h1 className="text-xl font-semibold text-stone-900 mb-2">Tokens</h1>
        No machine has pushed yet. Run <code>scripts/maintenance/token-usage-push.mjs --box &lt;name&gt;</code>.
      </main>
    );
  }

  const machines = freshness(docs, now);
  const stale = machines.filter(m => m.stale);
  const weeks = accountWeeks(docs, meters, now);
  const perPoint = dollarsPerPoint(weeks, machines);
  const signals = mergeSignals(docs).slice(-14);
  const jobs = mergeJobs(docs, now);
  const total7 = weeks.reduce((t, w) => t + w.transcript_7d, 0);
  const points7 = weeks.reduce((t, w) => t + w.points_7d, 0);
  const burn = weeks.reduce((t, w) => t + (w.burn || 0), 0);
  const budget = weeks.reduce((t, w) => t + (w.budget || 0), 0);

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 grid gap-8 min-w-0">
      <header className="grid gap-1">
        <h1 className="text-xl font-semibold text-stone-900">Tokens</h1>
        <p className="text-sm text-stone-600 max-w-3xl">
          Claude subscription use across the job boxes and the laptop. Last 7 days: <b>{usd(total7)} $-eq</b> and <b>{points7} weekly points</b>
          {perPoint ? <>, so 1 point is about <b>{usd(perPoint)}</b></> : null}.
          $-eq is API list price, a common unit, not money paid: the subscriptions are flat.
        </p>
        {stale.length > 0 && (
          <p className="text-sm font-medium text-red-700">
            Incomplete: no recent data from {stale.map(m => `${m.box} (${hours(m.age_hours)} old)`).join(', ')}. Totals leave it out or lag, and points per job are not shown.
          </p>
        )}
      </header>

      <Section title="This week, by account" intro={<>The black tick is where an even burn would stand now. All accounts together are burning {burn.toFixed(1)}%/h against a sustainable {budget.toFixed(1)}%/h.</>}>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {weeks.map(w => <WeekMeter key={w.account} w={w} now={now} />)}
        </div>
      </Section>

      <Section title="Usage over time">
        <UsageOverTime cells={usageCells(docs)} perPoint={perPoint} />
      </Section>

      <Section title="Waste signals" intro="Daily totals across all machines. Hover a bar for that day. A high figure is a question to ask, not a verdict: some long sessions and Opus subagents are worth it.">
        <WasteTrends rows={signals} />
      </Section>

      <Section title="Jobs" intro={<>Add <code>Estimate: 5 pts</code> to a brief's first lines to compare it with actual use here. A job is marked over past 1.5 times its estimate. Nothing is enforced.</>}>
        <JobTable jobs={jobs} perPoint={perPoint} />
      </Section>

      <Section title="What this can and cannot see" intro={<>Calls made with <code>--no-session-persistence</code> leave no transcript, so they move the meter without showing here. A low $-eq per point on an account suggests how much is missing. agy reports no token counts and is not on this page.</>}>
        <div className="overflow-x-auto rounded border border-stone-200 bg-white">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-600">
              <tr><th className="px-2 py-1 text-left font-medium">Account</th><th className="px-2 py-1 text-right font-medium">Points, 7 days</th><th className="px-2 py-1 text-right font-medium">Transcript $-eq</th><th className="px-2 py-1 text-right font-medium">$-eq per point</th></tr>
            </thead>
            <tbody>
              {weeks.map(w => (
                <tr key={w.account} className="border-b border-stone-100 last:border-0">
                  <td className="px-2 py-1 text-stone-800">{w.account}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{w.points_7d}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{usd(w.transcript_7d)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{w.per_point ? usd(w.per_point) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="text-xs text-stone-600 grid gap-0.5">
          {machines.map(m => (
            <li key={m.box}><b className="text-stone-800">{m.box}</b>: read {hours(m.age_hours)} ago, {m.files.toLocaleString('en-US')} transcripts{m.jobs_omitted ? `, ${m.jobs_omitted} smallest jobs left out of the table` : ''}{m.stale ? ' (stale)' : ''}</li>
          ))}
        </ul>
      </Section>
    </main>
  );
}
