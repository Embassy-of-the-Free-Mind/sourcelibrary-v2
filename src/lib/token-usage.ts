/**
 * Claude CLI token use across the machines (/admin/tokens, #8201).
 *
 * PRIOR ART: src/lib/spend-report.ts (vendor bills, one authored document; its gate is reused) and
 * src/lib/pipeline-now.ts (reads the account meter `claude-limits:latest`, reused here). Neither holds
 * per-job tokens. Each machine writes one `token-usage:<box>` document with
 * scripts/maintenance/token-usage-push.mjs; token-usage-read.ts fetches them and this file merges them.
 * Pure, with no database import, because the page's client charts import it too.
 *
 * Units: $-eq is API list price, not money paid. A point is 1% of one account's weekly limit.
 */

export interface Parts { input: number; write: number; read: number; output: number }
export interface DayRow { day: string; account: string; model: string; cost: number; req: number; parts: Parts }
export interface SignalRow {
  day: string; cost: number; big: number; huge: number; sub: number; sub_opus: number;
  polls: number; poll_cost: number; fat_calls: number; fat_cost: number;
}
export interface JobRow {
  job: string; account: string; cost: number; req: number; max_ctx: number; avg_ctx: number; big: number;
  sub: number; sub_opus: number; polls: number; poll_cost: number; sessions: number; first: string; last: string;
  parts: Parts; estimate_pts: number | null;
}
export interface UsageDoc {
  box: string; generated_at: string; window_days: number; files: number; accounts: string[];
  days: DayRow[]; signals: SignalRow[]; jobs: JobRow[]; jobs_omitted: number; jobs_omitted_cost: number;
}
export interface MeterSeries { account: string; points: { hour: string; pct: number }[] }
export interface LimitReading {
  key: string; percent: number; resets_at: string | null; budget_pct_per_h: number | null;
  burn_pct_per_h: number | null; pace_hits_in_s: number | null; unused_at_reset_pct: number | null;
}
export interface LimitsDoc { checked_at: string; accounts: { email: string; ok: boolean; limits: LimitReading[] | null }[] }

/** A box runs hourly and should never be this old. The laptop sleeps, so it gets a day. */
const STALE_HOURS: Record<string, number> = { laptop: 26 };
const DEFAULT_STALE_HOURS = 4;

export interface MachineFreshness { box: string; generated_at: string; age_hours: number; stale: boolean; files: number; accounts: string[]; jobs_omitted: number }

export function freshness(docs: UsageDoc[], now: Date): MachineFreshness[] {
  return docs.map(d => {
    const age = (now.getTime() - Date.parse(d.generated_at)) / 3600e3;
    return {
      box: d.box, generated_at: d.generated_at, age_hours: age, stale: age > (STALE_HOURS[d.box] ?? DEFAULT_STALE_HOURS),
      files: d.files, accounts: d.accounts, jobs_omitted: d.jobs_omitted,
    };
  }).sort((a, b) => a.box.localeCompare(b.box));
}

/** Points used since `sinceHour`: rises add, and a reset counts its new reading. Hours are `YYYY-MM-DDTHH`. */
export function pointsUsed(series: MeterSeries, sinceHour: string): number {
  let used = 0;
  let prev: number | null = null;
  for (const p of series.points) {
    if (prev != null && p.hour >= sinceHour) used += p.pct >= prev ? p.pct - prev : p.pct;
    prev = p.pct;
  }
  return used;
}

export interface AccountWeek {
  account: string; percent: number | null; resets_at: string | null; pace_percent: number | null;
  budget: number | null; burn: number | null; caps_in_hours: number | null; unused_at_reset: number | null;
  points_7d: number; transcript_7d: number; per_point: number | null;
}

const WEEK_HOURS = 168;

/** Where an even burn would stand now, given when the week resets. */
export function evenPacePercent(resetsAt: string | null, now: Date): number | null {
  if (!resetsAt) return null;
  const left = (Date.parse(resetsAt) - now.getTime()) / 3600e3;
  if (!Number.isFinite(left)) return null;
  return Math.max(0, Math.min(100, 100 * (1 - left / WEEK_HOURS)));
}

export const dayOffset = (now: Date, days: number) => new Date(now.getTime() - days * 86400e3).toISOString().slice(0, 10);

