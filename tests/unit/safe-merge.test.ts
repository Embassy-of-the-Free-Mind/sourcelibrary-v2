/**
 * scripts/maintenance/safe-merge.sh against a stubbed `gh` and a stubbed
 * interlock (#5711). Why: `--delete-branch` on a PR another PR is stacked on
 * closed the stacked PR twice (#5589, #5434), and a piped interlock read
 * tail's exit code and merged into an active sweep twice. These pin the
 * retarget-before-merge order and every refuse path.
 *
 * The `gh` stub is a node script whose state (PR views per poll, stacked
 * lists, calls made) lives in a JSON file. The `node` stub answers only the
 * interlock and execs the real node for everything else.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const SCRIPT = path.resolve(__dirname, '../../scripts/maintenance/safe-merge.sh');

const GH_STUB = `#!${process.execPath}
const fs = require('fs');
const file = process.env.STUB_STATE;
const s = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
s.calls.push(args.join(' '));
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const save = () => fs.writeFileSync(file, JSON.stringify(s));
const [a, b, n] = args;
let out = '', code = 0;
if (a === 'pr' && b === 'view') {
  if (s.merged.includes(n)) out = JSON.stringify({ mergeCommit: { oid: 'mergesha' + n } });
  else { const q = s.views[n]; out = JSON.stringify(q.length > 1 ? q.shift() : q[0]); }
} else if (a === 'pr' && b === 'list') {
  out = JSON.stringify((s.stacked[opt('--base')] || []).filter((x) => !s.retargeted.includes(String(x))).map((x) => ({ number: x })));
} else if (a === 'pr' && b === 'edit') {
  if (!s.editStuck) s.retargeted.push(n);
} else if (a === 'pr' && b === 'merge') {
  s.merged.push(n);
} else { code = 9; }
save();
if (out) console.log(out);
process.exit(code);
`;

const NODE_STUB = `#!/bin/sh
case "$*" in
  *entities-sweep-active.mjs*) echo "interlock $*" >> "$STUB_DIR/interlock.log"; exit "\${STUB_INTERLOCK_RC:-0}" ;;
esac
exec "$REAL_NODE" "$@"
`;

type View = Record<string, unknown>;
const clean = (n: number, over: View = {}): View => ({
  number: n, title: `PR ${n}`, state: 'OPEN', isDraft: false, labels: [],
  baseRefName: 'main', headRefName: `feat/pr-${n}`, headRefOid: `head${n}`, isCrossRepository: false,
  mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [], ...over,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'safe-merge-'));
  writeFileSync(path.join(dir, 'gh'), GH_STUB);
  writeFileSync(path.join(dir, 'node'), NODE_STUB);
  chmodSync(path.join(dir, 'gh'), 0o755);
  chmodSync(path.join(dir, 'node'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[], state: { views: Record<string, View[]>; stacked?: Record<string, number[]>; editStuck?: boolean }, interlockRc = 0) {
  const statePath = path.join(dir, 'state.json');
  writeFileSync(statePath, JSON.stringify({ stacked: {}, calls: [], retargeted: [], merged: [], ...state }));
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${dir}:${process.env.PATH}`, REAL_NODE: process.execPath,
      STUB_DIR: dir, STUB_STATE: statePath, STUB_INTERLOCK_RC: String(interlockRc),
      SAFE_MERGE_POLL_SECS: '0', SAFE_MERGE_POLL_TRIES: '3',
    },
  });
  const s = JSON.parse(readFileSync(statePath, 'utf8'));
  let interlock = '';
  try { interlock = readFileSync(path.join(dir, 'interlock.log'), 'utf8'); } catch { /* never ran */ }
  return { code: r.status, out: r.stdout + r.stderr, calls: s.calls as string[], merged: s.merged as string[], interlock };
}

const merges = (calls: string[]) => calls.filter((c) => c.startsWith('pr merge'));

