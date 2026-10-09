import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { hostname, tmpdir } from 'os';
import path from 'path';
import { judgeDrift, importClosure, checkWorkerDrift } from '../../scripts/audit/worker-code-drift.mjs';

/**
 * Merged is not in effect for a long-lived loop (#5442). On 2026-10-01 a detached
 * `translate-batch-worker.mjs --chained --loop` ran code eight hours older than main while every
 * record read the checkout and said the box was current. These pin the judgement both ways: a
 * worker older than main exits 3, an equal one exits 0 — so the audit can neither go quiet nor
 * cry wolf on every merge.
 */

const now = new Date('2026-10-01T08:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
const MAIN = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const CHECKOUT_CURRENT = { head: MAIN, behind: [] };
const fix = (h: number, pr: number) => ({ sha: `c${pr}`, at: hoursAgo(h), subject: `fix: thing (#${pr})` });
const worker = (over: object) => ({
  worker: 'translate-batch-worker', argv: '--chained --loop', pid: 4242, host: 'box',
  code_version: 'aaaaaaaaa', started_at: hoursAgo(9.5), ...over,
});

describe('judgeDrift', () => {
  it('a worker that loaded code older than main exits 3 with one STALE line (the 2026-10-01 shape)', () => {
    const r = judgeDrift({ main: MAIN, checkout: CHECKOUT_CURRENT, now, workers: [worker({ behind: [fix(8, 5427), fix(7, 5428), fix(7, 5431)] })] });
    expect(r.exit).toBe(3);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/^STALE translate-batch-worker \[--chained --loop\] pid=4242/);
    expect(r.lines[0]).toContain('#5427');
  });

  it('negative control: a worker at main exits 0 and prints nothing', () => {
    const r = judgeDrift({ main: MAIN, checkout: CHECKOUT_CURRENT, now, workers: [worker({ code_version: MAIN.slice(0, 9), behind: [] })] });
    expect(r.exit).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it('within grace is not stale: a cron worker started a minute before the pull is about to exit', () => {
    const r = judgeDrift({ main: MAIN, checkout: CHECKOUT_CURRENT, now, workers: [worker({ started_at: hoursAgo(0.02), behind: [fix(2, 1)] })] });
    expect(r.exit).toBe(0);
    const fresh = judgeDrift({ main: MAIN, checkout: CHECKOUT_CURRENT, now, workers: [worker({ behind: [fix(0.1, 1)] })] });
    expect(fresh.exit).toBe(0);
  });

  it('an unresolvable code version is UNVERIFIED — printed, never fresh, never stale', () => {
    const r = judgeDrift({ main: MAIN, checkout: CHECKOUT_CURRENT, now, workers: [worker({ code_version: 'not_recorded', behind: null })] });
    expect(r.exit).toBe(0);
    expect(r.unverified).toHaveLength(1);
    expect(r.lines[0]).toMatch(/^UNVERIFIED /);
  });

  it('a worker running another checkout (a nested worktree) is UNVERIFIED, never STALE (#6360)', () => {
    const r = judgeDrift({ main: MAIN, checkout: CHECKOUT_CURRENT, now, workers: [worker({ worktree: '.claude/worktrees/job-scan-cut-5189', branch: 'job-scan-cut-5189', behind: null })] });
    expect(r.exit).toBe(0);
    expect(r.stale).toEqual([]);
    expect(r.lines[0]).toMatch(/^UNVERIFIED .*runs another checkout \(\.claude\/worktrees\/job-scan-cut-5189, branch job-scan-cut-5189\)/);
  });

  it('a checkout behind main is one CHECKOUT_BEHIND line; workers that loaded it fold into it', () => {
    const head = 'cccccccccccccccccccccccccccccccccccccccc';
    const behind = [fix(3, 9)];
    const r = judgeDrift({ main: MAIN, checkout: { head, behind }, now, workers: [worker({ code_version: head.slice(0, 9), behind })] });
    expect(r.exit).toBe(3);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/^CHECKOUT_BEHIND /);
  });
});

describe('importClosure', () => {
  it('follows relative imports, ignores packages', () => {
    const files: Record<string, string> = {
      '/r/scripts/workers/w.mjs': "import x from '../lib/a.mjs';\nimport { MongoClient } from 'mongodb';",
      '/r/scripts/lib/a.mjs': "export * from './b';\nconst c = await import('./c.mjs');",
      '/r/scripts/lib/b.mjs': '',
      '/r/scripts/lib/c.mjs': '',
      '/r/scripts/lib/unrelated.mjs': '',
    };
    const read = (f: string) => { if (!(f in files)) throw new Error('ENOENT'); return files[f]; };
    expect(importClosure('/r', '/r/scripts/workers/w.mjs', read).sort())
      .toEqual(['scripts/lib/a.mjs', 'scripts/lib/b.mjs', 'scripts/lib/c.mjs', 'scripts/workers/w.mjs']);
  });
});

describe('checkWorkerDrift against a real git repo', () => {
  let repo: string;
  let v1: string;
  let v2: string;
  const g = (args: string[], env: Record<string, string> = {}) =>
    execFileSync('git', ['-C', repo, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' }).trim();
  const db = (rows: object[]) => ({
    collection: () => ({ createIndex: async () => 'ok', find: () => ({ toArray: async () => rows }) }),
  });

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'drift-'));
    g(['init', '-q', '-b', 'main']);
    mkdirSync(path.join(repo, 'scripts/workers'), { recursive: true });
    mkdirSync(path.join(repo, 'scripts/lib'), { recursive: true });
    writeFileSync(path.join(repo, 'scripts/workers/w.mjs'), "import '../lib/a.mjs';\n");
    writeFileSync(path.join(repo, 'scripts/lib/a.mjs'), 'export const v = 1;\n');
    const old = { GIT_AUTHOR_DATE: hoursAgo(10).toISOString(), GIT_COMMITTER_DATE: hoursAgo(10).toISOString(), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    g(['add', '.']); g(['commit', '-q', '-m', 'v1'], old);
    v1 = g(['rev-parse', 'HEAD']);
    writeFileSync(path.join(repo, 'scripts/lib/a.mjs'), 'export const v = 2;\n');
    const merged = { ...old, GIT_AUTHOR_DATE: hoursAgo(8).toISOString(), GIT_COMMITTER_DATE: hoursAgo(8).toISOString() };
    g(['commit', '-q', '-am', 'fix: a (#5431)'], merged);
    v2 = g(['rev-parse', 'HEAD']);
    g(['update-ref', 'refs/remotes/origin/main', v2]);
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const row = (code_version: string) => ({
    worker: 'w', argv: '--loop', pid: process.pid, host: hostname(), script: path.join(repo, 'scripts/workers/w.mjs'),
    code_version, started_at: hoursAgo(9), last_beat: now,
  });

  it('a heartbeat older than main → exit 3', async () => {
    const r = await checkWorkerDrift(db([row(v1.slice(0, 9))]), { repo, now });
    expect(r.exit).toBe(3);
    expect(r.lines.filter((l: string) => l.startsWith('STALE'))).toHaveLength(1);
    expect(r.lines[0]).toContain('#5431');
  });

  it('a heartbeat equal to main → exit 0', async () => {
    const r = await checkWorkerDrift(db([row(v2.slice(0, 9))]), { repo, now });
    expect(r.exit).toBe(0);
  });
});

describe('long-running workers announce their code version', () => {
  // The archive-acquired heartbeat was silently deleted by a concurrent PR the day it landed
  // (#4428). This runs in every PR's CI, so a rewrite that drops the beacon goes red there.
  const WORKERS = [
    'translate-worker', 'translate-batch-worker', 'pipeline-orchestrator', 'image-extract-worker',
    'enrich-worker', 'scheduler', 'identity-worker', 'syriac-kraken-lane', 'clip-server',
    'embedding-server', 'batch-collector', 'es-translate-worker', 'mineru-ocr-worker', 'deepzoom-tile-worker',
  ];
  it.each(WORKERS)('%s calls startWorkerBeacon(import.meta.url)', (w) => {
    const src = readFileSync(path.resolve(__dirname, `../../scripts/workers/${w}.mjs`), 'utf8');
    expect(src).toMatch(/^startWorkerBeacon\(import\.meta\.url\);/m);
  });
});
