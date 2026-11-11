/**
 * The per-job agy ledger and heavy-model daily cap (#7118): on 2026-10-19 one argon-high re-OCR job locked the shared
 * Google account for every model for 4.5 days. A heavy-model job stops at its cap; cheap models are only recorded.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { ledgerGate, jobCallsToday, HEAVY_MODEL } from '../../scripts/lib/agy-cli.mjs';

describe('agy per-job ledger and heavy-model cap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cap-'));
  const dir = path.join(root, 'jobs');
  const now = new Date('2026-10-22T12:00:00Z');

  it('classes the heavy tiers', () => {
    expect(HEAVY_MODEL.test('gemini-4-argon-high')).toBe(true);
    expect(HEAVY_MODEL.test('gemini-4-argon-low')).toBe(true);
    expect(HEAVY_MODEL.test('gemini-3.8-flash-medium')).toBe(false);
    expect(HEAVY_MODEL.test('gemini-3.8-flash-low')).toBe(false);
  });

  it('records every call and refuses a heavy job past its cap, per job', () => {
    for (let k = 0; k < 3; k++) expect(ledgerGate('gemini-4-argon-high', { dir, cap: 3, job: 'fl-reocr', now })).toBeNull();
    expect(ledgerGate('gemini-4-argon-high', { dir, cap: 3, job: 'fl-reocr', now })).toMatch(/daily cap of 3/);
    // a cheap model is never capped, and another job has its own count
    expect(ledgerGate('gemini-3.8-flash-low', { dir, cap: 3, job: 'fl-reocr', now })).toBeNull();
    expect(ledgerGate('gemini-4-argon-high', { dir, cap: 3, job: 'other', now })).toBeNull();
    expect(jobCallsToday('fl-reocr', { dir, now })).toBe(3);
    expect(jobCallsToday('fl-reocr', { dir, now, heavyOnly: false })).toBe(4);
    // a new UTC day starts at zero
    expect(ledgerGate('gemini-4-argon-high', { dir, cap: 3, job: 'fl-reocr', now: new Date('2026-10-23T00:01:00Z') })).toBeNull();
  });

  it('does nothing where there is no ledger home (a laptop)', () => {
    expect(ledgerGate('gemini-4-argon-high', { dir: path.join(root, 'missing', 'jobs'), cap: 0, job: 'x', now })).toBeNull();
  });
});
