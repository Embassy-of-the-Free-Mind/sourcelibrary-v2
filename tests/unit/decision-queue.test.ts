import { describe, it, expect } from 'vitest';
import {
  applyAnswers, buildAnswer, cardPriority, keyRequestCard, parseCostUsd, parseOpsDecisions, prCard, prMergeBlocker, sortCards,
  type DecisionCard, type HoldPr, type PendingKeyRequest,
} from '@/lib/decision-queue';

// Synthetic rows in the shape of the ops DECISIONS-PENDING.md (the real file is
// private; nothing from it belongs in this public repo).
const OPS = `# Decisions pending Derek

**Rules.** Every row opens with its recommended option in bold.
- **Queue cap: ten.** A rules bullet, not a decision.

## Widgets, 2026-10-05 (from session "widgets")
- **Turn on the widget lane** once #1234 is live. **Default: yes.**
- **Re-embed everything (≈ $360 batch)**: details. **Default: no for now.** (#2345)

## Job decisions (added 2026-10-01)

| decision | what is ready | cost | details |
|---|---|---|---|
| **Recommended: merge the green PRs in order.** (1) #111 then #112. | all green | ≈ $72 realtime, $35 over | #4523 · handoffs/2026-10-01-x.md |
| **Approve repairs of the clean shifts.** | screen done | $0 | #5803 |
| **DECIDED 2026-10-04 (default) — YOUR ACTION: download it.** | - | - | - |
| **Retranslate per leaf?** Recommended default: **yes, Flash Batch.** | pilot | $40 | #4523 |

## Done 2026-10-07
- 2026-10-07 · Derek "approve": something done.

## Running now, no decision needed until it reports
- **A running job** **Default: wait.**
`;

const SHA = 'a'.repeat(40);
const pr = (o: Partial<HoldPr> = {}): HoldPr => ({
  number: 6238, title: 'feat: a thing', url: 'https://github.com/x/y/pull/6238', createdAt: '2026-10-01T00:00:00Z',
  isDraft: false, baseRefName: 'main', headRefOid: SHA, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  labels: ['tier:hold'], additions: 40, deletions: 10, changedFiles: 3, author: 'JDerekLomas', body: null, ...o,
});

