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

describe('(d) non-pipeline allowance (#345)', () => {
  const day = (o: Record<string, unknown>) => ({ day: '2026-11-13', primary: true, dial_usd: 0, metered_usd: 30, envelope_usd: 20, outside_usd: 10, outside_pipeline_usd: 0, outside_other_usd: 10, other_top: [{ k: 'search', usd: 6 }, { k: 'embed', usd: 3 }, { k: 'eval', usd: 1 }], billed_usd: null, ...o });
  it('does not FAIL $6.93 of non-pipeline spend under a $0 dial, and names the top sources', () => {
    const r = S.dialCheck({ days: [day({ outside_usd: 6.93, outside_other_usd: 6.93 })], allowance: 15 });
    expect(r.status).toBe('PASS');
    expect(r.lines.join('\n')).toMatch(/allowance \$15\.00 \(limit \$22\.50\); top sources: search \$6\.00, embed \$3\.00, eval \$1\.00/);
  });
  it('FAILs non-pipeline spend over max(1.5 x allowance, allowance + 5)', () => {
    const r = S.dialCheck({ days: [day({ outside_usd: 23, outside_other_usd: 23 })], allowance: 15 });
    expect(r.status).toBe('FAIL');
    expect(r.allowance_over).toBe(true);
  });
  it('still FAILs pipeline spend outside envelopes against the dial', () => {
    expect(S.dialCheck({ days: [day({ outside_usd: 12, outside_pipeline_usd: 12, outside_other_usd: 0 })], allowance: 15 }).status).toBe('FAIL');
  });
  it('counts only METERED non-pipeline spend as authorised, so an unmetered bill still FAILs', () => {
    // $3 metered, $30 billed: authorised is 3 (not the whole $15 allowance), limit 1.25 x 3 + 10 = 13.75.
    const over = S.dialCheck({ days: [day({ metered_usd: 3, envelope_usd: 0, outside_usd: 3, outside_other_usd: 3, billed_usd: 30 })], allowance: 15 });
    expect(over.status).toBe('FAIL');
    expect(over.allowance_over).toBe(false);
    // $6.93 metered, $10.61 billed (2026-11-13): authorised 6.93, limit 18.66. No FAIL.
    expect(S.dialCheck({ days: [day({ metered_usd: 6.93, envelope_usd: 0, outside_usd: 6.93, outside_other_usd: 6.93, billed_usd: 10.61 })], allowance: 15 }).status).toBe('PASS');
  });
  it('reads the allowance from the environment', () => {
    process.env.SPEND_OUTSIDE_DIAL_ALLOWANCE_USD = '4';
    try { expect(S.outsideAllowanceUsd()).toBe(4); } finally { delete process.env.SPEND_OUTSIDE_DIAL_ALLOWANCE_USD; }
    expect(S.outsideAllowanceUsd()).toBe(15);
  });
});

describe('(e) vercel (#345)', () => {
  const mk = (vals: number[], y: number) => {
    const byDay: Record<string, { total: number; byProject: Record<string, number> }> = {};
    vals.forEach((v, i) => { byDay[`2026-11-0${6 + i}`] = { total: v, byProject: { app: v } }; });
    byDay['2026-11-13'] = { total: y, byProject: { app: y * 0.7, docs: y * 0.2, x: y * 0.1 } };
    return { byDay };
  };
  it('FAILs a spike: more than 1.5 x the median and $10 above it, naming the top two projects', () => {
    const r = S.vercelCheck({ charges: mk([30, 30, 30, 30, 30, 30, 30], 62), day: '2026-11-13', budget: 99999 });
    expect(r.status).toBe('FAIL');
    expect(r.lines.join('\n')).toMatch(/app \$43\.40, docs \$12\.40/);
  });
  it('PASSes a steady day, and a rise under $10 even when over 1.5 x', () => {
    expect(S.vercelCheck({ charges: mk([60, 62, 61, 63, 60, 62, 61], 63), day: '2026-11-13', budget: 99999 }).status).toBe('PASS');
    expect(S.vercelCheck({ charges: mk([4, 4, 4, 4, 4, 4, 4], 9), day: '2026-11-13', budget: 99999 }).status).toBe('PASS');
  });
  it('WARNs on a month-to-date pace over budget without a spike', () => {
    const r = S.vercelCheck({ charges: mk([60, 62, 61, 63, 60, 62, 61], 63), day: '2026-11-13', budget: 1000 });
    expect(r.status).toBe('WARN');
  });
  it('is UNKNOWN, never zero, when the token is missing or the history is too short', () => {
    expect(S.vercelCheck({ charges: { error: 'no VERCEL_API_TOKEN' }, day: '2026-11-13' }).status).toBe('UNKNOWN');
    expect(S.vercelCheck({ charges: { byDay: { '2026-11-13': { total: 50, byProject: {} } } }, day: '2026-11-13' }).status).toBe('UNKNOWN');
  });
});

