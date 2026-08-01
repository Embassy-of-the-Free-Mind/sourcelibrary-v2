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

  it('treats a provider block as transient — 403 is not "page absent"', () => {
    // 93.5% of the 14,123 production markers. Getting this wrong strands them all.
    const r = classifyArchiveFailure('failed:HTTP 403');
    expect(r.isMarker).toBe(true);
    expect(r.class).toBe(FAILURE_CLASS.TRANSIENT);
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

  it('collapses digits in the reporting key so counts aggregate', () => {
    expect(failureReasonKey('failed:source-not-found (gallica has only 45 pages)'))
      .toBe(failureReasonKey('failed:source-not-found (gallica has only 912 pages)'));
  });
});
