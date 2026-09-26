/**
 * PRIOR ART: scripts/maintenance/gpu-lease-watchdog.mjs — stops a rented GPU when its LEASE
 * expires, but a live lease on an idle GPU bills at full rate until it runs out; this module
 * is the idle rule the watchdog now also applies. scripts/lib/spend-guard.mjs gates Gemini
 * dispatch, not rented hardware. Nothing else in scripts/lib decides whether a machine is idle.
 *
 * gpu-idle — when is a rented GPU idle enough to power off?
 *
 * WHY (2026-09-26). September's Scaleway GPUs billed ~€358 for ~138K Tibetan pages, about
 * $0.003/page, against ~$0.00025/page when the GPU is busy. Most of the difference was a GPU
 * sitting inside a live lease with nothing running (a dead session, a finished job, setup and
 * benchmarks). A lease bounds the damage; it does not see idleness. The fix measures OUTPUT:
 * a leased server carries a `progress=` tag naming what its work writes, and a pass with no
 * new output for IDLE_MINUTES powers it off. "Judge a worker by its output growing" — the
 * activity of a process is not evidence it is doing the work.
 *
 * Tag grammar (on the Scaleway instance):
 *   progress=mongo:<ocr.source>   pages whose ocr.source is <value> and ocr.updated_at is recent
 * A leased server WITHOUT a progress tag keeps the old lease-only behaviour, and the on-box
 * watcher (scripts/gpu/idle-poweroff.sh, GPU utilisation) covers it from the inside.
 */

export const DEFAULT_IDLE_MINUTES = 30;
export const DEFAULT_GRACE_MINUTES = 20; // boot, model load, first batch

export function parseProgressTag(value) {
  if (!value) return null;
  const m = /^mongo:([A-Za-z0-9._\-/]+)$/.exec(String(value).trim());
  return m ? { kind: 'mongo', source: m[1] } : { kind: 'invalid', raw: String(value) };
}

/**
 * Decide what to do with one RUNNING, LEASED server.
 * @param {object} p
 * @param {Date}   p.now
 * @param {Date}   p.runningSince       when the server entered its current state
 * @param {Date|null} p.lastOutputAt    newest output timestamp the probe found (null = none in window)
 * @param {number} [p.idleMinutes]
 * @param {number} [p.graceMinutes]
 * @returns {{ action: 'keep'|'stop', reason: string }}
 */
export function idleDecision({ now, runningSince, lastOutputAt, idleMinutes = DEFAULT_IDLE_MINUTES, graceMinutes = DEFAULT_GRACE_MINUTES }) {
  const minsRunning = (now - runningSince) / 60000;
  if (minsRunning < graceMinutes) return { action: 'keep', reason: `in start-up grace (${minsRunning.toFixed(0)} of ${graceMinutes} min)` };
  if (lastOutputAt) {
    const quiet = (now - lastOutputAt) / 60000;
    if (quiet < idleMinutes) return { action: 'keep', reason: `output ${quiet.toFixed(0)} min ago` };
    return { action: 'stop', reason: `no new output for ${quiet.toFixed(0)} min (limit ${idleMinutes})` };
  }
  // Nothing in the probe window. Only stop once the server has also been up longer than the
  // idle window, so a server that just left grace gets a full window to produce its first page.
  if (minsRunning >= graceMinutes + idleMinutes) return { action: 'stop', reason: `no output in the last ${idleMinutes} min and up ${minsRunning.toFixed(0)} min` };
  return { action: 'keep', reason: `no output yet, up ${minsRunning.toFixed(0)} min` };
}
