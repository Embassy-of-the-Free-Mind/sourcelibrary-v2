/**
 * Liveness heartbeat for scheduler-spawned workers (#4837).
 *
 * PRIOR ART: scripts/lib/sweep-heartbeat.mjs — a Mongo-document heartbeat for detached bulk sweeps,
 * read by entities-sweep-active.mjs to answer "is a sweep running?". It does not fit here: the
 * observer is the scheduler, which runs every 2 minutes, must judge a worker without a DB round
 * trip per worker, and needs the signal to die when the worker's EVENT LOOP dies — not when the
 * process does. A file touched from a timer has exactly that property: a wedged loop stops
 * touching it while the process stays alive and the lock stays held.
 *
 * The stall this exists for: enrich-worker held /tmp/sl-enrich.lock for 4d18h — once after a
 * finished run that never exited, once with groundQuotes() spinning the loop at 99% CPU. The
 * scheduler reported `running=[enrich-worker]` for both, because a held lock is all it could see.
 */

import { writeFileSync } from 'fs';
import { hostname } from 'os';
import { basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { codeVersion } from '../../lib/write-provenance.mjs';

const BEAT_INTERVAL_MS = 60 * 1000;

/**
 * Start touching the heartbeat file named by SL_HEARTBEAT_FILE (set by the scheduler when it
 * spawns the worker). A no-op when unset, so the worker runs identically by hand.
 *
 * The timer is unref'd: it must never be the reason a process stays alive.
 *
 * @returns {{ stop: () => void }}
 */
export function startHeartbeat(path = process.env.SL_HEARTBEAT_FILE) {
  if (!path) return { stop() {} };

  const beat = () => {
    try {
      writeFileSync(path, `${new Date().toISOString()}\n`);
    } catch {
      // A heartbeat that cannot be written must not take the worker down. The scheduler will read
      // the silence as a stall, which is the safe direction.
    }
  };

  beat();
  const timer = setInterval(beat, BEAT_INTERVAL_MS);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}

/**
 * Has a worker gone silent? Pure, so the threshold is testable.
 *
 * @param {number|null} mtimeMs   last heartbeat write, or null when the file is missing
 * @param {number} nowMs
 * @param {number} maxSilenceMs
 */
export function heartbeatIsStale(mtimeMs, nowMs, maxSilenceMs) {
  // A missing file is NOT a stall: the worker may predate this mechanism, or be seconds from its
  // first beat. Only an observed, stale beat convicts.
  if (!mtimeMs) return false;
  return nowMs - mtimeMs > maxSilenceMs;
}

// ── Code-version beacon (#5442) ─────────────────────────────────────────────────────────────────
//
// The file heartbeat above answers "is this worker's event loop alive?". It cannot answer "which
// code is it running?", and on 2026-10-01 that was the question: a detached
// `translate-batch-worker.mjs --chained --loop` kept the code it loaded at 22:36Z for eight hours
// while three merged fixes (#5427 #5428 #5431) sat in the checkout, and because it held
// /tmp/sl-translate-chained.lock the cron tick that would have loaded them never ran either. Every
// record said the box was current — `hetzner_head` in ticks.jsonl is the CHECKOUT's HEAD, not the
// running process's.
//
// So a long-running worker announces the commit it loaded, ONCE, at start, into
// `worker_heartbeats` — one row per process — and refreshes `last_beat` every few minutes.
// scripts/audit/worker-code-drift.mjs compares those rows with origin/main.
//
// Each beat opens and closes its own short-lived connection on purpose. A MongoClient held open
// by a helper keeps the event loop alive, and a cron worker that stops exiting holds its flock
// forever — the very failure this exists to report. The timer is unref'd for the same reason.

export const WORKER_HEARTBEAT_COLLECTION = 'worker_heartbeats';
export const WORKER_BEAT_INTERVAL_MS = 5 * 60 * 1000;
/** A row whose last beat is older than this belongs to a process that has exited (or wedged). */
export const WORKER_LIVE_WINDOW_MS = 3 * WORKER_BEAT_INTERVAL_MS;
/** Rows expire on their own; this is telemetry, not a record (TTL index on `last_beat`). */
export const WORKER_HEARTBEAT_TTL_S = 3 * 24 * 3600;

/**
 * Announce this process's worker name and loaded code version, then keep `last_beat` fresh.
 *
 * Call at module top level with `import.meta.url`: it is a no-op unless that module is the entry
 * script (so a test or another script importing the worker registers nothing), and a no-op without
 * MONGODB_URI. Never throws; never keeps the process alive.
 *
 * @param {string} moduleUrl  the caller's `import.meta.url`
 * @param {{ worker?: string, intervalMs?: number }} [opts]
 * @returns {{ stop: () => void, ready: Promise<object|null> }}
 */
export function startWorkerBeacon(moduleUrl, opts = {}) {
  const noop = { stop() {}, ready: Promise.resolve(null) };
  if (!process.env.MONGODB_URI || process.env.VITEST) return noop;
  const entry = process.argv[1];
  if (!entry || !moduleUrl) return noop;
  let modulePath;
  try { modulePath = fileURLToPath(moduleUrl); } catch { return noop; }
  if (resolve(entry) !== modulePath) return noop;

  const worker = opts.worker || basename(modulePath).replace(/\.(m?js|ts)$/, '');
  const intervalMs = opts.intervalMs || WORKER_BEAT_INTERVAL_MS;
  const startedAt = new Date();
  const host = hostname();
  const id = `${host}:${worker}:${process.pid}:${startedAt.getTime()}`;
  let timer = null;

  const write = async (update) => {
    let client;
    try {
      const { MongoClient } = await import('mongodb');
      client = new MongoClient(process.env.MONGODB_URI, {
        maxPoolSize: 1, serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 10000,
      });
      await client.connect();
      await client.db('bookstore').collection(WORKER_HEARTBEAT_COLLECTION).updateOne({ _id: id }, update, { upsert: true });
    } catch {
      // Telemetry must never take down the worker it observes. A missing row reads as "no
      // heartbeat", which the drift audit reports as unverified, not as fresh.
    } finally {
      try { await client?.close(); } catch { /* ignore */ }
    }
  };

  // The code version is read ONCE, here, before any work: the checkout moves under a running
  // process every hour (auto-pull), and HEAD read later would describe the disk, not the process.
  const ready = codeVersion().then(async (code_version) => {
    const row = {
      worker,
      script: modulePath,
      argv: process.argv.slice(2).join(' ').slice(0, 300),
      pid: process.pid,
      host,
      // codeVersion() reads HEAD in the process cwd; record which checkout that was.
      checkout: process.cwd(),
      code_version,
      started_at: startedAt,
      last_beat: new Date(),
    };
    await write({ $set: row });
    timer = setInterval(() => { write({ $set: { last_beat: new Date() } }); }, intervalMs);
    timer.unref();
    return row;
  }).catch(() => null);

  return { stop() { if (timer) clearInterval(timer); }, ready };
}
