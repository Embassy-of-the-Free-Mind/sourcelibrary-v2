import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs lib without types
import { ceilingVerdict, ceilingBytes } from '../../scripts/lib/r2-storage-ceiling.mjs';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const CEIL = 41e12;
const snap = (bytes: number | null, updatedAt: string | null = '2026-11-12T03:45:00Z') => ({
  updatedAt,
  r2: bytes == null ? [{ bucket: 'other', bytes: 1 }] : [{ bucket: 'earthai-clouds', bytes: 9e15 }, { bucket: 'sourcelibrary', bytes }],
});

describe('r2-storage-ceiling', () => {
  it('passes under the ceiling and reads only the sourcelibrary bucket', () => {
    const v = ceilingVerdict(snap(40e12), { ceiling: CEIL, now: NOW });
    expect(v.ok).toBe(true);
    expect(v.reason).toMatch(/1\.00 TB left/);
  });

  it('refuses at or over the ceiling', () => {
    expect(ceilingVerdict(snap(41e12), { ceiling: CEIL, now: NOW }).ok).toBe(false);
    expect(ceilingVerdict(snap(42e12), { ceiling: CEIL, now: NOW }).reason).toMatch(/REACHED/);
  });

  it('fails closed on a missing reading, and says the meter is broken', () => {
    const v = ceilingVerdict(snap(null), { ceiling: CEIL, now: NOW });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/meter broken/);
    expect(ceilingVerdict(null, { ceiling: CEIL, now: NOW }).ok).toBe(false);
  });

  it('fails closed on a stale reading, and says the meter is stale', () => {
    const v = ceilingVerdict(snap(1e12, '2026-11-10T00:00:00Z'), { ceiling: CEIL, now: NOW });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/meter stale/);
  });

  it('accepts a Date updatedAt as written by the cron', () => {
    const s = { ...snap(1e12), updatedAt: new Date('2026-11-12T03:45:00Z') };
    expect(ceilingVerdict(s, { ceiling: CEIL, now: NOW }).ok).toBe(true);
  });

  it('derives the ceiling from baseline plus approvals at $/GB-month', () => {
    const c = ceilingBytes({ usd_per_gb_month: 0.015, baseline: { bytes: 20e12 }, approvals: [{ usd_per_month: 15 }, { usd_per_month: 30 }] });
    expect(c).toBe(23e12);
  });

  it('the checked-in config parses and lands between the baseline and 100 TB', () => {
    const c = ceilingBytes();
    expect(c).toBeGreaterThan(21.7e12);
    expect(c).toBeLessThan(100e12);
  });
});
