import { describe, it, expect } from 'vitest';
import {
  classifyNtfy, recentDecisions, stuckJobs, nearCap, formatDigest, issueUrl, MAX_BODY_LINES,
} from '../../scripts/maintenance/ntfy-morning-digest.mjs';

/**
 * The morning digest (#6181) is the one default-priority ntfy message of the day. These pin the two
 * promises that make it trustworthy: an unreadable source is SAID ("unreadable"), never silently
 * left out (an absent line reads as "all clear"), and the body never exceeds 15 lines.
 */
const msg = (title: string, time = 1000) => JSON.stringify({ event: 'message', time, title });

describe('classifyNtfy', () => {
  it('buckets job outcomes and decision pages from the topic history', () => {
    const out = classifyNtfy([
      JSON.stringify({ event: 'open', time: 1 }),
      msg('Job done + landed: a (hetzner)', 500),
      msg('Job finished but did NOT land: b (cloudlayer)'),
      msg('Job GAVE UP: c (hetzner)'),
      msg('Job a: 2 decision(s) for Derek'),
      msg('Source Library DOWN'),
      'not json',
    ].join('\n'));
    expect(out.landed).toEqual(['a (hetzner)']);
    expect(out.notLanded).toEqual(['b (cloudlayer)', 'c (hetzner)']);
    expect(out.decisions).toEqual([{ name: 'a', n: 2 }]);
    expect(out.total).toBe(5);
    expect(out.since).toBe(500);
  });
});

describe('helpers', () => {
  it('recentDecisions keeps rows on/after the day, newest first', () => {
    const rows = recentDecisions('2026-10-05 | old | DECISION: x\n2026-10-06 | j1 | DECISION: q1 (#5729)\n2026-10-07 | j2 | DECISION: q2', '2026-10-06');
    expect(rows.map((r) => r.job)).toEqual(['j2', 'j1']);
  });
  it('stuckJobs flags stale LIVE heartbeats and DIED, not fresh LIVE or DONE', () => {
    expect(stuckJobs('LIVE    a  hb=3m  :: x\nLIVE    b  hb=40m  :: y\nDIED    c  hb=90m  :: z\nDONE    d  2026')).toEqual(['b (LIVE, heartbeat 40m old)', 'c (DIED)']);
  });
  it('nearCap lists 90–99 % envelopes only', () => {
    expect(nearCap([
      { tag: 'a', budget_usd: 10, spent_usd: 9.5 },
      { tag: 'b', budget_usd: 10, spent_usd: 12 },
      { tag: 'c', budget_usd: 10, spent_usd: 2 },
    ])).toEqual(['a 95% ($9.50/$10.00)']);
  });
  it('issueUrl turns #N into a tappable URL', () => {
    expect(issueUrl('default: yes (#5729)')).toBe('https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5729');
    expect(issueUrl('no ref')).toBeNull();
  });
});

describe('formatDigest', () => {
  it('says "unreadable" for every source that failed, and still produces a digest', () => {
    const e = { error: 'boom' };
    const body = formatDigest({ yesterday: '2026-10-06', ntfy: e, spend: e, spendDaily: e, decisions: e, stuck: e, waiters: e, holds: e });
    for (const label of ['Jobs overnight', 'Spend 2026-10-06', 'Spend check', 'Decisions', 'Stuck', 'tier:hold PRs']) {
      expect(body).toContain(`${label}: unreadable (boom)`);
    }
  });
  it('never exceeds 15 body lines', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ day: '2026-10-07', job: `j${i}`, text: 'q' }));
    const body = formatDigest({
      yesterday: '2026-10-06', ntfyFrom: '18:00Z',
      ntfy: { landed: ['a'], notLanded: ['b'], decisions: [{ name: 'a', n: 1 }], since: 1, total: 3 },
      spend: { usd: 12, dial: 5 }, spendDaily: { day: '2026-10-05', line: 'spend check: PASS', nearCap: ['x 95%'] },
      decisions: { sinceDay: '2026-10-06', rows: many }, stuck: { items: ['s'] }, waiters: ['w.sh'], holds: [{ number: 1 }],
    });
    expect(body.split('\n').length).toBeLessThanOrEqual(MAX_BODY_LINES);
  });
});
