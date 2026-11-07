// PRIOR ART: scripts/maintenance/seam-repair-6742/lean.mjs claudeUsage() and library-dating/date-books.mjs meter() read
// the same climits file, and seam-repair-6742/gemini-repair.mjs agyOpen() reads the agy meter; each guards one script,
// and the seams pool still probed a spent account with a real `claude -p` call every 15 min. This is the one gate the
// call helpers share, so a limit is honoured before the call instead of discovered by it.
/**
 * Never call a model whose subscription limit has been hit — not even a probe (Derek, 2026-10-22, after the Florentine
 * re-OCR lanes kept calling a locked Gemini account ~430 times a day for three days, #7118).
 *
 * The answer comes from files the boxes already keep, never from a call:
 *   Claude  /root/.claude-limits/latest.json — the climits poll, every 5 min (cron on main, copied to the guests);
 *           the account is this box's own login (~/.claude.json).
 *   Gemini  /root/agy-quota/status.json — the passive agy meter, every 15 min; `locked_models[model]` is the reset
 *           Google quoted with its 429.
 *   Both    ~/.model-limits/<lane>.json — written by the call helpers the moment a reply says the limit was hit, so
 *           the next call on the box does not wait for the next meter poll to find out.
 *
 * A missing or stale meter is "unknown", which allows the call (a laptop has no meter); the first limit reply then
 * writes the local stop file, and every later call waits on that.
 *
 *   import { claudeBlocked, agyBlocked, noteLimitHit, waitWhileBlocked } from '../lib/model-limits.mjs';
 *   const b = claudeBlocked(); if (b) { ...don't call; b.until is when to look again... }
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const CLAUDE_METER = process.env.CLAUDE_LIMITS_FILE || '/root/.claude-limits/latest.json';
const AGY_METER = process.env.AGY_QUOTA_STATUS || '/root/agy-quota/status.json';
const STOP_DIR = process.env.MODEL_LIMITS_DIR || path.join(os.homedir(), '.model-limits');
// "Hit" means at the wall, not near it: callers that want headroom pass their own lower bound.
const SESSION_MAX = +(process.env.CLAUDE_SESSION_MAX_PCT || 98);
const WEEKLY_MAX = +(process.env.CLAUDE_WEEKLY_MAX_PCT || 98);

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const future = (iso) => iso && Date.parse(iso) > Date.now();

/** A stop written by noteLimitHit for this lane that has not expired, else null. */
function localStop(lane) {
  const s = readJson(path.join(STOP_DIR, `${lane.replace(/[^\w.-]/g, '_')}.json`));
  return s && future(s.until) ? { lane, until: s.until, reason: s.reason, source: 'local-stop' } : null;
}

/** Record that a reply said the limit was hit. `until` is ISO; without one, the meter's reset or one hour. */
export function noteLimitHit(lane, { until, reason = '' } = {}) {
  try {
    fs.mkdirSync(STOP_DIR, { recursive: true });
    const u = until && !Number.isNaN(Date.parse(until)) ? until
      : (lane === 'claude' ? claudeUsage()?.blockedUntil : null) || new Date(Date.now() + 3600e3).toISOString();
    fs.writeFileSync(path.join(STOP_DIR, `${lane.replace(/[^\w.-]/g, '_')}.json`), JSON.stringify({ until: u, reason: String(reason).slice(0, 300), at: new Date().toISOString(), pid: process.pid }));
  } catch { /* a read-only home: the meter still gates */ }
}

/**
 * The Claude login a `claude` child of this process uses: CLAUDE_CONFIG_DIR when set (a second login on one box,
 * JOB-HOSTS.md: /root/.claude-milo holds .claude.json and .credentials.json), else ~/.claude.json and ~/.claude/.
 */
export function claudeLoginFiles(env = process.env) {
  const dir = env.CLAUDE_CONFIG_DIR;
  return dir ? { account: path.join(dir, '.claude.json'), credentials: path.join(dir, '.credentials.json') }
    : { account: path.join(os.homedir(), '.claude.json'), credentials: path.join(os.homedir(), '.claude', '.credentials.json') };
}

