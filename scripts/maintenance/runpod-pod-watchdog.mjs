#!/usr/bin/env node
/**
 * runpod-pod-watchdog.mjs — terminate rented RunPod pods past their deadline or idle (#5600).
 *
 * PRIOR ART: scripts/maintenance/gpu-lease-watchdog.mjs (#4909 — the same job for Scaleway: lease tag,
 * provider-API stop, confirm). It is not extended because the two providers share nothing below the
 * idea: Scaleway leases are instance TAGS, stopping keeps the volume and progress is read from Mongo;
 * a RunPod pod has no tags (the deadline lives in its NAME), billing only ends at TERMINATE (a stopped
 * pod still bills its volume), and a benchmark pod writes nothing to Mongo — its progress is the files
 * the driver pulls from it. The idle rule itself is shared: scripts/lib/gpu-idle.mjs idleDecision().
 *
 * Runs on Hetzner every 10 minutes (live crontab, flock). Per pass, for every pod whose name starts with
 * PREFIX (default `sl-5600-`):
 *   name carries no parseable deadline        → terminate (our prefix without a deadline is a bug, fail closed)
 *   deadline passed                            → terminate
 *   idle: no file newer than IDLE_MIN (30) under PROGRESS_ROOT/<pod id>/, after a GRACE_MIN (20) start-up
 *         grace counted from lastStartedAt (or from the first pass that saw it)   → terminate
 *   otherwise                                  → one log line
 * Pods without the prefix are listed, never touched (another project's pod on the same account).
 * Terminate = DELETE /pods/{id}, then re-list until it is gone; an unconfirmed terminate exits 2.
 *
 * Deadline grammar (UTC, minutes):  sl-5600-<label>-until-20261002T1215Z
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/runpod-pod-watchdog.mjs [--apply]
 * Env: RUNPOD_API_KEY (required; never printed), RUNPOD_PREFIX, RUNPOD_PROGRESS_ROOT (/root/paddle-zh-5600/runpod),
 *      GPU_IDLE_MINUTES, GPU_GRACE_MINUTES, RUNPOD_WATCHDOG_STATE (~/.runpod-pod-watchdog.json).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { idleDecision } from '../lib/gpu-idle.mjs';

const APPLY = process.argv.includes('--apply');
const KEY = process.env.RUNPOD_API_KEY;
if (!KEY) { console.error('RUNPOD_API_KEY is not set'); process.exit(1); }
const PREFIX = process.env.RUNPOD_PREFIX || 'sl-5600-';
const ROOT = process.env.RUNPOD_PROGRESS_ROOT || '/root/paddle-zh-5600/runpod';
const IDLE_MIN = Number(process.env.GPU_IDLE_MINUTES) || 30;
const GRACE_MIN = Number(process.env.GPU_GRACE_MINUTES) || 20;
const STATE = process.env.RUNPOD_WATCHDOG_STATE || path.join(os.homedir(), '.runpod-pod-watchdog.json');
const API = 'https://rest.runpod.io/v1';
const now = new Date();

async function rp(method, url) {
  const res = await fetch(API + url, { method, headers: { Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

/** `sl-5600-x-until-20261002T1215Z` → Date, else null. */
function deadlineOf(name) {
  const m = /-until-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/.exec(name || '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Newest mtime of any file under dir (recursive), or null. */
function newestFile(dir) {
  let best = 0;
  const walk = (d) => {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { best = Math.max(best, fs.statSync(p).mtimeMs); } catch { /* raced */ } }
    }
  };
  walk(dir);
  return best ? new Date(best) : null;
}

const state = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { first_seen: {} }; } })();
let pods;
try { pods = await rp('GET', '/pods'); }
catch (e) { console.log(`${now.toISOString()} RunPod API FAILED: ${e.message} — pods are NOT being enforced`); process.exit(1); }
console.log(`${now.toISOString()} ${APPLY ? 'APPLY' : 'DRY RUN'} · ${pods.length} pod(s) · prefix ${PREFIX}`);

let exitCode = 0;
const seen = new Set();
for (const p of pods) {
  seen.add(p.id);
  state.first_seen[p.id] ||= now.toISOString();
  const label = `${p.name} (${p.id}, ${p.gpu?.displayName || p.machine?.gpuTypeId || p.cpuFlavorId || '?'}, $${p.costPerHr ?? '?'}/h, ${p.desiredStatus})`;
  if (!String(p.name || '').startsWith(PREFIX)) { console.log(`  other    ${label} · not ours, untouched`); continue; }
  const until = deadlineOf(p.name);
  const since = new Date(p.lastStartedAt || state.first_seen[p.id]);
  let why = null;
  if (!until) why = 'no parseable deadline in the name';
  else if (until <= now) why = `deadline ${until.toISOString()} passed ${((now - until) / 60000).toFixed(0)} min ago`;
  else {
    const d = idleDecision({ now, runningSince: since, lastOutputAt: newestFile(path.join(ROOT, p.id)), idleMinutes: IDLE_MIN, graceMinutes: GRACE_MIN });
    if (d.action === 'stop') why = `idle — ${d.reason} (progress ${path.join(ROOT, p.id)})`;
    else { console.log(`  ok       ${label} · ${((until - now) / 60000).toFixed(0)} min to deadline · ${d.reason}`); continue; }
  }
  console.log(`  KILL     ${label} · ${why}`);
  if (!APPLY) { console.log('  [dry-run] would terminate'); continue; }
  try {
    await rp('DELETE', `/pods/${p.id}`);
    let gone = false;
    for (let i = 0; i < 12 && !gone; i++) {
      await new Promise(r => setTimeout(r, 5000));
      gone = !(await rp('GET', '/pods')).some(x => x.id === p.id);
    }
    console.log(gone ? `  TERMINATED ${p.id} · confirmed gone` : `  UNCONFIRMED ${p.id} · still listed after 60 s`);
    if (!gone) exitCode = 2;
  } catch (e) { exitCode = 2; console.log(`  FAILED   ${p.id} · ${e.message}`); }
}
for (const id of Object.keys(state.first_seen)) if (!seen.has(id)) delete state.first_seen[id];
fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
process.exit(exitCode);
