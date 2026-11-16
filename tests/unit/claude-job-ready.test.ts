// claude-job.sh: one answer to "may a job start on this box now?" (v3 #70).
// On 2026-11-12 gex45's `where` said ready=yes with 13% of its root disk free and a load of 110 on 20 threads, while
// `start` refused under 15% free and paged high. The spare lane called `start` every 30 minutes, so each refusal was
// a page. `where` and `start` now read the same function (ready_state), and these tests hold them to it.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/claude-job.sh');

type Box = { root?: number; load?: string; weekly?: string; gaps?: string };
// Source the wrapper's functions, then replace the four probes of the box (root disk, load, the account's week,
// setup) with fixed readings, and the pager with a line on stdout. SL points at an empty folder so the refusal
// does not run the real job-where.sh, which asks every box over the network.
const box = (b: Box, body: string, env: Record<string, string> = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cjr-'));
  const stubs = [
    `SL="${root}/sl"; DATA="${root}"`,
    `root_free_pct() { echo ${b.root ?? 40}; }`,
    'root_free_gb() { echo 50; }',
    `load5_per_core() { echo ${b.load ?? '0.40'}; }`,
    `weekly_pct() { echo "${b.weekly ?? '20'}"; }`,
    `setup_gaps() { echo "${b.gaps ?? ''}"; }`,
    'ntfy_job() { echo "PAGE $1: $3"; }',
  ].join('\n');
  const r = spawnSync('bash', ['-c', `CLAUDE_JOB_LIB=1 source "${SCRIPT}" 2>/dev/null\n${stubs}\n${body}`],
    { encoding: 'utf8', env: { ...process.env, JOB_IGNORE_DISK: '', JOB_IGNORE_LOAD: '', JOB_IGNORE_LIMIT: '', ...env } });
  return r.stdout.trim();
};
// What `where` prints as ready=, and what `start` does with a job named j1 on the same box: its exit code and output.
const where = (b: Box, env = {}) => (box(b, 'where_line 2>/dev/null', env).match(/ ready=(\S+)/) || [])[1];
const start = (b: Box, env = {}) => {
  const out = box(b, 'start_refusal j1 "$(ready_state)"; echo "rc=$?"', env);
  return { rc: Number((out.match(/rc=(\d+)$/) || [])[1]), out };
};

