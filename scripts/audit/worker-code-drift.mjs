#!/usr/bin/env node
/**
 * Is any long-running worker on this box running code older than `main`? (#5442)
 *
 * PRIOR ART: scripts/workers/lib/worker-heartbeat.mjs (the file heartbeat the scheduler reads —
 * liveness only, no code version; this script reads the `worker_heartbeats` rows the same file now
 * writes); scripts/lib/sweep-heartbeat.mjs + scripts/audit/entities-sweep-active.mjs (one row per
 * named sweep, answers "is a sweep running?", not "which commit"); scripts/workers/auto-pull.sh
 * (moves the CHECKOUT to origin/main — says nothing about processes that loaded the old one).
 *
 * WHY: merged is not in effect for a long-lived loop. On 2026-10-01 a detached
 * `translate-batch-worker.mjs --chained --loop` kept the code it loaded at 22:36Z for eight hours
 * while three merged fixes (#5427 #5428 #5431) sat in the up-to-date checkout; it also held
 * /tmp/sl-translate-chained.lock, so the cron tick that would have loaded them never ran. Every
 * record said the box was current, because every record read the checkout.
 *
 * WHAT IT JUDGES
 *   - each live worker on this host — a heartbeat row (last beat within the live window, pid
 *     alive), or a `node scripts/workers/*.mjs` process with no row, whose version is inferred
 *     from the checkout's HEAD reflog at its start time — whose code is behind origin/main by
 *     commits touching a file it loads (its relative-import closure, plus package*.json)
 *     → STALE, once both the oldest such merge AND the
 *     process are older than the grace period (default 30 min — a cron worker started a minute
 *     before the pull is about to exit, not stale);
 *   - the live checkout itself behind origin/main by such commits for longer than the grace
 *     → CHECKOUT_BEHIND (auto-pull is failing; workers that loaded the checkout HEAD are folded
 *     into this one line rather than listed one by one);
 *   - a row whose code_version git cannot resolve (`not_recorded`, a laptop branch) → UNVERIFIED,
 *     printed, but it never reads as fresh and never reads as stale;
 *   - a worker whose script lives in ANOTHER checkout (a worktree under .claude/worktrees/, which
 *     sits inside the repo path) → UNVERIFIED. It runs a branch, not main, so main's reflog says
 *     nothing about it and a restart would load the same branch. On 2026-10-08/09 the PR #6047
 *     `mirror-changelog` loop paged "older than main" every six hours for this reason (#6360).
 *
 * EXIT: 0 fresh · 3 stale (one line per stale worker) · 2 UNKNOWN (no Mongo / no origin/main —
 * "could not check" is not "clear").
 *
 * This never restarts anything. scripts/maintenance/stale-worker-restart.mjs acts on its result:
 * it restarts a stale systemd worker that holds no lock and owns no open batch run, and pages only
 * the ones it could not restart (#6360).
 *
 * USAGE
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/audit/worker-code-drift.mjs
 *     [--repo /root/sourcelibrary] [--fetch] [--grace-min 30] [--json] [--alert] [--all-hosts]
 *   Hourly: scripts/workers/auto-pull.sh runs stale-worker-restart.mjs (which calls
 *   checkWorkerDrift) right after it pulls. Daily: pipeline-health-alert.mjs includes it in its email.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, readlinkSync, writeFileSync } from 'fs';
import { hostname } from 'os';
import { basename, dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { WORKER_HEARTBEAT_COLLECTION, WORKER_LIVE_WINDOW_MS, WORKER_HEARTBEAT_TTL_S } from '../workers/lib/worker-heartbeat.mjs';

const execFileAsync = promisify(execFile);

export const DEFAULT_GRACE_MS = 30 * 60 * 1000;
/** Commits that can change what a worker loads. A docs-only merge does not make a loop stale. */
export const CODE_PATHS = ['scripts', 'src/lib', 'package.json', 'package-lock.json'];
const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';
const ALERT_STATE = '/tmp/sl-worker-code-drift.alert.json';
const REALERT_MS = 6 * 3600 * 1000;

