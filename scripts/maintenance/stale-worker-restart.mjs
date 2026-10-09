#!/usr/bin/env node
/**
 * Restart the stale workers it is safe to restart; page only the ones that need a person (#6360).
 *
 * PRIOR ART: scripts/audit/worker-code-drift.mjs (finds workers older than main and never restarts:
 * this acts on its checkWorkerDrift() result, it does not re-derive staleness);
 * scripts/workers/auto-pull.sh (moves the checkout, then calls this); scripts/lib/gemini-batch-ledger.mjs
 * (OPEN batch statuses, copied here as the "still owns work" test). `ls scripts/maintenance/` showed no
 * restart or stale-worker script, only translation, hidden-reason, embedding and issue sweeps.
 *
 * WHY: the drift alert said "Restart is a human decision: check open batch runs and the lock it holds
 * first", and paged it every six hours for clip-server, embedding-server and mirror-changelog
 * (2026-10-08/09). The precondition it names can be checked, so it is checked here.
 *
 * FOR EACH STALE WORKER, all must hold before a restart:
 *   1. a LAUNCHER we can repeat: a non-transient systemd unit whose WorkingDirectory is the repo.
 *      A loop started by hand (nohup, tmux, a login session) is not restarted: how it was started is
 *      not on record, so restarting it is a guess.
 *   2. NO LOCK held by the worker or a process around it (its ancestors inside its own cgroup, e.g.
 *      a `flock -n` wrapper in the same unit, and its children). Source: /proc/locks.
 *   3. NO OPEN BATCH RUN it submitted: batch_jobs rows whose submitted_by is its script, status open,
 *      created in the last 14 days. Mongo unreadable → hold (could not check is not clear).
 *   4. NOT MID-REQUEST: no established inbound TCP connection on a port it listens on. A busy
 *      server is retried on the next run and paged only once it has been stale for 24 h.
 *   5. not restarted by this script in the last 6 h (a flapping restart is paged, not repeated).
 * After a restart: the unit is active with a NEW MainPID, /health on its *_PORT says ok (when it has
 * a port), and the drift audit no longer lists the new pid as stale. Anything else pages, high.
 *
 * Every decision (restart, verified, held + why) is one JSON line in --log. Pages go to ntfy
 * sourcelibrary-uptime, one message per changed set, at most every 6 h: priority high only when a
 * restart left a worker down or unverified (work at risk); default for "held, needs you".
 *
 * USAGE (dry run by default: prints what it would do, restarts nothing)
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/stale-worker-restart.mjs \
 *     [--repo /root/sourcelibrary] [--apply] [--alert] [--only <worker>] [--json]
 *     [--log /var/log/sourcelibrary/stale-worker-restart.jsonl]
 * EXIT: 0 nothing needs a person · 3 something was held or failed · 2 UNKNOWN (could not check)
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { appendFileSync, readFileSync, readdirSync, readlinkSync, statSync, writeFileSync } from 'fs';
import { relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { checkWorkerDrift, fmtAge } from '../audit/worker-code-drift.mjs';

const execFileAsync = promisify(execFile);

const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';
const ALERT_STATE = '/tmp/sl-stale-worker-restart.alert.json';
const RESTART_STATE = '/tmp/sl-stale-worker-restart.restarts.json';
const DEFAULT_LOG = '/var/log/sourcelibrary/stale-worker-restart.jsonl';
const REALERT_MS = 6 * 3600 * 1000;
export const MIN_RESTART_INTERVAL_MS = 6 * 3600 * 1000;
export const BUSY_PAGE_AFTER_MS = 24 * 3600 * 1000;
const BATCH_LOOKBACK_MS = 14 * 24 * 3600 * 1000;
// Same set as scripts/lib/gemini-batch-ledger.mjs OPEN_BATCH_STATUSES: the owner still means to read it.
export const OPEN_BATCH_STATUSES = ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING', 'submitted'];

/**
 * Pure judgement for one stale worker. All reads are done by the caller.
 * @returns {{ action: 'restart'|'hold'|'defer', reasons: string[], page: boolean }}
 *   restart = every precondition holds · hold = needs a person (paged) ·
 *   defer = busy right now, retry next run (paged only once stale past BUSY_PAGE_AFTER_MS)
 */
