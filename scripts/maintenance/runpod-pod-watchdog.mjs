#!/usr/bin/env node
/**
 * runpod-pod-watchdog.mjs — terminate rented RunPod pods past their deadline or idle (#5600).
 *
 * PRIOR ART: scripts/maintenance/gpu-lease-watchdog.mjs (#4909 — the same job for Scaleway: lease tag,
 * provider-API stop, confirm). It is not extended because the two providers share nothing below the
 * idea: Scaleway leases are instance TAGS, stopping keeps the volume and progress is read from Mongo;
 * a RunPod pod has no tags (the deadline lives in its NAME), billing only ends at TERMINATE (a stopped
 * pod still bills its volume), and a benchmark pod writes nothing to Mongo. The idle rule itself is
 * shared: scripts/lib/gpu-idle.mjs idleDecision().
 *
 * Runs on Hetzner every 10 minutes (live crontab, flock). Per pass, for every pod whose name starts with
 * PREFIX (default `sl-5600-`):
 *   name carries no parseable deadline        → terminate (our prefix without a deadline is a bug, fail closed)
 *   deadline passed                            → terminate
 *   idle: no ACTIVITY for IDLE_MIN (30), after a GRACE_MIN (20) start-up grace counted from the
 *         container's own uptime (else lastStartedAt, else the first pass that saw it)  → terminate
 *   otherwise                                  → one log line
 * ACTIVITY is either signal, whichever is newer:
 *   1. the pod's own GPU — RunPod GraphQL `runtime.gpus[].gpuUtilPercent` ≥ BUSY_UTIL (5) on a pass.
 *      The last pass that saw it busy is kept in the state file (utilisation is instantaneous).
 *   2. a file newer than the window under PROGRESS_ROOT/<pod id>/ (what a driver pulls back).
 * Why both (#5660, 2026-10-03): with (2) alone, a pod whose driver wrote elsewhere was killed as "idle"
 * while reading at 1.6 s/page, and its outputs were lost. GPU memory is NOT activity: a loaded model
 * that nobody calls holds 90% of memory at 0% utilisation — exactly the pod this exists to kill.
 * A CPU pod (no GPUs) or a pod RunPod reports no runtime for can only show activity through (2).
 * If the telemetry query itself fails, the pass enforces deadlines only — never "idle" on missing data.
 * Pods without the prefix are listed, never touched (another project's pod on the same account).
 * Terminate = DELETE /pods/{id}, then re-list until it is gone; an unconfirmed terminate exits 2.
 *
 * Deadline grammar (UTC, minutes):  sl-5600-<label>-until-20261002T1215Z
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/runpod-pod-watchdog.mjs [--apply]
 * Env: RUNPOD_API_KEY (required; never printed), RUNPOD_PREFIX, RUNPOD_PROGRESS_ROOT (/root/paddle-zh-5600/runpod),
 *      GPU_IDLE_MINUTES, GPU_GRACE_MINUTES, GPU_BUSY_UTIL, RUNPOD_WATCHDOG_STATE (~/.runpod-pod-watchdog.json).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { idleDecision } from '../lib/gpu-idle.mjs';

const API = 'https://rest.runpod.io/v1';
const GQL = 'https://api.runpod.io/graphql';
const RUNTIME_QUERY = 'query { myself { pods { id runtime { uptimeInSeconds gpus { id gpuUtilPercent } } } } }';

/** `sl-5600-x-until-20261002T1215Z` → Date, else null. */
export function deadlineOf(name) {
  const m = /-until-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/.exec(name || '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Newest mtime of any file under dir (recursive), or null. */
export function newestFile(dir) {
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

/** One pass's reading of the pod's own GPUs → { busy, note }. runtime null/undefined = no telemetry. */
export function gpuReading(runtime, busyUtil = 5) {
  if (!runtime) return { busy: false, note: 'no runtime telemetry' };
  const gpus = runtime.gpus || [];
  if (!gpus.length) return { busy: false, note: 'no GPU on the pod' };
  const util = Math.max(...gpus.map(g => Number(g.gpuUtilPercent) || 0));
  return { busy: util >= busyUtil, note: `GPU ${util}% now` };
}

const ago = (now, t) => (t ? `${((now - t) / 60000).toFixed(0)} min ago` : 'never');

/**
 * Decide one prefixed pod. Pure: the caller supplies the clock, telemetry and state.
 * @returns {{ action: 'keep'|'kill', why: string, lastGpuBusyAt: Date|null }}
 */
export function decidePod({ now, name, runningSince, runtime, telemetryOk = true, lastGpuBusyAt = null, lastLocalOutputAt = null, idleMinutes = 30, graceMinutes = 20, busyUtil = 5 }) {
  const until = deadlineOf(name);
  const r = gpuReading(runtime, busyUtil);
  const busyAt = telemetryOk && r.busy ? now : lastGpuBusyAt;
  if (!until) return { action: 'kill', why: 'no parseable deadline in the name', lastGpuBusyAt: busyAt };
  if (until <= now) return { action: 'kill', why: `deadline ${until.toISOString()} passed ${((now - until) / 60000).toFixed(0)} min ago`, lastGpuBusyAt: busyAt };
  const left = `${((until - now) / 60000).toFixed(0)} min to deadline`;
  if (!telemetryOk) return { action: 'keep', why: `${left} · GPU telemetry unavailable this pass — idle rule skipped, deadline only`, lastGpuBusyAt: busyAt };
  const last = [busyAt, lastLocalOutputAt].filter(Boolean).sort((a, b) => b - a)[0] || null;
  const d = idleDecision({ now, runningSince, lastOutputAt: last, idleMinutes, graceMinutes });
  const reason = d.reason.replace(/output/g, 'activity');
  const signals = `${r.note}; GPU ≥ ${busyUtil}% last seen ${ago(now, busyAt)}; local output ${ago(now, lastLocalOutputAt)}`;
  if (d.action === 'stop') return { action: 'kill', why: `idle — no GPU work or local output: ${reason} (${signals})`, lastGpuBusyAt: busyAt };
  return { action: 'keep', why: `${left} · ${reason} (${signals})`, lastGpuBusyAt: busyAt };
}

async function main() {
  const APPLY = process.argv.includes('--apply');
  const KEY = process.env.RUNPOD_API_KEY;
  if (!KEY) { console.error('RUNPOD_API_KEY is not set'); process.exit(1); }
  const PREFIX = process.env.RUNPOD_PREFIX || 'sl-5600-';
  const ROOT = process.env.RUNPOD_PROGRESS_ROOT || '/root/paddle-zh-5600/runpod';
  const IDLE_MIN = Number(process.env.GPU_IDLE_MINUTES) || 30;
  const GRACE_MIN = Number(process.env.GPU_GRACE_MINUTES) || 20;
  const BUSY_UTIL = Number(process.env.GPU_BUSY_UTIL) || 5;
  const STATE = process.env.RUNPOD_WATCHDOG_STATE || path.join(os.homedir(), '.runpod-pod-watchdog.json');
  const now = new Date();

  async function rp(method, url) {
    const res = await fetch(API + url, { method, headers: { Authorization: `Bearer ${KEY}` } });
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? null : res.json().catch(() => null);
  }
  async function runtimes() {
    const res = await fetch(GQL, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: RUNTIME_QUERY }) });
    if (!res.ok) throw new Error(`graphql → ${res.status}`);
    const j = await res.json();
    if (j.errors?.length || !j.data?.myself) throw new Error(`graphql: ${JSON.stringify(j.errors || j).slice(0, 200)}`);
    return new Map(j.data.myself.pods.map(p => [p.id, p.runtime]));
  }

  const state = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } })();
  state.first_seen ||= {}; state.gpu_busy ||= {};
  let pods;
  try { pods = await rp('GET', '/pods'); }
  catch (e) { console.log(`${now.toISOString()} RunPod API FAILED: ${e.message} — pods are NOT being enforced`); process.exit(1); }
  let rt = null, telemetryOk = true;
  if (pods.length) {
    try { rt = await runtimes(); }
    catch (e) { telemetryOk = false; console.log(`${now.toISOString()} GPU telemetry FAILED: ${e.message} — deadlines only this pass`); }
  }
  console.log(`${now.toISOString()} ${APPLY ? 'APPLY' : 'DRY RUN'} · ${pods.length} pod(s) · prefix ${PREFIX}`);

  let exitCode = 0;
  const seen = new Set();
  for (const p of pods) {
    seen.add(p.id);
    state.first_seen[p.id] ||= now.toISOString();
    const label = `${p.name} (${p.id}, ${p.gpu?.displayName || p.machine?.gpuTypeId || p.cpuFlavorId || '?'}, $${p.costPerHr ?? '?'}/h, ${p.desiredStatus})`;
    if (!String(p.name || '').startsWith(PREFIX)) { console.log(`  other    ${label} · not ours, untouched`); continue; }
    const runtime = rt?.get(p.id) ?? null;
    const uptime = Number(runtime?.uptimeInSeconds);
    const runningSince = uptime > 0 ? new Date(now.getTime() - uptime * 1000) : new Date(p.lastStartedAt || state.first_seen[p.id]);
    const d = decidePod({
      now, name: p.name, runningSince, runtime, telemetryOk,
      lastGpuBusyAt: state.gpu_busy[p.id] ? new Date(state.gpu_busy[p.id]) : null,
      lastLocalOutputAt: newestFile(path.join(ROOT, p.id)),
      idleMinutes: IDLE_MIN, graceMinutes: GRACE_MIN, busyUtil: BUSY_UTIL,
    });
    if (d.lastGpuBusyAt) state.gpu_busy[p.id] = d.lastGpuBusyAt.toISOString();
    if (d.action === 'keep') { console.log(`  ok       ${label} · ${d.why}`); continue; }
    console.log(`  KILL     ${label} · ${d.why}`);
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
  for (const k of ['first_seen', 'gpu_busy']) for (const id of Object.keys(state[k])) if (!seen.has(id)) delete state[k][id];
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
  process.exit(exitCode);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
