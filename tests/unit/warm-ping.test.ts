/** The warm-ping exemption counts only when the header carries the server secret. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isWarmPing, warmPingHeaders } from '@/lib/warm-ping';

const req = (headers: Record<string, string>) => new Request('https://sourcelibrary.org/api/x', { headers });

describe('warm ping', () => {
  const saved = process.env.CRON_SECRET;
  beforeEach(() => { process.env.CRON_SECRET = 'test-secret-value'; });
  afterEach(() => { if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved; });

  it('accepts the secret', () => {
    expect(isWarmPing(req({ 'X-Warm-Ping': 'test-secret-value' }))).toBe(true);
  });

  it('rejects any other value, and a missing header', () => {
    expect(isWarmPing(req({ 'X-Warm-Ping': '1' }))).toBe(false);
    expect(isWarmPing(req({ 'X-Warm-Ping': 'test-secret-valuX' }))).toBe(false);
    expect(isWarmPing(req({}))).toBe(false);
  });

  it('exempts nothing when no secret is configured', () => {
    delete process.env.CRON_SECRET;
    expect(isWarmPing(req({ 'X-Warm-Ping': '' }))).toBe(false);
    expect(isWarmPing(req({ 'X-Warm-Ping': 'undefined' }))).toBe(false);
    expect(warmPingHeaders()).toEqual({});
  });

  it('warmers send what the gate accepts', () => {
    expect(isWarmPing(req(warmPingHeaders()))).toBe(true);
  });
});
