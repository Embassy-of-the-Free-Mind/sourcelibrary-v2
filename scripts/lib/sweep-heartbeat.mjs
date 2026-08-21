/**
 * Liveness heartbeat for long-running bulk sweeps.
 *
 * WHY (the entities interlock): a merge to `main` builds production, and the
 * `/explore` prerender runs ~1M-doc counts against `entities` at
 * `maxTimeMS: 25000`. A concurrent bulk writer tips it over and the build dies.
 * The documented check — `pgrep -af "[r]epair-entity"` on both machines —
 * requires ssh to answer, and on 2026-08-17 ssh to the box connected and was
 * reset on every attempt, leaving the interlock unevaluable right before a
 * merge. "I could not check" must never read as "clear".
 *
 * A heartbeat inverts the problem: instead of hunting for a process, the writer
 * ANNOUNCES ITSELF in a place any machine can read cheaply. One tiny document
 * per sweep name, upserted as it works.
 *
 * This is the precise, named signal. It only covers sweeps that opt in, so it
 * is paired with the general index-backed recency check in
 * `scripts/audit/entities-sweep-active.mjs` — which catches a writer that never
 * called this, including one nobody remembers.
 *
 * Usage in a sweep:
 *
 *   import { beat, endSweep } from '../lib/sweep-heartbeat.mjs';
 *   await beat(db, 'repair-entity-page-attribution', { books_done: n });
 *   ...
 *   await endSweep(db, 'repair-entity-page-attribution');   // in a finally
 *
 * `beat()` is safe to call in a hot loop: it self-throttles, so only one write
 * per BEAT_INTERVAL_MS reaches Mongo no matter how often you call it. It never
 * throws — a telemetry failure must not kill a repair job.
 */

import { hostname } from 'node:os';
import { basename } from 'node:path';

export const HEARTBEAT_COLLECTION = 'sweep_heartbeats';

/** A heartbeat older than this means the sweep died without cleaning up. */
export const STALE_AFTER_MS = 5 * 60_000;

const BEAT_INTERVAL_MS = 30_000;
const lastBeatAt = new Map();

/**
 * Record that `sweep` is alive. Self-throttling and non-throwing.
 * @param {import('mongodb').Db} db
 * @param {string} sweep kebab-case sweep name
 * @param {Record<string, unknown>} [progress] free-form counters, e.g. { books_done: 12 }
 * @param {{force?: boolean}} [opts] force:true bypasses the throttle (use for the first beat)
 */
export async function beat(db, sweep, progress = {}, opts = {}) {
  const now = Date.now();
  const last = lastBeatAt.get(sweep) || 0;
  if (!opts.force && now - last < BEAT_INTERVAL_MS) return;
  lastBeatAt.set(sweep, now);

  try {
    await db.collection(HEARTBEAT_COLLECTION).updateOne(
      { _id: sweep },
      {
        $set: {
          last_beat_at: new Date(),
          host: hostname(),
          pid: process.pid,
          script: basename(process.argv[1] || 'unknown'),
          progress,
        },
        $setOnInsert: { started_at: new Date() },
      },
      { upsert: true },
    );
  } catch {
    // Telemetry must never take down the job it is observing.
  }
}

/**
 * Mark the sweep finished so the interlock clears immediately rather than
 * waiting out STALE_AFTER_MS. Call from a `finally`. Never throws.
 */
export async function endSweep(db, sweep) {
  lastBeatAt.delete(sweep);
  try {
    await db.collection(HEARTBEAT_COLLECTION).deleteOne({ _id: sweep });
  } catch {
    // A leftover heartbeat only causes a conservative "active" reading, which
    // errs toward holding a merge — the safe direction.
  }
}

/**
 * Which sweeps are currently alive? Reads a collection with one doc per sweep,
 * so this is instant regardless of how big `entities` is.
 * @returns {Promise<Array<{sweep: string, host: string, pid: number, ageMs: number, progress: unknown}>>}
 */
export async function activeSweeps(db, staleAfterMs = STALE_AFTER_MS) {
  const docs = await db.collection(HEARTBEAT_COLLECTION).find({}, { maxTimeMS: 10000 }).toArray();
  const now = Date.now();
  return docs
    .map((d) => ({
      sweep: d._id,
      host: d.host,
      pid: d.pid,
      progress: d.progress,
      ageMs: now - new Date(d.last_beat_at).getTime(),
    }))
    .filter((d) => d.ageMs < staleAfterMs);
}