export function judgeRestart({ unit, repo, locks = [], openBatches = null, connections = 0, lastRestartAt = null, staleForMs = 0, now = new Date() }) {
  const reasons = [];
  if (!unit) reasons.push('no systemd unit: started by hand (nohup/tmux/session), so how to restart it is not on record');
  else if (unit.transient) reasons.push(`unit ${unit.name} is transient: a restart would drop its definition`);
  else if (unit.workingDirectory && resolve(unit.workingDirectory) !== resolve(repo)) reasons.push(`unit ${unit.name} runs from ${unit.workingDirectory}, not ${repo}`);
  if (locks.length) reasons.push(`holds ${locks.length} lock(s): ${locks.join(', ')}`);
  if (openBatches == null) reasons.push('could not read batch_jobs: open batch runs unknown');
  else if (openBatches.length) reasons.push(`${openBatches.length} open batch run(s): ${openBatches.slice(0, 3).join(', ')}${openBatches.length > 3 ? ' …' : ''}`);
  if (lastRestartAt && now.getTime() - new Date(lastRestartAt).getTime() < MIN_RESTART_INTERVAL_MS) {
    reasons.push(`already restarted by this script ${fmtAge(now.getTime() - new Date(lastRestartAt).getTime())} ago and still stale`);
  }
  if (reasons.length) return { action: 'hold', reasons, page: true };
  if (connections > 0) {
    return { action: 'defer', reasons: [`serving ${connections} open connection(s); retry next run`], page: staleForMs > BUSY_PAGE_AFTER_MS };
  }
  return { action: 'restart', reasons: [], page: false };
}

// ── impure layer ────────────────────────────────────────────────────────────────────────────────

const readText = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const ppidOf = (pid) => { const s = readText(`/proc/${pid}/stat`); return s ? Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[1]) : null; };

/**
 * The worker, its ancestors in the same cgroup (a `flock -n x.lock node …` wrapper in its unit holds
 * the lock), and its descendants. The walk stops at the cgroup edge: cron, a login shell or a CI
 * runner above the worker holds locks that are not the worker's.
 */
export function processTree(pid) {
  const tree = new Set([pid]);
  const cg = readText(`/proc/${pid}/cgroup`);
  for (let p = ppidOf(pid); p && p > 1 && !tree.has(p) && readText(`/proc/${p}/cgroup`) === cg; p = ppidOf(p)) tree.add(p);
  const kids = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    const pp = ppidOf(Number(d));
    if (pp) kids.set(pp, [...(kids.get(pp) || []), Number(d)]);
  }
  const queue = [pid];
  while (queue.length) for (const k of kids.get(queue.shift()) || []) if (!tree.has(k)) { tree.add(k); queue.push(k); }
  return tree;
}

/** File locks held by any process in the tree, named by the path the holder has open (else by inode). */
export function heldLocks(pid, procLocks = readText('/proc/locks') || '') {
  const tree = processTree(pid);
  const inodes = new Map(); // inode → holder pid
  for (const line of procLocks.split('\n')) {
    const m = line.match(/^\d+:\s+(?:->\s+)?\S+\s+\S+\s+\S+\s+(-?\d+)\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s/);
    if (m && tree.has(Number(m[1]))) inodes.set(m[2], Number(m[1]));
  }
  const out = [];
  for (const [ino, holder] of inodes) {
    let name = `inode ${ino} (pid ${holder})`;
    try {
      for (const fd of readdirSync(`/proc/${holder}/fd`)) {
        try {
          if (String(statSync(`/proc/${holder}/fd/${fd}`).ino) === ino) { name = readlinkSync(`/proc/${holder}/fd/${fd}`); break; }
        } catch { /* fd closed meanwhile */ }
      }
    } catch { /* holder gone */ }
    out.push(name);
  }
  return out;
}

