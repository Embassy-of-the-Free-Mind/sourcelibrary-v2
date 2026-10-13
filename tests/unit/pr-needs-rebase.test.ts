import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs maintenance script, no type declarations
import { stackedAction } from '../../scripts/maintenance/pr-needs-rebase.mjs';

describe('pr-needs-rebase: the `stacked` label follows the base branch', () => {
  it('a PR into another branch gets the label', () => {
    expect(stackedAction('feat/parent-123', [])).toBe('add');
  });

  it('is not re-added (no second comment) while it is still stacked', () => {
    expect(stackedAction('feat/parent-123', ['tier:auto', 'stacked'])).toBeNull();
  });

  it('comes off once the PR is retargeted to main', () => {
    expect(stackedAction('main', ['stacked'])).toBe('remove');
  });

  it('a PR into main without the label is left alone', () => {
    expect(stackedAction('main', ['tier:auto'])).toBeNull();
  });

  it('an unknown base changes nothing', () => {
    expect(stackedAction(undefined, ['stacked'])).toBeNull();
    expect(stackedAction('', [])).toBeNull();
  });
});
