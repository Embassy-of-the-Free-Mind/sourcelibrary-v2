/**
 * issue-triage-done-pass (#7277): an issue closes only on shipped evidence, never
 * through a hold, and a later "not done" sends it to a human instead.
 */
import { describe, it, expect } from 'vitest';
import { classify, commitEvidence, closeComment, HOLD_LABELS } from '../../scripts/maintenance/issue-triage-done-pass.mjs';

const pr = (number: number, extra = {}) => ({ number, title: `fix: thing (#1)`, state: 'MERGED', merged: true, mergedAt: '2026-10-12T00:00:00Z', baseRefName: 'main', body: 'Closes #1', ...extra });
const issue = (extra: Record<string, unknown> = {}) => ({
  number: 1, title: 'A thing is wrong', labels: { nodes: [] as { name: string }[] }, assignees: { nodes: [] }, milestone: null,
  comments: { nodes: [] as { createdAt: string; body: string }[] }, timelineItems: { nodes: [] as { createdAt: string }[] },
  closedByPullRequestsReferences: { nodes: [pr(9)] }, ...extra,
});

describe('classify', () => {
  it('closes an issue whose closing PR merged into main', () => {
    expect(classify(issue()).cls).toBe('close');
  });
  it('ignores a PR that is unmerged or merged into another branch', () => {
    expect(classify(issue({ closedByPullRequestsReferences: { nodes: [pr(9, { merged: false }), pr(8, { baseRefName: 'stack' })] } })).cls).toBe('none');
  });
  it('never closes through a hold label, an assignee, or a money/auth/deletion subject', () => {
    for (const name of HOLD_LABELS) expect(classify(issue({ labels: { nodes: [{ name }] } })).cls).toBe('hold');
    expect(classify(issue({ assignees: { nodes: [{ login: 'x' }] } })).cls).toBe('hold');
    expect(classify(issue({ title: 'Stripe donations double-count' })).cls).toBe('hold');
    expect(classify(issue({ title: 'Delete the orphaned pages' })).cls).toBe('hold');
  });
  it('sends it to review when reopened after the merge or a later comment says work remains', () => {
    expect(classify(issue({ timelineItems: { nodes: [{ createdAt: '2026-10-13T00:00:00Z' }] } })).cls).toBe('review');
    expect(classify(issue({ comments: { nodes: [{ createdAt: '2026-10-13T00:00:00Z', body: 'The repair sweep is not done yet.' }] } })).cls).toBe('review');
    // the same words BEFORE the merge are history, not a residue
    expect(classify(issue({ comments: { nodes: [{ createdAt: '2026-10-01T00:00:00Z', body: 'Still broken on prod.' }] } })).cls).toBe('close');
  });
  it('a clean detector run is evidence on its own', () => {
    const r = classify(issue({ closedByPullRequestsReferences: { nodes: [] } }), { detector: { clean: true, url: 'u', at: '2026-10-20T00:00:00Z' } });
    expect(r.cls).toBe('close');
    expect(closeComment(r.evidence)).toContain('detector');
  });
});

describe('commitEvidence', () => {
  it('reads fix/close wording and fix(#N) subjects, not a passing mention', () => {
    const log = ['a1\x1ffix(#12): guard the writer\x1f', 'b2\x1fdocs: mention #13\x1fsee #13', 'c3\x1fchore\x1fCloses #14 and #15'].join('\x1e');
    expect(Object.keys(commitEvidence(log)).sort()).toEqual(['12', '14', '15']);
  });
});
