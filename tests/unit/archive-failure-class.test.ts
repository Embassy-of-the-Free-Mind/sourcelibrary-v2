/**
 * Classification of page-level `archived_photo: "failed:…"` markers.
 *
 * The stakes are asymmetric, and the tests are written around that:
 *  - Clearing a PERMANENT marker (404 / source-not-found) re-queues work that
 *    fails again and re-marks — a loop that burns provider goodwill.
 *  - Leaving a TRANSIENT marker (403 / timeout / truncated transfer) strands a
 *    page that is still there, forever, because every archiver selects on the
 *    field being empty.
 *  - An UNRECOGNISED reason must be left alone. Defaulting unknown→transient
 *    would silently re-queue the next novel permanent failure en masse.
 *
 * These assert behaviour on real marker strings observed in production, not the
 * shape of the source.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { classifyArchiveFailure, failureReasonKey, FAILURE_CLASS } from '../../scripts/lib/archive-failure-class.mjs';

describe('classifyArchiveFailure', () => {
  it('ignores values that are not markers', () => {
    for (const v of [
      'https://images.sourcelibrary.org/archived/abc/1.jpg',
      '', null, undefined, 42,
    ]) {
      expect(classifyArchiveFailure(v as string).isMarker).toBe(false);
    }
  });

  it('does NOT auto-clear 403 — on this corpus it is in-copyright material', () => {
    // 8,583 of 9,767 clearable markers were Internet Archive, and a sample
    // resolved to `naghammadilibrar00jame` (Robinson, Nag Hammadi Library in
    // English, 1981) which IA reports as access-restricted-item: true. That 403
    // is IA correctly refusing to serve a copyrighted book. Clearing it
    // re-queues a fetch that must never succeed.
    const r = classifyArchiveFailure('failed:HTTP 403');
    expect(r.isMarker).toBe(true);
    expect(r.class).toBe(FAILURE_CLASS.UNKNOWN);
    expect(r.class).not.toBe(FAILURE_CLASS.TRANSIENT);
  });

  it('allows 403 to be cleared only via explicit opt-in', () => {
    // Genuine rate-limit 403s exist, so the capability is preserved — but the
    // caller must assert they checked the population.
    expect(classifyArchiveFailure('failed:HTTP 403', { include403: true }).class)
      .toBe(FAILURE_CLASS.TRANSIENT);
  });

  it('keeps a 403 out of the sweep even when the reason also names a timeout', () => {
    // Rights-sensitive must beat transient, or a compound message smuggles a
    // refusal in through the timeout pattern.
    expect(classifyArchiveFailure('failed:HTTP 403 after timeout').class)
      .toBe(FAILURE_CLASS.UNKNOWN);
  });

  it('treats broken transfers as transient', () => {
    for (const s of [
      'failed:timeout',
      'failed:terminated',
      'failed:This operation was aborted',
      'failed:fetch aborted: stalled — no data for 60s (https://example/x.jpg)',
      'failed:VipsJpeg: premature end of JPEG image',
      'failed:fetch failed',
      'failed:ECONNRESET',
      'failed:HTTP 503',
      'failed:HTTP 429',
    ]) {
      expect(classifyArchiveFailure(s).class, s).toBe(FAILURE_CLASS.TRANSIENT);
    }
  });

  it('treats absence as permanent — these must never be cleared', () => {
    for (const s of [
      'failed:HTTP 404',
      'failed:HTTP 410',
      'failed:HTTP 401',
      'failed:source-not-found (gallica has only 45 pages, DB stub claims 100)',
    ]) {
      expect(classifyArchiveFailure(s).class, s).toBe(FAILURE_CLASS.PERMANENT);
    }
  });

  it('classifies an unrecognised reason as unknown, never transient', () => {
    // The default must not be "recoverable" — that would mass-re-queue the next
    // novel permanent failure the moment it appears.
    const r = classifyArchiveFailure('failed:some brand new error nobody has seen');
    expect(r.class).toBe(FAILURE_CLASS.UNKNOWN);
    expect(r.class).not.toBe(FAILURE_CLASS.TRANSIENT);
  });

  it('lets permanent win when a reason names both', () => {
    // "timed out waiting, then HTTP 404" must not be retried on the timeout.
    expect(classifyArchiveFailure('failed:timeout then HTTP 404').class)
      .toBe(FAILURE_CLASS.PERMANENT);
  });

  it('collapses incidental digits in the reporting key so counts aggregate', () => {
    expect(failureReasonKey('failed:source-not-found (gallica has only 45 pages)'))
      .toBe(failureReasonKey('failed:source-not-found (gallica has only 912 pages)'));
  });

  it('does NOT collapse HTTP status codes — 403 vs 404 is the whole decision', () => {
    // Collapsing every digit printed "2438  HTTP N" in the dry-run report,
    // merging retryable 403s with permanent 404s in the exact output an
    // operator reads before running --apply.
    expect(failureReasonKey('failed:HTTP 403')).toBe('HTTP 403');
    expect(failureReasonKey('failed:HTTP 404')).toBe('HTTP 404');
    expect(failureReasonKey('failed:HTTP 403'))
      .not.toBe(failureReasonKey('failed:HTTP 404'));
  });

  it('preserves the status code while still collapsing surrounding noise', () => {
    expect(failureReasonKey('failed:HTTP 403 after 5 attempts on page 214'))
      .toBe(failureReasonKey('failed:HTTP 403 after 9 attempts on page 7'));
    expect(failureReasonKey('failed:HTTP 403 after 5 attempts on page 214'))
      .toContain('HTTP 403');
  });
});
