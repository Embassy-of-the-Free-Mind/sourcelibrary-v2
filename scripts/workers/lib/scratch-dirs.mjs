/**
 * Per-book scratch dirs that a SIGKILL cannot leak for hours (#4564).
 *
 * PRIOR ART: scripts/workers/archive-bulk.mjs cleanupStaleTmpDirs — an age-only
 * sweep (6h); this replaces it. scripts/import/bdrc-scans-import.mjs diskPercent —
 * a statfs check on '/', not on the scratch filesystem and not exported.
 *
 * The incident (2026-09-01): archive-bulk mkdtemps a 3-4GB JP2 extraction dir per
 * book. OOM kills skip the `finally` that removes it; the next run retries the same
 * book in a NEW dir. At one leak per ~15 min retry, /tmp held 44GB of sl-bulk-* and
 * the Hetzner disk hit 100% long before any dir reached the 6h age cutoff.
 *
 * The fix is ownership, not age: every scratch dir carries an `.owner` file with the
 * creating process's pid and kernel start time. A dir whose owner is no longer
 * running is a leak the moment its owner dies, whatever its age — so the next run's
 * startup sweep reclaims it before it mkdtemps another. The start time guards pid
 * reuse: a recycled pid with a different start time is not the owner.
 *
 * Dirs without an `.owner` file (written before this change, or by another script
 * sharing the prefix — archive-images-fast.ts uses `sl-bulk-`) keep the old
 * age-based rule, because there is no way to tell them from a live job.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const OWNER_FILE = '.owner';

/** Kernel start time of `pid` (clock ticks since boot), or null if unknown. */
export function processStartTime(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Field 2 (comm) may contain spaces and parens; fields after the LAST ')' are fixed.
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return rest[19] ?? null; // field 22 overall = index 19 after state (field 3)
  } catch {
    return null;
  }
}

/** Is the process that wrote `owner` ({pid, start}) still the one running at that pid? */
export function ownerAlive(owner) {
  const pid = Number(owner?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    // EPERM: exists but belongs to another user — alive.
    if (err.code !== 'EPERM') return false;
  }
  if (owner.start == null) return true;
  const now = processStartTime(pid);
  // No /proc (macOS): kill(0) succeeding is the best we have.
  return now == null ? true : String(now) === String(owner.start);
}

/** mkdtemp under `root` with prefix, stamped with this process as owner. */
export function makeOwnedScratchDir(root, prefix) {
  const dir = fs.mkdtempSync(path.join(root, prefix));
  const owner = { pid: process.pid, start: processStartTime(process.pid), created_at: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, OWNER_FILE), JSON.stringify(owner));
  return dir;
}

function readOwner(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, OWNER_FILE), 'utf8')); }
  catch { return null; }
}

function dirBytes(dir) {
  try { return parseInt(execFileSync('du', ['-sb', dir], { stdio: ['ignore', 'pipe', 'ignore'] }).toString(), 10) || 0; }
  catch { return 0; }
}

/**
 * Remove leaked `prefix*` dirs under `root`:
 *   - owned dirs whose owner process is gone (any age);
 *   - un-owned dirs older than `unownedMaxAgeMs` (legacy rule).
 * Dirs owned by a live process are never touched.
 */
export function sweepLeakedScratchDirs(root, prefix, { unownedMaxAgeMs, now = Date.now() } = {}) {
  const result = { removed: 0, bytesFreed: 0, keptLive: 0, keptYoung: 0 };
  let entries;
  try { entries = fs.readdirSync(root); } catch { return result; }
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue;
    const full = path.join(root, name);
    try {
      const st = fs.statSync(full);
      if (!st.isDirectory()) continue;
      const owner = readOwner(full);
      if (owner) {
        if (ownerAlive(owner)) { result.keptLive++; continue; }
      } else if (unownedMaxAgeMs == null || now - st.mtimeMs < unownedMaxAgeMs) {
        result.keptYoung++;
        continue;
      }
      const size = dirBytes(full);
      fs.rmSync(full, { recursive: true, force: true });
      result.removed++;
      result.bytesFreed += size;
    } catch {}
  }
  return result;
}

/** Free bytes available to an unprivileged writer on the filesystem holding `dir`. */
export function freeBytes(dir) {
  const s = fs.statfsSync(dir);
  return s.bavail * s.bsize;
}
