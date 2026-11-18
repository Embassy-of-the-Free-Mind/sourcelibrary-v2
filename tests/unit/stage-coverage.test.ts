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

// ── #428: the book-level rows of the whole line ────────────────────────────
// @ts-expect-error — plain .mjs helper, no types
import * as bs from '../../scripts/lib/stage-coverage.mjs';

describe('book-level steps (#428)', () => {
  it('a per-day row reports the last FULL UTC day, never the day still running', () => {
    expect(bs.lastFullUtcDay(new Date('2026-11-16T04:20:00Z'))).toEqual({
      day: '2026-11-15', start: new Date('2026-11-15T00:00:00Z'), end: new Date('2026-11-16T00:00:00Z'),
    });
    expect(bs.lastFullUtcDay(new Date('2026-11-16T00:00:00Z')).day).toBe('2026-11-15');
    // the publication event of 2026-11-16T18:18:41Z has _id 6afb49013595fc69f8057028
    expect(bs.objectIdHexAt(new Date('2026-11-16T18:18:41Z'))).toBe('6afb49010000000000000000');
  });

  it('a stage marked stall_watch:false never pages STALLED; the same stage without the mark does', () => {
    const s = { ...ok('catalogue', 10, 100, 90), delta: 0 };
    expect(findStalled([s])).toEqual(['catalogue']); // positive control: the detector still fires
    expect(findStalled([{ ...s, stall_watch: false }])).toEqual([]);
    // The mark survives a broken probe, so the stage stays out when it recovers.
    expect(finalizeMeasurement({ stage: 'x', stall_watch: false }, false).stall_watch).toBe(false);
  });

  const rows = [
    { _id: 'o1', id: 'a', catalogue: true, quality_score: true, collections: true, cover_page: true, cover_selected: true, place: true, author_place: false, split: true, pictures_count: true, pictures_stamp: true },
    { _id: 'o2', id: 'b', catalogue: false, quality_score: true, collections: false, cover_page: false, cover_selected: true, place: false, author_place: true, pictures_count: true },
    { _id: 'o3', id: 'c', catalogue: false, quality_score: false, collections: false, cover_page: false, cover_selected: false, place: false, author_place: false },
    { _id: 'o4', id: 'd', catalogue: false, quality_score: false, collections: false, cover_page: false, cover_selected: false, place: false, author_place: false },
  ];
  const allOk = { catalogue: true, quality_score: true, cover: true, place: true, coverQueue: 1, pictures: true };
  const sets = { ftBooks: new Set(['a', 'zz']), checkedBooks: new Set(['o2']), pageNumberBooks: new Set(['c', 'd']) };
  const byStage = (ms: Stage[]) => Object.fromEntries(ms.map((m) => [m.stage, m]));

  it('counts each step from its own field, over live books', () => {
    const m = byStage(bs.bookStepStages(rows, sets, allOk));
    expect(m.catalogue).toMatchObject({ status: 'ok', covered: 1, total: 4, stall_watch: false });
    expect(m.quality_score).toMatchObject({ covered: 2, also: [{ label: 'placed in collections by score', n: 1 }] });
    // a kept manual cover is a cover decision (phase 8.9 stamps cover_selected_at for it)
    expect(m.cover).toMatchObject({ covered: 2, queue_depth: 1, detail: { with_cover_page: 1 } });
    expect(m.places).toMatchObject({ covered: 1, also: [{ label: 'with an author birth or death place', n: 1 }, { label: 'with printed page numbers fitted', n: 2 }] });
    // ids from other collections match a book by `id` or by `_id` (16K books carry a re-minted _id)
    expect(m.ft_search).toMatchObject({ status: 'ok', covered: 1 });
    expect(m.book_checks).toMatchObject({ status: 'ok', covered: 1 });
    // a picture count from an older run counts as searched; the stamp the waiting count reads rides beside it (#425)
    expect(m.image_books).toMatchObject({ status: 'ok', covered: 2, total: 4, also: [{ label: 'with the done or skip stamp the waiting count reads', n: 1 }] });
    expect(findStalled(computeStageDeltas(Object.values(m), Object.values(m)))).toEqual([]);
  });

  it('an empty id set, or one that names no live book, is a broken probe, never 0 coverage', () => {
    const m = byStage(bs.bookStepStages(rows, { ...sets, ftBooks: new Set(), checkedBooks: new Set(['not-a-book']) }, allOk));
    expect(m.ft_search).toMatchObject({ status: 'probe_broken', covered: null });
    expect(m.book_checks).toMatchObject({ status: 'probe_broken', covered: null });
  });

  it('a failed field control breaks that stage only; a broken page-number log drops that figure, not the row', () => {
    const m = byStage(bs.bookStepStages(rows, { ...sets, pageNumberBooks: new Set() }, { ...allOk, catalogue: false }));
    expect(m.catalogue.status).toBe('probe_broken');
    expect(m.quality_score.status).toBe('ok');
    expect(byStage(bs.bookStepStages(rows, sets, { ...allOk, pictures: false })).image_books.status).toBe('probe_broken');
    expect(m.places).toMatchObject({ status: 'ok', covered: 1, also: [{ label: 'with an author birth or death place', n: 1 }] });
  });

  it('the live-book pass starts at the live filter and projects booleans only', () => {
    const [match, project] = bs.buildBookStepPipeline();
    expect(match).toEqual({ $match: { visible: true, pages_count: { $gt: 0 } } });
    expect(Object.keys(project.$project)).toEqual(['_id', 'id', 'catalogue', 'quality_score', 'collections', 'cover_page', 'cover_selected', 'place', 'split', 'author_place', 'pictures_stamp', 'pictures_count']);
  });

  it('pins the hold reason and the fitter log to the scripts that write them', () => {
    expect(fs.readFileSync('scripts/audit/pre-ocr-duplicate-screen.ts', 'utf8')).toContain(`const HOLD_REASON = '${bs.COPY_HOLD_REASON}'`);
    const fitter = fs.readFileSync('scripts/maintenance/backfill-printed-page-4291.mjs', 'utf8');
    expect(fitter).toContain(`export const SWEEP = '${bs.PRINTED_PAGE_SWEEP.sweep}'`);
    expect(fitter).toContain(`action: '${bs.PRINTED_PAGE_SWEEP.action}'`);
    expect(fs.readFileSync('scripts/workers/pipeline-orchestrator.mjs', 'utf8')).toContain("'ai_metadata.enriched_at': { $exists: false }");
  });

  /** A db whose collections answer findOne with `control` and aggregate with `groups`, recording the pipeline. */
  const fakeDb = (control: boolean, groups: unknown[]) => {
    const seen: unknown[] = [];
    return { seen, db: { collection: () => ({
      findOne: async () => (control ? { _id: 'x' } : null),
      aggregate: (p: unknown) => { seen.push(p); return { toArray: async () => groups }; },
    }) } };
  };

  it('imports: the last full day, split into books and artwork records, through the {visible, created_at} index', async () => {
    const { db, seen } = fakeDb(true, [{ _id: true, n: 1100 }, { _id: false, n: 20 }]);
    const m = await bs.measureImports(db, { now: new Date('2026-11-16T04:20:00Z') });
    expect(m).toMatchObject({ stage: 'imported', status: 'ok', covered: null, total: null, stall_watch: false,
      per_day: { day: '2026-11-15', n: 1120, parts: [{ label: 'artwork records', n: 1100 }, { label: 'books', n: 20 }] } });
    expect((seen[0] as { $match: Record<string, unknown> }[])[0].$match.visible).toEqual(bs.ANY_VISIBILITY);
    const quiet = await bs.measureImports(fakeDb(true, []).db, { now: new Date('2026-11-16T04:20:00Z') });
    expect(quiet.per_day).toEqual({ day: '2026-11-15', n: 0, parts: [] }); // a quiet day is a measured zero
    expect((await bs.measureImports(fakeDb(false, []).db)).status).toBe('probe_broken');
  });

  it('published: books made public on the day, by writer, the day bounded by _id', async () => {
    const { db, seen } = fakeDb(true, [{ _id: 'claude:bathing-collection', n: 24 }, { _id: 'derek', n: 2 }]);
    const m = await bs.measurePublished(db, { now: new Date('2026-11-17T04:20:00Z') });
    expect(m.per_day).toEqual({ day: '2026-11-16', n: 26, parts: [{ label: 'claude:bathing-collection', n: 24 }, { label: 'derek', n: 2 }] });
    const match = (seen[0] as { $match: Record<string, unknown> }[])[0].$match;
    expect(match.to).toBe('public');
    expect(match._id).toBeDefined();
    expect((await bs.measurePublished(fakeDb(false, []).db)).status).toBe('probe_broken');
  });

  it('day parts keep the three largest and sum the rest', () => {
    expect(bs.dayPartsOf([{ label: 'a', n: 1 }, { label: 'b', n: 5 }, { label: 'c', n: 3 }, { label: 'd', n: 2 }, { label: 'e', n: 0 }]))
      .toEqual([{ label: 'b', n: 5 }, { label: 'c', n: 3 }, { label: 'd', n: 2 }, { label: 'other', n: 1 }]);
  });

  it('the log line prints a flow as its day and a count as a number', () => {
    const line = formatSummaryLine({ stages: [
      { stage: 'imported', status: 'ok', covered: null, total: null, queue_depth: null, per_day: { day: '2026-11-15', n: 7 } },
      { stage: 'copy_holds', status: 'ok', covered: 194, total: null, queue_depth: null },
    ], stalled: [], dial: {}, duration_ms: 1 });
    expect(line).toContain('imported 7 on 2026-11-15');
    expect(line).toContain('copy_holds 194');
  });
});