describe('safe-merge.sh', () => {
  it('parses as bash', () => {
    expect(spawnSync('bash', ['-n', SCRIPT]).status).toBe(0);
  });

  it('retargets PRs stacked on the head branch to main BEFORE merging with --delete-branch', () => {
    const r = run(['10'], { views: { 10: [clean(10)] }, stacked: { 'feat/pr-10': [11, 12] } });
    expect(r.code).toBe(0);
    const editIdx = r.calls.map((c, i) => (c.startsWith('pr edit') ? i : -1)).filter((i) => i >= 0);
    const mergeIdx = r.calls.findIndex((c) => c.startsWith('pr merge'));
    expect(r.calls.filter((c) => c.startsWith('pr edit'))).toEqual([
      expect.stringMatching(/^pr edit 11 .*--base main/),
      expect.stringMatching(/^pr edit 12 .*--base main/),
    ]);
    expect(mergeIdx).toBeGreaterThan(Math.max(...editIdx));
    expect(r.calls[mergeIdx]).toMatch(/--squash/);
    expect(r.calls[mergeIdx]).toMatch(/--delete-branch/);
    expect(r.calls[mergeIdx]).toMatch(/--match-head-commit head10/);
    expect(r.out).toContain('merged #10 as mergesha10');
    expect(r.out).toContain('npx vercel ls sourcelibrary-v2 --meta githubCommitSha=mergesha10');
  });

  it('runs the interlock bare, with the production env file', () => {
    const r = run(['10'], { views: { 10: [clean(10)] } });
    expect(r.code).toBe(0);
    expect(r.interlock.trim()).toBe('interlock --env-file=.env.production.local scripts/audit/entities-sweep-active.mjs');
  });

  it('refuses when a retarget does not take', () => {
    const r = run(['10'], { views: { 10: [clean(10)] }, stacked: { 'feat/pr-10': [11] }, editStuck: true });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/still based on feat\/pr-10/);
    expect(merges(r.calls)).toEqual([]);
  });

  it('does not list or retarget for a fork PR (its head branch is not ours to delete)', () => {
    const r = run(['10'], { views: { 10: [clean(10, { isCrossRepository: true })] }, stacked: { 'feat/pr-10': [11] } });
    expect(r.code).toBe(0);
    expect(r.calls.some((c) => c.startsWith('pr edit') || c.startsWith('pr list'))).toBe(false);
  });

  it.each([1, 2])('refuses when the interlock exits %i, before touching the PR', (rc) => {
    const r = run(['10'], { views: { 10: [clean(10)] }, stacked: { 'feat/pr-10': [11] } }, rc);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`entities interlock exited ${rc}`);
    expect(r.calls).toEqual([]);
  });

  it.each([
    ['conflicting', clean(10, { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }), /mergeable=CONFLICTING/],
    ['draft', clean(10, { isDraft: true }), /draft/],
    ['blocked label', clean(10, { labels: [{ name: 'blocked' }] }), /blocked/],
    ['closed', clean(10, { state: 'CLOSED' }), /state=CLOSED/],
    ['stacked on another branch', clean(10, { baseRefName: 'feat/parent' }), /base is feat\/parent/],
    ['blocked with no failing check', clean(10, { mergeStateStatus: 'BLOCKED' }), /no failing check/],
  ])('refuses a %s PR', (_label, view, msg) => {
    const r = run(['10'], { views: { 10: [view] }, stacked: { 'feat/pr-10': [11] } });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(msg);
    expect(r.calls.some((c) => c.startsWith('pr edit') || c.startsWith('pr merge'))).toBe(false);
  });

  const unstable = clean(10, {
    mergeStateStatus: 'UNSTABLE',
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'next-build', status: 'COMPLETED', conclusion: 'FAILURE' },
    ],
  });

  it('refuses a failing check that is not named with --allow-check', () => {
    const r = run(['10'], { views: { 10: [unstable] } });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/failing: next-build/);
    expect(merges(r.calls)).toEqual([]);
  });

  it('merges when the only failures are named with --allow-check', () => {
    const r = run(['--allow-check', 'next-build', '10'], { views: { 10: [unstable] } });
    expect(r.code).toBe(0);
    expect(merges(r.calls)).toHaveLength(1);
  });

  it('refuses a still-running check even when other failures are allowed', () => {
    const view = clean(10, {
      mergeStateStatus: 'UNSTABLE',
      statusCheckRollup: [
        { __typename: 'CheckRun', name: 'next-build', status: 'COMPLETED', conclusion: 'FAILURE' },
        { __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS', conclusion: '' },
      ],
    });
    const r = run(['--allow-check', 'next-build', '10'], { views: { 10: [view] } });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/checks still running: test/);
  });

  // Previews are opt-in (#5980): a skipped one leaves the Vercel status PENDING
  // forever, and GitHub then reports UNSTABLE. Vercel is not gating (#5990).
  it('merges when the only thing not passing is the Vercel status', () => {
    for (const state of ['PENDING', 'FAILURE']) {
      const view = clean(10, {
        mergeStateStatus: 'UNSTABLE',
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { __typename: 'CheckRun', name: 'next-build', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { __typename: 'StatusContext', context: 'Vercel', state },
        ],
      });
      const r = run(['10'], { views: { 10: [view] } });
      expect(r.code).toBe(0);
      expect(merges(r.calls)).toHaveLength(1);
    }
  });

  it('still refuses a running next-build next to a pending Vercel status', () => {
    const view = clean(10, {
      mergeStateStatus: 'UNSTABLE',
      statusCheckRollup: [
        { __typename: 'StatusContext', context: 'Vercel', state: 'PENDING' },
        { __typename: 'CheckRun', name: 'next-build', status: 'IN_PROGRESS', conclusion: '' },
      ],
    });
    const r = run(['10'], { views: { 10: [view] } });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/checks still running: next-build/);
  });

  it('waits out UNKNOWN mergeability, then merges', () => {
    const unknown = clean(10, { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' });
    const r = run(['10'], { views: { 10: [unknown, unknown, clean(10)] } });
    expect(r.code).toBe(0);
    expect(r.calls.filter((c) => c.startsWith('pr view 10 ') && c.includes('mergeStateStatus'))).toHaveLength(3);
    expect(merges(r.calls)).toHaveLength(1);
  });

  it('never treats UNKNOWN as clean: refuses once the polls run out', () => {
    const r = run(['10'], { views: { 10: [clean(10, { mergeable: 'MERGEABLE', mergeStateStatus: 'UNKNOWN' })] } });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/still UNKNOWN after 3 tries/);
    expect(merges(r.calls)).toEqual([]);
  });

  it('merges several PRs in order, re-running the interlock for each, and stops at the first refusal', () => {
    const r = run(['10', '11', '12'], {
      views: {
        10: [clean(10)],
        11: [clean(11, { mergeable: 'UNKNOWN' }), clean(11, { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' })],
        12: [clean(12)],
      },
    });
    expect(r.code).toBe(1);
    expect(r.merged).toEqual(['10']);
    expect(r.interlock.trim().split('\n')).toHaveLength(2);
    expect(r.out).toMatch(/REFUSED #11/);
    expect(r.calls.some((c) => c.startsWith('pr view 12'))).toBe(false);
  });

  it('--dry-run touches nothing', () => {
    const r = run(['--dry-run', '10'], { views: { 10: [clean(10)] }, stacked: { 'feat/pr-10': [11] } });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/would retarget #11/);
    expect(r.calls.some((c) => c.startsWith('pr edit') || c.startsWith('pr merge'))).toBe(false);
  });

  it('rejects usage errors with exit 2', () => {
    expect(run([], { views: {} }).code).toBe(2);
    expect(run(['abc'], { views: {} }).code).toBe(2);
  });
});
