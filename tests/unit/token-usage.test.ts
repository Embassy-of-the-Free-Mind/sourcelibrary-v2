/**
 * /admin/tokens (#8201): the collector's counting and the rules behind what the page claims.
 * The fixtures copy real transcript shapes: one message spanning several lines that repeat its usage.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no declarations
import { feedLine, finishRollup, jobLabel, loginAt, meterSeries, newRollup, parseLoginTimeline, parseEstimate, priceUsage } from '../../scripts/maintenance/token-usage-push.mjs';
import { dollarsPerPoint, estimateVerdict, evenPacePercent, forecast, freshness, mergeMeters, pointsUsed, type AccountWeek, type MeterDoc, type UsageDoc } from '@/lib/token-usage';

const T = '2026-11-04T10:00:00.000Z';
const ctx = { account: 'a@x', label: 'job', session: 's1', isSub: false, since: Date.parse('2026-11-01T00:00:00Z') };
const line = (id: string, usage: object, extra: object = {}, timestamp = T, model = 'claude-opus-5-5') =>
  JSON.stringify({ type: 'assistant', timestamp, message: { id, model, usage, content: [] }, ...extra });

describe('priceUsage', () => {
  it('prices each part at list and scales Sonnet to 0.6', () => {
    const u = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation: { ephemeral_1h_input_tokens: 1e6, ephemeral_5m_input_tokens: 0 } };
    expect(priceUsage(u, 'claude-opus-5-5').cost).toBeCloseTo(5 + 25 + 0.5 + 10);
    expect(priceUsage(u, 'claude-sonnet-5-5').cost).toBeCloseTo((5 + 25 + 0.5 + 10) * 0.6);
  });
  it('falls back to the 5-minute price when the split is absent', () => {
    expect(priceUsage({ cache_creation_input_tokens: 1e6 }, 'claude-opus-5-5').cost).toBeCloseTo(6.25);
  });
  it('context counts everything sent, not the output', () => {
    expect(priceUsage({ input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 999 }, 'x').context).toBe(152);
  });
});

describe('feedLine', () => {
  const usage = { input_tokens: 0, output_tokens: 100, cache_read_input_tokens: 1000 };
  it('counts a message once although its usage repeats on each line', () => {
    const r = newRollup();
    for (let i = 0; i < 3; i++) feedLine(r, line('m1', usage), ctx, { afterSleep: false });
    expect(finishRollup(r).jobs[0].req).toBe(1);
  });
  it('ignores a message older than the window, as a resumed session repeats them', () => {
    const r = newRollup();
    feedLine(r, line('old', usage, {}, '2026-10-01T00:00:00.000Z'), ctx, { afterSleep: false });
    expect(finishRollup(r).jobs).toHaveLength(0);
  });
  it('skips the synthetic messages that carry API errors', () => {
    const r = newRollup();
    feedLine(r, line('e', usage, {}, T, '<synthetic>'), ctx, { afterSleep: false });
    expect(finishRollup(r).jobs).toHaveLength(0);
  });
  it('survives a truncated line', () => {
    const r = newRollup();
    expect(() => feedLine(r, '{"type":"assis', ctx, { afterSleep: false })).not.toThrow();
  });
  it('charges a poll to the request after the sleep, and only that one', () => {
    const r = newRollup();
    const state = { afterSleep: false };
    const sleep = JSON.stringify({ type: 'assistant', timestamp: T, message: { id: 'p0', model: 'claude-opus-5-5', usage, content: [{ type: 'tool_use', name: 'Bash', input: { command: 'sleep 60; gh pr checks' } }] } });
    feedLine(r, sleep, ctx, state); // the sleeping message itself is a request made before the wait
    feedLine(r, line('p1', { cache_read_input_tokens: 2e6 }), ctx, state);
    feedLine(r, line('p2', { cache_read_input_tokens: 2e6 }), ctx, state);
    const j = finishRollup(r).jobs[0];
    expect(j.polls).toBe(1);
    expect(j.poll_cost).toBeCloseTo(1); // p1's cache read (2M × $0.50), not the sleeping message's
  });
  it('still finds the sleep when it arrives on a later line of a message already counted', () => {
    const r = newRollup();
    const state = { afterSleep: false };
    feedLine(r, line('p0', usage), ctx, state);
    feedLine(r, line('p0', usage, { message: { id: 'p0', model: 'claude-opus-5-5', usage, content: [{ type: 'tool_use', name: 'Bash', input: { command: 'sleep 60' } }] } }), ctx, state);
    feedLine(r, line('p1', { cache_read_input_tokens: 2e6 }), ctx, state);
    expect(finishRollup(r).jobs[0].poll_cost).toBeCloseTo(1);
  });
  it('separates Opus subagent spend from Sonnet subagent spend', () => {
    const r = newRollup();
    feedLine(r, line('o', usage), { ...ctx, isSub: true }, { afterSleep: false });
    feedLine(r, line('s', usage, {}, T, 'claude-sonnet-5-5'), { ...ctx, isSub: true }, { afterSleep: false });
    const j = finishRollup(r).jobs[0];
    expect(j.sub).toBeGreaterThan(j.sub_opus);
    expect(j.sub_opus).toBeGreaterThan(0);
  });
  it('flags a short session that booted on the default prompt, not a lean one', () => {
    const fat = newRollup();
    feedLine(fat, line('f', { cache_creation_input_tokens: 20000 }), ctx, { afterSleep: false });
    expect(finishRollup(fat).signals[0].fat_calls).toBe(1);
    const lean = newRollup();
    feedLine(lean, line('l', { input_tokens: 400 }), ctx, { afterSleep: false });
    expect(finishRollup(lean).signals[0].fat_calls).toBe(0);
  });
  it('reports what the job table leaves out', () => {
    const r = newRollup();
    feedLine(r, line('a', usage), { ...ctx, label: 'big' }, { afterSleep: false });
    feedLine(r, line('b', { output_tokens: 1 }), { ...ctx, label: 'small' }, { afterSleep: false });
    const out = finishRollup(r, { maxJobs: 1 });
    expect(out.jobs.map((j: { job: string }) => j.job)).toEqual(['big']);
    expect(out.jobs_omitted).toBe(1);
  });
});

describe('login timeline', () => {
  const timeline = parseLoginTimeline([
    '{"t":"2026-11-03T11:00:00Z","account":"gmail"}',
    'not json',
    '{"t":"2026-10-29T23:00:00Z","account":"sl"}',
    '{"t":"2026-11-05T10:00:00Z","account":"sl"}',
  ].join('\n'));

  it('reads entries in time order and skips a bad line', () => {
    expect(timeline.map((e: { account: string }) => e.account)).toEqual(['sl', 'gmail', 'sl']);
  });
  it('gives the login in force at a moment, and says when there is no record', () => {
    expect(loginAt(timeline, Date.parse('2026-11-04T12:00:00Z'))).toBe('gmail');
    expect(loginAt(timeline, Date.parse('2026-11-06T12:00:00Z'))).toBe('sl');
    expect(loginAt(timeline, Date.parse('2026-10-01T00:00:00Z'))).toBe('unknown');
  });
  it('files each message under its own moment, so a later /login cannot relabel history: the page showed all $3,730 under one account', () => {
    const r = newRollup();
    const accountAt = (ms: number) => loginAt(timeline, ms);
    const c = { ...ctx, since: 0, accountAt };
    feedLine(r, line('a', { output_tokens: 100 }, {}, '2026-11-04T12:00:00.000Z'), c, { afterSleep: false });
    feedLine(r, line('b', { output_tokens: 100 }, {}, '2026-11-05T12:00:00.000Z'), c, { afterSleep: false });
    const out = finishRollup(r);
    expect(out.days.map((d: { account: string }) => d.account).sort()).toEqual(['gmail', 'sl']);
    expect(out.jobs.map((j: { account: string }) => j.account).sort()).toEqual(['gmail', 'sl']);
    expect(out.hours.map((h: { account: string }) => h.account).sort()).toEqual(['gmail', 'sl']);
  });
});

describe('jobLabel', () => {
  it('reads a job worktree on each box layout', () => {
    expect(jobLabel('-root-worktrees-job-authors-7660')).toBe('authors-7660');
    expect(jobLabel('-mnt-HC-Volume-105839809-worktrees-job-read-surface-6740')).toBe('read-surface-6740');
  });
  it('folds the per-call folders of a page lane into their job', () => {
    expect(jobLabel('-data-scratch-sl-jobs-ocr-context-8182-tmp-zhpl-Zwt5qZ')).toBe('ocr-context-8182');
    expect(jobLabel('-root-worktrees-job-tib-diffqa-t1-6740-claude-ws-tib-diffqa-t1-6740-69e7aae15f1a22ab19a8eded')).toBe('tib-diffqa-t1-6740');
    expect(jobLabel('-mnt-HC-Volume-105839809-jobs-convergent-audit-6420-tmp-second-reader-sealed-2026-11-02-opus-p058')).toBe('convergent-audit-6420');
  });
  it('folds temp folders and the main checkout', () => {
    expect(jobLabel('-tmp')).toBe('(scripted, temp folder)');
    expect(jobLabel('-root-sourcelibrary')).toBe('(main checkout)');
  });
});

describe('parseEstimate', () => {
  it('reads the header with or without a unit and a reason', () => {
    expect(parseEstimate('Lands: #1\nEstimate: 5 pts\n')).toBe(5);
    expect(parseEstimate('Estimate: 2.5\n')).toBe(2.5);
    expect(parseEstimate('Estimate: 8 points — three stages\n')).toBe(8);
  });
  it('does not read an estimate from the body of a brief', () => {
    expect(parseEstimate(`${'x\n'.repeat(20)}Estimate: 5 pts\n`)).toBeNull();
    expect(parseEstimate('Estimate: a few\n')).toBeNull();
  });
});

describe('meter', () => {
  it('keeps the last reading of each hour, per account, inside the window', () => {
    const text = [
      { t: '2026-10-01T00:00:00Z', email: 'a', limits: { 'weekly_all:all': 1 } },
      { t: '2026-11-01T00:05:00Z', email: 'a', limits: { 'weekly_all:all': 2 } },
      { t: '2026-11-01T00:55:00Z', email: 'a', limits: { 'weekly_all:all': 3 } },
    ].map(o => JSON.stringify(o)).join('\n');
    expect(meterSeries(text, '2026-10-20')).toEqual([{ account: 'a', points: [{ hour: '2026-11-01T00', pct: 3 }] }]);
  });
  it('counts rises, and across a reset counts the new reading rather than a negative', () => {
    const points = [{ hour: 'h1', pct: 90 }, { hour: 'h2', pct: 95 }, { hour: 'h3', pct: 4 }, { hour: 'h4', pct: 10 }];
    expect(pointsUsed({ account: 'a', points }, 'h1')).toBe(15);
  });
  it('does not count the rise into the first hour of the period', () => {
    expect(pointsUsed({ account: 'a', points: [{ hour: 'h1', pct: 50 }, { hour: 'h2', pct: 55 }] }, 'h2')).toBe(5);
  });
});

describe('forecast', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const hourAgo = (h: number) => new Date(now.getTime() - h * 3600e3).toISOString().slice(0, 13);
  const series = (rows: [number, number][]) => ({ account: 'a', points: rows.map(([h, pct]) => ({ hour: hourAgo(h), pct })) });

  it('warns of a cap only when it comes before the reset', () => {
    const fast = series([[7, 70], [6, 70], [3, 76], [0, 82]]); // 2 points an hour, 18 left: 9 h
    expect(forecast(82, '2026-11-06T12:00:00Z', fast, now).caps_in_hours).toBeCloseTo(9);
    expect(forecast(82, '2026-11-04T15:00:00Z', fast, now).caps_in_hours).toBeNull();
  });
  it('says an idle account near its reset will leave quota unused, and no cap', () => {
    const idle = series([[30, 91], [10, 91], [0, 91]]);
    const f = forecast(91, '2026-11-05T12:00:00Z', idle, now);
    expect(f.unused_at_reset).toBeCloseTo(9);
    expect(f.caps_in_hours).toBeNull();
    expect(f.budget).toBeCloseTo(9 / 24);
  });
  it('makes no forecast from a reset already past or from no meter', () => {
    expect(forecast(50, '2026-11-01T00:00:00Z', series([[1, 50]]), now).budget).toBeNull();
    expect(forecast(50, '2026-11-06T00:00:00Z', undefined, now).burn).toBeNull();
    expect(forecast(50, '2026-11-06T00:00:00Z', undefined, now).unused_at_reset).toBeNull();
    expect(forecast(null, '2026-11-06T00:00:00Z', series([[1, 50]]), now).budget).toBeNull();
  });
  it('takes each account from whichever machine read it last', () => {
    const meter = (box: string, hour: string, checked_at: string, percent: number) =>
      ({ box, generated_at: checked_at, series: [{ account: 'a', points: [{ hour, pct: percent }] }], readings: [{ account: 'a', percent, resets_at: null, checked_at }] }) as MeterDoc;
    const merged = mergeMeters([meter('main', '2026-10-27T15', '2026-10-27T15:00:00Z', 97), meter('laptop', '2026-11-04T21', '2026-11-04T21:00:00Z', 81)]);
    expect(merged.readings[0].percent).toBe(81);
    expect(merged.series[0].points[0].pct).toBe(81);
  });
});

describe('what the page claims', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const doc = (box: string, generated_at: string) => ({ box, generated_at, files: 1, accounts: [], jobs_omitted: 0 }) as unknown as UsageDoc;
  const week = { points_7d: 10, transcript_7d: 200 } as AccountWeek;

  it('withholds the point rate while a machine is stale: W45 reported $17.7 instead of about $22 that way', () => {
    const fresh = freshness([doc('main', '2026-11-04T11:00:00Z')], now);
    expect(dollarsPerPoint([week], fresh)).toBe(20);
    const stale = freshness([doc('main', '2026-11-04T01:00:00Z')], now);
    expect(stale[0].stale).toBe(true);
    expect(dollarsPerPoint([week], stale)).toBeNull();
  });
  it('gives no rate from no machines', () => {
    expect(dollarsPerPoint([week], [])).toBeNull();
  });
  it('lets the laptop sleep overnight without calling it stale', () => {
    expect(freshness([doc('laptop', '2026-11-04T01:00:00Z')], now)[0].stale).toBe(false);
  });
  it('even pace follows the time left in the week', () => {
    expect(evenPacePercent('2026-11-08T00:00:00Z', new Date('2026-11-04T12:00:00Z'))).toBeCloseTo(50);
    expect(evenPacePercent(null, now)).toBeNull();
  });
  it('only marks a job over well past its estimate, and never without one', () => {
    expect(estimateVerdict(4, 5)).toBe('within');
    expect(estimateVerdict(4, 7)).toBe('over');
    expect(estimateVerdict(null, 7)).toBe('none');
    expect(estimateVerdict(4, null)).toBe('none');
  });
});