export function accountWeeks(docs: UsageDoc[], meter: MeterSeries[], limits: LimitsDoc | null, now: Date): AccountWeek[] {
  const sinceHour = new Date(now.getTime() - 7 * 86400e3).toISOString().slice(0, 13);
  const sinceDay = sinceHour.slice(0, 10);
  const cost = new Map<string, number>();
  for (const d of docs) for (const r of d.days) if (r.day >= sinceDay) cost.set(r.account, (cost.get(r.account) || 0) + r.cost);

  const names = new Set<string>([...cost.keys(), ...meter.map(m => m.account), ...(limits?.accounts || []).map(a => a.email)]);
  return [...names].filter(a => a !== 'unknown').sort().map(account => {
    const series = meter.find(m => m.account === account);
    const week = limits?.accounts.find(a => a.email === account)?.limits?.find(l => l.key === 'weekly_all:all') ?? null;
    const points = series ? pointsUsed(series, sinceHour) : 0;
    const transcript = cost.get(account) || 0;
    return {
      account,
      percent: week?.percent ?? null,
      resets_at: week?.resets_at ?? null,
      pace_percent: evenPacePercent(week?.resets_at ?? null, now),
      budget: week?.budget_pct_per_h ?? null,
      burn: week?.burn_pct_per_h ?? null,
      caps_in_hours: week?.pace_hits_in_s != null ? week.pace_hits_in_s / 3600 : null,
      unused_at_reset: week?.unused_at_reset_pct ?? null,
      points_7d: points,
      transcript_7d: transcript,
      per_point: points > 0 ? transcript / points : null,
    };
  });
}

/**
 * $-eq per point across every account, last 7 days. Null while any machine is stale: points count every
 * account but a missing machine removes only its dollars, so the ratio would be wrong, not just rough
 * (W45 reported $17.7 instead of about $22 that way).
 */
export function dollarsPerPoint(weeks: AccountWeek[], machines: MachineFreshness[]): number | null {
  if (!machines.length || machines.some(m => m.stale)) return null;
  const points = weeks.reduce((t, w) => t + w.points_7d, 0);
  const dollars = weeks.reduce((t, w) => t + w.transcript_7d, 0);
  return points > 0 ? dollars / points : null;
}

export type Dimension = 'account' | 'machine' | 'model' | 'part';
export interface UsageCell { day: string; dim: Dimension; key: string; cost: number }

/** Long-form cells for the over-time chart, so the client only groups and draws. */
export function usageCells(docs: UsageDoc[]): UsageCell[] {
  const m = new Map<string, UsageCell>();
  const add = (day: string, dim: Dimension, key: string, cost: number) => {
    const k = `${day}|${dim}|${key}`;
    const c = m.get(k);
    if (c) c.cost += cost; else m.set(k, { day, dim, key, cost });
  };
  for (const d of docs) for (const r of d.days) {
    add(r.day, 'account', r.account, r.cost);
    add(r.day, 'machine', d.box, r.cost);
    add(r.day, 'model', r.model, r.cost);
    add(r.day, 'part', 'cache read', r.parts.read);
    add(r.day, 'part', 'cache write', r.parts.write);
    add(r.day, 'part', 'output', r.parts.output);
    add(r.day, 'part', 'input', r.parts.input);
  }
  return [...m.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function mergeSignals(docs: UsageDoc[]): SignalRow[] {
  const m = new Map<string, SignalRow>();
  for (const d of docs) for (const s of d.signals) {
    const c = m.get(s.day);
    if (!c) { m.set(s.day, { ...s }); continue; }
    for (const k of ['cost', 'big', 'huge', 'sub', 'sub_opus', 'polls', 'poll_cost', 'fat_calls', 'fat_cost'] as const) c[k] += s[k];
  }
  return [...m.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export interface BoardJob extends JobRow { box: string; active_recent: boolean }

export function mergeJobs(docs: UsageDoc[], now: Date): BoardJob[] {
  const recent = new Date(now.getTime() - 7 * 86400e3).toISOString();
  return docs.flatMap(d => d.jobs.map(j => ({ ...j, box: d.box, active_recent: j.last >= recent }))).sort((a, b) => b.cost - a.cost);
}

export type EstimateVerdict = 'none' | 'within' | 'over';
/** Over means more than 1.5 times the estimate: a brief's estimate is a guess, not a contract. */
export function estimateVerdict(estimatePts: number | null, actualPts: number | null): EstimateVerdict {
  if (estimatePts == null || actualPts == null) return 'none';
  return actualPts > estimatePts * 1.5 ? 'over' : 'within';
}
