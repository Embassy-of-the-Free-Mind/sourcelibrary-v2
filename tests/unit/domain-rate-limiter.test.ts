import { describe, it, expect } from 'vitest';
import { claimSlot, getDomainLimit, noteRateLimited, effectiveLimit, _agePenaltyClockForTest, DOMAIN_LIMITS } from '../../scripts/lib/iiif-utils.mjs';

/**
 * Guards the per-host rate limiter in scripts/lib/iiif-utils.mjs against the
 * defect that livelocked R2 archiving for a day (#4395, fixed in #4396).
 *
 * The old limiter counted requests inside a 1-second window and, when the
 * window was full, made each waiter sleep and then RESET the window. Under
 * concurrency that inverts the intent: N waiters all observe a full window,
 * all sleep the same interval, and all wake and fire together. Measured with
 * 60 in-flight callers against a nominal 5/s limit, it emitted 5 requests in
 * the first second and 55 in the next — an 11x burst. MDZ throttled a rate we
 * never intended to send, and because a 429 was then counted as a *block*, the
 * hourly archiver aborted, slept, and retried at the identical rate forever.
 *
 * This is a behavioural guard, not a line-presence one: it reproduces the
 * burst condition and asserts the emitted rate. Negative control performed
 * when written — restoring the reset-on-wake algorithm makes `holds the
 * configured rate under concurrency` fail with ~10x the limit, and removing
 * the penalty makes the 429 tests fail. Both go green again on restore.
 *
 * See .claude/docs/invariants/archive-fetch-failures.md and
 * .claude/docs/invariants/archive-coverage.md.
 */

/**
 * `claimSlot` is exported solely so these tests drive the REAL scheduler.
 *
 * An earlier draft of this file re-implemented the slot algebra locally, which
 * would have passed forever while production regressed — the exact
 * "documentation with a green checkmark" failure that
 * invariants/tests-that-are-not-guards.md warns about. Each test uses its own
 * hostname so the module-level per-host buckets cannot leak between them.
 */
describe('per-host rate limiter', () => {
  it('holds the configured rate under concurrency (the #4395 regression)', async () => {
    const LIMIT = 5;
    const CALLERS = 40;
    const HOST = 'concurrency-test.example.org';
    const t0 = Date.now();

    const stamps = await Promise.all(
      Array.from({ length: CALLERS }, async () => {
        await claimSlot(HOST, LIMIT);
        return Date.now();
      }),
    );

    // Bucket the emissions into whole seconds and take the worst one. The old
    // implementation put ~90% of callers into a single second; any correct one
    // keeps every second at or near the limit.
    const perSecond = new Map<number, number>();
    for (const s of stamps) {
      const sec = Math.floor((s - t0) / 1000);
      perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    }
    const worst = Math.max(...perSecond.values());

    // +1 tolerates a slot landing on a second boundary; it does NOT tolerate a
    // burst. The pre-fix code scored 55 here against a limit of 5.
    expect(worst).toBeLessThanOrEqual(LIMIT + 1);
  });

  it('spaces callers rather than releasing them together', async () => {
    // The burst signature was every waiter waking at the same instant. Distinct
    // slots mean distinct timestamps, so a correct scheduler spreads N callers
    // over roughly N/limit seconds instead of finishing them all at once.
    const HOST = 'spacing-test.example.org';
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 12 }, () => claimSlot(HOST, 4)));
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(2000); // 12 callers at 4/s ≈ 3s
  });
});

describe('429 handling', () => {
  const HOST = 'https://rate-limit-test.example.org/iiif/x/full/full/0/default.jpg';

  it('halves the effective rate per 429 and floors the slowdown', () => {
    const base = getDomainLimit(HOST);
    expect(effectiveLimit(HOST)).toBe(base);

    noteRateLimited(HOST, 1);
    expect(effectiveLimit(HOST)).toBe(base / 2);

    noteRateLimited(HOST);
    expect(effectiveLimit(HOST)).toBe(base / 4);

    // The floor exists so a throttled host converges on a slow rate rather
    // than an infinitely slow one.
    for (let i = 0; i < 12; i++) noteRateLimited(HOST);
    expect(effectiveLimit(HOST)).toBe(base / 16);
  });

  it('is a no-op on an unparseable URL rather than throwing', () => {
    expect(() => noteRateLimited('not a url')).not.toThrow();
  });
});

