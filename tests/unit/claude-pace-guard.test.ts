// claude-pace-guard.sh when the climits meter cannot speak for this login (#8168): read the login's own usage, and page
// when the guard has failed open for over an hour. Runs the real script with a stub CLI and file:// endpoints.
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/claude-pace-guard.sh');
const EMAIL = 'a@example.org';
const iso = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3600e3).toISOString();

const setup = (meterAccount: object, expiresAt = Date.now() + 3600e3) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-'));
  const home = path.join(root, 'home'); fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: EMAIL } }));
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 't', expiresAt } }));
  fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify({ checked_at: iso(0), accounts: [{ email: EMAIL, ...meterAccount }] }));
  fs.writeFileSync(path.join(root, 'usage.json'), JSON.stringify({ seven_day: { utilization: 71, resets_at: iso(40) } }));
  fs.writeFileSync(path.join(root, 'real'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return { root, dir: path.join(root, 'pace'), env: { ...process.env, HOME: home, CLAUDE_REAL: path.join(root, 'real'), CLAUDE_CONFIG_DIR: '',
    CLAUDE_PACE_DIR: path.join(root, 'pace'), CLAUDE_PACE_METER: path.join(root, 'latest.json'),
    CLAUDE_PACE_USAGE_URL: `file://${path.join(root, 'usage.json')}`, CLAUDE_PACE_NTFY: `file://${path.join(root, 'no-ntfy')}` } };
};
const run = (env: NodeJS.ProcessEnv) => spawnSync('bash', [SCRIPT, '-p', 'hi'], { encoding: 'utf8', env });
const NOT_OK = { ok: false, error: 'HTTP 400 invalid_grant' };

describe('pace guard with a meter that cannot read this login', () => {
  it('takes the week from the login and keeps a burn rate from its own samples', () => {
    const { dir, env } = setup(NOT_OK);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, `${EMAIL}.hist`), `${iso(-1)} 69\n`);
    expect(run(env).status).toBe(0);
    const slots = fs.readFileSync(path.join(dir, `${EMAIL}.slots`), 'utf8');
    expect(slots).toMatch(/^\d+ burn=2\.\d+%\/h,budget=0\.7\d%\/h,week=71%,src=login\n$/);
    expect(fs.existsSync(path.join(dir, 'failopen.log'))).toBe(false);
  });

  it('never refreshes: an expired token fails open and says why, without calling the endpoint', () => {
    const { dir, env } = setup(NOT_OK, Date.now() - 1000);
    expect(run(env).status).toBe(0);
    expect(fs.readFileSync(path.join(dir, `${EMAIL}.slots`), 'utf8')).toMatch(/^12 meter-error:.*account-not-ok-in-meter\+login-unread:ValueError:token-expired/);
    expect(fs.readFileSync(path.join(dir, 'failopen.log'), 'utf8')).toContain('token-expired');
  });

  it('prefers a good meter and does not touch the endpoint', () => {
    const { root, dir, env } = setup({ ok: true, limits: [{ key: 'weekly_all:all', percent: 50, resets_at: iso(50), burn_pct_per_h: 2 }] });
    fs.rmSync(path.join(root, 'usage.json'));
    expect(run(env).status).toBe(0);
    expect(fs.readFileSync(path.join(dir, `${EMAIL}.slots`), 'utf8')).toMatch(/^6 burn=2\.00%\/h,budget=1\.00%\/h,week=50%,src=meter\n$/);
    expect(fs.existsSync(path.join(dir, `${EMAIL}.usage`))).toBe(false);
  });

  it('concurrent decisions do not read as fail-open', async () => {
    // Each round is a new meter reading and an empty cache, so all 12 calls write the samples file at once. The shared
    // .tmp this replaces lost the replace about 22 times in these 300 calls, and gex45 logged the same on 2026-11-04.
    const { root, dir, env } = setup({});
    for (let round = 0; round < 25; round++) {
      fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify({ checked_at: iso(0), accounts: [{ email: EMAIL, ok: true, limits: [{ key: 'weekly_all:all', percent: 50, resets_at: iso(50), burn_pct_per_h: 2 }] }] }));
      fs.rmSync(path.join(dir, `${EMAIL}.slots`), { force: true });
      await Promise.all(Array.from({ length: 12 }, () => new Promise((res) => spawn('bash', [SCRIPT, '-p', 'hi'], { env: { ...env, PACE_MAX_SLOTS: '40' } }).on('close', res))));
    }
    expect(fs.existsSync(path.join(dir, 'failopen.log'))).toBe(false);
  }, 120e3);
});

describe('pace guard paging on a long fail-open', () => {
  const blind = () => {
    const s = setup(NOT_OK, Date.now() - 1000);
    const sink = path.join(s.root, 'ntfy');
    fs.mkdirSync(s.dir);
    return { ...s, sink, state: path.join(s.dir, `${EMAIL}.failopen`), slots: path.join(s.dir, `${EMAIL}.slots`) };
  };
  const paged = (state: string) => Number(fs.readFileSync(state, 'utf8').split(' ')[2]);
  const now = () => Date.now() / 1000;

  it('does not page inside the hour, or when an hour-long gap means nobody was calling', () => {
    const { env, state, slots, root } = blind();
    const ntfy = path.join(root, 'ntfy.body'); fs.writeFileSync(ntfy, '');
    const e = { ...env, CLAUDE_PACE_NTFY: `file://${ntfy}` };
    run(e);
    expect(paged(state)).toBe(0);
    fs.writeFileSync(state, `${now() - 7200} ${now() - 4000} 0\n`); fs.rmSync(slots);
    run(e);
    expect(paged(state)).toBe(0);
    expect(Number(fs.readFileSync(state, 'utf8').split(' ')[0])).toBeGreaterThan(now() - 60);
  });

  it('marks a page after an hour of steady fail-open, once, and clears when paced again', () => {
    const { env, dir, root, state, slots } = blind();
    const ntfy = path.join(root, 'ntfy.body'); fs.writeFileSync(ntfy, '');
    const e = { ...env, CLAUDE_PACE_NTFY: `file://${ntfy}` };
    fs.writeFileSync(state, `${now() - 3700} ${now() - 60} 0\n`);
    run(e);
    const first = paged(state);
    expect(first).toBeGreaterThan(0);
    fs.rmSync(slots); run(e);
    expect(paged(state)).toBe(first);
    fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify({ checked_at: iso(0), accounts: [{ email: EMAIL, ok: true, limits: [{ key: 'weekly_all:all', percent: 50, resets_at: iso(50), burn_pct_per_h: 1 }] }] }));
    fs.rmSync(slots); run(e);
    expect(fs.existsSync(state)).toBe(false);
    expect(fs.readFileSync(path.join(dir, `${EMAIL}.slots`), 'utf8')).toMatch(/^12 burn=/);
  });
});
