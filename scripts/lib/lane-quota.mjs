#!/usr/bin/env node
// PRIOR ART: scripts/workers/spare-lane.py decide() (#6395) — the weekly pacing this copies: on pace against an even
// burn of the week, the last 48 h open to 90%, stop at 92% weekly / 85% session. It decides whether to START a spare
// job, not whether a lane may keep spending, and it is Python. scripts/lib/model-limits.mjs (claudeBlocked, agyBlocked)
// — the wall: never call a locked model. It knows no share and no pace. refused-pages.mjs weeklyPct() and
// cli-translate-lane.mjs — a fixed 70% cap each, no pace, no free stretch. None says "this lane's share of the week".
/**
 * The quota gate of a subscription lane (#7301 item 2): may lane L spend its account's quota right now?
 *
 * The unit is a SHARE OF THE ACCOUNT'S WEEK (lanes.mjs QUOTA_METERS, `quota: { meter, share }`). The default of
 * Derek's decision D13 on #5469, taken as the default. Rules, first match wins:
 *
 *   locked     the meter says the model or account is at its wall          → idle; the book waits (never the API)
 *   end-of-week  only for a lane with `quota.endOfWeek: { weekly, hours }`: the week resets within `hours` and weekly <
 *              `weekly`, 5-hour < 85%                                    → OPEN, priced $0, past the 92% stop line. The
 *              Opus translate lane runs to 95% in the last 24 h (#7448; Derek chose 95 over the shared 90 on #7387)
 *   stop       weekly ≥ 92% or 5-hour ≥ 85% (spare-lane.py's stop line)     → idle; the rest is for interactive use
 *   spare      the week resets within 48 h, weekly < 90%, 5-hour < 70%     → OPEN, priced $0, the share is lifted:
 *              quota left at a reset is lost (Derek, 2026-10-26), so spare-lane.py and every lane may spend it
 *   ceiling    weekly ≥ share × 100                                         → idle until the reset
 *   pace       only for a lane with `quota.paced`: weekly ahead of an even burn of the week (elapsed share × 100),
 *              or 5-hour ≥ 60% (spare-lane.py's normal start line)          → idle for now
 *   open       otherwise                                                    → open
 *
 * `paced` is off for every lane today: the runners ran to a fixed 70% before this gate, and on 2026-10-26 an even
 * burn would have idled l7a's refused-pages cron (account at 66% with 44% of the week gone). Turning it on trades
 * throughput for interactive headroom early in the week, which is a call for whoever owns the account.
 *   unmetered  no fresh meter on this box                                   → open: the reader's own limit reply
 *              stops it (model-limits.mjs: "a missing or stale meter is unknown, which allows the call")
 *
 * The agy meter has no weekly percent yet, only locked models, so an agy lane is `locked` or `unmetered`; its share is
 * recorded and waits for the meter (#7263, "agy weekly cap from all boxes").
 *
 *   node scripts/lib/lane-quota.mjs <lane> [--model=<agy model>]   prints the verdict as JSON; exit 0 open, 3 idle
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { laneByName } from './lanes.mjs';
import { claudeUsage, agyBlocked } from './model-limits.mjs';

/** spare-lane.py's lines, the same numbers (tests/unit/lane-quota.test.ts reads the .py and pins them). */
export const PACE = Object.freeze({
  WEEK_S: 7 * 86400,
  LAST_STRETCH_S: 2 * 86400,
  STOP_WEEKLY: 92, STOP_SESSION: 85,
  SPARE_WEEKLY: 90, SPARE_SESSION: 70,
  PACED_SESSION: 60,
});

/**
 * The verdict, pure. `usage` is what the lane's meter says:
 *   climits: { weekly, session, weeklyReset } (percent, percent, ISO) — claudeUsage()
 *   agy:     { locked_until } (ISO or null)
 *   null:    no fresh meter
 * @returns {{ open: boolean, state: string, why: string, priced_usd: 0|null, until?: string|null }}
 */
