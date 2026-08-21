/**
 * Pins the pure logic of the semantic monitoring surface (#3756 §B):
 *
 *  - finalizeMeasurement: a failed positive control must yield
 *    status:'probe_broken' with covered:null — a broken probe and an empty
 *    pipeline must never look the same (the probe-needs-a-positive-control
 *    lesson: "not found" is worthless until the probe returned "found").
 *  - computeStageDeltas: deltas only exist between two OK measurements;
 *    a broken side yields null, never a fabricated 0.
 *  - findStalled: the I54 "quietly stops advancing" detector — queue_depth>0
 *    and delta===0. null deltas and broken probes are excluded: null is not
 *    zero, and flagging a broken probe as "stalled" would misdirect triage.
 *  - parseContentRangeCount: the Supabase REST count parser.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { finalizeMeasurement, computeStageDeltas, findStalled, parseContentRangeCount } from '../../scripts/lib/stage-coverage.mjs';

type Stage = {
  stage: string;
  status: 'ok' | 'probe_broken';
  covered: number | null;
  total: number | null;
  queue_depth: number | null;
  delta?: number | null;
  detail?: Record<string, unknown>;
};

const ok = (stage: string, covered: number, total: number, queue = 0): Stage => ({
  stage, status: 'ok', covered, total, queue_depth: queue,
});

describe('finalizeMeasurement (positive-control behavior)', () => {
  it('passes counts through when the control found a known-present case', () => {
    const m = finalizeMeasurement({ stage: 'ocr', covered: 100, total: 200, queue_depth: 100 }, true);
    expect(m).toEqual({ stage: 'ocr', status: 'ok', covered: 100, total: 200, queue_depth: 100 });
  });

  it('reports probe_broken with covered:null when the control fails — NEVER 0 coverage', () => {
    const m = finalizeMeasurement({ stage: 'ocr', covered: 0, total: 200, queue_depth: 200 }, false);
    expect(m.status).toBe('probe_broken');
    expect(m.covered).toBeNull(); // not 0 — that's the whole point
    expect(m.queue_depth).toBeNull();
    expect(m.total).toBe(200); // the denominator is still informative
  });

  it('keeps detail on a broken measurement (it carries the diagnosis)', () => {
    const m = finalizeMeasurement({ stage: 'embeddings', detail: { book_embeddings: null } }, false);
    expect(m.status).toBe('probe_broken');
    expect(m.detail).toEqual({ book_embeddings: null });
  });
});

describe('computeStageDeltas', () => {
  it('computes covered deltas per stage against the previous snapshot', () => {
    const current = [ok('ocr', 110, 200, 90), ok('translated', 50, 200, 150)];
    const previous = [ok('ocr', 100, 200, 100), ok('translated', 50, 200, 150)];
    const out = computeStageDeltas(current, previous);
    expect(out.find((s: Stage) => s.stage === 'ocr')!.delta).toBe(10);
    expect(out.find((s: Stage) => s.stage === 'translated')!.delta).toBe(0);
  });

  it('yields null when the stage is missing from the previous snapshot', () => {
    const out = computeStageDeltas([ok('images', 5, 10, 5)], [ok('ocr', 1, 2)]);
    expect(out[0].delta).toBeNull();
  });

  it('yields null (not 0) when either side is probe_broken', () => {
    const brokenNow: Stage = { stage: 'ocr', status: 'probe_broken', covered: null, total: 200, queue_depth: null };
    const out1 = computeStageDeltas([brokenNow], [ok('ocr', 100, 200)]);
    expect(out1[0].delta).toBeNull();

    const brokenPrev: Stage = { stage: 'ocr', status: 'probe_broken', covered: null, total: 200, queue_depth: null };
    const out2 = computeStageDeltas([ok('ocr', 100, 200)], [brokenPrev]);
    expect(out2[0].delta).toBeNull();
  });

  it('handles a missing previous snapshot entirely (first run)', () => {
    const out = computeStageDeltas([ok('ocr', 100, 200)], undefined);
    expect(out[0].delta).toBeNull();
  });

  it('can go negative — a regression is a signal, not an error', () => {
    const out = computeStageDeltas([ok('summaries', 90, 100, 10)], [ok('summaries', 95, 100, 5)]);
    expect(out[0].delta).toBe(-5);
  });
});

describe('findStalled (queue nonempty, coverage not advancing)', () => {
  it('flags a stage with work waiting and zero delta', () => {
    const stages = [{ ...ok('translated', 50, 200, 150), delta: 0 }];
    expect(findStalled(stages)).toEqual(['translated']);
  });

  it('does not flag a stage that advanced', () => {
    const stages = [{ ...ok('translated', 60, 200, 140), delta: 10 }];
    expect(findStalled(stages)).toEqual([]);
  });

  it('does not flag an empty queue — done is not stalled', () => {
    const stages = [{ ...ok('identity', 200, 200, 0), delta: 0 }];
    expect(findStalled(stages)).toEqual([]);
  });

  it('does not flag a null delta (first run / missing baseline) — null is not zero', () => {
    const stages = [{ ...ok('translated', 50, 200, 150), delta: null }];
    expect(findStalled(stages)).toEqual([]);
  });

  it('excludes probe_broken stages — a broken probe is its own alarm', () => {
    const stages = [
      { stage: 'ocr', status: 'probe_broken' as const, covered: null, total: 200, queue_depth: null, delta: null },
      { ...ok('chapters', 10, 100, 90), delta: 0 },
    ];
    expect(findStalled(stages)).toEqual(['chapters']);
  });

  it('flags a regression whose queue is nonempty only when delta is exactly 0', () => {
    // A negative delta is a REGRESSION — reported via the delta itself, not
    // the stalled list (stalled means "quietly stopped", not "went backwards").
    const stages = [{ ...ok('summaries', 90, 100, 10), delta: -5 }];
    expect(findStalled(stages)).toEqual([]);
  });
});

describe('parseContentRangeCount', () => {
  it('parses the standard PostgREST shapes', () => {
    expect(parseContentRangeCount('0-0/36079')).toBe(36079);
    expect(parseContentRangeCount('*/4420000')).toBe(4420000);
    expect(parseContentRangeCount('0-24/205000')).toBe(205000);
  });

  it('returns null for garbage, missing headers, and unknown totals', () => {
    expect(parseContentRangeCount(null)).toBeNull();
    expect(parseContentRangeCount(undefined)).toBeNull();
    expect(parseContentRangeCount('')).toBeNull();
    expect(parseContentRangeCount('0-24/*')).toBeNull(); // count not computed
    expect(parseContentRangeCount('bytes 0-99/100x')).toBeNull();
  });
});