/** systemd unit owning the pid, or null when it is not a system service (a login session, cron, tmux). */
async function unitOf(pid) {
  const cg = readText(`/proc/${pid}/cgroup`) || '';
  const m = cg.match(/\/system\.slice\/(?:[^\n]*\/)?([^/\n]+\.service)\s*$/m);
  if (!m) return null;
  const { stdout } = await execFileAsync('systemctl', ['show', m[1], '-p', 'Transient', '-p', 'WorkingDirectory', '-p', 'Environment', '-p', 'MainPID', '-p', 'ActiveState']);
  const p = Object.fromEntries(stdout.trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const port = (p.Environment || '').match(/\b\w*_?PORT=(\d+)\b/)?.[1];
  return { name: m[1], transient: p.Transient === 'yes', workingDirectory: p.WorkingDirectory || null, mainPid: Number(p.MainPID), active: p.ActiveState, port: port ? Number(port) : null };
}

/** Established inbound connections on the ports this pid listens on. */
async function inboundConnections(pid) {
  try {
    const { stdout: listen } = await execFileAsync('ss', ['-Hltnp']);
    const ports = [...listen.split('\n').filter((l) => l.includes(`pid=${pid},`)).map((l) => l.split(/\s+/)[3]?.split(':').pop())].filter(Boolean);
    if (!ports.length) return 0;
    const { stdout: est } = await execFileAsync('ss', ['-Htn', 'state', 'established']);
    return est.split('\n').filter((l) => ports.includes(l.split(/\s+/)[2]?.split(':').pop())).length;
  } catch { return 0; }
}

async function openBatchesFor(db, repo, w) {
  const script = w.script ? relative(repo, w.script) : `scripts/workers/${w.worker}.mjs`;
  try {
    const rows = await db.collection('batch_jobs').find(
      { submitted_by: script, status: { $in: OPEN_BATCH_STATUSES }, created_at: { $gte: new Date(Date.now() - BATCH_LOOKBACK_MS) } },
      { projection: { id: 1, status: 1 }, limit: 20, maxTimeMS: 15000 },
    ).toArray();
    return rows.map((r) => `${r.id || r._id} ${r.status}`);
  } catch { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function health(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) });
    const body = await res.json().catch(() => ({}));
    return res.ok && body.ok !== false;
  } catch { return false; }
}

/** Restart the unit and verify it came back on the new code. Returns { ok, newPid, why }. */
async function restartAndVerify(db, repo, w, unit) {
  await execFileAsync('systemctl', ['restart', unit.name]);
  const deadline = Date.now() + 180_000;
  let u = unit;
  while (Date.now() < deadline) {
    await sleep(5000);
    u = await unitShow(unit.name);
    if (u.active === 'active' && u.mainPid && u.mainPid !== w.pid && (!unit.port || await health(unit.port))) break;
  }
  if (u.active !== 'active' || !u.mainPid || u.mainPid === w.pid) return { ok: false, newPid: u.mainPid || null, why: `unit ${unit.name} is ${u.active}, MainPID ${u.mainPid} after 180 s` };
  if (unit.port && !await health(unit.port)) return { ok: false, newPid: u.mainPid, why: `GET :${unit.port}/health not ok after 180 s` };
  // Steady: the same pid still there 15 s later (not a crash loop under Restart=always).
  await sleep(15000);
  const again = await unitShow(unit.name);
  if (again.mainPid !== u.mainPid || again.active !== 'active') return { ok: false, newPid: again.mainPid, why: `unit ${unit.name} restarted again (MainPID ${u.mainPid} → ${again.mainPid}): crash loop?` };
  const drift = await checkWorkerDrift(db, { repo });
  if (drift.stale.some((s) => s.pid === u.mainPid)) return { ok: false, newPid: u.mainPid, why: 'new process is still older than main (is the checkout behind?)' };
  return { ok: true, newPid: u.mainPid, why: unit.port ? `active, /health ok on :${unit.port}, not stale` : 'active, steady 15 s, not stale' };
}

async function unitShow(name) {
  const { stdout } = await execFileAsync('systemctl', ['show', name, '-p', 'MainPID', '-p', 'ActiveState']);
  const p = Object.fromEntries(stdout.trim().split('\n').map((l) => l.split('=')));
  return { name, mainPid: Number(p.MainPID), active: p.ActiveState };
}

