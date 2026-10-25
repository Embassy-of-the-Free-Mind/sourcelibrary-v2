import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs maintenance script, no type declarations
import { closeLinkedIssues } from '../../scripts/maintenance/auto-merge.mjs';

// #7288: a github-actions merge does not fire `Closes #N`, so auto-merge.mjs
// closes the linked issues itself. A fake `gh` answers from a table and records
// every command, so the test sees exactly which issues would be closed.
const REPO = { name: 'sourcelibrary-v2', owner: { login: 'Embassy-of-the-Free-Mind' } };

function fakeGh(refs: object[], states: Record<number, string>) {
  const calls: string[] = [];
  const run = (cmd: string) => {
    calls.push(cmd);
    if (cmd.startsWith('gh pr view')) return JSON.stringify({ closingIssuesReferences: refs });
    if (cmd.startsWith('gh repo view')) return JSON.stringify({ name: REPO.name, owner: REPO.owner.login });
    const m = cmd.match(/^gh issue view (\d+)/);
    if (m) return `${states[Number(m[1])]}\n`;
    if (cmd.startsWith('gh issue close')) return '';
    throw new Error(`unexpected command: ${cmd}`);
  };
  const closes = () => calls.filter((c) => c.startsWith('gh issue close'));
  return { run, calls, closes };
}

describe('auto-merge: closes the issues a bot-merged PR names (#7288)', () => {
  it('closes an open linked issue with a comment naming the PR', () => {
    const gh = fakeGh([{ number: 3401, repository: REPO }], { 3401: 'OPEN' });
    expect(closeLinkedIssues(6646, gh.run)).toEqual([3401]);
    expect(gh.closes()).toHaveLength(1);
    expect(gh.closes()[0]).toMatch(/^gh issue close 3401 --reason completed --comment "Closed by #6646 /);
  });

  it('leaves an already-closed issue alone (negative control)', () => {
    const gh = fakeGh([{ number: 10, repository: REPO }, { number: 11, repository: REPO }], { 10: 'CLOSED', 11: 'OPEN' });
    expect(closeLinkedIssues(1, gh.run)).toEqual([11]);
    expect(gh.closes().join('\n')).not.toMatch(/close 10 /);
  });

  it('closes nothing when the PR names no closing issue (Part of #N is not a closing keyword)', () => {
    const gh = fakeGh([], {});
    expect(closeLinkedIssues(2, gh.run)).toEqual([]);
    expect(gh.closes()).toEqual([]);
  });

  it('never closes an issue in another repository', () => {
    const other = { name: 'sourcelibrary-ops', owner: { login: 'Embassy-of-the-Free-Mind' } };
    const gh = fakeGh([{ number: 5, repository: other }], { 5: 'OPEN' });
    expect(closeLinkedIssues(3, gh.run)).toEqual([]);
    expect(gh.calls.some((c) => c.startsWith('gh issue'))).toBe(false);
  });
});
