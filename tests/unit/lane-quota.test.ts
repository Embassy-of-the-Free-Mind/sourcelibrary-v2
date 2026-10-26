/**
 * The quota gate of a subscription lane (scripts/lib/lane-quota.mjs, #7301 item 2).
 *
 * 1. It paces with spare-lane.py's numbers (#6395): the test reads the .py and pins them, so the two cannot drift.
 * 2. Its rules: a lane with no quota idles; a locked meter idles; the last 48 h open to 90% at $0 above the lane's
 *    share; the share is a ceiling; an even burn binds only a `paced` lane; no meter is "unmetered" (the reader's own
 *    limit reply stops it, as model-limits.mjs says).
 * 3. Every quota-share lane in the registry resolves to a verdict.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — scripts-side module, no types
import { quotaGate, laneQuota, PACE } from '../../scripts/lib/lane-quota.mjs';
// @ts-expect-error — scripts-side module, no types
import { LANES } from '../../scripts/lib/lanes.mjs';

const ROOT = path.resolve(__dirname, '../..');
const H = 3600e3;
const NOW = Date.parse('2026-10-26T12:00:00Z');
const resetIn = (h: number) => new Date(NOW + h * H).toISOString();
const claude = { meter: 'climits', share: 0.7 };

describe('lane-quota paces like spare-lane.py', () => {
  const py = fs.readFileSync(path.join(ROOT, 'scripts/workers/spare-lane.py'), 'utf8');
  it('the same week, last stretch and stop/start lines', () => {
    expect(py).toMatch(/WEEK_S = 7 \* 86400/);
    expect(py).toMatch(/LAST_STRETCH_S = 2 \* 86400/);
    expect(PACE.WEEK_S).toBe(7 * 86400);
    expect(PACE.LAST_STRETCH_S).toBe(2 * 86400);
    expect(py).toContain(`w >= ${PACE.STOP_WEEKLY} or s >= ${PACE.STOP_SESSION}`);
    expect(py).toContain(`w < ${PACE.SPARE_WEEKLY} and s < ${PACE.SPARE_SESSION}`);
    expect(py).toContain(`s < ${PACE.PACED_SESSION}`);
  });
});

describe('quotaGate', () => {
  it('a lane with no quota idles: it never falls through to anything', () => {
    expect(quotaGate(null, { weekly: 0 }, { now: NOW })).toMatchObject({ open: false, state: 'no-quota' });
  });

  it('agy: a locked model idles until its reset; otherwise unmetered', () => {
    const agy = { meter: 'agy', share: 0.4 };
    expect(quotaGate(agy, { locked_until: resetIn(5) }, { now: NOW })).toMatchObject({ open: false, state: 'locked' });
    expect(quotaGate(agy, { locked_until: resetIn(-1) }, { now: NOW })).toMatchObject({ open: true, state: 'unmetered' });
    expect(quotaGate(agy, { locked_until: null }, { now: NOW })).toMatchObject({ open: true, state: 'unmetered' });
  });

  it('no fresh climits meter is unmetered (open): the reader stops on its own limit reply', () => {
    expect(quotaGate(claude, null, { now: NOW })).toMatchObject({ open: true, state: 'unmetered' });
  });

  it('the wall and the stop line idle the lane', () => {
    expect(quotaGate(claude, { weekly: 98, session: 0, weeklyReset: resetIn(100) }, { now: NOW })).toMatchObject({ open: false, state: 'locked' });
    expect(quotaGate(claude, { weekly: 92, session: 0, weeklyReset: resetIn(10) }, { now: NOW })).toMatchObject({ open: false, state: 'stop' });
    expect(quotaGate(claude, { weekly: 10, session: 85, weeklyReset: resetIn(100) }, { now: NOW })).toMatchObject({ open: false, state: 'stop' });
  });

  it('in the last 48 h quota left at the reset is priced $0 and the share is lifted to 90%', () => {
    const v = quotaGate(claude, { weekly: 89, session: 20, weeklyReset: resetIn(30) }, { now: NOW });
    expect(v).toMatchObject({ open: true, state: 'spare', priced_usd: 0 });
    expect(quotaGate(claude, { weekly: 90, session: 20, weeklyReset: resetIn(30) }, { now: NOW })).toMatchObject({ open: false });
    expect(quotaGate(claude, { weekly: 50, session: 70, weeklyReset: resetIn(30) }, { now: NOW })).toMatchObject({ open: false });
  });

  it('a lane with endOfWeek runs past the stop line to its own cap in its own last stretch (#7448: Opus translate, 95% / 24 h)', () => {
    const eow = { ...claude, endOfWeek: { weekly: 95, hours: 24 } };
    expect(quotaGate(eow, { weekly: 94, session: 20, weeklyReset: resetIn(20) }, { now: NOW })).toMatchObject({ open: true, state: 'spare', priced_usd: 0 });
    expect(quotaGate(eow, { weekly: 95, session: 20, weeklyReset: resetIn(20) }, { now: NOW })).toMatchObject({ open: false });
    expect(quotaGate(eow, { weekly: 94, session: 85, weeklyReset: resetIn(20) }, { now: NOW })).toMatchObject({ open: false, state: 'stop' });
    // Outside its 24 h it is an ordinary lane: 36 h out, 94% is past the shared 92% stop line.
    expect(quotaGate(eow, { weekly: 94, session: 20, weeklyReset: resetIn(36) }, { now: NOW })).toMatchObject({ open: false, state: 'stop' });
    expect(quotaGate(claude, { weekly: 94, session: 20, weeklyReset: resetIn(20) }, { now: NOW })).toMatchObject({ open: false });
  });

  it('outside the last stretch the share is a ceiling', () => {
    expect(quotaGate(claude, { weekly: 70, session: 0, weeklyReset: resetIn(100) }, { now: NOW })).toMatchObject({ open: false, state: 'ceiling' });
    expect(quotaGate(claude, { weekly: 66, session: 16, weeklyReset: resetIn(94) }, { now: NOW })).toMatchObject({ open: true, state: 'open', priced_usd: null });
  });

  it('an even burn binds only a paced lane', () => {
    // 94 h left of 168: 44% of the week gone; the account at 66% is ahead of an even burn.
    const u = { weekly: 66, session: 16, weeklyReset: resetIn(94) };
    expect(quotaGate({ ...claude, paced: true }, u, { now: NOW })).toMatchObject({ open: false, state: 'pace' });
    expect(quotaGate({ ...claude, paced: true }, { ...u, weekly: 40 }, { now: NOW })).toMatchObject({ open: true });
    expect(quotaGate({ ...claude, paced: true }, { ...u, weekly: 40, session: 60 }, { now: NOW })).toMatchObject({ open: false, state: 'pace' });
  });

  it('an unknown reset cannot be paced, so it idles', () => {
    expect(quotaGate(claude, { weekly: 10, session: 0, weeklyReset: null }, { now: NOW })).toMatchObject({ open: false });
  });
});

describe('laneQuota over the registry', () => {
  it('every quota-share lane resolves to a verdict; other lanes are refused by name', () => {
    for (const l of LANES as { name: string; budget: string }[]) {
      if (l.budget === 'quota-share') expect(typeof laneQuota(l.name, { model: 'gemini-3.8-flash-low' }).open).toBe('boolean');
      else expect(() => laneQuota(l.name)).toThrow(/not a quota share/);
    }
    expect(() => laneQuota('no-such-lane')).toThrow(/no lane/);
  });

  it('--max-weekly-pct overrides the registered share', () => {
    expect(laneQuota('claude-opus-ocr', { maxWeeklyPct: 55 }).share).toBe(0.55);
  });
});
