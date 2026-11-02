// PRIOR ART: scripts/batch/siku-translate-lane.mjs — the pool reader and picker this is moved out of, unchanged in
// behaviour (#5600), so cli-ocr-lane.mjs correct (#7263) can choose a pool the same way instead of writing a second
// picker. scripts/workers/agy-guard.sh — AGY_HOME itself (second login, per-account stop files, allowed-model).
// scripts/lib/lane-quota.mjs — the CLAUDE account's weekly gate (climits percent); it does not read agy pools, so the
// agy weekly reserve (#7911) lives here, beside the pool reader.
/**
 * agy-pools — which agy login (pool) a lane spends, read from the pool itself (#5600, #7263).
 *
 * A box can carry more than one agy login: the default HOME and each AGY_HOME in POOL_HOMES. Every Gemini model of a
 * login draws one weekly pool and one 5-hour bucket. `agy -p /quota --output-format json` reads both (0 tokens).
 *
 * BUSY. A non-default pool that another process is using (AGY_HOME in its environment) is "busy": a measurement job
 * may own it. A lane that only SHARES a pool marks its own process and children AGY_POOL_SHARED=1 (agyEnv), and is
 * not counted, so two lanes on one pool do not push each other off it. SIKU_LANE_CHILD=1 is the Siku lane's older mark.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Other agy logins this box may carry (scripts/workers/agy-guard.sh AGY_HOME, #7517). */
export const POOL_HOMES = Object.freeze(['/root/.agy-james']);
/** Env marks of lanes that share a pool rather than own it (see BUSY). */
export const SHARED_MARKS = Object.freeze(['AGY_POOL_SHARED=1', 'SIKU_LANE_CHILD=1']);

/** Gemini buckets of `agy -p /quota --output-format json` stdout: [{ id, window, remaining_fraction, reset_time }], or null. */
export function quotaBuckets(stdout) {
  let j;
  try { j = JSON.parse(String(stdout).trim().split('\n').filter((l) => l.startsWith('{')).pop()); } catch { return null; }
  const groups = j?.command?.data?.groups;
  if (j?.status !== 'SUCCESS' || !Array.isArray(groups)) return null;
  return groups.filter((x) => /gemini/i.test(x.name || '')).flatMap((g) => g.buckets || []);
}

/** `agy -p /quota --output-format json` stdout → { weekly, weeklyReset, fiveHour, fiveHourReset } (fractions), or null. */
export function parseQuota(stdout) {
  const buckets = quotaBuckets(stdout);
  const b = (w) => buckets?.find((x) => x.window === w);
  const wk = b('weekly');
  if (!wk || typeof wk.remaining_fraction !== 'number') return null;
  return { weekly: wk.remaining_fraction, weeklyReset: wk.reset_time ?? null, fiveHour: b('5h')?.remaining_fraction ?? null, fiveHourReset: b('5h')?.reset_time ?? null, claude: claudeQuota(stdout) };
}

/**
 * The same reply's "Claude and GPT models" group, a separate pool per login: { weekly, weeklyReset, fiveHour,
 * fiveHourReset } or null. Read for display (/admin/pipeline/now, climits); lanes spend it only through agyClaudeGate
 * (scripts/lib/agy-cli.mjs, #7545).
 */
export function claudeQuota(stdout) {
  let j;
  try { j = JSON.parse(String(stdout).trim().split('\n').filter((l) => l.startsWith('{')).pop()); } catch { return null; }
  const g = j?.status === 'SUCCESS' ? j?.command?.data?.groups?.find?.((x) => /claude/i.test(x.name || '')) : null;
  const b = (w) => g?.buckets?.find((x) => x.window === w);
  if (typeof b('weekly')?.remaining_fraction !== 'number') return null;
  const f = (x) => (typeof x?.remaining_fraction === 'number' ? x.remaining_fraction : null);
  return { weekly: f(b('weekly')), weeklyReset: b('weekly')?.reset_time ?? null, fiveHour: f(b('5h')), fiveHourReset: b('5h')?.reset_time ?? null };
}

/** The env a child runs agy in: AGY_HOME set for a second login, removed for the default one; marked as sharing. */
export function agyEnv(home, base = process.env, extra = {}) {
  const env = { ...base, AGY_POOL_SHARED: '1', ...extra };
  if (home) env.AGY_HOME = home; else delete env.AGY_HOME;
  return env;
}

