import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { judgeRestart, heldLocks, selectPageLines, MIN_RESTART_INTERVAL_MS, BUSY_PAGE_AFTER_MS, REPAGE_HELD_MS } from '../../scripts/maintenance/stale-worker-restart.mjs';

/**
 * The drift alert said "check open batch runs and the lock it holds first" and paged a person
 * every six hours to do it (#6360). These pin the check that replaced the person: restart only
 * when every precondition holds, and hold (page) when any one fails or cannot be read.
 */

const now = new Date('2026-10-09T06:00:00Z');
const REPO = '/root/sourcelibrary';
const unit = { name: 'sl-clip-server.service', transient: false, workingDirectory: REPO, mainPid: 2056020, active: 'active', port: 3457, execStart: '{ path=/usr/bin/node ; argv[]=/usr/bin/node scripts/workers/clip-server.mjs ; }' };
const clear = { pid: 2056020, worker: 'clip-server', unit, repo: REPO, locks: [], openBatches: [], connections: 0, lastRestartAt: null, now };

describe('judgeRestart', () => {
  it('a systemd worker with no lock, no open batch and no live request is restarted', () => {
    expect(judgeRestart(clear)).toEqual({ action: 'restart', reasons: [], page: false });
  });

  it('a loop started by hand (no unit) is held and paged: how to restart it is not on record', () => {
    const r = judgeRestart({ ...clear, unit: null });
    expect(r.action).toBe('hold');
    expect(r.page).toBe(true);
    expect(r.reasons[0]).toMatch(/no systemd unit/);
  });

  it('a held lock, an open batch run, or an unreadable batch store each hold it', () => {
    expect(judgeRestart({ ...clear, locks: ['/tmp/sl-translate-chained.lock'] }).action).toBe('hold');
    expect(judgeRestart({ ...clear, openBatches: ['batch-1 JOB_STATE_RUNNING'] }).action).toBe('hold');
    const unknown = judgeRestart({ ...clear, openBatches: null });
    expect(unknown.action).toBe('hold');
    expect(unknown.reasons[0]).toMatch(/unknown/);
  });

  it('a cron-started worker (cgroup cron.service, MainPID crond) is held: restarting the unit would restart cron', () => {
    const cron = { name: 'cron.service', transient: false, workingDirectory: null, mainPid: 939, active: 'active', port: null, execStart: '{ path=/usr/sbin/cron ; argv[]=/usr/sbin/cron -f -P ; }' };
    const r = judgeRestart({ ...clear, pid: 3508026, worker: 'pipeline-orchestrator', unit: cron });
    expect(r.action).toBe('hold');
    expect(r.reasons[0]).toMatch(/not the main process of cron\.service/);
  });

  it('a worker that is a child of a wrapper unit, or a unit whose ExecStart names another script, is held', () => {
    expect(judgeRestart({ ...clear, pid: 4242 }).action).toBe('hold');
    expect(judgeRestart({ ...clear, worker: 'embedding-server' }).reasons[0]).toMatch(/does not name embedding-server\.mjs/);
  });

  it('a transient unit, or one running from another checkout, is held', () => {
    expect(judgeRestart({ ...clear, unit: { ...unit, transient: true } }).action).toBe('hold');
    expect(judgeRestart({ ...clear, unit: { ...unit, workingDirectory: '/root/sourcelibrary/.claude/worktrees/x' } }).action).toBe('hold');
  });

  it('restarted by this script less than 6 h ago and still stale → hold, never a restart loop', () => {
    const recent = new Date(now.getTime() - MIN_RESTART_INTERVAL_MS / 2).toISOString();
    expect(judgeRestart({ ...clear, lastRestartAt: recent }).action).toBe('hold');
    const old = new Date(now.getTime() - MIN_RESTART_INTERVAL_MS * 2).toISOString();
    expect(judgeRestart({ ...clear, lastRestartAt: old }).action).toBe('restart');
  });

  it('busy serving a request defers without a page, and pages once stale past 24 h', () => {
    expect(judgeRestart({ ...clear, connections: 2, staleForMs: 3600_000 })).toMatchObject({ action: 'defer', page: false });
    expect(judgeRestart({ ...clear, connections: 2, staleForMs: BUSY_PAGE_AFTER_MS + 1 })).toMatchObject({ action: 'defer', page: true });
  });
});

