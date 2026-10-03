/**
 * The daily spend check (#5743) has to be able to FAIL, must not FAIL on what is fine, and must say
 * UNKNOWN (never PASS) when it could not read a source. Shapes are the ones measured on 2026-10-03:
 * the dial at $300 until a 22:35 backstop set it to $5, an eval touching every book, RunPod pods
 * named `…-until-20261004T0006Z`, and envelopes that share books.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs without types
import * as S from '../../scripts/audit/spend-daily.mjs';
import { spendLine, SPEND_STALE_H, type SpendDoc } from '@/lib/spend-check';

const NOW = new Date('2026-10-04T07:00:00Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3600e3);
const env = (o: Record<string, unknown>) => ({ tag: 't', budget_usd: 20, spent_usd: 5, paid24_usd: 0, pages24: 0, created_at: ago(24 * 10), last_spend_at: ago(2), ...o });

describe('(a) ledger', () => {
  it('carries a paid-vs-got FAIL and its reason', () => {
    const r = S.ledgerCheck({ verdict: { status: 'FAIL', fails: ['duplicate-submission spend $6.35 > $1/day'], warns: [] }, headline: [{ paid_usd: 494, waste_usd: 39.67, pages_written: 374239 }] }, '2026-10-01');
    expect(r.status).toBe('FAIL');
    expect(r.lines.join('\n')).toMatch(/duplicate-submission/);
  });
  it('is UNKNOWN, not PASS, when the ledger wrote no row', () => {
    expect(S.ledgerCheck(null, '2026-10-03').status).toBe('UNKNOWN');
  });
});

describe('(b) machines', () => {
  const fresh = (flags: unknown[]) => ({ box: 'x', generated_at: ago(0.5), flags });
  it('FAILs on a watchdog flag, with its cost', () => {
    const r = S.machinesCheck({ infraDocs: { 'infra-hetzner': fresh([{ provider: 'hetzner', name: 'sl-reocr-1', kind: 'idle', eur_month: 74.5, reason: 'CPU 0.4 %' }]), 'infra-scaleway': fresh([]) }, pods: [], now: NOW });
    expect(r.status).toBe('FAIL');
    expect(r.eur_month).toBe(74.5);
  });
  it('is UNKNOWN when a provider is not watched, a flag document is stale or missing, or RunPod is unread', () => {
    expect(S.machinesCheck({ infraDocs: { 'infra-hetzner': fresh([{ kind: 'unwatched', reason: 'no HCLOUD_TOKEN' }]), 'infra-scaleway': fresh([]) }, pods: [], now: NOW }).status).toBe('UNKNOWN');
    expect(S.machinesCheck({ infraDocs: { 'infra-hetzner': { box: 'infra-hetzner', generated_at: ago(5), flags: [] }, 'infra-scaleway': fresh([]) }, pods: [], now: NOW }).status).toBe('UNKNOWN');
    expect(S.machinesCheck({ infraDocs: {}, pods: [], now: NOW }).status).toBe('UNKNOWN');
    expect(S.machinesCheck({ infraDocs: { 'infra-hetzner': fresh([]), 'infra-scaleway': fresh([]) }, pods: null, podsError: 'no key', now: NOW }).status).toBe('UNKNOWN');
  });
  it('PASSes when every source is read and nothing is flagged', () => {
    expect(S.machinesCheck({ infraDocs: { 'infra-hetzner': fresh([]), 'infra-scaleway': fresh([]) }, pods: [], now: NOW }).status).toBe('PASS');
  });
  it('reads a RunPod lease from the pod name, flags no deadline or a passed one, never a live one', () => {
    expect(S.podDeadline('sl-5600-olmocr-until-20261004T0006Z')?.toISOString()).toBe('2026-10-04T00:06:00.000Z');
    const flags = S.podFlags([
      { name: 'sl-5600-a-until-20261004T1200Z', desiredStatus: 'RUNNING', costPerHr: 0.57 },
      { name: 'sl-5600-b-until-20261004T0006Z', desiredStatus: 'RUNNING', costPerHr: 0.57 },
      { name: 'scratch-pod', desiredStatus: 'RUNNING', costPerHr: 0.2 },
      { name: 'old-pod', desiredStatus: 'EXITED', costPerHr: 0.2 },
    ], NOW);
    expect(flags.map((f: { name: string; kind: string }) => `${f.name}:${f.kind}`)).toEqual(['sl-5600-b-until-20261004T0006Z:expired', 'scratch-pod:no-lease']);
  });
});

describe('(c) envelopes', () => {
  it('FAILs paid spend with no pages written', () => {
    expect(S.envelopeLevel(env({ paid24_usd: 4.2, pages24: 0 }), NOW).level).toBe('FAIL');
  });
  it('does not FAIL spend that wrote pages, or noise under $1', () => {
    expect(S.envelopeLevel(env({ paid24_usd: 41.78, pages24: 25505 }), NOW).level).toBe('ok');
    expect(S.envelopeLevel(env({ paid24_usd: 0.67, pages24: 0 }), NOW).level).toBe('ok');
  });
  it('WARNs at 90 % of cap and on stored spend; over cap is INFO', () => {
    expect(S.envelopeLevel(env({ spent_usd: 16.01, budget_usd: 17 }), NOW).level).toBe('WARN');
    expect(S.envelopeLevel(env({ last_spend_at: ago(24 * 4) }), NOW).level).toBe('WARN');
    expect(S.envelopeLevel(env({ last_spend_at: null }), NOW).level).toBe('WARN');
    expect(S.envelopeLevel(env({ spent_usd: 56.82, budget_usd: 10 }), NOW).level).toBe('INFO');
  });
  it('does not call a young envelope stored spend', () => {
    expect(S.envelopeLevel(env({ created_at: ago(30), last_spend_at: null }), NOW).level).toBe('ok');
  });
  it('is UNKNOWN when its meter is unreadable', () => {
    expect(S.envelopeLevel(env({ meter_error: 'Supabase read failed (500)', paid24_usd: 9 }), NOW).level).toBe('UNKNOWN');
  });
  it('finds the owning issue in the tag, else in the trail', () => {
    expect(S.envelopeIssue('tengyur-full-5497', {})).toBe(5497);
    expect(S.envelopeIssue('chained-zero-2026-10', { created_by: 'cohort (#4681)' })).toBe(4681);
    expect(S.envelopeIssue('yam-harkhuf-2026-09-04', { created_by: 'derek: finish Breasted' })).toBe(null);
  });
});

describe('--week', () => {
  it('sums an envelope\'s week from the stored daily rows, and says when only today is known', () => {
    const d = (pages24: number, paid24_usd: number) => ({ checks: { envelopes: { envelopes: [{ tag: 'a', pages24, paid24_usd }] } } });
    expect(S.weekOf('a', [d(10, 1), d(0, 2.5), { checks: {} }])).toEqual({ pages_week: 10, paid_week_usd: 3.5, days_counted: 2 });
    expect(S.weekOf('b', [d(10, 1)], { pages24: 4, paid24_usd: 0.2 })).toMatchObject({ pages_week: 4, days_counted: 1, from_today_only: true });
  });
});

describe('(d) dial', () => {
  const a = Date.parse('2026-10-03T00:00:00Z'), b = a + 86400e3;
  it('uses the highest dial in force that day, not today\'s', () => {
    const revs = [
      { created_at: new Date('2026-10-03T20:43:30Z'), prior: { daily_budget_usd: 300 } }, // scope churn
      { created_at: new Date('2026-10-03T22:35:03Z'), prior: { daily_budget_usd: 300 } }, // backstop → 5
    ];
    expect(S.dialDuring(revs, 5, a, b)).toBe(300);
    expect(S.dialDuring([], 5, a, b)).toBe(5);
    // raised to 50 for an hour inside the day, then back to 5
    expect(S.dialDuring([
      { created_at: new Date('2026-10-03T10:00:00Z'), prior: { daily_budget_usd: 5 } },
      { created_at: new Date('2026-10-03T11:00:00Z'), prior: { daily_budget_usd: 50 } },
    ], 5, a, b)).toBe(50);
  });
  it('FAILs spend outside every envelope well past the dial, and a bill beyond what was authorised', () => {
    const r = S.dialCheck({ days: [{ day: '2026-10-02', primary: true, dial_usd: 5, metered_usd: 557, envelope_usd: 260, outside_usd: 297, billed_usd: 614 }] });
    expect(r.status).toBe('FAIL');
    expect(r.fails).toHaveLength(2);
  });
  it('PASSes the measured 2026-10-02 under the $300 dial in force that day', () => {
    const r = S.dialCheck({ days: [{ day: '2026-10-02', primary: true, dial_usd: 300, metered_usd: 557.16, envelope_usd: 260.03, outside_usd: 297.13, billed_usd: 614.63 }] });
    expect(r.status).toBe('PASS');
  });
  it('is UNKNOWN when the invoice is unreadable', () => {
    expect(S.dialCheck({ days: [], billedUnreadable: 'no token' }).status).toBe('UNKNOWN');
  });
});

describe('verdict, line, mail', () => {
  const C = (status: string) => ({ status, lines: [], flags: [], envelopes: [], fails: [] });
  it('FAIL beats UNKNOWN beats WARN beats PASS', () => {
    expect(S.overall({ a: C('PASS'), b: C('WARN'), c: C('UNKNOWN'), d: C('FAIL') })).toBe('FAIL');
    expect(S.overall({ a: C('PASS'), b: C('WARN'), c: C('UNKNOWN') })).toBe('UNKNOWN');
    expect(S.overall({ a: C('PASS'), b: C('WARN') })).toBe('WARN');
    expect(S.overall({ a: C('PASS') })).toBe('PASS');
  });
  it('mails a new FAIL, not the same one again inside 7 days', () => {
    expect(S.shouldMail({ status: 'FAIL', fingerprint: 'x', state: {}, now: NOW })).toBe(true);
    expect(S.shouldMail({ status: 'FAIL', fingerprint: 'x', state: { fingerprint: 'x', last_mailed_at: ago(48) }, now: NOW })).toBe(false);
    expect(S.shouldMail({ status: 'FAIL', fingerprint: 'y', state: { fingerprint: 'x', last_mailed_at: ago(48) }, now: NOW })).toBe(true);
    expect(S.shouldMail({ status: 'FAIL', fingerprint: 'x', state: { fingerprint: 'x', last_mailed_at: ago(24 * 8) }, now: NOW })).toBe(true);
    expect(S.shouldMail({ status: 'UNKNOWN', fingerprint: '', state: {}, now: NOW })).toBe(false);
  });
});

describe('/admin/work line', () => {
  const doc = (o: Partial<SpendDoc> = {}): SpendDoc => ({
    _id: 'spend-daily-2026-10-03', day: '2026-10-03', generated_at: ago(1), status: 'PASS', line: 'spend check: PASS — $502.64 paid',
    checks: { ledger: { status: 'PASS', lines: ['x'] }, machines: { status: 'PASS', lines: [] }, envelopes: { status: 'PASS', lines: [] }, dial: { status: 'PASS', lines: [] } },
    ...o,
  });
  it('shows the stored line and the four sections', () => {
    const s = spendLine(doc(), NOW);
    expect(s.status).toBe('PASS');
    expect(s.sections).toHaveLength(4);
  });
  it('says NO DATA when there is no row and STALE when the cron stopped — never a quiet PASS', () => {
    expect(spendLine(null, NOW).status).toBe('MISSING');
    expect(spendLine(doc({ generated_at: ago(SPEND_STALE_H + 1) }), NOW).status).toBe('STALE');
  });
});
