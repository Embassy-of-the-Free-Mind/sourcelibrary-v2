/**
 * The pipeline hold, pinned (#4790).
 *
 * A hold is a status every worker already skips by selection, plus a marker the status WRITERS
 * consult. The two ways to get the writer side wrong are both silent: refuse too little and a
 * rollback lifts the hold (the book re-enters a lane while "held on paper"); refuse too much and
 * the hold can never be re-asserted or released. So the boundary is asserted here rather than
 * assumed: a held book accepts `held` and nothing else; an unheld book is never refused.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — scripts-side module, no types
import { holdViolation, isHeld, NOT_HELD, HOLD_STATUS } from '../../scripts/lib/pipeline-hold.mjs';

const held = { id: 'b1', pipeline_auto: { status: 'held', hold: { reason: 'ia-wrong-leaf-4790', issue: 4790, held_at: new Date('2026-09-13T20:00:00Z'), held_from_status: 'ocr_complete', release: 'x' } } };
const free = { id: 'b2', pipeline_auto: { status: 'ocr_complete' } };

describe('pipeline hold', () => {
  it('a held book refuses every status but held', () => {
    for (const s of ['ocr_complete', 'translate_submitted', 'archive_complete', 'complete', 'failed', 'needs_attention']) {
      expect(holdViolation(held, s), s).toMatch(/held \(ia-wrong-leaf-4790 #4790/);
    }
    expect(holdViolation(held, HOLD_STATUS)).toBeNull();
  });
  it('an unheld book is never refused — the status alone is not a hold', () => {
    expect(holdViolation(free, 'held')).toBeNull();
    expect(holdViolation(free, 'ocr_complete')).toBeNull();
    expect(holdViolation({ id: 'b3', pipeline_auto: { status: 'held' } }, 'ocr_complete')).toBeNull(); // orphaned: the audit's job, not the writer's
    expect(holdViolation(undefined, 'ocr_complete')).toBeNull();
    expect(isHeld(free)).toBe(false);
    expect(isHeld(held)).toBe(true);
  });
  it('NOT_HELD is a filter on the marker, so a direct updateOne cannot match a held book', () => {
    expect(NOT_HELD).toEqual({ 'pipeline_auto.hold': { $exists: false } });
  });
});
