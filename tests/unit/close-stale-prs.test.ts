/** close-stale-prs (#8353): only idle AND unmergeable PRs close; a green idle PR survives. */
import { describe, it, expect } from 'vitest';
import { selectCandidates, lastActivity, closeComment, titleIssues } from '../../scripts/maintenance/close-stale-prs.mjs';

const now = Date.parse('2026-11-07T00:00:00Z');
const daysAgo = (d: number) => new Date(now - d * 86400e3).toISOString();
const human = { login: 'derek', is_bot: false };
const pr = (number: number, extra: Record<string, unknown> = {}) => ({
  number, title: `pr ${number}`, createdAt: daysAgo(40), isDraft: false, author: human,
  labels: [], commits: [{ committedDate: daysAgo(30) }], comments: [], mergeable: 'CONFLICTING',
  statusCheckRollup: [], headRefName: `b${number}`, ...extra,
});
const pick = (prs: ReturnType<typeof pr>[], opts = {}) => selectCandidates(prs, { now, ...opts }).map((p: { number: number }) => p.number);
const red = [{ name: 'test', conclusion: 'FAILURE' }, { name: 'DCO', conclusion: 'SUCCESS' }];
const green = [{ name: 'test', conclusion: 'SUCCESS' }, { name: 'DCO', conclusion: 'SUCCESS' }];

describe('selectCandidates', () => {
  it('closes an idle conflicting PR', () => expect(pick([pr(1)])).toEqual([1]));
  it('closes an idle PR with a failing required check', () =>
    expect(pick([pr(1, { mergeable: 'MERGEABLE', statusCheckRollup: red })])).toEqual([1]));
  it('NEGATIVE CONTROL: an idle green mergeable PR survives', () =>
    expect(pick([pr(1, { mergeable: 'MERGEABLE', statusCheckRollup: green })])).toEqual([]));
  it('a failing non-required check does not count', () =>
    expect(pick([pr(1, { mergeable: 'MERGEABLE', statusCheckRollup: [{ name: 'vercel', conclusion: 'FAILURE' }] })])).toEqual([]));
  it('a recent commit keeps it', () => expect(pick([pr(1, { commits: [{ committedDate: daysAgo(3) }] })])).toEqual([]));
  it('a recent comment keeps it, even from a bot', () =>
    expect(pick([pr(1, { comments: [{ createdAt: daysAgo(2), author: { login: 'x[bot]' } }] })])).toEqual([]));
  it('a recent label change (updatedAt) does not keep it', () =>
    expect(pick([pr(1, { updatedAt: daysAgo(0) })])).toEqual([1]));
  it('skips drafts, dependabot, blocked, keep', () => {
    expect(pick([pr(1, { isDraft: true })])).toEqual([]);
    expect(pick([pr(2, { author: { login: 'dependabot[bot]', is_bot: true } })])).toEqual([]);
    expect(pick([pr(3, { labels: [{ name: 'blocked' }] })])).toEqual([]);
    expect(pick([pr(4, { labels: [{ name: 'keep' }] })])).toEqual([]);
  });
  it('tier:hold is skipped with a recent human comment, closed without one', () => {
    const hold = [{ name: 'tier:hold' }];
    expect(pick([pr(1, { labels: hold, comments: [{ createdAt: daysAgo(20), author: human }] })])).toEqual([]);
    expect(pick([pr(2, { labels: hold, comments: [{ createdAt: daysAgo(20), author: { login: 'a[bot]' } }] })])).toEqual([2]);
    expect(pick([pr(3, { labels: hold })])).toEqual([3]);
  });
  it('caps at max, longest idle first', () => {
    const prs = [pr(1, { commits: [{ committedDate: daysAgo(20) }] }), pr(2, { commits: [{ committedDate: daysAgo(50) }] }), pr(3, { commits: [{ committedDate: daysAgo(30) }] })];
    expect(pick(prs, { max: 2 })).toEqual([2, 3]);
  });
});

describe('helpers', () => {
  it('lastActivity is the latest commit or comment', () =>
    expect(lastActivity(pr(1, { comments: [{ createdAt: daysAgo(5) }] }))).toBe(daysAgo(5)));
  it('comment says why, reopenable, branch kept, links the title issue', () => {
    const c = closeComment(pr(1, { title: 'fix thing (#7468)' }), 14);
    expect(c).toMatch(/conflicts/);
    expect(c).toMatch(/reopenable/);
    expect(c).toMatch(/branch `b1` is kept/);
    expect(c).toMatch(/#7468/);
    expect(titleIssues('a #1 and #2')).toEqual([1, 2]);
  });
});
