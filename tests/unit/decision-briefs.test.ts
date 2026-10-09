import { describe, it, expect } from 'vitest';
import { failingChecksOf, parseOpsDecisions, prCard, type HoldPr } from '@/lib/decision-queue';
import {
  attachBriefs, groupCards, isWaitingOnAuthor, issueOfPr, validateBrief, type DecisionBrief,
} from '@/lib/decision-briefs';

// Synthetic rows in the shape of the ops DECISIONS-PENDING.md (the real file is
// private; nothing from it belongs in this public repo).
const OPS = `# Decisions pending Derek

## Widgets, 2026-10-05 (from session "widgets")
- **Turn on the widget lane** once #1234 is live. **Default: yes.**
- **Re-embed everything (≈ $360 batch)**: details. **Default: no for now.** (#2345)

## Job decisions (added 2026-10-01)
- **Approve repairs of the clean shifts.** (#5803)

## Done 2026-10-07
- 2026-10-07 · Derek "approve": something done.
`;

const holdPr = (number: number, title: string, over: Partial<HoldPr> = {}): HoldPr => ({
  number, title, url: `https://github.com/o/r/pull/${number}`, createdAt: '2026-10-05T00:00:00Z', isDraft: false,
  baseRefName: 'main', headRefOid: String(number).padStart(40, 'a'), mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  labels: ['tier:hold'], additions: 10, deletions: 1, changedFiles: 2, author: 'someone', body: '', ...over,
});

