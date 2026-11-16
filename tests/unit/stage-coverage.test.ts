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
import fs from 'node:fs';
// @ts-expect-error — plain .mjs helper, no types
import { measureImages, measureIdentity, thumbnailerTakes, identityQueueMatch, THUMBNAILER_SOURCES, THUMBNAILER_MIN_QUALITY, MINTER_RETRY_DAYS } from '../../scripts/lib/stage-coverage.mjs';
// @ts-expect-error — plain .mjs helper, no types
import { finalizeMeasurement, computeStageDeltas, findStalled, parseContentRangeCount, compareCounters, pageStagesFromCounters, buildCounterSamplePipeline, buildAlertPushes, formatSummaryLine } from '../../scripts/lib/stage-coverage.mjs';

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

describe('page stages: positive control — the probe can report both moving and stalled (#359)', () => {
  const check = { checked: 100, drifted: 0, ok: true, examples: [] };
  const sums = (archived: number, ocr: number, translated: number) =>
    ({ pages_count: 1000, pages_ocr: ocr, pages_translated: translated, pages_blank: 0, pages_archived: archived });

  it('a stage whose counters advanced is moving, not stalled', () => {
    const prev = pageStagesFromCounters(sums(500, 300, 100), check);
    const now = computeStageDeltas(pageStagesFromCounters(sums(510, 320, 101), check), prev);
    expect(now.map((s: Stage) => s.delta)).toEqual([10, 20, 1]);
    expect(findStalled(now)).toEqual([]);
  });

  it('a stage whose counters did not move with work waiting is stalled', () => {
    const prev = pageStagesFromCounters(sums(500, 300, 100), check);
    const now = computeStageDeltas(pageStagesFromCounters(sums(500, 320, 100), check), prev);
    expect(findStalled(now)).toEqual(['archived', 'translated']);
  });
});

describe('counter-check sample (#359)', () => {
  it('$sample is the FIRST stage, so Mongo uses the random cursor instead of fetching every book', () => {
    const p = buildCounterSamplePipeline(100);
    expect(Object.keys(p[0])).toEqual(['$sample']);
    expect(p[0].$sample.size).toBeGreaterThanOrEqual(100);
    expect(p.findIndex((s: object) => '$match' in s)).toBeGreaterThan(0);
    expect(p.find((s: object) => '$limit' in s)).toEqual({ $limit: 100 });
  });
});

describe('reporting keeps the instrument apart from the pipeline (#359)', () => {
  const brokenErr = (stage: string) => ({
    stage, status: 'probe_broken', covered: null, total: null, queue_depth: null, delta: null,
    detail: { error: 'Executor error during aggregate command on namespace: bookstore.books :: caused by :: operation exceeded time limit' },
  });
  const ok = (stage: string, covered: number, total: number) =>
    ({ stage, status: 'ok', covered, total, queue_depth: total - covered, delta: 0 });
  const stages = [brokenErr('archived'), brokenErr('ocr'), ok('images', 99, 100)];

  it('broken probes and stalls go out as two pushes, never one count', () => {
    const pushes = buildAlertPushes({ stages, stalled: ['images'], collectorAgeHours: 0.5, agingUncollected: 0 });
    expect(pushes).toHaveLength(2);
    expect(pushes[0].title).toBe('Pipeline line: 1 pipeline issue(s)');
    expect(pushes[0].body).toContain('STALLED');
    expect(pushes[0].body).not.toMatch(/archived|ocr/);
    expect(pushes[1].title).toBe('Pipeline line INSTRUMENT broken: archived, ocr');
    expect(pushes[1].body).toContain('NOT a stalled stage');
    expect(pushes[1].body).toContain('archived,ocr: operation exceeded time limit');
    expect(pushes[1].body).not.toContain('images');
  });

  it('only a broken probe: no pipeline push', () => {
    const pushes = buildAlertPushes({ stages, stalled: [], collectorAgeHours: 0.5, agingUncollected: 0 });
    expect(pushes.map((p: { title: string }) => p.title)).toEqual(['Pipeline line INSTRUMENT broken: archived, ocr']);
  });

  it('a drifted counter check names the drift, not a timeout', () => {
    const drifted = { ...brokenErr('ocr'), detail: { counters_checked: 100, counters_drifted: 30 } };
    const [push] = buildAlertPushes({ stages: [drifted], stalled: [], collectorAgeHours: 0, agingUncollected: null });
    expect(push.body).toContain('page counters disagree with a recount on 30/100 books');
  });

  it('an empty counter sample says so, not "0/0 books disagree"', () => {
    const empty = { ...brokenErr('ocr'), detail: { counters_checked: 0, counters_drifted: 0 } };
    const [push] = buildAlertPushes({ stages: [empty], stalled: [], collectorAgeHours: 0, agingUncollected: null });
    expect(push.body).toContain('drew no materialized books');
  });

  it('collector and aging batches stay on the pipeline push', () => {
    const pushes = buildAlertPushes({ stages: [], stalled: [], collectorAgeHours: Infinity, agingUncollected: 3 });
    expect(pushes).toHaveLength(1);
    expect(pushes[0].title).toBe('Pipeline line: 2 pipeline issue(s)');
    expect(pushes[0].body).toContain('NEVER');
  });

  it('nothing wrong: no push', () => {
    expect(buildAlertPushes({ stages: [ok('images', 99, 100)], stalled: [], collectorAgeHours: 0.1, agingUncollected: 0 })).toEqual([]);
  });

  it('the log line prints a broken probe as n/a under "instrument broken", separate from "stalled"', () => {
    const line = formatSummaryLine({
      stages, stalled: ['images'], dial: { paused: false, daily_budget_usd: 0 }, spend_today_usd: 1.5, duration_ms: 70000,
    });
    expect(line).toContain('archived n/a | ocr n/a | images 99.0%');
    expect(line).toContain('| stalled: images |');
    expect(line).toContain('| instrument broken: archived,ocr: operation exceeded time limit |');
    expect(line).not.toContain('BROKEN');
  });
});