describe('(f) r2 (#345)', () => {
  const NOW = new Date('2026-11-14T07:00:00Z');
  const stats = (o: Record<string, unknown> = {}) => ({ updatedAt: new Date('2026-11-14T03:00:00Z'), r2: [{ bucket: 'sourcelibrary', bytes: 40.56e12, objects: 1 }], ...o });
  const w = (...gb: number[]) => gb.map((g, i) => ({ day: `2026-11-${13 - i}`, bytes: g * 1e9 }));
  const CEIL = 43.1e12;
  it('WARNs when the room lasts under 7 days at the 3-day average (2.54 TB at 400 GB/day)', () => {
    const r = S.r2Check({ stats: stats(), writtenDays: w(400, 400, 400), ceiling: CEIL, now: NOW });
    expect(r.status).toBe('WARN');
    expect(r.lines[0]).toMatch(/40\.56 TB stored, 2\.54 TB of room.*400 GB written yesterday.*\$608\.40\/month/);
  });
  it('PASSes with room for more than 7 days, and with no writes at all', () => {
    expect(S.r2Check({ stats: stats(), writtenDays: w(100, 100, 100), ceiling: CEIL, now: NOW }).status).toBe('PASS');
    expect(S.r2Check({ stats: stats(), writtenDays: w(0, 0, 0), ceiling: CEIL, now: NOW }).status).toBe('PASS');
  });
  it('FAILs at or over the ceiling', () => {
    expect(S.r2Check({ stats: stats(), writtenDays: w(1), ceiling: 40.56e12, now: NOW }).status).toBe('FAIL');
  });
  it('is UNKNOWN when the document is missing or older than 36 h', () => {
    expect(S.r2Check({ stats: null, writtenDays: [], ceiling: CEIL, now: NOW }).status).toBe('UNKNOWN');
    expect(S.r2Check({ stats: stats({ updatedAt: new Date('2026-11-12T07:00:00Z') }), writtenDays: w(1), ceiling: CEIL, now: NOW }).status).toBe('UNKNOWN');
  });
  it('is UNKNOWN, not PASS, when no write day is stored', () => {
    expect(S.r2Check({ stats: stats(), writtenDays: [], ceiling: CEIL, now: NOW }).status).toBe('UNKNOWN');
  });
});

describe('headline carries the new checks only when not PASS (#345)', () => {
  const C = (status: string, o = {}) => ({ status, lines: [], flags: [], envelopes: [], fails: [], ...o });
  it('names Vercel and R2 clauses', () => {
    const base = { ledger: C('PASS'), machines: C('PASS'), envelopes: C('PASS'), dial: C('PASS') };
    expect(S.summaryLine('PASS', { ...base, vercel: C('PASS'), r2: C('PASS') })).toBe('spend check: PASS');
    expect(S.summaryLine('WARN', { ...base, vercel: C('PASS'), r2: C('WARN', { room_days: 6.3 }) })).toMatch(/R2 room 6\.3 days/);
    expect(S.summaryLine('FAIL', { ...base, vercel: C('FAIL', { yesterday_usd: 62, median_usd: 30 }), r2: C('PASS') })).toMatch(/Vercel spike \$62\.00 vs median \$30\.00/);
  });
});