describe('parseOpsDecisions', () => {
  const cards = parseOpsDecisions(OPS);

  it('takes only rows under pending sections, never the preamble, Done or Running now, nor DECIDED rows', () => {
    expect(cards).toHaveLength(5);
    expect(cards.some((c) => /Queue cap|running job|something done|YOUR ACTION/.test(c.question + c.defaultLabel))).toBe(false);
  });

  it('a bullet with a separate Default: the first bold is the question', () => {
    expect(cards[0].question).toBe('Turn on the widget lane');
    expect(cards[0].defaultLabel).toBe('yes.');
    expect(cards[0].raisedAt).toBe('2026-10-05');
    expect(cards[0].evidence.map((e) => e.label)).toContain('#1234');
  });

  it('a row that opens with its recommendation asks the section question', () => {
    const c = cards[2];
    expect(c.question).toBe('Job decisions');
    expect(c.defaultLabel).toBe('merge the green PRs in order.');
    expect(c.costUsd).toBe(72);
    expect(c.details.some((d) => d.startsWith('Ready: all green'))).toBe(true);
    expect(c.evidence.map((e) => e.label)).toEqual(expect.arrayContaining(['Ops row', '#111', '#4523', '2026-10-01-x.md']));
    expect(c.evidence[0].url).toMatch(/DECISIONS-PENDING\.md#L\d+$/);
  });

  it('a bold proposal with no "Recommended:" is its own default', () => {
    expect(cards[3].defaultLabel).toBe('Approve repairs of the clean shifts.');
    expect(cards[3].defaultActionable).toBe(true);
  });

  it('reads "Recommended default: **X**" with the keyword outside the bold', () => {
    expect(cards[4].question).toBe('Retranslate per leaf?');
    expect(cards[4].defaultLabel).toBe('yes, Flash Batch.');
  });

  it('ids are stable across reads and distinct across rows', () => {
    expect(parseOpsDecisions(OPS).map((c) => c.id)).toEqual(cards.map((c) => c.id));
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    for (const c of cards) expect(c.id).toMatch(/^ops:[0-9a-f]{16}$/);
  });
});

describe('parseCostUsd', () => {
  it('takes the largest dollar figure', () => {
    expect(parseCostUsd('≈ $72 realtime, $35 over the $476 cap')).toBe(476);
    expect(parseCostUsd('$1,250 and $2k')).toBe(2000);
    expect(parseCostUsd('free')).toBe(0);
  });
});

describe('prCard / prMergeBlocker', () => {
  it('a clean PR: Default merges, keyed to the head sha', () => {
    const c = prCard(pr());
    expect(c.defaultActionable).toBe(true);
    expect(c.defaultLabel).toBe('Merge');
    expect(c.defaultDoes).toMatch(/safe-merge\.sh/);
    expect(c.ref).toEqual({ pr: 6238, headSha: SHA });
    expect(prCard(pr({ headRefOid: 'b'.repeat(40) })).id).not.toBe(c.id);
  });

  it.each([
    [{ isDraft: true }, /draft/],
    [{ labels: ['tier:hold', 'blocked'] }, /blocked/],
    [{ baseRefName: 'feat/parent' }, /stacked on feat\/parent/],
    [{ mergeable: 'CONFLICTING' }, /conflicts/],
    [{ mergeStateStatus: 'BEHIND' }, /behind/],
    [{ mergeStateStatus: 'BLOCKED' }, /check/],
  ] as [Partial<HoldPr>, RegExp][])('refuses %o', (o, why) => {
    expect(prMergeBlocker(pr(o))).toMatch(why);
    expect(prCard(pr(o)).defaultActionable).toBe(false);
  });

  it('UNSTABLE (Vercel only) and UNKNOWN go to the drainer, which decides', () => {
    expect(prMergeBlocker(pr({ mergeStateStatus: 'UNSTABLE' }))).toBeNull();
    expect(prCard(pr({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' })).defaultDoes).toMatch(/still computing/);
  });

  it('a big diff says it needs a desk; a preview URL in the body becomes evidence', () => {
    expect(prCard(pr({ changedFiles: 30 })).needsDesk).toMatch(/30 files/);
    expect(prCard(pr()).needsDesk).toBeUndefined();
    const c = prCard(pr({ body: 'Preview: https://sourcelibrary-v2-git-x.vercel.app/platform/admin/decisions.' }));
    expect(c.evidence.find((e) => e.label === 'Preview')?.url).toBe('https://sourcelibrary-v2-git-x.vercel.app/platform/admin/decisions.');
  });
});

describe('ordering', () => {
  const now = new Date('2026-10-07T00:00:00Z');
  const base = prCard(pr());
  const mk = (id: string, raisedAt: string | null, costUsd: number): DecisionCard => ({ ...base, id, raisedAt, costUsd });

  it('a day of age weighs as much as $10', () => {
    expect(cardPriority(mk('a', '2026-10-06T00:00:00Z', 0), now)).toBeCloseTo(1);
    expect(cardPriority(mk('b', null, 50), now)).toBe(5);
  });

  it('oldest and most expensive first', () => {
    const sorted = sortCards([mk('new-cheap', '2026-10-06', 0), mk('new-dear', '2026-10-06', 300), mk('old', '2026-09-20', 0)], now);
    expect(sorted.map((c) => c.id)).toEqual(['new-dear', 'old', 'new-cheap']);
  });
});

describe('buildAnswer', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const prc = prCard(pr());
  const ops = parseOpsDecisions(OPS)[0];

  it('a PR Default is queued for the drainer with the sha it was judged at', () => {
    const a = buildAnswer({ card: prc, choice: 'default' }, 'derek@sourcelibrary.org', now);
    expect(a).toMatchObject({ status: 'queued', choice: 'default', text: '', answered_by: 'derek@sourcelibrary.org', ref: { pr: 6238, headSha: SHA } });
    expect(a.answered_at).toBe(now);
  });

  it('Other needs text and queues it', () => {
    expect(() => buildAnswer({ card: prc, choice: 'other', text: '  ' }, 'd@x', now)).toThrow(/written answer/);
    expect(buildAnswer({ card: prc, choice: 'other', text: ' split it ' }, 'd@x', now)).toMatchObject({ status: 'queued', text: 'split it' });
  });

  it('an ops answer is a record, not an action', () => {
    expect(buildAnswer({ card: ops, choice: 'default' }, 'd@x', now).status).toBe('recorded');
  });

  it('Skip, and a Default that cannot act, both skip for a day', () => {
    const s = buildAnswer({ card: prc, choice: 'skip' }, 'd@x', now);
    expect(s).toMatchObject({ choice: 'skip', status: 'recorded' });
    expect(s.skip_until?.toISOString()).toBe('2026-10-08T12:00:00.000Z');
    const blocked = prCard(pr({ isDraft: true }));
    expect(buildAnswer({ card: blocked, choice: 'default' }, 'd@x', now).choice).toBe('skip');
  });

  it('refuses malformed answers', () => {
    expect(() => buildAnswer({ card: prc, choice: 'default' }, '', now)).toThrow(/answerer/);
    expect(() => buildAnswer({ card: { ...prc, id: 'ops:0123456789abcdef' }, choice: 'default' }, 'd@x', now)).toThrow(/card id/);
    expect(() => buildAnswer({ card: { ...prc, ref: { pr: 1 } }, choice: 'default' }, 'd@x', now)).toThrow(/head sha/);
    expect(() => buildAnswer({ card: prc, choice: 'merge' as never }, 'd@x', now)).toThrow(/choice/);
    expect(() => buildAnswer({ card: { ...prc, id: 'session:0123456789abcdef', source: 'session' }, choice: 'skip' }, 'd@x', now)).toThrow(/read-only/);
  });
});

describe('applyAnswers', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const c = prCard(pr());
  const at = (h: number) => new Date(now.getTime() - h * 3_600_000);

  it('hides queued, acting, done and recorded cards', () => {
    for (const status of ['queued', 'acting', 'done', 'recorded'] as const) {
      expect(applyAnswers([c], [{ card_id: c.id, choice: 'default', status, answered_at: at(1) }], now)).toEqual([]);
    }
  });

  it('a skip hides until skip_until', () => {
    expect(applyAnswers([c], [{ card_id: c.id, choice: 'skip', status: 'recorded', answered_at: at(1), skip_until: at(-1) }], now)).toEqual([]);
    expect(applyAnswers([c], [{ card_id: c.id, choice: 'skip', status: 'recorded', answered_at: at(30), skip_until: at(6) }], now)).toHaveLength(1);
  });

  it('a refused merge brings the card back with the reason; the latest answer wins', () => {
    const back = applyAnswers([c], [
      { card_id: c.id, choice: 'default', status: 'done', answered_at: at(5) },
      { card_id: c.id, choice: 'default', status: 'refused', answered_at: at(1), result: 'REFUSED #6238: entities interlock exited 1' },
    ], now);
    expect(back[0].lastAttempt).toMatch(/refused: REFUSED #6238: entities interlock/);
  });
});

describe('keyRequestCard', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const req = (o: Partial<PendingKeyRequest> = {}): PendingKeyRequest => ({
    id: '0123456789abcdef01234567', name: 'Ada Reader', email: 'ada@example.org', organization: 'Example Lab',
    use_case: 'Corpus\n  study of   alchemical terms', requested_tier: 'explorer', created_at: '2026-10-01T09:00:00.000Z', ...o,
  });

  it('asks about the requester, defaults to approving the requested tier, and keys the card to the request', () => {
    const c = keyRequestCard(req());
    expect(c.source).toBe('apikey');
    expect(c.id).toMatch(/^apikey:[0-9a-f]{16}$/);
    expect(c.id).toBe(keyRequestCard(req({ use_case: 'edited' })).id);
    expect(c.question).toBe('Give Ada Reader (Example Lab) an API key?');
    expect(c.defaultLabel).toBe('Approve, explorer tier');
    expect(c.defaultDoes).toMatch(/emails it to ada@example\.org/);
    expect(c.otherDoes).toMatch(/Denies/);
    expect(c.details[1]).toBe('Use: Corpus study of alchemical terms');
    expect(c.raisedAt).toBe('2026-10-01T09:00:00.000Z');
    expect(c.ref).toEqual({ keyRequest: '0123456789abcdef01234567', section: 'API key requests' });
    expect(keyRequestCard(req({ organization: null })).question).toBe('Give Ada Reader an API key?');
  });

  it('an approve answer is acted on at once (acting); a deny needs its note; a skip is recorded', () => {
    const c = keyRequestCard(req());
    expect(buildAnswer({ card: c, choice: 'default' }, 'd@x', now)).toMatchObject({ status: 'acting', choice: 'default' });
    expect(() => buildAnswer({ card: c, choice: 'other', text: ' ' }, 'd@x', now)).toThrow(/written answer/);
    expect(buildAnswer({ card: c, choice: 'other', text: 'not a research use' }, 'd@x', now)).toMatchObject({ status: 'acting', text: 'not a research use' });
    expect(buildAnswer({ card: c, choice: 'skip' }, 'd@x', now).status).toBe('recorded');
    expect(() => buildAnswer({ card: { ...c, ref: { section: 'API key requests' } }, choice: 'default' }, 'd@x', now)).toThrow(/request id/);
  });

  it('a failed approval brings the card back with the reason', () => {
    const c = keyRequestCard(req());
    const back = applyAnswers([c], [{ card_id: c.id, choice: 'default', status: 'failed', answered_at: now, result: 'Invalid tier: gold' }], now);
    expect(back[0].lastAttempt).toMatch(/failed: Invalid tier: gold/);
  });
});
