/**
 * The flag-only lease rules for always-on servers (scripts/lib/infra-lease.mjs, #5736). Why: ~€298/month
 * of Hetzner servers sat idle for 20 days after their job moved to leased GPUs, and nothing watched them.
 * The Hetzner server fixture follows the shape of the Hetzner Cloud API's GET /servers response (no
 * token on the box yet to copy a live one); the Scaleway prices are the ones the live dry run read.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  leaseLabels, leaseVerdict, parseLeaseUntil, hetznerMonthlyEur, scalewayMonthlyEur, meanCpuPct, flagLine,
  // @ts-expect-error — plain .mjs module without type declarations
} from '../../scripts/lib/infra-lease.mjs';

const now = new Date('2026-10-04T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 864e5);
const v = (labels: Record<string, string>, extra: Record<string, unknown> = {}) =>
  leaseVerdict({ labels, running: true, since: daysAgo(20), now, cpuPct: 0.4, ...extra });

describe('leaseVerdict — the rule table', () => {
  it('role=permanent is never flagged, even idle and unleased', () => {
    expect(v({ role: 'permanent' }).action).toBe('skip');
  });
  it('no lease label → flagged (the sl-reocr case: 20 days, no label)', () => {
    expect(v({})).toMatchObject({ action: 'flag', kind: 'no-lease' });
  });
  it('an owner alone is not a lease', () => {
    expect(v({ owner: '4523' })).toMatchObject({ action: 'flag', kind: 'no-lease' });
  });
  it('a stopped server with no lease is still flagged — a stopped Hetzner server bills', () => {
    expect(v({}, { running: false, cpuPct: null })).toMatchObject({ action: 'flag', kind: 'no-lease' });
  });
  it('expired lease → flagged with how long ago', () => {
    const r = v({ 'lease-until': '2026-10-01T00:00:00Z', owner: '4523' });
    expect(r).toMatchObject({ action: 'flag', kind: 'expired' });
    expect(r.reason).toMatch(/lease ended 4 d ago/);
  });
  it('unreadable lease → flagged, not trusted', () => {
    expect(v({ 'lease-until': 'next week' })).toMatchObject({ action: 'flag', kind: 'bad-lease' });
  });
  it('live lease but CPU < 5 % over 24 h → idle', () => {
    expect(v({ 'lease-until': '2026-10-31' }, { cpuPct: 2.1 })).toMatchObject({ action: 'flag', kind: 'idle' });
  });
  it('live lease and busy → ok', () => {
    expect(v({ 'lease-until': '2026-10-31' }, { cpuPct: 40 }).action).toBe('ok');
  });
  it('live lease, up less than 24 h → not judged idle yet', () => {
    expect(v({ 'lease-until': '2026-10-31' }, { since: new Date(now.getTime() - 3 * 3.6e6), cpuPct: 0 }).action).toBe('ok');
  });
  it('live lease, metrics unreadable → ok (an unknown CPU is not evidence of idleness)', () => {
    expect(v({ 'lease-until': '2026-10-31' }, { cpuPct: null }).action).toBe('ok');
  });
  it('live lease on a stopped server → ok (parked within its lease)', () => {
    expect(v({ 'lease-until': '2026-10-31' }, { running: false, cpuPct: null }).action).toBe('ok');
  });
  it('providers without metrics (Scaleway CPU) are judged on the lease only', () => {
    expect(v({ 'lease-until': '2026-10-31' }, { cpuPct: null, checkCpu: false }).action).toBe('ok');
    expect(v({}, { cpuPct: null, checkCpu: false })).toMatchObject({ action: 'flag', kind: 'no-lease' });
  });
});

describe('lease grammar', () => {
  it('Scaleway tags and Hetzner labels read the same', () => {
    expect(leaseLabels(['lease-until=2026-10-31', 'owner=5736', 'gpu'])).toEqual({ 'lease-until': '2026-10-31', owner: '5736' });
    expect(leaseLabels({ role: 'permanent' })).toEqual({ role: 'permanent' });
  });
  it('label-safe dates (Hetzner label values cannot hold ":")', () => {
    expect(parseLeaseUntil('2026-10-10')!.toISOString()).toBe('2026-10-10T23:59:59.000Z');
    expect(parseLeaseUntil('2026-10-10T18-30Z')!.toISOString()).toBe('2026-10-10T18:30:00.000Z');
    expect(parseLeaseUntil('2026-10-10T18:30:00Z')!.toISOString()).toBe('2026-10-10T18:30:00.000Z');
    expect(parseLeaseUntil('soon')).toBeUndefined();
  });
});

describe('cost and CPU', () => {
  const server = {
    datacenter: { location: { name: 'hel1' } },
    server_type: { name: 'cax41', cores: 16, prices: [
      { location: 'fsn1', price_monthly: { net: '31.0000', gross: '36.8900' } },
      { location: 'hel1', price_monthly: { net: '32.0000', gross: '38.0800' } },
    ] },
  };
  it('Hetzner €/month is the net list price at the server\'s own location', () => {
    expect(hetznerMonthlyEur(server)).toBe(32);
    expect(hetznerMonthlyEur({ server_type: { prices: [] } })).toBeNull();
  });
  it('Scaleway €/month from the product list', () => {
    expect(scalewayMonthlyEur({ monthly_price: 14.74, hourly_price: 0.0202 })).toBe(14.74);
    expect(scalewayMonthlyEur({ hourly_price: 0.01 })).toBe(7.3);
    expect(scalewayMonthlyEur(undefined)).toBeNull();
  });
  it('CPU is per-core summed by Hetzner, so it is divided by cores', () => {
    expect(meanCpuPct([[1, '1600'], [2, '0']], 16)).toBe(50);
    expect(meanCpuPct([], 16)).toBeNull();
  });
  it('a flag line carries the cost', () => {
    expect(flagLine({ name: 'sl-reocr-1', provider: 'hetzner', type: 'cax41', location: 'hel1', eur_month: 32, status: 'running', age_days: 20, cpu_24h: 0.3, owner: null, kind: 'no-lease', reason: 'x' }))
      .toContain('€32.00/month');
  });
});

describe('gpu-lease-watchdog --hetzner without a token', () => {
  it('fails loudly — an unreadable provider is not an empty one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-wd-'));
    const env = { ...process.env, GPU_WATCHDOG_STATE_DIR: dir } as NodeJS.ProcessEnv;
    delete env.HCLOUD_TOKEN;
    const r = spawnSync('node', ['scripts/maintenance/gpu-lease-watchdog.mjs', '--hetzner'], { env, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Hetzner NOT watched: HCLOUD_TOKEN is not set/);
    expect(r.stdout).toMatch(/would email: watchdog cannot read the Hetzner account/);
    expect(r.stdout).toMatch(/would push 1 flag/);
    expect(fs.existsSync(path.join(dir, 'heartbeat-hetzner'))).toBe(false);
  });
});