async function page(lines, high) {
  const key = lines.map((l) => l.split(' — ')[0]).sort().join('\n');
  let prev = {};
  try { prev = JSON.parse(readFileSync(ALERT_STATE, 'utf8')); } catch { /* first run */ }
  if (prev.key === key && Date.now() - (prev.at || 0) < REALERT_MS) { console.log('[stale-worker-restart] page suppressed (same set within 6 h)'); return; }
  try {
    await fetch(NTFY_TOPIC, {
      method: 'POST',
      headers: { Title: high ? `Worker restart FAILED (${lines.length})` : `Stale worker needs you (${lines.length})`, Priority: high ? 'high' : 'default', Tags: high ? 'warning' : 'hourglass' },
      body: `${lines.join('\n')}\n\nThe safe ones were restarted automatically. Owner: #6360 · scripts/maintenance/stale-worker-restart.mjs`,
    });
    writeFileSync(ALERT_STATE, JSON.stringify({ key, at: Date.now() }));
  } catch (e) { console.error(`[stale-worker-restart] ntfy failed: ${e.message}`); }
}

async function cli() {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const apply = args.includes('--apply');
  const repo = resolve(opt('--repo') || process.cwd());
  const only = opt('--only');
  const logPath = opt('--log') || (apply ? DEFAULT_LOG : null);
  const log = (rec) => {
    const line = JSON.stringify({ at: new Date().toISOString(), apply, ...rec });
    console.log(line);
    if (logPath) try { appendFileSync(logPath, `${line}\n`); } catch (e) { console.error(`log write failed: ${e.message}`); }
  };

  if (!process.env.MONGODB_URI) { console.log('UNKNOWN MONGODB_URI not set'); process.exit(2); }
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 10000 });
  let restarts = {};
  try { restarts = JSON.parse(readFileSync(RESTART_STATE, 'utf8')); } catch { /* none yet */ }
  const pageLines = [];
  let high = false;
  try {
    await client.connect();
    const db = client.db('bookstore');
    const drift = await checkWorkerDrift(db, { repo });
    if (drift.checkoutBehind) pageLines.push(`${drift.lines[0]} — a restart cannot fix this; auto-pull is failing (see /var/log/sourcelibrary/auto-pull.log)`);
    const stale = drift.stale.filter((w) => !only || w.worker === only);
    if (!stale.length) log({ event: 'none_stale', live: drift.workers.length, unverified: drift.unverified.length });
    for (const w of stale) {
      const unit = await unitOf(w.pid).catch(() => null);
      const staleForMs = Date.now() - Math.min(...w.behind.map((c) => new Date(c.at).getTime()));
      const verdict = judgeRestart({
        unit, repo, locks: heldLocks(w.pid), openBatches: await openBatchesFor(db, repo, w),
        connections: await inboundConnections(w.pid), lastRestartAt: unit ? restarts[unit.name] : null, staleForMs,
      });
      const base = { worker: w.worker, pid: w.pid, unit: unit?.name || null, loaded: w.code_version?.slice(0, 9), main: drift.main.slice(0, 9), behind: w.behind.length };
      if (verdict.action !== 'restart') {
        log({ ...base, event: verdict.action, reasons: verdict.reasons });
        if (verdict.page) pageLines.push(`${w.worker} pid=${w.pid} — ${verdict.action === 'hold' ? 'held' : 'busy'}: ${verdict.reasons.join('; ')}`);
        continue;
      }
      if (!apply) { log({ ...base, event: 'would_restart', how: `systemctl restart ${unit.name}` }); continue; }
      log({ ...base, event: 'restarting', how: `systemctl restart ${unit.name}` });
      restarts[unit.name] = new Date().toISOString();
      writeFileSync(RESTART_STATE, JSON.stringify(restarts));
      const r = await restartAndVerify(db, repo, w, unit).catch((e) => ({ ok: false, newPid: null, why: e.message.split('\n')[0] }));
      log({ ...base, event: r.ok ? 'restarted' : 'restart_failed', new_pid: r.newPid, verified: r.why });
      if (!r.ok) { high = true; pageLines.push(`${w.worker} (${unit.name}) — restart FAILED: ${r.why}. Look: journalctl -u ${unit.name} -n 50`); }
    }
  } catch (e) {
    console.log(`UNKNOWN ${e.message.split('\n')[0]}`);
    await client.close().catch(() => {});
    process.exit(2);
  }
  await client.close();
  if (args.includes('--alert') && pageLines.length) await page(pageLines, high);
  process.exit(pageLines.length ? 3 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
