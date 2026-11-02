/**
 * scripts/lib/agy-pools.mjs weeklyReserve — drain by reset (#7911): a lane spends a pool down to the declared reserve of
 * the lanes that must not starve, 0 in the last 36 h before the pool's weekly reset. The 5-hour floor that does the
 * pacing is quotaFloor's (tests/unit/cli-ocr-lane.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { weeklyReserve, LANE_RESERVES, RESERVE_DROP_HOURS } from '../../scripts/lib/agy-pools.mjs';
import { quotaFloor } from '../../scripts/batch/cli-ocr-lane.mjs';

const H = 3600e3;
const reset = '2026-11-05T22:00:00Z';
const at = (hoursBefore: number) => Date.parse(reset) - hoursBefore * H;
const total = Object.values(LANE_RESERVES).reduce((s, v) => s + v, 0);

describe('weeklyReserve (#7911)', () => {
  it('is the sum of the declared lane reserves for a lane with none of its own', () => {
    expect(weeklyReserve({ resetTime: reset, now: at(100) })).toBeCloseTo(total, 9);
    expect(weeklyReserve({ resetTime: reset, now: at(100), lane: 'cli-ocr' })).toBeCloseTo(total, 9);
  });
  it('leaves out the caller\'s own reserve', () => {
    for (const [lane, v] of Object.entries(LANE_RESERVES)) expect(weeklyReserve({ resetTime: reset, now: at(100), lane })).toBeCloseTo(total - v, 9);
  });
  it('does not depend on how much of the week is left, until the last 36 h', () => {
    expect(weeklyReserve({ resetTime: reset, now: at(160) })).toBe(weeklyReserve({ resetTime: reset, now: at(37) }));
  });
  it('drops to 0 in the last 36 h before the reset', () => {
    expect(RESERVE_DROP_HOURS).toBe(36);
    expect(weeklyReserve({ resetTime: reset, now: at(36) })).toBe(0);
    expect(weeklyReserve({ resetTime: reset, now: at(1) })).toBe(0);
    expect(weeklyReserve({ resetTime: reset, now: at(36.01) })).toBeGreaterThan(0);
  });
  it('keeps the reserve when the reset is unreadable', () => {
    expect(weeklyReserve({ resetTime: null, now: at(1) })).toBeCloseTo(total, 9);
    expect(weeklyReserve({ resetTime: 'soon', now: at(1) })).toBeCloseTo(total, 9);
  });
  it('takes another table', () => {
    expect(weeklyReserve({ resetTime: reset, now: at(100), reserves: { a: 0.2, b: 0.1 }, lane: 'b' })).toBeCloseTo(0.2, 9);
  });
  it('stays small: a reserve that holds most of a pool is the pace line again', () => {
    expect(total).toBeLessThan(0.25);
  });
});

describe('quotaFloor on the reserve (#7911)', () => {
  const b = (weekly: number, fiveH = 0.9) => [{ id: 'gemini-weekly', remaining_fraction: weekly, reset_time: reset }, { id: 'gemini-5h', remaining_fraction: fiveH }];
  it('the 2026-11-01 idle: main 68.6% vs a 71.1% line, james 26.1% vs 28.6% now run', () => {
    expect(quotaFloor(b(0.686), { now: at(0.711 * 168) }).ok).toBe(true);
    expect(quotaFloor(b(0.261), { now: at(0.286 * 168) }).ok).toBe(true);
  });
  it('the 5-hour floor still binds above the reserve and in the last 36 h', () => {
    expect(quotaFloor(b(0.9, 0.2), { now: at(100) }).ok).toBe(false);
    expect(quotaFloor(b(0.9, 0.2), { now: at(10) }).ok).toBe(false);
    expect(quotaFloor(b(0.9, 0.2), { now: at(10), floor5h: 0.1 }).ok).toBe(true);
  });
  it('a pilot\'s weeklyFloor still replaces the reserve', () => {
    expect(quotaFloor(b(0.3), { now: at(10), weeklyFloor: 0.4 }).ok).toBe(false);
  });
});