// ── #368: images and identity count only rows their worker takes ─────────────

type Det = Record<string, unknown>;
const page = (dets: Det[], src: Record<string, unknown> = { archived_photo: 'https://images.sourcelibrary.org/archived/b/1.jpg' }) => ({ id: 'p1', detected_images: dets, ...src });
const takeable: Det = { bbox: { x: 0, y: 0, width: 1, height: 1 }, detection_source: 'vision_model', gallery_quality: 0.8 };

/** A db the measurement can run against: gallery rows + pages, counts by a predicate test function. */
function fakeImagesDb(galleryRows: Det[], pages: Det[]) {
  const pending = (r: Det) => !r.extracted_url && Number(r.gallery_quality) >= 0.5;
  return {
    collection(name: string) {
      if (name === 'gallery_images') return {
        findOne: async () => ({ _id: 'x' }),
        estimatedDocumentCount: async () => galleryRows.length,
        countDocuments: async (q: Det) => galleryRows.filter((r) => ('$or' in q ? pending(r) : !!r.extracted_url)).length,
        find: () => ({ toArray: async () => galleryRows.filter(pending) }),
      };
      return { find: (q: { id: { $in: string[] } }) => ({ toArray: async () => pages.filter((p) => q.id.$in.includes(p.id as string)) }) };
    },
  };
}