const sameSha = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));
const short = (s) => (s || '?').slice(0, 9);
const prs = (commits, max = 6) => {
  // The PR is the last (#N) in a squash subject; earlier ones are the issues it names.
  const all = [...new Set(commits.map((c) => [...(c.subject || '').matchAll(/\(#(\d+)\)/g)].pop()?.[1]).filter(Boolean).map((n) => `#${n}`))];
  return all.length > max ? [...all.slice(0, max), `+${all.length - max} more`] : all;
};

export function fmtAge(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${Math.floor(h / 24)}d${h % 24}h`;
}

/**
 * Pure judgement — all git and Mongo reads are done by the caller.
 *
 * @param {object} a
 * @param {string} a.main                 origin/main sha
 * @param {{head: string, behind: Array<{sha,at:Date,subject}>}} a.checkout
 * @param {Array<object>} a.workers       live heartbeat rows, each with `behind`:
 *                                        null (unresolvable) or [{sha, at, subject}] — code
 *                                        commits in code_version..main
 * @param {Date} a.now
 * @param {number} [a.graceMs]
 */
export function judgeDrift({ main, checkout, workers, now, graceMs = DEFAULT_GRACE_MS }) {
  const t = now.getTime();
  const oldest = (commits) => Math.min(...commits.map((c) => new Date(c.at).getTime()));
  const stale = [];
  const unverified = [];
  const fresh = [];
  const lines = [];

  const checkoutBehind = checkout?.behind?.length > 0 && t - oldest(checkout.behind) > graceMs;
  if (checkoutBehind) {
    lines.push(`CHECKOUT_BEHIND checkout=${short(checkout.head)} main=${short(main)} behind=${checkout.behind.length} code commits, oldest merged ${fmtAge(t - oldest(checkout.behind))} ago ${prs(checkout.behind).join(' ')} — auto-pull is not landing; every worker started from this checkout runs it`.trim());
  }

  for (const w of workers) {
    const label = `${w.worker}${w.argv ? ` [${w.argv}]` : ''} pid=${w.pid} host=${w.host}${w.inferred ? ' (no heartbeat; version inferred from HEAD reflog)' : ''}`;
    if (w.worktree) {
      unverified.push(w);
      lines.push(`UNVERIFIED ${label} runs another checkout (${w.worktree}${w.branch ? `, branch ${w.branch}` : ''}) — not main's code; a restart would load the same branch`);
      continue;
    }
    if (!Array.isArray(w.behind)) {
      unverified.push(w);
      lines.push(`UNVERIFIED ${label} code_version=${w.code_version ?? 'missing'} — not resolvable against origin/main`);
      continue;
    }
    if (w.behind.length === 0) { fresh.push(w); continue; }
    if (checkoutBehind && sameSha(w.code_version, checkout.head)) { fresh.push(w); continue; }
    const mergeAge = t - oldest(w.behind);
    const procAge = t - new Date(w.started_at).getTime();
    if (mergeAge > graceMs && procAge > graceMs) {
      stale.push(w);
      lines.push(`STALE ${label} started=${new Date(w.started_at).toISOString()} loaded=${short(w.code_version)} main=${short(main)} behind=${w.behind.length} code commits, oldest merged ${fmtAge(mergeAge)} ago ${prs(w.behind).join(' ')}`.trim());
    } else {
      fresh.push(w);
    }
  }

  return { exit: stale.length || checkoutBehind ? 3 : 0, stale, unverified, fresh, checkoutBehind, lines };
}

// ── impure layer ────────────────────────────────────────────────────────────────────────────────

async function git(repo, args) {
  const { stdout } = await execFileAsync('git', ['-C', repo, ...args], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

const IMPORT_RE = /(?:from\s*|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

/**
 * Repo-relative files a worker can load: its static relative-import closure, read from the
 * current checkout. "A file this worker loads changed" is the signal; "something under scripts/
 * changed" fires on every eval merge and teaches everyone to ignore the alert. Falls back to
 * CODE_PATHS when the entry cannot be read.
 */
export function importClosure(repo, entryAbs, read = (f) => readFileSync(f, 'utf8')) {
  const seen = new Set();
  const queue = [entryAbs];
  while (queue.length && seen.size < 3000) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    let src;
    try { src = read(f); } catch { if (f === entryAbs) return null; continue; }
    seen.add(f);
    for (const m of src.matchAll(IMPORT_RE)) {
      const target = resolve(dirname(f), m[1]);
      for (const cand of [target, `${target}.mjs`, `${target}.js`, `${target}.ts`, `${target}/index.mjs`, `${target}/index.ts`]) {
        if (cand.match(/\.(mjs|js|ts|cjs|json)$/) && (() => { try { read(cand); return true; } catch { return false; } })()) { queue.push(cand); break; }
      }
    }
  }
  return [...seen].map((f) => relative(repo, f)).filter((f) => !f.startsWith('..'));
}

/** Commits in `from..to` touching `paths`, or null when `from` is not a commit git knows. */
async function commitsBetween(repo, from, to, paths) {
  if (!from || from === 'not_recorded') return null;
  try { await git(repo, ['rev-parse', '--verify', '--quiet', `${from}^{commit}`]); } catch { return null; }
  const out = await git(repo, ['log', '--format=%H%x09%ct%x09%s', `${from}..${to}`, '--', ...paths]);
  return out ? out.split('\n').map((l) => {
    const [sha, ct, ...rest] = l.split('\t');
    return { sha, at: new Date(Number(ct) * 1000), subject: rest.join('\t') };
  }) : [];
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/**
 * Worker processes on this host that never wrote a heartbeat — anything started before the
 * beacon shipped, or a script that does not call it. Their code version is INFERRED from the
 * checkout's HEAD reflog at the process start time (auto-pull moves HEAD; the reflog records
 * when). "No heartbeat" must never read as "fresh": that is exactly how the 2026-10-01 loop hid.
 */
async function unregisteredWorkers(repo, knownPids, now) {
  let ps;
  try { ({ stdout: ps } = await execFileAsync('ps', ['-eo', 'pid=,etimes=,args='], { maxBuffer: 8 * 1024 * 1024 })); } catch { return []; }
  let reflog = [];
  try {
    reflog = (await git(repo, ['reflog', 'show', '--date=unix', '--format=%H %gd', 'HEAD'])).split('\n')
      .map((l) => { const m = l.match(/^([0-9a-f]+) HEAD@\{(\d+)\}/); return m && { sha: m[1], at: Number(m[2]) * 1000 }; })
      .filter(Boolean);
  } catch { /* no reflog → every inference is unverified */ }
  const out = [];
  for (const line of ps.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(?:\S*\/)?node\s+(?:--\S+\s+)*(\S*scripts\/workers\/[\w.-]+\.mjs)\s*(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid || knownPids.has(pid)) continue;
    let cwd;
    try { cwd = readlinkSync(`/proc/${pid}/cwd`); } catch { continue; }
    const script = resolve(cwd, m[3]);
    if (relative(repo, script).startsWith('..')) continue;
    const startedAt = now.getTime() - Number(m[2]) * 1000;
    const loaded = reflog.find((r) => r.at <= startedAt);
    out.push({
      worker: basename(script).replace(/\.mjs$/, ''), argv: m[4].slice(0, 300), pid, host: hostname(), script,
      started_at: new Date(startedAt), code_version: loaded?.sha ?? null, inferred: true,
    });
  }
  return out;
}

/**
 * Read heartbeats + git and judge. Shared by the CLI and pipeline-health-alert.mjs.
 * Throws when it cannot check (no origin/main); the caller decides what UNKNOWN means.
 */
export async function checkWorkerDrift(db, { repo = process.cwd(), graceMs = DEFAULT_GRACE_MS, allHosts = false, fetch = false, now = new Date() } = {}) {
  repo = await git(repo, ['rev-parse', '--show-toplevel']);
  if (fetch) await git(repo, ['fetch', '--quiet', 'origin', 'main']);
  const main = await git(repo, ['rev-parse', '--verify', 'origin/main^{commit}']);
  const head = await git(repo, ['rev-parse', 'HEAD']);
  const checkout = { head, behind: (await commitsBetween(repo, head, main, CODE_PATHS)) || [] };

  const col = db.collection(WORKER_HEARTBEAT_COLLECTION);
  // Idempotent; rows are telemetry and expire on their own.
  await col.createIndex({ last_beat: 1 }, { expireAfterSeconds: WORKER_HEARTBEAT_TTL_S }).catch(() => {});
  const me = hostname();
  const rows = await col.find(
    { last_beat: { $gte: new Date(now.getTime() - WORKER_LIVE_WINDOW_MS) }, ...(allHosts ? {} : { host: me }) },
    { maxTimeMS: 10000 },
  ).toArray();
  const live = rows.filter((r) => r.host !== me || pidAlive(r.pid));
  live.push(...await unregisteredWorkers(repo, new Set(rows.filter((r) => r.host === me).map((r) => r.pid)), now));

  // A script under .claude/worktrees/<x>/ is inside `repo` by path but belongs to another checkout.
  const tops = new Map();
  for (const w of live) {
    if (!w.script || relative(repo, w.script).startsWith('..')) continue;
    const dir = dirname(w.script);
    if (!tops.has(dir)) tops.set(dir, await git(dir, ['rev-parse', '--show-toplevel']).catch(() => null));
    const top = tops.get(dir);
    if (top && top !== repo) {
      w.worktree = relative(repo, top) || top;
      w.branch = await git(top, ['branch', '--show-current']).catch(() => '') || null;
    }
  }

  const closures = new Map();
  const cache = new Map();
  for (const w of live) {
    if (w.worktree) { w.behind = null; continue; }
    const script = w.script && !relative(repo, w.script).startsWith('..') ? w.script : null;
    if (!closures.has(script)) closures.set(script, (script && importClosure(repo, script)) || CODE_PATHS);
    const paths = [...closures.get(script), 'package.json', 'package-lock.json'];
    const key = `${w.code_version}|${script}`;
    if (!cache.has(key)) cache.set(key, await commitsBetween(repo, w.code_version, main, paths));
    w.behind = cache.get(key);
  }
  return { main, checkout, workers: live, ...judgeDrift({ main, checkout, workers: live, now, graceMs }) };
}

async function alert(result) {
  const key = [...result.stale.map((w) => `${w.host}:${w.pid}`), ...(result.checkoutBehind ? [`checkout:${result.checkout.head}`] : [])].sort().join('\n');
  let prev = {};
  try { prev = JSON.parse(readFileSync(ALERT_STATE, 'utf8')); } catch { /* first run */ }
  if (prev.key === key && Date.now() - (prev.at || 0) < REALERT_MS) {
    console.log('[worker-code-drift] alert suppressed (same stale set, sent within 6h)');
    return;
  }
  try {
    await fetch(NTFY_TOPIC, {
      method: 'POST',
      headers: { Title: `Worker running code older than main (${result.stale.length + (result.checkoutBehind ? 1 : 0)})`, Priority: 'high', Tags: 'hourglass' },
      body: `${result.lines.join('\n')}\n\nMerged is not in effect for a long-lived loop. Restart is a human decision: check open batch runs and the lock it holds first.`,
    });
    writeFileSync(ALERT_STATE, JSON.stringify({ key, at: Date.now() }));
    console.log('[worker-code-drift] ntfy alert sent');
  } catch (e) {
    console.error(`[worker-code-drift] ntfy alert failed: ${e.message}`);
  }
}

async function cli() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const json = args.includes('--json');
  const repo = resolve(opt('--repo') || process.cwd());
  const graceMs = opt('--grace-min') ? Number(opt('--grace-min')) * 60000 : DEFAULT_GRACE_MS;

  if (!process.env.MONGODB_URI) { console.log('UNKNOWN MONGODB_URI not set — cannot read worker_heartbeats'); process.exit(2); }
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 10000 });
  let result;
  try {
    await client.connect();
    result = await checkWorkerDrift(client.db('bookstore'), { repo, graceMs, allHosts: args.includes('--all-hosts'), fetch: args.includes('--fetch') });
  } catch (e) {
    console.log(`UNKNOWN ${e.message.split('\n')[0]}`);
    await client.close().catch(() => {});
    process.exit(2);
  }
  await client.close();

  if (json) {
    console.log(JSON.stringify({
      main: result.main, checkout_head: result.checkout.head, exit: result.exit, lines: result.lines,
      workers: result.workers.map((w) => ({ worker: w.worker, argv: w.argv, pid: w.pid, host: w.host, code_version: w.code_version, started_at: w.started_at, behind: Array.isArray(w.behind) ? w.behind.length : null, stale: result.stale.includes(w) })),
    }));
  } else {
    for (const l of result.lines) console.log(l);
    console.log(`[worker-code-drift] ${new Date().toISOString()} main=${short(result.main)} checkout=${short(result.checkout.head)} live=${result.workers.length} stale=${result.stale.length} unverified=${result.unverified.length}${result.checkoutBehind ? ' CHECKOUT_BEHIND' : ''}`);
  }
  if (args.includes('--alert') && result.exit === 3) await alert(result);
  process.exit(result.exit);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
