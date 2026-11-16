// PRIOR ART: src/app/api/cron/health-check/route.ts step 5 (reads cron_runs, but is itself called by the
// box's crontab via cron-caller.mjs, so it dies with cron.service and is skipped while paused);
// scripts/workers/pipeline-health-alert.mjs (a cron on the same box). Neither can see a dead cron.service.
//
// Off-box liveness for the main box's cron.service (v2#4528). On 2026-08-31 cron.service was
// OOM-killed and every scheduled job stopped for 25 hours; nothing alarmed because every check was
// itself a cron on that box. This judge runs from a VERCEL cron (a different failure domain) and
// asserts that cron-driven writers on the box have written a `cron_runs` row recently.
//
// It is a LIVENESS assertion ("someone reported within N minutes"), not an error assertion: a dead
// reporter cannot log errors. It does not depend on processing_control.paused — scheduler.mjs writes
// a row ("paused (Nmin)") even while paused, so a pause never reads as an outage and an outage
// during a pause still fires.

/** A cron_runs writer driven by a crontab line on the main box (scripts/workers/crontab.production). */
export interface Witness {
  /** `cron_runs.cron` value */
  cron: string;
  /** how often the crontab line fires, for the message */
  cadence: string;
  /** stale after this many minutes without a row */
  staleAfterMin: number;
}

/**
 * Chosen because each is a plain crontab line that writes a row on EVERY run, including no-op and
 * paused runs. Measured 2026-11-12 over all 30 days cron_runs keeps (TTL): scheduler 21,590 rows and
 * health-check 720, ZERO gaps above these thresholds, so neither would have paged falsely once.
 * sync-pages-content was tried and rejected: 64 gaps over 45 min in the same window (a long run holds
 * its flock and the next five-minute runs write nothing), so it would page as noise.
 * Workers run as systemd services or under the scheduler would keep writing with cron.service dead,
 * so they are deliberately not witnesses.
 */
export const WITNESSES: Witness[] = [
  { cron: 'scheduler', cadence: '*/2 * * * *', staleAfterMin: 20 },
  { cron: 'health-check', cadence: '2 * * * * (cron-caller)', staleAfterMin: 150 },
];

export interface WitnessState {
  cron: string;
  lastRun: Date | null;
  ageMin: number | null;
  stale: boolean;
}

export type LivenessVerdict = 'alive' | 'partial' | 'dead';

export interface LivenessResult {
  verdict: LivenessVerdict;
  witnesses: WitnessState[];
  summary: string;
}

/**
 * `dead`: every witness is stale — cron.service (or the whole box, or its Mongo access) is down.
 * `partial`: some witnesses are stale — one job is broken but cron itself is running.
 * `alive`: all fresh.
 */
export function judgeSchedulerLiveness(
  lastRuns: Record<string, Date | null | undefined>,
  now: Date,
  witnesses: Witness[] = WITNESSES,
): LivenessResult {
  const states: WitnessState[] = witnesses.map((w) => {
    const last = lastRuns[w.cron] ?? null;
    const ageMin = last ? Math.round((now.getTime() - last.getTime()) / 60000) : null;
    const stale = ageMin === null || ageMin > w.staleAfterMin;
    return { cron: w.cron, lastRun: last, ageMin, stale };
  });
  const staleOnes = states.filter((s) => s.stale);
  const verdict: LivenessVerdict =
    staleOnes.length === 0 ? 'alive' : staleOnes.length === states.length ? 'dead' : 'partial';
  const fmt = (s: WitnessState) => `${s.cron} ${s.ageMin === null ? 'never' : `${s.ageMin}min ago`}`;
  const summary =
    verdict === 'alive'
      ? `alive: ${states.map(fmt).join(', ')}`
      : verdict === 'dead'
        ? `DEAD: no cron-driven writer on the main box has reported (${states.map(fmt).join(', ')}). cron.service, the box, or its Mongo access is down.`
        : `partial: stale ${staleOnes.map(fmt).join(', ')}; fresh ${states.filter((s) => !s.stale).map(fmt).join(', ')}`;
  return { verdict, witnesses: states, summary };
}

/** Re-page at most this often while the verdict stays bad. */
export const REPAGE_AFTER_MS = 6 * 60 * 60 * 1000;

export interface AlertState {
  last_verdict?: LivenessVerdict;
  last_sent_at?: Date | string | null;
}

/**
 * What to send this run. A changed verdict always sends (including the recovery to `alive`);
 * an unchanged bad verdict re-sends after REPAGE_AFTER_MS; `alive`→`alive` never sends.
 */
export function alertAction(
  result: LivenessVerdict,
  prev: AlertState | null,
  now: Date,
): 'page' | 'recovered' | 'none' {
  const prevVerdict = prev?.last_verdict ?? 'alive';
  if (result === 'alive') return prevVerdict === 'alive' ? 'none' : 'recovered';
  if (result !== prevVerdict) return 'page';
  const sent = prev?.last_sent_at ? new Date(prev.last_sent_at).getTime() : 0;
  return now.getTime() - sent >= REPAGE_AFTER_MS ? 'page' : 'none';
}
