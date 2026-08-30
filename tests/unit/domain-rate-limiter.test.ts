import { describe, it, expect } from 'vitest';
import { claimSlot, getDomainLimit, noteRateLimited, effectiveLimit, DOMAIN_LIMITS } from '../../scripts/lib/iiif-utils.mjs';

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