describe('claude-job.sh ready_state: where and start give one answer', () => {
  it('a healthy box is ready, and start says nothing', () => {
    expect(where({})).toBe('yes');
    expect(start({})).toEqual({ rc: 0, out: 'rc=0' });
  });

  it('gex45 on 2026-11-12 (13% of root free, 5.5 per core): where says no, as start does', () => {
    const gex45 = { root: 13, load: '5.50' };
    expect(where(gex45)).toBe('no:root-13pct-free,load-5.50-per-core');
    const s = start(gex45);
    expect(s.rc).toBe(5);
    expect(s.out).toContain('REFUSED: root disk has 13% free');
    expect(s.out).toContain('PAGE high: Job refused, root disk 13% free: j1');
  });

  it('the root-disk floor is 15% free: 14 refuses, 15 does not', () => {
    expect(where({ root: 14 })).toBe('no:root-14pct-free');
    expect(start({ root: 14 }).rc).toBe(5);
    expect(where({ root: 15 })).toBe('yes');
    expect(start({ root: 15 }).rc).toBe(0);
  });

  it('a 5-minute load over 1.5 per core is reported by where; a start that names the box warns and goes ahead, with no page', () => {
    expect(where({ load: '1.50' })).toBe('yes');
    expect(where({ load: '1.51' })).toBe('no:load-1.51-per-core');
    const s = start({ load: '5.50' });
    expect(s.rc).toBe(0);
    expect(s.out).toContain('warn: `where` reports this box as ready=no:load-5.50-per-core');
    expect(s.out).not.toContain('PAGE');
    expect(s.out).not.toContain('REFUSED');
  });

  it('a spent account: where says weekly-NNpct and start refuses with exit 6, without a page', () => {
    expect(where({ weekly: '89' })).toBe('yes');
    expect(where({ weekly: '93' })).toBe('no:weekly-93pct');
    const s = start({ weekly: '93' });
    expect(s.rc).toBe(6);
    expect(s.out).toContain('at 93% of its weekly limit');
    expect(s.out).not.toContain('PAGE');
  });

  it('no meter reading (absent or stale) is no weekly check, in both', () => {
    expect(where({ weekly: '' })).toBe('yes');
    expect(start({ weekly: '' }).rc).toBe(0);
  });

  it('each switch changes both answers together (the spare lane drains with JOB_IGNORE_LIMIT=1)', () => {
    const full = { root: 13, load: '5.50', weekly: '93' };
    expect(where(full)).toBe('no:root-13pct-free,load-5.50-per-core,weekly-93pct');
    expect(where({ weekly: '93' }, { JOB_IGNORE_LIMIT: '1' })).toBe('yes');
    expect(start({ weekly: '93' }, { JOB_IGNORE_LIMIT: '1' }).rc).toBe(0);
    expect(where({ root: 13 }, { JOB_IGNORE_DISK: '1' })).toBe('yes');
    expect(start({ root: 13 }, { JOB_IGNORE_DISK: '1' }).rc).toBe(0);
    expect(where({ load: '5.50' }, { JOB_IGNORE_LOAD: '1' })).toBe('yes');
    expect(where(full, { JOB_IGNORE_DISK: '1', JOB_IGNORE_LOAD: '1', JOB_IGNORE_LIMIT: '1' })).toBe('yes');
  });

  it('keeps the setup reasons, first in the list', () => {
    expect(where({ gaps: 'claude-not-logged-in' })).toBe('no:claude-not-logged-in');
    expect(where({ gaps: 'gh-not-logged-in,no-bash-permission', root: 13, weekly: '93' }))
      .toBe('no:gh-not-logged-in,no-bash-permission,root-13pct-free,weekly-93pct');
    // A setup gap alone is a placement reason: nothing picks the box, and a start that names it is warned.
    const s = start({ gaps: 'no-bash-permission' });
    expect(s.rc).toBe(0);
    expect(s.out).toContain('warn: `where` reports this box as ready=no:no-bash-permission');
  });

  it('start never refuses on a box where says is ready (every combination of the three readings)', () => {
    // One bash process walks the grid: 80 boxes, one line each: "<root> <load> <weekly> <ready> <start's exit code>".
    const rows = box({}, `for r in 5 14 15 60; do for l in 0.10 1.50 1.51 6.00; do for w in "" 10 89 90 100; do
      root_free_pct() { echo $r; }; load5_per_core() { echo $l; }; weekly_pct() { echo "$w"; }
      rs=$(ready_state); start_refusal j1 "$rs" >/dev/null; echo "$r $l \${w:--} $rs $?"
    done; done; done`).split('\n').map((l) => l.split(' '));
    expect(rows).toHaveLength(80);
    for (const [root, load, weekly, ready, rc] of rows) {
      const row = `root ${root}% free, load ${load}, week ${weekly}`;
      if (ready === 'yes') expect([row, rc]).toEqual([row, '0']);
      if (rc !== '0') expect([row, ready.startsWith('no:')]).toEqual([row, true]);
      expect([row, rc]).toEqual([row, Number(root) < 15 ? '5' : Number(weekly) >= 90 ? '6' : '0']);
      expect([row, ready === 'yes']).toEqual([row, Number(root) >= 15 && Number(load) <= 1.5 && !(Number(weekly) >= 90)]);
    }
  });

  it('the start verb has no check of its own: it asks ready_state, and reads no disk or meter itself', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const verb = src.slice(src.indexOf('\n  start)\n'), src.indexOf('\n  resume)\n'));
    expect(verb).toContain('start_refusal "$name" "$(ready_state)" || exit $?');
    expect(verb).not.toMatch(/root_free_pct|weekly_pct|loadavg/);
    expect(src).toContain('\n  where) where_line ;;\n');
  });
});
