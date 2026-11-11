/**
 * Never call a model whose subscription limit has been hit — not even to probe whether it has reset (Derek, 2026-10-22,
 * #7118). scripts/lib/model-limits.mjs answers from the meters on disk; agyCall() must return a quota result for a
 * locked model WITHOUT starting agy.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-limits-'));
const home = path.join(dir, 'home');
const agyMeter = path.join(dir, 'agy-status.json');
const claudeMeter = path.join(dir, 'claude-latest.json');
const later = new Date(Date.now() + 3 * 3600e3).toISOString();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lim: any, agy: any;
beforeAll(async () => {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'box@example.org' } }));
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;   // the login comes from HOME here, not a second login dir (claudeLoginFiles)
  process.env.MODEL_LIMITS_DIR = path.join(dir, 'stops');
  process.env.AGY_QUOTA_STATUS = agyMeter;
  process.env.CLAUDE_LIMITS_FILE = claudeMeter;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module
  lim = await import('../../scripts/lib/model-limits.mjs');
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module
  agy = await import('../../scripts/lib/agy-cli.mjs');
});

const claude = (session: number, weekly: number) => fs.writeFileSync(claudeMeter, JSON.stringify({
  checked_at: new Date().toISOString(),
  accounts: [{ email: 'box@example.org', ok: true, limits: [
    { key: 'session:all', percent: session, resets_at: later },
    { key: 'weekly_all:all', percent: weekly, resets_at: later },
  ] }],
}));

describe('model-limits gate', () => {
  it('blocks a locked agy model and leaves the others open', () => {
    fs.writeFileSync(agyMeter, JSON.stringify({ locked_models: { 'gemini-4-argon-high': later } }));
    expect(lim.agyBlocked('gemini-4-argon-high')?.until).toBe(later);
    expect(lim.agyBlocked('gemini-3.8-flash-low')).toBeNull();
  });

  it('agyCall does not start agy for a locked model', async () => {
    const r = await agy.agyCall(['-p', 'x', '--model', 'gemini-4-argon-high'], dir);
    expect(r).toMatchObject({ cls: 'quota', not_called: true, locked_until: later });
  });

  it('an expired lock is open', () => {
    fs.writeFileSync(agyMeter, JSON.stringify({ locked_models: { 'gemini-4-argon-high': new Date(Date.now() - 60e3).toISOString() } }));
    expect(lim.agyBlocked('gemini-4-argon-high')).toBeNull();
  });

  it('Claude: open under the limit, blocked at it, and a job can keep its own headroom', () => {
    claude(40, 50);
    expect(lim.claudeBlocked()).toBeNull();
    expect(lim.claudeBlocked({ weeklyMax: 50 })?.reason).toMatch(/weekly 50%/);
    claude(100, 50);
    expect(lim.claudeBlocked()?.until).toBe(later);
  });

  it('a limit reply stops later calls before the meter catches up', () => {
    claude(10, 10);
    expect(lim.claudeBlocked()).toBeNull();
    lim.noteLimitHit('claude', { until: later, reason: 'usage limit reached' });
    expect(lim.claudeBlocked()).toMatchObject({ source: 'local-stop', until: later });
  });

  it('reads agy\'s quoted reset', () => {
    const t = Date.parse(lim.agyResetFromText('Individual quota reached. Resets in 2h30m0s'));
    expect(Math.abs(t - (Date.now() + 2.5 * 3600e3))).toBeLessThan(5000);
  });

  it('a second agy account (AGY_HOME) has its own locks, apart from the main account and its meter (#7517)', () => {
    fs.writeFileSync(agyMeter, JSON.stringify({ locked_models: { 'gemini-3.8-flash-low': later } }));
    lim.noteLimitHit('agy-gemini-3.8-flash-low', { until: later, reason: 'main account' });
    process.env.AGY_HOME = '/root/.agy-james';
    try {
      expect(lim.agyLimitLane('gemini-3.8-flash-low')).toBe('agy@.agy-james-gemini-3.8-flash-low');
      expect(lim.agyBlocked('gemini-3.8-flash-low')).toBeNull();
      lim.noteLimitHit(lim.agyLimitLane('gemini-3.8-flash-low'), { until: later, reason: 'second account' });
      expect(lim.agyBlocked('gemini-3.8-flash-low')).toMatchObject({ reason: 'second account' });
    } finally { delete process.env.AGY_HOME; }
    expect(lim.agyBlocked('gemini-3.8-flash-low')).toMatchObject({ reason: 'main account' });
  });

  it('a wait does not idle through a block that outlasts it', async () => {
    const ok = await lim.waitWhileBlocked(() => ({ until: later, reason: 'test' }), { log: () => {}, maxWaitH: 1 });
    expect(ok).toBe(false);
  });
});
