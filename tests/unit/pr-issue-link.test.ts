/**
 * pr-issue-link (#6284): a PR title that names an open issue needs a
 * `Closes #N` or `Part of #N` line in the description.
 */
import { describe, it, expect } from 'vitest';
import { titleRefs, declared, missingDeclarations } from '../../scripts/maintenance/pr-issue-link.mjs';

describe('titleRefs', () => {
  it('reads every issue number in the title once', () => {
    expect(titleRefs('search: spread results (#3514, #3895, #5729) and #3514 again')).toEqual([3514, 3895, 5729]);
    expect(titleRefs('fix(#4823): Phase 8.9 cover selection')).toEqual([4823]);
    expect(titleRefs('chore: bump stripe')).toEqual([]);
  });
});

describe('declared', () => {
  it('recognises closing keywords in any tense and case', () => {
    for (const line of ['Closes #12', 'closed #12', 'Fixes #12', 'fix #12', 'Resolved #12', 'Closes: #12']) {
      expect(declared(`Summary.\n\n${line}\n`, 12)).toBe('closes');
    }
  });
  it('recognises Part of', () => {
    expect(declared('Step 1 only.\n\nPart of #12', 12)).toBe('part');
  });
  it('lets one keyword govern a list', () => {
    const body = 'Closes #1, #2 and #3.\nPart of #7, #8';
    expect([1, 2, 3].map((n) => declared(body, n))).toEqual(['closes', 'closes', 'closes']);
    expect([7, 8].map((n) => declared(body, n))).toEqual(['part', 'part']);
  });
  it('does not accept a bare mention or a different number', () => {
    expect(declared('See #12 for context. Closes #120.', 12)).toBeNull();
    expect(declared('Follow-up to #12', 12)).toBeNull();
    expect(declared(null, 12)).toBeNull();
  });
});

describe('missingDeclarations', () => {
  it('flags only open issues the description leaves undeclared', () => {
    const title = 'pipeline: fix two writers (#6122) (#6160)';
    expect(missingDeclarations(title, 'Fixes the hold writers.', [6122])).toEqual([6122]);
    expect(missingDeclarations(title, 'Part of #6122', [6122])).toEqual([]);
    expect(missingDeclarations(title, 'Closes #6122', [6122])).toEqual([]);
  });
  it('ignores numbers that are not open issues', () => {
    expect(missingDeclarations('revert (#5000)', '', [])).toEqual([]);
  });
});
