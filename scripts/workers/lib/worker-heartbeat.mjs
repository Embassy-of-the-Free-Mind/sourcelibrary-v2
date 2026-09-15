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