export function quotaGate(quota, usage, { now = Date.now() } = {}) {
  if (!quota || !quota.meter) return { open: false, state: 'no-quota', why: 'the lane declares no quota: a subscription lane with no quota idles', priced_usd: null };
  const share = Number(quota.share);
  if (quota.meter === 'agy') {
    if (usage?.locked_until && Date.parse(usage.locked_until) > now) return { open: false, state: 'locked', why: `agy locked until ${usage.locked_until}; the book waits`, priced_usd: null, until: usage.locked_until };
    return { open: true, state: 'unmetered', why: `agy meter reports locks only; share ${share} recorded, not yet measurable (#7263)`, priced_usd: null };
  }
  if (!usage || usage.weekly == null) return { open: true, state: 'unmetered', why: 'no fresh climits meter on this box; the reader stops on its own limit reply', priced_usd: null };
  const w = Number(usage.weekly), s = Number(usage.session ?? 0);
  if (w >= 98 || s >= 98) return { open: false, state: 'locked', why: `account at its wall (weekly ${w}%, 5-hour ${s}%)`, priced_usd: null, until: w >= 98 ? usage.weeklyReset ?? null : null };
  const eow = quota.endOfWeek, eowReset = Date.parse(usage.weeklyReset ?? '');
  if (eow && !Number.isNaN(eowReset) && (eowReset - now) / 1000 <= eow.hours * 3600 && w < eow.weekly && s < PACE.STOP_SESSION) {
    return { open: true, state: 'spare', why: `last ${Math.round((eowReset - now) / 3600000)} h of the week at ${w}%: this lane runs to ${eow.weekly}% before the reset, priced $0`, priced_usd: 0 };
  }
  if (w >= PACE.STOP_WEEKLY || s >= PACE.STOP_SESSION) return { open: false, state: 'stop', why: `weekly ${w}% / 5-hour ${s}%: the rest is left for interactive use`, priced_usd: null };
  const reset = Date.parse(usage.weeklyReset ?? '');
  if (Number.isNaN(reset)) return { open: false, state: 'pace', why: 'weekly reset time unknown, so the pace cannot be read', priced_usd: null };
  const left = (reset - now) / 1000;
  if (left <= PACE.LAST_STRETCH_S) {
    if (w < PACE.SPARE_WEEKLY && s < PACE.SPARE_SESSION) return { open: true, state: 'spare', why: `last ${Math.round(left / 3600)} h of the week at ${w}%: quota left at the reset is lost, priced $0`, priced_usd: 0 };
    return { open: false, state: 'stop', why: `last stretch but weekly ${w}% / 5-hour ${s}%`, priced_usd: null };
  }
  if (Number.isFinite(share) && w >= share * 100) return { open: false, state: 'ceiling', why: `weekly ${w}% ≥ this lane's share ${Math.round(share * 100)}%`, priced_usd: null };
  const fair = 100 * (1 - left / PACE.WEEK_S);
  if (quota.paced && (w > fair || s >= PACE.PACED_SESSION)) return { open: false, state: 'pace', why: `weekly ${w}% vs an even burn ${fair.toFixed(0)}%, 5-hour ${s}%: ahead of pace`, priced_usd: null };
  return { open: true, state: 'open', why: `weekly ${w}% under this lane's share ${Math.round(share * 100)}% (an even burn would be ${fair.toFixed(0)}%)`, priced_usd: null };
}

/** The live verdict for a registered lane on this box. `maxWeeklyPct` (a runner's --max-weekly-pct) overrides the share. */
export function laneQuota(laneName, { model = null, maxWeeklyPct = null, now = Date.now() } = {}) {
  const lane = laneByName(laneName);
  if (!lane) throw new Error(`lane-quota: no lane ${laneName} in scripts/lib/lanes.mjs`);
  if (lane.budget !== 'quota-share') throw new Error(`lane-quota: ${laneName} is budgeted '${lane.budget}', not a quota share`);
  const quota = maxWeeklyPct != null ? { ...lane.quota, share: Number(maxWeeklyPct) / 100 } : lane.quota;
  let usage = null;
  if (quota.meter === 'climits') usage = claudeUsage();
  else if (quota.meter === 'agy') { const b = model ? agyBlocked(model) : null; usage = { locked_until: b?.until ?? null }; }
  return { lane: laneName, meter: quota.meter, share: quota.share, ...quotaGate(quota, usage, { now }) };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const name = process.argv[2];
  if (!name || name.startsWith('--')) { console.error('usage: lane-quota.mjs <lane> [--model=M]'); process.exit(2); }
  const model = process.argv.find((a) => a.startsWith('--model='))?.slice(8) ?? null;
  const v = laneQuota(name, { model });
  console.log(JSON.stringify(v));
  process.exit(v.open ? 0 : 3);
}