describe('images queue = what the thumbnail maker takes (#368)', () => {
  it('takes a detection the maker would select, and not the ones it skips', () => {
    expect(thumbnailerTakes(page([takeable]), 0)).toBe(true);
    // the 532 of 2026-11-14: gallery row says 1.0, the page detection says null
    expect(thumbnailerTakes(page([{ ...takeable, gallery_quality: null }]), 0)).toBe(false);
    expect(thumbnailerTakes(page([{ ...takeable, bbox: null }]), 0)).toBe(false); // the maker's loop skips !det.bbox
    expect(thumbnailerTakes(page([{ ...takeable, detection_source: 'clip' }]), 0)).toBe(false);
    expect(thumbnailerTakes(page([{ ...takeable, extracted_url: 'https://x' }]), 0)).toBe(false);
    expect(thumbnailerTakes(page([takeable], {}), 0)).toBe(false); // no source image to crop
    expect(thumbnailerTakes(undefined, 0)).toBe(false); // page gone
  });

  it('pins the rule to the worker and its cron line', () => {
    const src = fs.readFileSync('scripts/workers/generate-thumbnails.mjs', 'utf8');
    expect(src).toContain(`detection_source: { $in: ${JSON.stringify(THUMBNAILER_SOURCES).replace(/"/g, "'").replace(/,/g, ', ')} }`);
    expect(src).toContain('if (!det || !det.bbox) continue;');
    const cron = fs.readFileSync('scripts/workers/crontab.production', 'utf8').split('\n').find((l) => l.includes('generate-thumbnails.mjs'))!;
    expect(cron).toContain(`--min-quality=${THUMBNAILER_MIN_QUALITY}`);
  });

  it('positive control: rows the maker WOULD take, left unprocessed, still report STALLED', async () => {
    const gallery = [
      { extracted_url: 'https://done', gallery_quality: 1 },
      ...[0, 1, 2].map((i) => ({ page_id: `t${i}`, detection_index: 0, gallery_quality: 0.9 })),
      { page_id: 'r0', detection_index: 0, gallery_quality: 1 },
    ];
    const pages = [...[0, 1, 2].map((i) => ({ ...page([takeable]), id: `t${i}` })), { ...page([{ ...takeable, gallery_quality: null }]), id: 'r0' }];
    const m = await measureImages(fakeImagesDb(gallery, pages));
    expect(m).toMatchObject({ status: 'ok', covered: 1, queue_depth: 3, residue: 1 });
    const [s] = computeStageDeltas([m], [{ ...m }]);
    expect(findStalled([s])).toEqual(['images']);
  });

  it('a queue of residue only does not stall, and the residue stays visible', async () => {
    const gallery = [{ extracted_url: 'https://done', gallery_quality: 1 }, { page_id: 'r0', detection_index: 0, gallery_quality: 1 }];
    const m = await measureImages(fakeImagesDb(gallery, [{ ...page([{ ...takeable, gallery_quality: null }]), id: 'r0' }]));
    expect(m).toMatchObject({ queue_depth: 0, residue: 1 });
    const [s] = computeStageDeltas([m], [{ ...m }]);
    expect(findStalled([s])).toEqual([]);
    expect(formatSummaryLine({ stages: [s], stalled: [], dial: {}, duration_ms: 1 })).toContain('residue 1 no worker takes');
  });
});

describe('identity queue = what identity-worker and the nightly minter take (#368)', () => {
  const now = new Date('2026-11-15T00:00:00Z');
  /** countDocuments answers by predicate shape: the queue count is the one with $and. */
  const fakeBooksDb = (n: { total: number; covered: number; queue: number }) => ({
    collection: () => ({
      findOne: async () => ({ _id: 'x' }),
      countDocuments: async (q: Det) => ('$and' in q ? n.queue : 'work_id' in q && 'edition_key' in q ? n.covered : 'work_id' in q || 'edition_key' in q ? n.covered : n.total),
    }),
  });

  it('selects absent identity fields (identity-worker) and a missing work_id only while the minter still retries', () => {
    const q = identityQueueMatch(now);
    expect(q.$or[0]).toEqual({ content_type: { $ne: 'artwork' }, $or: [{ edition_key: { $exists: false } }, { normalized_title: { $exists: false } }] });
    expect(q.$or[1].created_at.$gte.toISOString()).toBe(new Date(now.getTime() - MINTER_RETRY_DAYS * 864e5).toISOString());
    expect(q.$or[1].language).toEqual({ $nin: ['Visual', 'Unknown', null] });
  });

  it('positive control: books a worker would take, left unkeyed, still report STALLED', async () => {
    const m = await measureIdentity(fakeBooksDb({ total: 71313, covered: 70558, queue: 4 }), { now });
    expect(m).toMatchObject({ queue_depth: 4, residue: 751 });
    const [s] = computeStageDeltas([m], [{ ...m }]);
    expect(findStalled([s])).toEqual(['identity']);
  });

  it('the 755 refused or unkeyable books of 2026-11-14 are residue, not a stall', async () => {
    const m = await measureIdentity(fakeBooksDb({ total: 71313, covered: 70558, queue: 0 }), { now });
    expect(m).toMatchObject({ queue_depth: 0, residue: 755 });
    expect(findStalled(computeStageDeltas([m], [{ ...m }]))).toEqual([]);
  });
});
