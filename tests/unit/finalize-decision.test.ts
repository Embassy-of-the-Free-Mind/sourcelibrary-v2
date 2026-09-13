/**
 * The regression this pins: a 250-page book with the 25-page preview pass done
 * sat at exactly 10% coverage, cleared Phase 9's `< 0.1 → needs_attention` floor,
 * and was stamped `complete` — after which the OCR queue (which reads only
 * `archive_complete`) never looked at it again. 13,329 books are in that state,
 * holding 1.55M pages that were never transcribed.
 *
 * The first test is the exact shape of that book. If someone reintroduces a
 * percentage floor instead of a completion bar, it fails.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { decideFinalize, COMPLETE_AT, REQUEUE_BELOW, MAX_STALLED_REQUEUES } from '../../scripts/lib/finalize-decision.mjs';

describe('decideFinalize — the preview stall', () => {
  it('does NOT complete a 250-page book with only the 25-page preview', () => {
    const d = decideFinalize({ totalPages: 250, ocrCount: 25 });
    expect(d.action).toBe('requeue');
    expect(d.reason).toMatch(/unfinished/i);
  });

  it('requeues to the state the OCR queue actually reads, not to limbo', () => {
    // Guard on the decision, not the caller: 'requeue' is meaningless unless the
    // orchestrator maps it to `archive_complete`, which the caller test covers.
    expect(decideFinalize({ totalPages: 500, ocrCount: 25 }).action).toBe('requeue');
    expect(decideFinalize({ totalPages: 60, ocrCount: 25 }).action).toBe('requeue');
  });

  it('completes a genuinely finished book', () => {
    expect(decideFinalize({ totalPages: 250, ocrCount: 250 }).action).toBe('complete');
    expect(decideFinalize({ totalPages: 250, ocrCount: 226 }).action).toBe('complete'); // 90.4%
  });

  it('leaves the near-complete band alone rather than churning it', () => {
    // 60-90%: pages that will never transcribe (damage, blanks, RECITATION).
    // Requeuing these forever would park thousands of books that are as done as
    // they will ever be — the gap between the thresholds is deliberate.
    expect(decideFinalize({ totalPages: 100, ocrCount: 70 }).action).toBe('complete');
    expect(decideFinalize({ totalPages: 100, ocrCount: 55 }).action).toBe('complete');
  });

  it('keeps the thresholds apart — a single bar would either churn or stall', () => {
    expect(COMPLETE_AT).toBeGreaterThan(REQUEUE_BELOW);
  });
});

describe('decideFinalize — the requeue must terminate', () => {
  it('keeps requeuing while OCR is still growing', () => {
    const d = decideFinalize({ totalPages: 500, ocrCount: 120, requeues: 5, lastOcrCount: 25 });
    expect(d.action).toBe('requeue');
  });

  it('parks a book whose requeues add no pages', () => {
    const d = decideFinalize({ totalPages: 500, ocrCount: 25, requeues: MAX_STALLED_REQUEUES, lastOcrCount: 25 });
    expect(d.action).toBe('needs_attention');
    expect(d.reason).toMatch(/stalled/i);
  });

  it('does not park on the first no-progress cycle', () => {
    const d = decideFinalize({ totalPages: 500, ocrCount: 25, requeues: 0, lastOcrCount: 25 });
    expect(d.action).toBe('requeue');
  });
});

describe('decideFinalize — the cases that must not regress', () => {
  it('finalizes a 0-page artwork instead of flagging a failed import', () => {
    expect(decideFinalize({ totalPages: 0, ocrCount: 0, contentType: 'artwork' }).action).toBe('complete');
  });

  it('still flags an empty book', () => {
    expect(decideFinalize({ totalPages: 0, ocrCount: 0 }).action).toBe('needs_attention');
  });

  it('still flags a book with no OCR at all', () => {
    const d = decideFinalize({ totalPages: 300, ocrCount: 0 });
    expect(d.action).toBe('needs_attention');
    expect(d.reason).toMatch(/0\/300/);
  });

  it('reports the real numbers in every reason, so the log is diagnosable', () => {
    expect(decideFinalize({ totalPages: 250, ocrCount: 25 }).reason).toContain('25/250');
    expect(decideFinalize({ totalPages: 250, ocrCount: 250 }).reason).toContain('250/250');
  });
});
