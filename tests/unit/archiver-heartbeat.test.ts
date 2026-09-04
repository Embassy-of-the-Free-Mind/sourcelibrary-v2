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

/**
 * The archiver must schedule its work as a POOL, not as fixed slices.
 *
 * ## What broke
 *
 * Both loops in `archive-acquired.ts` were `for (i += N) { await
 * Promise.all(slice) }`. A slice does not advance until its slowest member
 * finishes, and the members that finished early sit idle in the meantime — so
 * the run's effective width decays to one for as long as the slowest item
 * takes.
 *
 * Measured on the pipeline box 2026-09-04 (#4588): a 50-minute run archived 53
 * pages/min for four minutes, completed its one healthy book, and then held the
 * remaining seven slots for 45 minutes on books whose hosts returned an error
 * to every single request — at a flat 5 pages/min — while 7,559 books on a host
 * serving 100% of requests in 0.3s waited unreached in the same 240-row batch.
 * `books 0/240`, every hour, for days.
 *
 * ## What this test is, honestly
 *
 * A re-deletion guard, not a proof of behaviour. `archive-acquired.ts` opens a
 * Mongo connection and an R2 client at import, so it cannot be exercised in a
 * unit test; the real behavioural coverage for the pieces that COULD be
 * extracted is in host-breaker.test.ts. What this pins is that the barrier does
 * not come back — which is not hypothetical for this file: the heartbeat above
 * was added and silently deleted the same day by a concurrent PR that predated
 * it, and nothing failed (see the header). A grep-shaped test still runs in
 * that PR's CI, which is the whole point.
 */
describe('archive-acquired schedules with a pool, not a barrier', () => {
  const src = readFileSync(ARCHIVER, 'utf8');

  it('has no fixed-slice Promise.all over a work list', () => {
    // `for (...; i += N) await Promise.all(list.slice(i, i + N)...)` is the
    // shape. Either loop coming back reintroduces the 45-minute stall.
    expect(src, 'a sliced Promise.all is a barrier: the slice waits for its slowest member')
      .not.toMatch(/await Promise\.all\(\s*\w+\.slice\(/);
    expect(src, 'sliced chunk loop over pages or books').not.toMatch(/for \(let i = 0; i < \w+\.length; i \+= /);
  });

  it('drives both levels from a shared cursor, so a finished slot is refilled', () => {
    // A pool is: a shared index, workers that loop until it runs out, and
    // exactly `width` of them started at once.
    expect(src, 'no book-level worker pool').toMatch(/const bookWorker = async/);
    expect(src, 'workers must pull from a shared cursor, not own a fixed slice').toMatch(/todo\[nextBook\+\+\]/);
    expect(src, 'no page-level worker pool').toMatch(/ps\[next\+\+\]/);
    expect(src, 'pool width must come from the concurrency settings')
      .toMatch(/Array\.from\(\{ length: Math\.min\(CONCURRENCY/);
    expect(src).toMatch(/Array\.from\(\{ length: Math\.min\(PAGE_CONCURRENCY/);
  });

  it('parses its width flags safely, and refuses to start on a bad one', () => {
    // This is the case the grep assertions above did NOT catch, and it shipped
    // to a live measurement run before being caught by actually running it.
    //
    // `parseInt(argv[argv.indexOf('--x') + 1] || 'N')` reads argv[0] — the node
    // binary path — when the flag is absent, so the value is NaN and the `|| 'N'`
    // default never fires. `Array.from({length: NaN})` is an EMPTY array, so the
    // pool started zero workers: 24 books "processed" in one second, nothing
    // fetched, and the run reported `complete 2, partial 22`.
    //
    // A width is load-bearing, so the guard is a throw at startup rather than a
    // comment. Negative control: restoring the old idiom for any one flag turns
    // the first assertion red.
    expect(src, 'the argv[indexOf+1] idiom reads argv[0] when the flag is absent')
      .not.toMatch(/parseInt\(process\.argv\[process\.argv\.indexOf/);
    expect(src, 'no safe int-arg reader').toMatch(/const intArg = /);
    expect(src, 'a bad width must abort the run, not run it empty')
      .toMatch(/refusing to start/);
  });

  it('prints its summary on SIGTERM, because SIGTERM is how every run ends', () => {
    // The cron wrapper always kills this run at its 50-minute ceiling. A summary
    // printed only on natural completion is a summary nobody ever sees — which
    // would have made the per-host table added in this PR unreachable in
    // production, the exact failure it was written to end.
    expect(src, 'no signal handler — the run summary dies with the process').toMatch(/process\.on\(sig/);
    expect(src, 'SIGTERM must be handled; it is the normal exit path here').toMatch(/SIGTERM/);
    expect(src, 'the summary must be callable from both paths').toMatch(/const printSummary = /);
    expect(src, 'the handler must emit the per-host table too').toMatch(/printSummary\(`stopped by/);
  });

  it('will not send to a host its breaker has paused', () => {
    // Without this the pool refills its slots and hands them straight back to
    // the host that emptied them.
    expect(src, 'the pool must consult the breaker before each page').toMatch(/breaker\.allow\(/);
    expect(src, 'a success must reopen the host').toMatch(/breaker\.success\(/);
    expect(src, 'the run must print per-host outcomes').toMatch(/breaker\.report\(\)/);
  });

  it('never drops a book from the queue that archived nothing', () => {
    // `archived: true` on a book with 0 pages on R2 removes it from the work
    // queue for good, with the truth demoted to a note nothing reads — a write
    // that erases its own repair path (CLAUDE.md, Data Protection). It was
    // unreachable only because the run was always killed at the 50-minute
    // ceiling first; fixing the throughput is what makes it reachable.
    expect(src, 'a partial book must be retried, not marked archived').toMatch(/archive_attempts/);
    expect(src, 'giving up must be recorded as giving up, not as success').toMatch(/archive_stalled/);
    expect(src, 'progress must be what decides whether to retry').toMatch(/r2 > have0/);
  });
});