describe('page-level steps (#428)', () => {
  const rows = [
    { _id: 'o1', id: 'a', split: true }, { _id: 'o2', id: 'b', split: false }, { _id: 'o3', id: 'c' },
  ];
  const sets = { ftBooks: new Set(['a']), checkedBooks: new Set(['a']), pageNumberBooks: new Set(['a']) };
  const controls = { catalogue: true, quality_score: true, cover: true, place: true, coverQueue: 0 };
  const split = (c: Record<string, unknown>) => bs.bookStepStages(rows, sets, { ...controls, split: c }).find((m: Stage) => m.stage === 'split');

  it('split: books cut, phase 1.3 queue as waiting, pages cut and books not yet checked beside it', () => {
    expect(split({ control: true, flagged: 479, flaggedVisible: 3, unchecked: 17740, pagesCut: 111291 })).toMatchObject({
      status: 'ok', covered: 1, total: null, queue_depth: 479, queue_visible: 3, stall_watch: false,
      also: [{ label: 'pages cut from spreads, hidden books included', n: 111291 }, { label: 'books at archive_complete not yet checked for spreads', n: 17740 }],
    });
    // a failed side count drops that figure, not the row; a failed control breaks the row
    expect(split({ control: true, flagged: null, unchecked: null, pagesCut: null })).toMatchObject({ status: 'ok', covered: 1, queue_depth: null, also: [] });
    expect(split({ control: false, flagged: 1 })).toMatchObject({ status: 'probe_broken', covered: null });
  });

  it('seams: pages repaired on the day, by run family, with rows and books beside', () => {
    expect(bs.runFamily('seam-pass-8399-20261115041200')).toBe('seam-pass-8399');
    expect(bs.runFamily(undefined)).toBe('unnamed run');
    const d = bs.seamDay([
      { book_id: 'a', run: 'seam-pass-8399-20261115041200', pages: 2 },
      { book_id: 'a', run: 'seam-pass-8399-20261115051200', pages: 1 },
      { book_id: 'b', run: 'seam-repair-6742-20261115', pages: 4 },
    ], '2026-11-15');
    expect(d).toEqual({ per_day: { day: '2026-11-15', n: 7, parts: [{ label: 'seam-repair-6742', n: 4 }, { label: 'seam-pass-8399', n: 3 }] },
      detail: { repair_rows: 3, books: 2 } });
    expect(bs.seamDay([], '2026-11-15').per_day).toEqual({ day: '2026-11-15', n: 0, parts: [] });
  });

  it('search: pages copied on the day, failures and capped runs beside', () => {
    const d = bs.searchCopyDay([
      { status: 'success', actions: { seen: 700, synced: 700, failed: 0 } },
      { status: 'failed', actions: { seen: 50000, synced: 49990, failed: 10 } },
    ], '2026-11-15');
    expect(d).toEqual({ per_day: { day: '2026-11-15', n: 50690, parts: [{ label: 'copied', n: 50690 }, { label: 'failed to copy', n: 10 }] },
      detail: { runs: 2, failed_runs: 1, capped_runs: 1 } });
  });

  const report = (over: Record<string, unknown> = {}) => ({
    at: '2026-11-16T07:30:00.000Z', controls: { pass: true },
    pages: { sampled: 400, n: 350, marked: 300, noR2Display: 20 }, books: { rate: 0.8 }, recent: { rate: 0.95, n: 120 }, ...over,
  });
  const now = new Date('2026-11-17T04:20:00Z');

  it('display and marks: read from the weekly sample, its date carried, never differenced', () => {
    const [display, marks] = bs.provenanceStages(report(), { now });
    expect(display).toMatchObject({ stage: 'display', status: 'ok', covered: 380, total: 400, sampled_at: '2026-11-16T07:30:00.000Z', stall_watch: false });
    expect(marks).toMatchObject({ stage: 'marks', status: 'ok', covered: 300, total: 350, detail: { by_book_rate: 0.8, recent_rate: 0.95, recent_n: 120 } });
    expect(findStalled(computeStageDeltas([display, marks], [{ ...display, covered: 380 }, { ...marks, covered: 300 }]))).toEqual([]);
  });

  it('a missing, stale or uncontrolled report breaks both rows, never 0', () => {
    for (const r of [null, report({ at: '2026-10-20T00:00:00Z' }), report({ controls: { pass: false } }), report({ pages: { sampled: 0 } })]) {
      const ms = bs.provenanceStages(r, { now });
      expect(ms.map((m: Stage) => [m.stage, m.status, m.covered])).toEqual([['display', 'probe_broken', null], ['marks', 'probe_broken', null]]);
    }
  });

  it('pins the event, run record and report names to the scripts that write them', () => {
    expect(fs.readFileSync('scripts/maintenance/seam-repair-6742/seam-repair.mjs', 'utf8')).toContain(`type: '${bs.SEAM_EVENT}'`);
    const sync = fs.readFileSync('scripts/workers/sync-pages-content.mjs', 'utf8');
    expect(sync).toContain(`cron: '${bs.SEARCH_COPY_CRON}'`);
    expect(sync).toContain(`'--max='))?.split('=')[1] || '${bs.SEARCH_COPY_MAX_PAGES}'`);
    expect(fs.readFileSync('scripts/audit/image-provenance-coverage.mjs', 'utf8')).toContain(`const REPORT_ID = '${bs.PROVENANCE_REPORT_ID}'`);
    expect(fs.readFileSync('scripts/workers/lib/trailing-dedup.mjs', 'utf8')).toContain("hidden_reason: 'ia_trailing_dupe'");
  });
});
