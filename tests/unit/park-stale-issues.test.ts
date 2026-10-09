/**
 * park-stale-issues (#6285): idleness is measured from the last comment, not
 * `updatedAt`, and defects are never parked.
 */
import { describe, it, expect } from 'vitest';
import { selectCandidates, lastActivity, prActivity, NEVER_PARK } from '../../scripts/maintenance/park-stale-issues.mjs';

const now = Date.parse('2026-10-08T00:00:00Z');
const daysAgo = (d: number) => new Date(now - d * 86400e3).toISOString();
const issue = (number: number, labels: string[], createdDays: number, commentDays: number[] = [], extra = {}) => ({
  number, title: `issue ${number}`, createdAt: daysAgo(createdDays),
  labels: labels.map((name) => ({ name })), assignees: [], milestone: null,
  comments: commentDays.map((d) => ({ createdAt: daysAgo(d) })), ...extra,
});
const pick = (issues: ReturnType<typeof issue>[], opts = {}) => selectCandidates(issues, { now, ...opts }).map((i: { number: number }) => i.number);

describe('lastActivity', () => {
  it('is the last comment, or creation when there are none', () => {
    expect(lastActivity(issue(1, [], 100, [80, 10]))).toBe(daysAgo(10));
    expect(lastActivity(issue(2, [], 100))).toBe(daysAgo(100));
  });
});

describe('selectCandidates', () => {
  it('parks an old enhancement even though it carries no updatedAt signal at all', () => {
    expect(pick([issue(1, ['enhancement'], 170)])).toEqual([1]);
  });
  it('a recent comment keeps an old issue open', () => {
    expect(pick([issue(1, ['enhancement'], 170, [5])])).toEqual([]);
  });
  it('a PR titled for the issue counts as activity', () => {
    const prAt = prActivity([{ title: 'feat: works catalog step 9 (#1)', mergedAt: daysAgo(3) }, { title: 'mentions #2 only in passing', updatedAt: daysAgo(200) }]);
    expect(prAt).toEqual({ 1: daysAgo(3), 2: daysAgo(200) });
    expect(pick([issue(1, ['enhancement'], 170), issue(2, ['enhancement'], 170)], { prAt })).toEqual([2]);
  });
  it('uses 45 days for enhancement and 90 for everything else', () => {
    expect(pick([issue(1, ['enhancement'], 60), issue(2, ['ui'], 60), issue(3, ['ui'], 95), issue(4, [], 95)])).toEqual([3, 4, 1]);
  });
  it('never parks a defect or a commitment', () => {
    const protectedOnes = NEVER_PARK.map((l, k) => issue(100 + k, ['enhancement', l], 300));
    expect(pick([...protectedOnes,
      issue(1, ['enhancement'], 300, [], { assignees: [{ login: 'x' }] }),
      issue(2, ['enhancement'], 300, [], { milestone: { title: 'm' } })])).toEqual([]);
  });
  it('takes the longest-idle first and stops at max', () => {
    expect(pick([issue(1, ['ui'], 100), issue(2, ['ui'], 300), issue(3, ['ui'], 200)], { max: 2 })).toEqual([2, 3]);
  });
});
