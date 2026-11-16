// claude-job.sh login check (v3#176): `start` and `resume` refuse a Claude login whose settings.json lacks the
// job permissions. On 2026-11-12 four jobs started with JOB_CLAUDE_HOME=/root/.claude-derek (a hook, no
// permissions block) and were refused almost every command; `start` had accepted the login.
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/claude-job.sh');
// The box's own login on 2026-11-13, read from /root/.claude/settings.json on main and gex45.
const PROFILE = { allow: ['Bash', 'Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent', 'Skill', 'TodoWrite', 'NotebookEdit', 'ToolSearch'], defaultMode: 'acceptEdits' };

let dir: string;
const home = (name: string, settings: unknown | null) => {
  const h = path.join(dir, name);
  fs.mkdirSync(h, { recursive: true });
  if (settings !== null) fs.writeFileSync(path.join(h, 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings));
  return h;
};
// NTFY_TOPIC points nowhere: if the check is ever removed, `start` would run on to gates that page Derek's phone.
const env = (extra: Record<string, string> = {}) =>
  ({ ...process.env, JOB_PROFILE_REF: path.join(dir, 'box', 'settings.json'), NTFY_TOPIC: 'http://127.0.0.1:9/none', ...extra });
// Source the wrapper's functions and ask about one login.
const gap = (h: string) => {
  const r = spawnSync('bash', ['-c', `CLAUDE_JOB_LIB=1 source "${SCRIPT}" 2>/dev/null; login_profile_gap "${h}"`], { encoding: 'utf8', env: env() });
  return { code: r.status, why: r.stdout.trim() };
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-login-'));
  home('box', { hooks: {}, permissions: PROFILE });
  fs.writeFileSync(path.join(dir, 'brief.txt'), 'Lands: none\nPR: no\n\nSay hello.\n');
});

describe('claude-job.sh login_profile_gap', () => {
  it('passes the box\'s own login and a second login with the same permissions', () => {
    expect(gap(path.join(dir, 'box'))).toEqual({ code: 0, why: '' });
    expect(gap(home('team', { permissions: PROFILE }))).toEqual({ code: 0, why: '' });
  });
  it('refuses a login with a hook and no permissions block (the 2026-11-12 case)', () => {
    const r = gap(home('hook-only', { hooks: { PreToolUse: [] } }));
    expect(r.code).toBe(1);
    expect(r.why).toContain('no Bash rule');
  });
  it('refuses a login with no settings.json, or one that does not parse', () => {
    expect(gap(home('empty', null))).toMatchObject({ code: 1, why: expect.stringContaining('does not exist') });
    expect(gap(home('broken', '{ not json'))).toMatchObject({ code: 1, why: expect.stringContaining('not valid JSON') });
  });
  it('refuses a login that can run Bash but lacks other rules, and names them', () => {
    const r = gap(home('partial', { permissions: { allow: PROFILE.allow.filter((t) => t !== 'Agent' && t !== 'WebFetch'), defaultMode: 'acceptEdits' } }));
    expect(r.code).toBe(1);
    expect(r.why).toMatch(/lacks allow rules .*: WebFetch Agent$/);
  });
  it('passes when the box has no reference file to compare with, so long as Bash is allowed', () => {
    const h = home('bash-only', { permissions: { allow: ['Bash'] } });
    const r = spawnSync('bash', ['-c', `CLAUDE_JOB_LIB=1 source "${SCRIPT}" 2>/dev/null; login_profile_gap "${h}"`],
      { encoding: 'utf8', env: env({ JOB_PROFILE_REF: path.join(dir, 'absent.json') }) });
    expect(r.status).toBe(0);
  });
});

describe('claude-job.sh start and resume', () => {
  // The check runs before anything is created, so a refused start leaves no worktree, tmux session or job file.
  const run = (args: string[], extra: Record<string, string>) =>
    spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: env(extra) });

  it('start exits 9 on a hook-only login and says why', () => {
    const r = run(['start', 'login-profile-test', path.join(dir, 'brief.txt')], { JOB_CLAUDE_HOME: home('hook-only-2', { hooks: {} }) });
    expect(r.status).toBe(9);
    expect(r.stdout).toContain('REFUSED: the Claude login this job would run on lacks the job permissions');
    expect(r.stdout).toContain('JOB_IGNORE_PROFILE=1');
  });
  it('resume exits 9 when the login in use is hook-only', () => {
    const r = run(['resume', 'login-profile-test'], { CLAUDE_CONFIG_DIR: home('hook-only-3', { hooks: {} }) });
    expect(r.status).toBe(9);
    expect(r.stdout).toContain('REFUSED');
  });
  // The gate itself, sourced: a full `start` on a good login would go on to the disk and login gates, which page.
  const gate = (extra: Record<string, string>) =>
    spawnSync('bash', ['-c', `CLAUDE_JOB_LIB=1 source "${SCRIPT}" 2>/dev/null; refuse_login_without_profile; echo passed`], { encoding: 'utf8', env: env(extra) });

  it('negative control: the gate lets a login with the profile through, and stops the hook-only one', () => {
    expect(gate({ CLAUDE_CONFIG_DIR: home('team-2', { permissions: PROFILE }) }).stdout.trim()).toBe('passed');
    const bad = gate({ CLAUDE_CONFIG_DIR: home('hook-only-4', { hooks: {} }) });
    expect(bad.status).toBe(9);
    expect(bad.stdout).not.toContain('passed');
  });
  it('JOB_IGNORE_PROFILE=1 skips the check', () => {
    expect(gate({ CLAUDE_CONFIG_DIR: home('hook-only-5', { hooks: {} }), JOB_IGNORE_PROFILE: '1' }).stdout.trim()).toBe('passed');
  });
});