describe('heldLocks (live /proc)', () => {
  it('finds a lock held by the flock(1) wrapper around a worker, by path; none for a bare process', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'swr-'));
    const lock = path.join(dir, 'worker.lock');
    const wrapped = spawn('flock', ['-n', lock, 'sleep', '30'], { stdio: 'ignore' });
    const bare = spawn('sleep', ['30'], { stdio: 'ignore' });
    try {
      // the child of flock is the "worker"; wait until it exists
      let child: number | null = null;
      for (let i = 0; i < 50 && !child; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const { execFileSync } = await import('child_process');
        const out = execFileSync('pgrep', ['-P', String(wrapped.pid)], { encoding: 'utf8' }).trim();
        child = out ? Number(out.split('\n')[0]) : null;
      }
      expect(child).toBeTruthy();
      expect(heldLocks(child!)).toContain(lock);
      // Negative control: a process outside the wrapper does not inherit its lock. (Not `toEqual([])`:
      // a test runner's own ancestors may hold unrelated locks inside the same cgroup.)
      expect(heldLocks(bare.pid!)).not.toContain(lock);
    } finally {
      wrapped.kill(); bare.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('selectPageLines', () => {
  const held = (w: string, pid: number) => `${w} pid=${pid} — held: not the main process of cron.service (MainPID 939)`;
  const A = held('embed-gemini', 2629492);
  const B = held('mirror-changelog', 3891638);
  const H = 3600 * 1000;

  it('replays 2026-10-11: archive-bulk coming and going no longer re-pages the same two held pids', () => {
    const t0 = Date.parse('2026-10-11T10:17:00Z');
    const runs: [number, string[]][] = [
      [0, [A, held('archive-bulk', 2669553), B]], [1, [A, B]], [2, [A, B]], [3, [A, B]], [4, [A, B]],
      [5, [A, held('archive-bulk', 2825928), B]], [6, [A, B]], [7, [A, B]], [8, [A, B]],
    ];
    let sent: Record<string, number> = {};
    const pages: string[][] = [];
    for (const [h, lines] of runs) {
      const r = selectPageLines(lines, sent, t0 + h * H);
      if (r.fresh.length) { pages.push(r.fresh); for (const l of r.fresh) r.sent[l.split(' — ')[0]] = t0 + h * H; }
      sent = r.sent;
    }
    // Before: four pages, each naming both pids. After: the first page, then only the new archive-bulk pid.
    expect(pages).toEqual([[A, held('archive-bulk', 2669553), B], [held('archive-bulk', 2825928)]]);
  });

  it('a held pid pages again after a day; a new pid for the same worker pages at once', () => {
    const t = Date.parse('2026-10-11T10:00:00Z');
    const sent = { 'embed-gemini pid=2629492': t };
    expect(selectPageLines([A], sent, t + REPAGE_HELD_MS - 1).fresh).toEqual([]);
    expect(selectPageLines([A], sent, t + REPAGE_HELD_MS).fresh).toEqual([A]);
    expect(selectPageLines([held('embed-gemini', 1)], sent, t + H).fresh).toHaveLength(1);
  });

  it('a failed restart re-pages after 6 h, and the old per-set state reads as nothing sent', () => {
    const t = Date.parse('2026-10-11T10:00:00Z');
    const F = 'clip-server (sl-clip-server.service) — restart FAILED: unit inactive';
    const sent = { 'clip-server (sl-clip-server.service)': t };
    expect(selectPageLines([F], sent, t + 5 * H).fresh).toEqual([]);
    expect(selectPageLines([F], sent, t + 6 * H).fresh).toEqual([F]);
    expect(selectPageLines([A, B], undefined, t).fresh).toEqual([A, B]);
  });
});
