import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

/**
 * `CLAUDE.md` declares its own word budget and, until this test, nothing enforced it.
 *
 * The budget is the mechanism that makes the downward pass ("is anything here now
 * conditional, duplicated, or stale?") happen at all: over budget, something must be
 * demoted before anything is added. Without enforcement the file grew from ~290 lines to
 * 827 in three months, with the same incident written up twice 300 lines apart.
 *
 * It went unenforced again on 2026-08-30. Merging #4197 took the file to 5,631 words with
 * nothing flagging it; a demotion pass (#4422) brought it back to 5,501, and another
 * session's merge pushed it to 5,519 within the hour. That last part is the reason a test
 * is the right layer rather than a habit: **the budget is shared mutable state across
 * concurrent sessions**, and no single session can see the whole spend. Same class as the
 * `locus_anchors` clobber this repo already learned from — two sessions can each believe
 * they own a shared resource.
 *
 * The cap is deliberately a CEILING WITH SLACK, not the target. Failing at 5,501 would
 * turn every doc PR into a demotion argument and get the test deleted. Failing at 6,000
 * catches the drift that actually matters — the file growing by a third — while leaving
 * room for a session to land a lesson and pay it back in the next commit.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');

/** The budget CLAUDE.md states for itself. */
const STATED_BUDGET = 5500;

/**
 * Hard ceiling. Slack over the stated budget so that a PR landing a lesson is not blocked
 * before its paired demotion, while runaway growth still fails loudly.
 */
const HARD_CEILING = 6000;

function wordCount(file: string): number {
  return readFileSync(file, 'utf8').split(/\s+/).filter(Boolean).length;
}

describe('CLAUDE.md word budget', () => {
  it(`stays under the hard ceiling of ${HARD_CEILING} words`, () => {
    const words = wordCount(path.join(REPO_ROOT, 'CLAUDE.md'));
    expect(
      words,
      `CLAUDE.md is ${words} words (stated budget ~${STATED_BUDGET}, ceiling ${HARD_CEILING}).\n` +
        'Demote something to .claude/docs/invariants/ before adding more — the body keeps ' +
        'the RULE and the TELL; the incident archaeology lives in the invariant doc it ' +
        'routes to. See .claude/docs/knowledge-layer.md.',
    ).toBeLessThanOrEqual(HARD_CEILING);
  });

  it('still states its own budget, so the number here is not the only copy', () => {
    // If someone edits the prose to drop the budget, this test becomes the sole
    // definition and silently stops meaning anything. Fail instead.
    const body = readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
    expect(body).toMatch(/5,500 words|~5,500|5500 words/);
  });
});

describe('invariant routing', () => {
  it('every invariant doc is reachable from CLAUDE.md', () => {
    // The invariants tier only works if the routing table sends you there. A doc nobody
    // routes to is a doc nobody reads — and demoting a rule into an unrouted file is
    // strictly worse than leaving it in the body, because it looks handled.
    const body = readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
    const dir = path.join(REPO_ROOT, '.claude/docs/invariants');
    const orphans = readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => !body.includes(f));

    expect(
      orphans,
      `These invariant docs are not referenced anywhere in CLAUDE.md, so nothing routes a ` +
        `reader to them:\n  ${orphans.join('\n  ')}\n` +
        'Add a one-line trigger entry to the "Conditional invariants" table.',
    ).toEqual([]);
  });
});
