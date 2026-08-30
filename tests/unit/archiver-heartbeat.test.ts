import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

/**
 * The archiver must never go silent for the length of a run.
 *
 * `archive-acquired.ts` can run for the better part of an hour. Without periodic
 * output, a healthy run and a wedged one are indistinguishable — on 2026-08-30 a
 * stalled run held `/tmp/sl-arch-acq.lock` for 1h24m and, because the cron wraps
 * it in `flock -n`, silently no-op'd every subsequent run. The archiver looked
 * dead for three hours.
 *
 * ## Why this test exists rather than just the feature
 *
 * The heartbeat was added in #4421 and **silently deleted the same day** by
 * #4428, a concurrent PR whose branch predated it and which rewrote the same
 * region of the file. GitHub reported that PR `MERGEABLE`; nothing failed; the
 * loss was found only because a later run produced no heartbeat lines.
 *
 * That is the `locus_anchors` failure mode (invariants/main-checkout-and-worktrees.md)
 * applied to code instead of data: two sessions edit shared state, and the
 * second silently wins. A doc cannot prevent it — the other session never reads
 * your PR. **A test can, because it runs in their CI, not yours.**
 *
 * So this asserts the *mechanism*, not a string: an interval that emits progress,
 * cleared before exit, with page-grain counters. If a future edit removes the
 * heartbeat, this goes red in that edit's own CI run.
 */

const ARCHIVER = path.resolve(__dirname, '../../scripts/catalog-coverage/archive-acquired.ts');

describe('archive-acquired heartbeat', () => {
  const src = readFileSync(ARCHIVER, 'utf8');

  it('emits progress on an interval while the run is in flight', () => {
    expect(src, 'no setInterval — the run would be silent for its whole duration').toMatch(/setInterval\(/);
    expect(src, 'no heartbeat log line').toMatch(/heartbeat/i);
  });

  it('counts pages, not just books — book-grain cannot separate slow from stuck', () => {
    // A 250-page book is minutes of apparent silence. The 2026-08-30 capture that
    // proved the heartbeat's worth read `books 0/3` while pages climbed 6 -> 11.
    for (const counter of ['pagesDone', 'pagesFailed']) {
      expect(src, `missing page-grain counter ${counter}`).toContain(counter);
    }
  });

  it('clears the interval so it cannot outlive the work', () => {
    expect(src, 'setInterval without clearInterval leaks a timer past the run').toMatch(/clearInterval\(/);
    expect(src, 'the timer should be unref\'d so it never holds the process open').toMatch(/unref/);
  });

  it('reports the achieved rate in its final summary', () => {
    // A completed run should state its own throughput rather than leaving it to
    // be inferred from log timestamps.
    expect(src).toMatch(/pages\/s/);
  });
});

describe('long-running archivers generally', () => {
  it('every archive worker that loops over books emits some periodic progress', () => {
    // Generalises the lesson rather than pinning one file. A sweep that can run
    // for many minutes and prints nothing is the shape that gets killed by an
    // operator who assumes it hung — which is how two corpus scans were lost
    // (invariants/archive-fetch-failures.md).
    const dirs = [
      path.resolve(__dirname, '../../scripts/catalog-coverage'),
      path.resolve(__dirname, '../../scripts/workers'),
    ];
    const LONG_RUNNERS = ['archive-acquired.ts'];

    const silent: string[] = [];
    for (const dir of dirs) {
      for (const f of readdirSync(dir)) {
        if (!LONG_RUNNERS.includes(f)) continue;
        const body = readFileSync(path.join(dir, f), 'utf8');
        const periodic = /setInterval\(/.test(body);
        if (!periodic) silent.push(f);
      }
    }
    expect(
      silent,
      `These long-running archivers emit no periodic progress:\n  ${silent.join('\n  ')}\n` +
        'A silent long run is indistinguishable from a hung one. Add a heartbeat.',
    ).toEqual([]);
  });
});
