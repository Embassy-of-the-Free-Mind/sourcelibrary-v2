/**
 * A SIGKILLed archive-bulk run must not leak its scratch dir for hours (#4564).
 *
 * The incident: OOM kills skipped the per-book `finally`, each retry mkdtemp'd a
 * fresh 3-4GB dir, and the 6h age-only sweep let 44GB pile up in /tmp until the
 * Hetzner disk hit 100%. These tests create a scratch dir from a real child
 * process, SIGKILL it, and assert the next sweep reclaims the dir at once — while
 * a dir owned by a live process, however old, is never touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  makeOwnedScratchDir,
  sweepLeakedScratchDirs,
  ownerAlive,
  processStartTime,
  freeBytes,
} from '../../scripts/workers/lib/scratch-dirs.mjs';

const LIB = path.resolve(__dirname, '../../scripts/workers/lib/scratch-dirs.mjs');
const HOUR = 60 * 60 * 1000;

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-sweep-test-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

/** A child process makes an owned dir, writes a payload, then SIGKILLs itself. */
function leakFromKilledChild(): string {
  const script = `
    import { makeOwnedScratchDir } from ${JSON.stringify(LIB)};
    import * as fs from 'fs';
    const d = makeOwnedScratchDir(${JSON.stringify(root)}, 'sl-bulk-MN003272-');
    fs.writeFileSync(d + '/book.zip', Buffer.alloc(1024 * 1024));
    console.log(d);
    process.kill(process.pid, 'SIGKILL');
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  expect(r.signal).toBe('SIGKILL');
  const dir = r.stdout.trim();
  expect(fs.existsSync(path.join(dir, 'book.zip'))).toBe(true);
  return dir;
}

describe('sweepLeakedScratchDirs (#4564)', () => {
  it('reclaims a fresh dir whose owner was SIGKILLed, regardless of age', () => {
    const leaked = leakFromKilledChild();
    const r = sweepLeakedScratchDirs(root, 'sl-bulk-', { unownedMaxAgeMs: 6 * HOUR });
    expect(r.removed).toBe(1);
    expect(r.bytesFreed).toBeGreaterThanOrEqual(1024 * 1024);
    expect(fs.existsSync(leaked)).toBe(false);
  });

  it('reclaims every leak from repeated killed retries of the same book', () => {
    const leaks = [leakFromKilledChild(), leakFromKilledChild(), leakFromKilledChild()];
    expect(sweepLeakedScratchDirs(root, 'sl-bulk-', { unownedMaxAgeMs: 6 * HOUR }).removed).toBe(3);
    for (const d of leaks) expect(fs.existsSync(d)).toBe(false);
  });

  it('never touches a dir owned by a live process, even a very old one', () => {
    const live = makeOwnedScratchDir(root, 'sl-bulk-live-');
    const old = (Date.now() - 48 * HOUR) / 1000;
    fs.utimesSync(live, old, old);
    const r = sweepLeakedScratchDirs(root, 'sl-bulk-', { unownedMaxAgeMs: 6 * HOUR });
    expect(r).toMatchObject({ removed: 0, keptLive: 1 });
    expect(fs.existsSync(live)).toBe(true);
  });

  it('treats a recycled pid (same pid, different start time) as dead', () => {
    const start = processStartTime(process.pid);
    if (start == null) return; // no /proc on this platform
    expect(ownerAlive({ pid: process.pid, start })).toBe(true);
    expect(ownerAlive({ pid: process.pid, start: String(Number(start) + 1) })).toBe(false);
  });

  it('keeps the age rule for un-owned dirs (legacy, or archive-images-fast.ts)', () => {
    const young = fs.mkdtempSync(path.join(root, 'sl-bulk-young-'));
    const stale = fs.mkdtempSync(path.join(root, 'sl-bulk-stale-'));
    const old = (Date.now() - 7 * HOUR) / 1000;
    fs.utimesSync(stale, old, old);
    const r = sweepLeakedScratchDirs(root, 'sl-bulk-', { unownedMaxAgeMs: 6 * HOUR });
    expect(r).toMatchObject({ removed: 1, keptYoung: 1 });
    expect(fs.existsSync(young)).toBe(true);
    expect(fs.existsSync(stale)).toBe(false);
  });

  it('ignores dirs without the prefix', () => {
    const other = path.join(root, 'something-else');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, '.owner'), JSON.stringify({ pid: 999999999 }));
    expect(sweepLeakedScratchDirs(root, 'sl-bulk-', { unownedMaxAgeMs: 0 }).removed).toBe(0);
    expect(fs.existsSync(other)).toBe(true);
  });

  it('freeBytes reports the scratch filesystem', () => {
    expect(freeBytes(root)).toBeGreaterThan(0);
  });
});