/** This box's Claude account from the climits poll: { email, session, weekly, sessionReset, weeklyReset } or null. */
export function claudeUsage() {
  const m = readJson(CLAUDE_METER);
  if (!m || !m.checked_at || Date.now() - Date.parse(m.checked_at) > 30 * 60e3) return null;
  let email = null;
  try { email = (JSON.parse(fs.readFileSync(claudeLoginFiles().account, 'utf8')).oauthAccount?.emailAddress || '').toLowerCase() || null; } catch { /* no login file */ }
  email ||= m.claude_code_account;
  const a = (m.accounts || []).find((x) => x.ok && x.email === email);
  if (!a) return null;
  const get = (k) => a.limits?.find((l) => l.key === k);
  return { email, session: get('session:all')?.percent ?? null, weekly: get('weekly_all:all')?.percent ?? null,
    sessionReset: get('session:all')?.resets_at ?? null, weeklyReset: get('weekly_all:all')?.resets_at ?? null, checked_at: m.checked_at };
}

/**
 * Is Claude on this box blocked right now? null = go ahead; else { until, reason }.
 * `weeklyMax` / `sessionMax` let a job keep headroom (e.g. weeklyMax: 60), and default to the wall.
 */
export function claudeBlocked({ sessionMax = SESSION_MAX, weeklyMax = WEEKLY_MAX } = {}) {
  const stop = localStop('claude');
  if (stop) return stop;
  const u = claudeUsage();
  if (!u) return null;
  if (u.weekly != null && u.weekly >= weeklyMax) return { lane: 'claude', until: u.weeklyReset, reason: `${u.email} weekly ${u.weekly}% >= ${weeklyMax}%`, source: 'meter' };
  if (u.session != null && u.session >= sessionMax) return { lane: 'claude', until: u.sessionReset, reason: `${u.email} 5-hour ${u.session}% >= ${sessionMax}%`, source: 'meter' };
  return null;
}

/**
 * The agy account this process calls (#7517). AGY_HOME=<dir> (scripts/workers/agy-guard.sh) runs the CLI on a second
 * Google login whose quota is its own: a quota reply there must not lock the main account's lanes, and the main
 * account's meter (/root/agy-quota/status.json) says nothing about it. null = the main account.
 */
export const agyAccount = () => (process.env.AGY_HOME ? path.basename(process.env.AGY_HOME) : null);
/** The local stop lane for an agy model on this process's account: `agy-<model>`, or `agy@<account>-<model>`. */
export const agyLimitLane = (model) => (agyAccount() ? `agy@${agyAccount()}-${model}` : `agy-${model}`);

/** Is `model` on agy (Gemini via the subscription CLI) locked right now? null = go ahead; else { until, reason }. */
export function agyBlocked(model) {
  const acct = agyAccount();
  if (acct) return localStop(agyLimitLane(model)) || localStop(`agy@${acct}`);
  const stop = localStop(`agy-${model}`) || localStop('agy');
  if (stop) return stop;
  const s = readJson(AGY_METER);
  const until = s?.locked_models?.[model];
  return future(until) ? { lane: `agy-${model}`, until, reason: `agy ${model} locked by Google until ${until}`, source: 'meter' } : null;
}

/** "Resets in 26h5m13s" (agy's 429 text) → ISO time, or null. */
export function agyResetFromText(text) {
  const m = /Resets in ((?:\d+h)?(?:\d+m)?(?:\d+s)?)/i.exec(String(text || ''));
  if (!m || !m[1]) return null;
  const d = Object.fromEntries([...m[1].matchAll(/(\d+)([hms])/g)].map(([, n, u]) => [u, +n]));
  return new Date(Date.now() + ((d.h || 0) * 3600 + (d.m || 0) * 60 + (d.s || 0)) * 1000).toISOString();
}

/**
 * Sleep while `check()` reports a block, re-reading only the files (no model call). Resolves true when open,
 * false after maxWaitH hours. The sleep is to the block's `until` (+1 min), capped at 30 min so a meter that clears
 * early is noticed.
 */
export async function waitWhileBlocked(check, { log = console.log, maxWaitH = 6 } = {}) {
  const t0 = Date.now();
  for (let b = check(); b; b = check()) {
    // A block that outlasts the whole wait is not waited out: the caller stops now instead of idling for hours.
    if (Date.now() - t0 >= maxWaitH * 3600e3 || (b.until && Date.parse(b.until) > t0 + maxWaitH * 3600e3)) { log(`limit hit (${b.reason}); it resets after the ${maxWaitH} h wait, so stopping`); return false; }
    const toUntil = b.until ? Date.parse(b.until) - Date.now() + 60e3 : 15 * 60e3;
    const ms = Math.max(60e3, Math.min(toUntil, 30 * 60e3));
    log(`limit hit (${b.reason}); no calls until ${b.until || 'the meter clears'} — rechecking the meter in ${Math.round(ms / 60e3)} min`);
    await new Promise((r) => setTimeout(r, ms));
  }
  return true;
}
