/**
 * Guards for the readers headline (#48).
 *
 * The dashboard said "95K people" and meant browser fingerprints, most of them
 * crawler fleets, and its top-ten search table was our own uptime probe. These
 * pin the parts of the fix that are pure functions: which user agents are our
 * own tools, which referrers count as arriving from another site, and the
 * bookkeeping of the daily series (whole UTC days, no day counted in two
 * chunks, a recomputed day replacing the stored one). The rule itself runs
 * inside Mongo and is checked against production in the issue, not here.
 */
import { describe, it, expect } from 'vitest';
import {
  EXTERNAL_REF, OWN_TOOL_UA, likelyHumanDailyChunked, median, mergeDaily,
} from '../../scripts/lib/likely-human.mjs';

const DAY = 864e5;

describe('own tools are not readers', () => {
  it('matches the search probe, the eval harness and bare node', () => {
    for (const ua of ['sl-search-probe/1 (#2049)', 'sl-search-evals/1 (#2049)', 'node', 'undici']) expect(OWN_TOOL_UA.test(ua)).toBe(true);
  });
  it('does not match a browser, or a word that merely contains one', () => {
    for (const ua of [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      'node-fetch/3 (some reader tool)',
      '',
    ]) expect(OWN_TOOL_UA.test(ua)).toBe(false);
  });
});

describe('a referrer from another site', () => {
  const external = new RegExp(EXTERNAL_REF);
  it('counts other sites', () => {
    for (const r of ['google.com', 'embassyofthefreemind.com', 'l.instagram.com', 'com.google.android.gm']) expect(external.test(r)).toBe(true);
  });
  it('does not count direct visits or our own hosts', () => {
    for (const r of ['direct', 'sourcelibrary.org', 'bph.sourcelibrary.org', 'localhost', '127.0.0.1']) expect(external.test(r)).toBe(false);
  });
});

describe('median', () => {
  it('ignores one fleet day that a mean would carry', () => {
    const days = [1100, 1200, 1150, 1050, 46668, 1180, 1120];
    expect(median(days)).toBe(1150);
    expect(Math.round(days.reduce((a, b) => a + b, 0) / days.length)).toBeGreaterThan(7000);
  });
  it('averages the middle pair and returns 0 for nothing', () => {
    expect(median([1, 2, 3, 4])).toBe(3); // 2.5 rounded
    expect(median([])).toBe(0);
  });
});

describe('the daily series', () => {
  const now = Date.UTC(2026, 10, 12, 5, 45); // the cron's hour

  it('asks for whole UTC days in contiguous chunks that stop at today 00:00', async () => {
    const asked: { from: number; to: number }[] = [];
    const pageviews = {
      aggregate: (pipeline: { $match?: { timestamp: { $gte: Date; $lt: Date } } }[]) => {
        const t = pipeline[0].$match!.timestamp;
        asked.push({ from: +t.$gte, to: +t.$lt });
        return { toArray: async () => [] };
      },
    };
    await likelyHumanDailyChunked(pageviews, { days: 70, now });
    const today = Date.UTC(2026, 10, 12);
    expect(asked).toHaveLength(3);
    expect(asked[0].from).toBe(today - 70 * DAY);
    expect(asked.at(-1)!.to).toBe(today); // today is partial and never counted
    for (const a of asked) { expect(a.from % DAY).toBe(0); expect(a.to % DAY).toBe(0); }
    for (let i = 1; i < asked.length; i++) expect(asked[i].from).toBe(asked[i - 1].to); // no day in two chunks
  });

  it('lets a recomputed day replace the stored one and drops days past the window', () => {
    const d = (date: string, likely: number) => ({ date, all: likely * 3, likely, strict: likely / 2, pageviews: 0, likelyPageviews: 0 });
    const merged = mergeDaily(
      [d('2026-01-01', 5), d('2026-11-09', 900), d('2026-11-10', 1000)],
      [d('2026-11-10', 1125), d('2026-11-11', 928)],
      { keepDays: 220, now },
    );
    expect(merged.map((r: { date: string }) => r.date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    expect(merged[1].likely).toBe(1125);
  });
});