describe('groupCards', () => {
  const now = new Date('2026-10-08T00:00:00Z');
  const a = prCard(holdPr(101, 'eval: arm one (#6215)'));
  const b = prCard(holdPr(102, 'eval(#6215): arm two', { createdAt: '2026-10-01T00:00:00Z' }));
  const alone = prCard(holdPr(103, 'ntfy: three tiers (#6181)'));
  const conflicted = prCard(holdPr(104, 'eval: arm three (#6215)', { mergeable: 'CONFLICTING' }));
  const stacked = prCard(holdPr(105, 'docs: stacked', { baseRefName: 'feat/parent' }));
  const ops = parseOpsDecisions(OPS);

  it('reads the issue a PR belongs to from its title, preferring the parenthesised one', () => {
    expect(issueOfPr(a.question)).toBe(6215);
    expect(issueOfPr(b.question)).toBe(6215);
    expect(issueOfPr('Merge #9: fix #1234 properly (#5678)')).toBe(5678);
    expect(issueOfPr('Merge #9: no issue named')).toBeNull();
  });

  it('PRs on one issue are one group; a PR on its own is a group of one with no label', () => {
    const { groups } = groupCards([a, b, alone], now, { 6215: 'Canon scoring' });
    const g = groups.find((x) => x.key === 'issue:6215')!;
    expect(g.cardIds).toEqual([a.id, b.id]);
    expect(g.label).toBe('2 PRs on #6215: Canon scoring');
    expect(g.url).toBe('https://github.com/o/r/issues/6215');
    expect(groups.find((x) => x.cardIds[0] === alone.id)).toMatchObject({ key: `one:${alone.id}`, label: '' });
  });

  it('a PR that cannot merge yet leaves the queue for the waiting list, and does not count toward a group', () => {
    expect(isWaitingOnAuthor(conflicted)).toBe(true);
    expect(isWaitingOnAuthor(stacked)).toBe(true);
    const { groups, waiting } = groupCards([a, conflicted, stacked], now);
    expect(waiting).toEqual([conflicted.id, stacked.id]);
    expect(groups).toEqual([{ key: `one:${a.id}`, label: '', cardIds: [a.id] }]);
  });

  it('ops rows group by section, and an ops row is never "waiting on its author"', () => {
    expect(ops).toHaveLength(3);
    const { groups, waiting } = groupCards(ops, now);
    expect(waiting).toEqual([]);
    expect(groups.map((g) => g.cardIds.length).sort()).toEqual([1, 2]);
    expect(groups.find((g) => g.cardIds.length === 2)!.label).toBe('2 decisions: Widgets, 2026-10-05');
  });

  it('every card lands in exactly one place, and a group sorts by its most urgent card', () => {
    const all = [a, b, alone, conflicted, ...ops];
    const { groups, waiting } = groupCards(all, now);
    const grouped = groups.flatMap((g) => g.cardIds);
    expect([...grouped, ...waiting].sort()).toEqual(all.map((c) => c.id).sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    // b is 7 days old, so its group outranks the 3-day-old PR on its own.
    const order = groupCards([alone, a, b], now).groups.map((g) => g.key);
    expect(order.indexOf('issue:6215')).toBeLessThan(order.indexOf(`one:${alone.id}`));
  });
});

describe('failing checks send a PR back to its author', () => {
  it('counts finished, failed checks; sets Vercel aside; ignores passing, skipped and running ones', () => {
    expect(failingChecksOf([
      { name: 'test', conclusion: 'FAILURE' },
      { name: 'DCO', conclusion: 'ACTION_REQUIRED' },
      { context: 'Vercel', state: 'FAILURE' },
      { name: 'next-build', conclusion: 'SUCCESS' },
      { name: 'field-sprawl', conclusion: 'SKIPPED' },
      { name: 'search-eval', conclusion: null },
      { context: 'blog-links', state: 'ERROR' },
    ])).toEqual(['DCO', 'blog-links', 'test']);
    expect(failingChecksOf([{ context: 'Vercel', state: 'FAILURE' }])).toEqual([]);
  });

  it('a cancelled duplicate run beside a passing run of the same check is not a failure', () => {
    expect(failingChecksOf([{ name: 'tier', conclusion: 'CANCELLED' }, { name: 'tier', conclusion: 'SUCCESS' }])).toEqual([]);
    expect(failingChecksOf([{ name: 'tier', conclusion: 'CANCELLED' }])).toEqual(['tier']);
  });

  it('a CLEAN PR is never sent back on its check list', () => {
    const clean = prCard(holdPr(108, 'docs: y', { mergeStateStatus: 'CLEAN', failingChecks: ['tier'] }));
    expect(clean.defaultActionable).toBe(true);
  });

  it('a PR with a failing check cannot be merged from the card, and says which check', () => {
    const red = prCard(holdPr(106, 'copy: part 1 (#6215)', { mergeStateStatus: 'UNSTABLE', failingChecks: ['blog-links'] }));
    expect(red.defaultActionable).toBe(false);
    expect(red.defaultDoes).toContain('a check is failing (blog-links)');
    expect(isWaitingOnAuthor(red)).toBe(true);
  });

  it('UNSTABLE with only Vercel red still goes to Derek, as safe-merge.sh allows it', () => {
    const vercelOnly = prCard(holdPr(107, 'docs: x', { mergeStateStatus: 'UNSTABLE', failingChecks: [] }));
    expect(vercelOnly.defaultActionable).toBe(true);
    expect(isWaitingOnAuthor(vercelOnly)).toBe(false);
  });
});

describe('validateBrief', () => {
  const now = new Date('2026-10-08T00:00:00Z');
  const card = prCard(holdPr(101, 'eval: arm one (#6215)'));
  const other = prCard(holdPr(102, 'eval: arm two (#6215)'));
  const live = new Set([card.id, other.id]);
  const good = {
    card_id: card.id, summary: 'Adds one scoring arm. Nothing a reader sees changes.', recommendation: 'default',
    recommendation_label: 'Merge', rationale: ['the diff only adds files under scripts/eval'], risk: 'None to readers; revert the commit.',
    read: ['diff', 'PR body'], model: 'claude-opus-5-5', written_by: 'session decisions-queue',
  };

  it('accepts a complete brief and stamps the time itself', () => {
    const b = validateBrief({ ...good, written_at: '1999-01-01', same_decision_as: [other.id] }, live, now);
    expect(b.written_at).toBe(now);
    expect(b.same_decision_as).toEqual([other.id]);
    expect(b).not.toHaveProperty('other_text');
  });

  it('refuses a brief for a card that is no longer in the queue', () => {
    expect(() => validateBrief({ ...good, card_id: 'pr:0000000000000000' }, live, now)).toThrow(/not in the queue/);
  });

  it('"other" must carry the text to send', () => {
    expect(() => validateBrief({ ...good, recommendation: 'other' }, live, now)).toThrow(/other_text is required/);
    expect(validateBrief({ ...good, recommendation: 'other', other_text: 'Close: superseded by #102.' }, live, now).other_text)
      .toBe('Close: superseded by #102.');
  });

  it('refuses no reasons, too many, an over-long summary, an unknown recommendation, a self-reference, nothing read', () => {
    expect(() => validateBrief({ ...good, rationale: [] }, live, now)).toThrow(/rationale needs 1 to 3/);
    expect(() => validateBrief({ ...good, rationale: ['a', 'b', 'c', 'd'] }, live, now)).toThrow(/rationale needs 1 to 3/);
    expect(() => validateBrief({ ...good, summary: 'x'.repeat(501) }, live, now)).toThrow(/limit is 500/);
    expect(() => validateBrief({ ...good, recommendation: 'merge' }, live, now)).toThrow(/default, other or skip/);
    expect(() => validateBrief({ ...good, same_decision_as: [card.id] }, live, now)).toThrow(/the card itself/);
    expect(() => validateBrief({ ...good, read: [] }, live, now)).toThrow(/read needs 1 to 8/);
    expect(() => validateBrief([good], live, now)).toThrow(/JSON object/);
  });
});

describe('attachBriefs', () => {
  const card = prCard(holdPr(101, 'eval: arm one (#6215)'));
  const other = prCard(holdPr(102, 'eval: arm two (#6215)'));
  const brief = (over: Partial<DecisionBrief>): DecisionBrief => ({
    card_id: card.id, summary: 's', recommendation: 'default', recommendation_label: 'Merge', rationale: ['r'], risk: 'k',
    read: ['diff'], model: 'm', written_by: 'w', written_at: new Date('2026-10-08T00:00:00Z'), ...over,
  });

  it('a card with no brief is returned unchanged', () => {
    expect(attachBriefs([card, other], [brief({})])[1]).toBe(other);
  });

  it('the newest brief wins; goes-with resolves to live questions and drops cards that are gone', () => {
    const [c] = attachBriefs([card, other], [
      brief({ recommendation_label: 'old' }),
      brief({ recommendation_label: 'new', written_at: new Date('2026-10-09T00:00:00Z'), same_decision_as: [other.id, 'pr:ffffffffffffffff'] }),
    ]);
    expect(c.brief!.recommendation_label).toBe('new');
    expect(c.brief!.goesWith).toEqual([other.question]);
    expect(c.brief!.written_at).toBe('2026-10-09T00:00:00.000Z');
  });

  it('flags a recommendation that is not the opener\'s default', () => {
    expect(attachBriefs([card], [brief({})])[0].brief!.disagrees).toBe(false);
    expect(attachBriefs([card], [brief({ recommendation: 'skip' })])[0].brief!.disagrees).toBe(true);
  });

  it('a brief keyed to an older head of the same PR does not attach to the new card', () => {
    const pushed = prCard(holdPr(101, 'eval: arm one (#6215)', { headRefOid: 'b'.repeat(40) }));
    expect(pushed.id).not.toBe(card.id);
    expect(attachBriefs([pushed], [brief({})])[0].brief).toBeUndefined();
  });
});
