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
 *  - page stages (#4708): summed per-book counters, trusted only while an
 *    exact recount of random books agrees with them — drift beyond the
 *    tolerance is probe_broken, never coverage.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { finalizeMeasurement, computeStageDeltas, findStalled, parseContentRangeCount, compareCounters, pageStagesFromCounters } from '../../scripts/lib/stage-coverage.mjs';

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

describe('page stages from verified counters (#4708)', () => {
  const c = (pages_count: number, pages_ocr = 0, pages_translated = 0, pages_blank = 0, pages_archived = 0) =>
    ({ pages_count, pages_ocr, pages_translated, pages_blank, pages_archived });
  const agree = (id: string) => ({ id, stored: c(10, 5, 2), actual: c(10, 5, 2) });

  it('compareCounters: agreement passes, any differing counter is drift', () => {
    expect(compareCounters([agree('a'), agree('b')])).toMatchObject({ checked: 2, drifted: 0, ok: true });
    const r = compareCounters([agree('a'), { id: 'b', stored: c(10, 5, 2), actual: c(10, 6, 2) }]);
    expect(r).toMatchObject({ checked: 2, drifted: 1, ok: false, examples: ['b'] });
  });

  it('compareCounters: tolerates up to 5% drifted books (pipeline writes race the recount)', () => {
    const rows = Array.from({ length: 100 }, (_, i) => agree(String(i)));
    for (let i = 0; i < 5; i++) rows[i] = { id: String(i), stored: c(10), actual: c(11) };
    expect(compareCounters(rows).ok).toBe(true);
    rows[5] = { id: '5', stored: c(10), actual: c(11) };
    expect(compareCounters(rows).ok).toBe(false);
  });

  it('compareCounters: nothing checked is a broken probe, not a pass', () => {
    expect(compareCounters([]).ok).toBe(false);
  });

  it('pageStagesFromCounters: covered/total/queue per stage; blank leaves out of both translated sides', () => {
    const check = { checked: 100, drifted: 1, ok: true, examples: ['x'] };
    const [archived, ocr, translated] = pageStagesFromCounters(c(1000, 700, 400, 100, 950), check);
    expect(archived).toMatchObject({ stage: 'archived', status: 'ok', covered: 950, total: 1000, queue_depth: 50 });
    expect(ocr).toMatchObject({ stage: 'ocr', status: 'ok', covered: 700, total: 1000, queue_depth: 300 });
    expect(translated).toMatchObject({ stage: 'translated', status: 'ok', covered: 400, total: 900, queue_depth: 500 });
    expect(ocr.detail).toEqual({ counters_checked: 100, counters_drifted: 1 });
  });

  it('pageStagesFromCounters: counters that fail the recount are probe_broken, never coverage', () => {
    const check = { checked: 100, drifted: 30, ok: false, examples: ['a', 'b'] };
    const stages = pageStagesFromCounters(c(1000, 700, 400, 100, 950), check);
    for (const s of stages) {
      expect(s.status).toBe('probe_broken');
      expect(s.covered).toBeNull();
      expect(s.detail).toMatchObject({ counters_drifted: 30, drift_examples: 'a,b' });
    }
  });
});