/**
 * The other half of a backoff: getting back up.
 *
 * #4396 fixed the burst but gave the limiter multiplicative DECREASE and no
 * increase — `penalty` doubled on every 429 and nothing lowered it. Four 429s
 * pinned a host at 1/16th of its rate for the life of the process, and the
 * archiver runs 50-minute batches, so one early burst crippled the whole run.
 * Measured on production 2026-09-03 before the fix: gallica granted 3.27 req/s
 * healthy, 0.29 req/s after four 429s, and was still at 0.41 req/s afterwards
 * with no path back. The hourly archiver logged a flat 0.08 pages/s and
 * `books 0/240` against a 12,561-book backlog (#4588).
 *
 * Negative control performed when written: deleting the `decayPenalty` call in
 * `claimSlot` makes `recovers ... after a quiet period` fail with the penalty
 * still at 16, and it goes green again on restore.
 */
describe('per-host rate limiter recovery', () => {
  it('recovers toward the configured rate after a quiet period', () => {
    const URL_ = 'https://recovery-test.example.org/x';
    for (let i = 0; i < 5; i++) noteRateLimited(URL_, undefined);
    const configured = getDomainLimit(URL_);

    // Pinned at the floor immediately after the burst.
    expect(effectiveLimit(URL_)).toBeCloseTo(configured / 16, 5);

    // One quiet minute halves it; four quiet minutes are most of the way back.
    _agePenaltyClockForTest(URL_, 60_000);
    expect(effectiveLimit(URL_)).toBeCloseTo(configured / 8, 5);

    _agePenaltyClockForTest(URL_, 3 * 60_000);
    expect(effectiveLimit(URL_)).toBeCloseTo(configured, 5);
  });

  it('never recovers past the configured rate', () => {
    const URL_ = 'https://recovery-ceiling.example.org/x';
    noteRateLimited(URL_, undefined);
    _agePenaltyClockForTest(URL_, 60 * 60_000); // an hour of quiet
    expect(effectiveLimit(URL_)).toBe(getDomainLimit(URL_));
  });

  it('grants the recovered rate to the REAL scheduler, not just the reporter', async () => {
    // The first draft of these tests asserted only through effectiveLimit(),
    // which decays on its own — so every one of them passed with the decay
    // deleted from claimSlot, the function that actually paces the archiver.
    // A guard that green-lights the broken build is worse than no guard
    // (invariants/tests-that-are-not-guards.md). This drives claimSlot and
    // times it.
    const HOST = 'recovery-scheduler.example.org';
    const LIMIT = 50; // 20ms spacing healthy, 320ms at 1/16 — a wide, fast gap

    for (let i = 0; i < 5; i++) noteRateLimited(`https://${HOST}/x`, undefined);
    _agePenaltyClockForTest(`https://${HOST}/x`, 5 * 60_000); // 5 quiet minutes

    // Drain the 429 cooldown, which parks nextSlot ~5s out regardless of rate.
    await claimSlot(HOST, LIMIT);

    const t0 = Date.now();
    for (let i = 0; i < 10; i++) await claimSlot(HOST, LIMIT);
    const elapsed = Date.now() - t0;

    // Recovered: 10 x 20ms = ~200ms. Still pinned at 1/16: 10 x 320ms = ~3.2s.
    expect(elapsed).toBeLessThan(1500);
  });

  it('backs off faster than it recovers', () => {
    // The asymmetry is the safety property: the other party is a library that
    // can block us outright, so we must fall fast and climb slowly. One 429
    // halves the rate instantly; undoing it costs a full quiet minute.
    const URL_ = 'https://asymmetry-test.example.org/x';
    const configured = getDomainLimit(URL_);

    noteRateLimited(URL_, undefined);
    expect(effectiveLimit(URL_)).toBeCloseTo(configured / 2, 5);

    _agePenaltyClockForTest(URL_, 59_000); // just under the half-life
    expect(effectiveLimit(URL_)).toBeCloseTo(configured / 2, 5);

    _agePenaltyClockForTest(URL_, 2_000); // now over it
    expect(effectiveLimit(URL_)).toBeCloseTo(configured, 5);
  });
});

describe('DOMAIN_LIMITS', () => {
  it('keeps every configured host at a polite rate', () => {
    // Three institutions blocked us inside 48 hours in August 2026. Nothing in
    // this table should creep upward without evidence from a clean run; 15/s
    // (images.eap.bl.uk, behind CloudFront) is the deliberate ceiling.
    for (const [host, limit] of Object.entries(DOMAIN_LIMITS)) {
      expect(limit, `${host} rate`).toBeGreaterThan(0);
      expect(limit, `${host} rate`).toBeLessThanOrEqual(15);
    }
  });

  it('keeps MDZ at the rate we are re-earning tolerance at (#4395)', () => {
    // Raise this only on evidence from a clean run — not by assumption. MDZ is
    // 73-100% of the outstanding fetch gap, so it is the most consequential
    // number in the archiver.
    expect(DOMAIN_LIMITS['api.digitale-sammlungen.de']).toBeLessThanOrEqual(5);
  });
});
