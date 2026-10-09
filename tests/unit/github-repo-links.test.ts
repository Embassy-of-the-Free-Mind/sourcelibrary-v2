import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

// The repository is Embassy-of-the-Free-Mind/sourcelibrary-v2. Links to
// Embassy-of-the-Free-Mind/sourcelibrary/… (no -v2) are 404s, not redirects: on 2026-10-04 every
// "Work log", "Details" and results link on /research/canon-gap pointed there, and a reader
// following a figure to its source landed on GitHub's 404 page (PR #5744).
const BAD = 'github.com/Embassy-of-the-Free-Mind/sourcelibrary/';

describe('GitHub links in src/ name the real repository', () => {
  it(`no tracked file under src/ links to ${BAD}`, () => {
    let hits = '';
    try {
      hits = execSync(`git grep -n -F "${BAD}" -- src`, { encoding: 'utf8' });
    } catch (e) {
      // git grep exits 1 when nothing matches: that is the passing case.
      if ((e as { status?: number }).status !== 1) throw e;
    }
    expect(hits).toBe('');
  });
});