/** Is another process using this AGY_HOME without a shared mark (e.g. a measurement job)? Returns its pid or null. */
export function homeBusy(home) {
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    if (Number(pid) === process.pid) continue;
    let env;
    try { env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0'); } catch { continue; }
    if (!env.includes(`AGY_HOME=${home}`)) continue;
    if (SHARED_MARKS.some((m) => env.includes(m))) continue;
    return Number(pid);
  }
  return null;
}

/** Raw `agy -p /quota` stdout for a pool (null home = default login), or '' when the call failed. */
export function readQuotaStdout(home, { model = null, env = {} } = {}) {
  const r = spawnSync('agy', ['-p', '/quota', '--output-format', 'json', ...(model ? ['--model', model] : [])],
    { encoding: 'utf8', env: agyEnv(home, process.env, env), timeout: 120e3, cwd: os.tmpdir() });
  return r.stdout || '';
}

/** One pool's reading (parseQuota), tried twice, or null. */
export function readPool(home, opts) {
  for (let i = 0; i < 2; i++) {
    const q = parseQuota(readQuotaStdout(home, opts));
    if (q) return q;
  }
  return null;
}

/** Every pool on the box: [{ home, busy, reading }], the default login first. */
export function readPools({ homes = POOL_HOMES, ...opts } = {}) {
  return [null, ...homes.filter((h) => fs.existsSync(h))].map((home) => ({ home, busy: home ? homeBusy(home) : null, reading: readPool(home, opts) }));
}

/** The pool to use: of the pools not busy and read, the one with most weekly remaining, if `gate(reading).open`. */
export function choosePool(pools, gate) {
  // Every open pool is a candidate, not just the fullest: a fuller pool under its own floor must not shut a
  // smaller one that is above its line (2026-10-29: enrich-agy called nothing for days while the main pool was open).
  const ok = pools.filter((p) => !p.busy && p.reading).map((p) => ({ ...p, gate: gate(p.reading) })).filter((p) => p.gate.open);
  ok.sort((a, b) => b.reading.weekly - a.reading.weekly);
  return ok[0] ?? null;
}

export const poolName = (p) => (p?.home ? path.basename(p.home) : 'default');

// ── weekly reserve (#7911) ──
/**
 * DRAIN BY RESET. A lane spends a pool freely down to the weekly RESERVE; the 5-hour bucket (each lane's --floor-5h)
 * does the pacing. The reserve is the declared weekly need of the lanes that must not starve, as a fraction of a pool,
 * held on every pool (a lane may land on either). It replaced the even-burn pace line (remaining time / 7 days), which
 * left every agy lane idle from 2026-11-01 ~18:00Z with 4,042 first-read books queued, each pool a few points under
 * its line, and which reached 0 only by a hand-set --pace-off-until.
 *
 * A reserved lane does not keep its own reserve from itself: it spends down to the OTHER lanes' reserves. In the last
 * RESERVE_DROP_HOURS before the pool's weekly reset the reserve is 0: what is left then is lost at the reset.
 * These are declarations, not measurements; change a number here, never on a cron line.
 */
export const LANE_RESERVES = Object.freeze({
  siku: 0.10, // scripts/batch/siku-translate-lane.mjs (#5600)
  'cli-translate': 0.03, // scripts/batch/cli-translate-lane.mjs, agy engine
  enrich: 0.03, // scripts/workers/lib/enrich-agy-lane.mjs (#7628)
  'reader-requests': 0.02, // books readers asked for (#7090)
});
export const RESERVE_DROP_HOURS = 36;

/**
 * The weekly fraction a lane must leave in a pool now: the sum of LANE_RESERVES other than `lane`'s own, or 0 within
 * RESERVE_DROP_HOURS of `resetTime`. An unreadable reset keeps the reserve (the drop needs a known reset).
 */
export function weeklyReserve({ resetTime, now = Date.now(), lane = null, reserves = LANE_RESERVES } = {}) {
  const reset = Date.parse(resetTime ?? '');
  if (Number.isFinite(reset) && reset - now <= RESERVE_DROP_HOURS * 3600e3) return 0;
  return Object.entries(reserves).reduce((s, [k, v]) => (k === lane ? s : s + v), 0);
}
