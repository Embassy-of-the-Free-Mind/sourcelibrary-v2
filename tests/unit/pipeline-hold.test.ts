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
import { holdViolation, isHeld, NOT_HELD, HOLD_STATUS, holdBook, makeHoldMarker, parseReleaseWhen, releaseWhenProblem, NOT_ACQUIRED_HOLD_REASONS, isNotAcquiredReason } from '../../scripts/lib/pipeline-hold.mjs';
// @ts-expect-error — scripts-side module, no types
import { holdAtInsert } from '../../scripts/iiif-discovery/lib/wave-import.mjs';
// @ts-expect-error — scripts-side module, no types
import { CLI_FLASH_OCR_HOLD } from '../../scripts/lib/ocr-routing.mjs';
// @ts-expect-error — scripts-side module, no types
import { CLI_TRANSLATE_HOLD } from '../../scripts/lib/translation-routing.mjs';
// @ts-expect-error — scripts-side module, no types
import { HOLD_RELEASE_WHEN as GPU_RW } from '../../scripts/lib/gpu-print-lane.mjs';
// @ts-expect-error — scripts-side module, no types
import { HOLD_RELEASE_WHEN as PADDLE_PRINT_RW } from '../../scripts/lib/paddle-print-lane.mjs';
// @ts-expect-error — scripts-side module, no types
import { HOLD_RELEASE_WHEN as PADDLE_ZH_RW } from '../../scripts/lib/paddle-zh-lane.mjs';
// @ts-expect-error — scripts-side module, no types
import { HOLD_RELEASE_WHEN as NDL_RW } from '../../scripts/lib/ndl-koten-lane.mjs';

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

/**
 * Every hold carries a release condition a detector can test (#7860). 1,535 books sat a month on
 * `*-awaits-derek` holds whose decisions were already made, because a `release` sentence is read by
 * nobody. These exercise the refusal itself: holdBook against a db that records every touch, and the
 * insert-time constructor the importers use.
 */
describe('pipeline hold: release_when is required (#7860)', () => {
  const touchingDb = () => {
    const calls: string[] = [];
    const coll = (name: string) => new Proxy({}, { get: (_t, op) => (...args: unknown[]) => {
      calls.push(`${name}.${String(op)}`);
      if (op === 'findOne') return Promise.resolve({ id: 'b1', title: 't', pipeline_auto: { status: 'ocr_complete' } });
      if (op === 'updateOne') { calls.push(JSON.stringify(args[1])); return Promise.resolve({ modifiedCount: 1 }); }
      return Promise.resolve({});
    } });
    return { calls, db: { collection: coll } };
  };
  const base = { reason: 'test-hold-7860', issue: 7860, release: 'a sentence' };

  it('holdBook refuses a hold with no release_when, before it reads or writes anything', async () => {
    const { calls, db } = touchingDb();
    await expect(holdBook(db, 'b1', base)).rejects.toThrow(/release_when/);
    await expect(holdBook(db, 'b1', base, { dryRun: true })).rejects.toThrow(/release_when/);
    expect(calls).toEqual([]);
  });
  it('holdBook refuses a malformed release_when', async () => {
    const { calls, db } = touchingDb();
    for (const rw of [{ kind: 'someday', ref: 'x' }, { kind: 'issue', ref: 'soon' }, { kind: 'issue', ref: 0 }, { kind: 'date', ref: 'next week' }, { kind: 'decision', ref: '  ' }, { kind: 'test' }, 'issue:7860']) {
      await expect(holdBook(db, 'b1', { ...base, release_when: rw }), JSON.stringify(rw)).rejects.toThrow(/release_when/);
    }
    expect(calls).toEqual([]);
  });
  it('holdBook stores the condition on the marker, the note defaulting to the release sentence', async () => {
    const { calls, db } = touchingDb();
    const r = await holdBook(db, 'b1', { ...base, release_when: { kind: 'issue', ref: 7860 } });
    expect(r.outcome).toBe('held');
    const set = JSON.parse(calls.find((c) => c.startsWith('{"$set"'))!).$set;
    expect(set['pipeline_auto.hold'].release_when).toEqual({ kind: 'issue', ref: 7860, note: 'a sentence' });
    expect(set['pipeline_auto.status']).toBe('held');
  });
  it('the insert-time constructor refuses too (wave-import, warehouse promotion)', () => {
    expect(() => makeHoldMarker(base)).toThrow(/release_when/);
    expect(() => holdAtInsert(base, new Date())).toThrow(/release_when/);
    expect(holdAtInsert({ ...base, release_when: { kind: 'date', ref: '2026-12-01', note: 'n' } }, new Date()).hold.release_when).toEqual({ kind: 'date', ref: '2026-12-01', note: 'n' });
  });
  it('the CLI form parses into a condition holdBook accepts', () => {
    expect(makeHoldMarker({ ...base, release_when: parseReleaseWhen('issue:#7343') }).release_when.ref).toBe(7343);
    expect(makeHoldMarker({ ...base, release_when: parseReleaseWhen('decision:syriac re-translation') }).release_when).toMatchObject({ kind: 'decision', ref: 'syriac re-translation' });
    expect(parseReleaseWhen(undefined)).toBeUndefined();
    expect(() => makeHoldMarker({ ...base, release_when: parseReleaseWhen('7343') })).toThrow(/release_when/);
  });
  it('the shared hold constants the orchestrator and lanes use all carry a valid condition', () => {
    for (const [name, h] of Object.entries({ CLI_FLASH_OCR_HOLD, CLI_TRANSLATE_HOLD })) expect(() => makeHoldMarker(h), name).not.toThrow();
    for (const [name, rw] of Object.entries({ gpu: GPU_RW, paddlePrint: PADDLE_PRINT_RW, paddleZh: PADDLE_ZH_RW, ndl: NDL_RW })) expect(releaseWhenProblem(rw), name).toBeNull();
  });
  it('group 1 (not acquired) is named once, and is not a decision', () => {
    expect(NOT_ACQUIRED_HOLD_REASONS).toEqual(['manifest-only-lazy-pages', 'acquisition-wave-2026-10b']);
    expect(isNotAcquiredReason('tibetan-retranslation-awaits-derek')).toBe(false);
  });
});
