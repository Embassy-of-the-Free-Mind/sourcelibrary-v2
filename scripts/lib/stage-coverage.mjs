/**
 * stage-coverage — one coverage measurement per pipeline stage (#3756 §B/§A1).
 *
 * The v1 archaeology's loudest finding: of the most expensive incidents, zero
 * were caught by monitoring, because monitoring watched JOB COUNTERS and the
 * counters lied. Every measurement here is therefore computed from the DATA
 * (rows and fields that exist), never from job status.
 *
 * Each measurement returns:
 *   { stage, status: 'ok' | 'probe_broken', covered, total, queue_depth, detail? }
 *
 * POSITIVE CONTROLS (the probe-needs-a-positive-control lesson): before
 * counting, each measurement runs a known-satisfiable sub-query — "at least
 * one row satisfies the covered predicate" — with a findOne. If the control
 * finds nothing, the measurement reports status:'probe_broken' with
 * covered:null instead of reporting 0 coverage. A broken probe and an empty
 * pipeline must never look the same (that is exactly how #2973-class freezes
 * and the #3362 silent-success class went unnoticed).
 *
 * Query discipline: countDocuments with simple predicates only;
 * estimatedDocumentCount where exact totals aren't needed; every query
 * carries maxTimeMS. No unindexed queries over `pages` at all — the page
 * stages read the verified per-book counters instead (#4708).
 *
 * Conventions reused:
 *   - visible pages: page_number > 0 (scripts/lib/page-counts.mjs, #3293)
 *   - live books: visible:true && pages_count>0 (canonical public filter)
 *   - page stages: the per-book counters (scripts/lib/page-counts.mjs, #5325),
 *     verified against an exact recount of random books every run (#4708)
 *   - #2430 canary: gallery_images rows with a detection above the
 *     thumbnail-quality bar but no extracted_url — the batch collector writes
 *     bbox-only rows and generate-thumbnails materializes them; rows stuck in
 *     that state are the images queue.
 */

import { buildVisiblePageCountPipeline, pageCountersFromStats, PAGE_COUNTERS } from './page-counts.mjs';

const COUNT_MAX_TIME_MS = 10 * 60_000; // nightly job
const CONTROL_MAX_TIME_MS = 60_000;

/** Canonical "live" book filter used across public APIs. */
export const LIVE_BOOK_MATCH = { visible: true, pages_count: { $gt: 0 } };

/**
 * Pure: fold the positive-control outcome into a measurement.
 * controlOk=false means the probe could not find even one known-present case,
 * so its counts are untrustworthy — report the probe broken, never 0 coverage.
 */
export function finalizeMeasurement(measurement, controlOk) {
  const { stage, covered, total, queue_depth, detail } = measurement;
  if (!controlOk) {
    return {
      stage,
      status: 'probe_broken',
      covered: null,
      total: total ?? null,
      queue_depth: null,
      ...(detail !== undefined ? { detail } : {}),
    };
  }
  return {
    stage,
    status: 'ok',
    covered,
    total,
    queue_depth,
    ...(detail !== undefined ? { detail } : {}),
  };
}

/**
 * Pure: annotate current stages with `delta` (covered − previous covered).
 * Delta is null when either side is missing or probe_broken — a broken probe
 * must not manufacture a zero delta (which findStalled would then flag).
 */
export function computeStageDeltas(currentStages, previousStages) {
  const prev = new Map((previousStages ?? []).map((s) => [s.stage, s]));
  return (currentStages ?? []).map((s) => {
    const p = prev.get(s.stage);
    const comparable =
      s.status === 'ok' && typeof s.covered === 'number' &&
      p?.status === 'ok' && typeof p.covered === 'number';
    return { ...s, delta: comparable ? s.covered - p.covered : null };
  });
}

/**
 * Pure: the I54 "quietly stops advancing" detector — stages with work waiting
 * (queue_depth > 0) whose coverage did not move (delta === 0). Broken probes
 * and stages without a comparable delta are excluded: null is not zero.
 */
export function findStalled(stagesWithDeltas) {
  return (stagesWithDeltas ?? [])
    .filter(
      (s) =>
        s.status === 'ok' &&
        typeof s.queue_depth === 'number' &&
        s.queue_depth > 0 &&
        s.delta === 0,
    )
    .map((s) => s.stage);
}

/** Pure: parse a PostgREST Content-Range header ("0-0/36079" or "*\/36079"). */
export function parseContentRangeCount(header) {
  if (typeof header !== 'string') return null;
  const m = header.match(/\/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

// ── Mongo helpers ───────────────────────────────────────────────────────────

async function controlFound(coll, predicate) {
  try {
    const doc = await coll.findOne(predicate, {
      projection: { _id: 1 },
      maxTimeMS: CONTROL_MAX_TIME_MS,
    });
    return doc != null;
  } catch {
    // A timed-out or failed control is indistinguishable from a broken probe.
    return false;
  }
}

function count(coll, predicate) {
  return coll.countDocuments(predicate, { maxTimeMS: COUNT_MAX_TIME_MS });
}

// ── Stage measurements ──────────────────────────────────────────────────────

// ── Page stages (#4708) ─────────────────────────────────────────────────────
//
// `pages` is ~29M docs and none of the coverage predicates is indexed: one
// countDocuments({page_number:{$gt:0}}) did not finish in 10 minutes
// (measured 2026-10-11), and the six exact page counts that used to live here
// put this nightly job past its 1800s ceiling every night from 2026-08-09 —
// one snapshot row ever. A $sample is no substitute: on 2026-10-11 it put
// pages-with-ocr.updated_at at 23.0M against an exact indexed count of 9.5M
// (WiredTiger's random cursor is not uniform here).
//
// So the page stages SUM the per-book page counters — but those are written
// from page data by exactly one aggregation (PAGE_COUNT_ACCUMULATORS in
// page-counts.mjs, via recountBook() and the reconciler), not by job status.
// The positive control is therefore a TRUTH check on the counters: recount a
// random handful of books exactly from their pages (book_id is indexed) and
// compare. If more than COUNTER_DRIFT_TOLERANCE of them disagree, the stages
// report probe_broken — a counter that lies must not read as coverage.

const COUNTER_CHECK_BOOKS = 100;
const COUNTER_DRIFT_TOLERANCE = 0.05;

/** Pure: compare stored counters with exact recounts; drifted = any counter differs. */
export function compareCounters(rows) {
  const drifted = rows.filter(({ stored, actual }) =>
    ['pages_count', 'pages_ocr', 'pages_translated', 'pages_blank', 'pages_archived'].some(
      (k) => (stored?.[k] ?? 0) !== (actual?.[k] ?? 0),
    ),
  );
  return {
    checked: rows.length,
    drifted: drifted.length,
    ok: rows.length > 0 && drifted.length / rows.length <= COUNTER_DRIFT_TOLERANCE,
    examples: drifted.slice(0, 3).map((r) => r.id),
  };
}

/** Recount COUNTER_CHECK_BOOKS random books exactly from `pages`; compare to their counters. */
async function checkPageCounters(db, sampleSize = COUNTER_CHECK_BOOKS) {
  const books = await db.collection('books').aggregate(
    [
      { $match: { pages_count: { $gt: 0 } } },
      { $sample: { size: sampleSize } },
      { $project: { _id: 0, id: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1, pages_archived: 1 } },
    ],
    { maxTimeMS: CONTROL_MAX_TIME_MS },
  ).toArray();
  const rows = [];
  for (const { id, ...stored } of books) {
    if (!id) continue;
    // Read the books row again right before its recount, so a book the pipeline
    // advanced between the sample and the recount is not reported as drift.
    const [fresh, [stats]] = await Promise.all([
      db.collection('books').findOne({ id }, { projection: { _id: 0, ...Object.fromEntries(PAGE_COUNTERS.map((k) => [k, 1])) }, maxTimeMS: CONTROL_MAX_TIME_MS }),
      db.collection('pages').aggregate(buildVisiblePageCountPipeline(id), { maxTimeMS: CONTROL_MAX_TIME_MS }).toArray(),
    ]);
    rows.push({ id, stored: fresh ?? stored, actual: pageCountersFromStats(stats) });
  }
  return compareCounters(rows);
}

/** Pure: page-stage measurements from summed counters (+ the counter check). */
export function pageStagesFromCounters(sums, check) {
  const total = sums?.pages_count ?? 0;
  const checkDetail = { counters_checked: check.checked, counters_drifted: check.drifted };
  const nonBlank = Math.max(0, total - (sums?.pages_blank ?? 0));
  const measurements = [
    // pages_archived counts a `failed:` marker as archived (isArchivedPage —
    // the reconciler's long-standing definition); the queue is pages with no
    // archived_photo at all, which is what an archiver selects on.
    { stage: 'archived', covered: sums?.pages_archived ?? 0, total },
    { stage: 'ocr', covered: sums?.pages_ocr ?? 0, total },
    // Blank leaves are out of BOTH sides, as isTranslatedPage() (#3747):
    // they can never be translated, so as queue they would never drain.
    { stage: 'translated', covered: sums?.pages_translated ?? 0, total: nonBlank },
  ];
  return measurements.map((m) =>
    finalizeMeasurement(
      {
        ...m,
        queue_depth: Math.max(0, m.total - m.covered),
        detail: check.ok ? checkDetail : { ...checkDetail, drift_examples: check.examples.join(',') },
      },
      check.ok,
    ),
  );
}

/**
 * archived / ocr / translated — visible pages (page_number > 0) across every
 * book, from the summed page counters, guarded by an exact recount of random
 * books (see the section comment above).
 */
export async function measurePageStages(db) {
  const check = await checkPageCounters(db);
  const [sums] = await db.collection('books').aggregate(
    [
      {
        $group: {
          _id: null,
          pages_count: { $sum: '$pages_count' },
          pages_ocr: { $sum: '$pages_ocr' },
          pages_translated: { $sum: '$pages_translated' },
          pages_blank: { $sum: '$pages_blank' },
          pages_archived: { $sum: '$pages_archived' },
        },
      },
    ],
    { maxTimeMS: COUNT_MAX_TIME_MS },
  ).toArray();
  return pageStagesFromCounters(sums, check);
}

/** summaries — live books with a summary (object with data, or legacy string). */
export async function measureSummaries(db) {
  const books = db.collection('books');
  const coveredPredicate = { ...LIVE_BOOK_MATCH, summary: { $exists: true, $nin: [null, ''] } };
  if (!(await controlFound(books, coveredPredicate))) {
    return finalizeMeasurement({ stage: 'summaries' }, false);
  }
  const [total, covered] = await Promise.all([
    count(books, LIVE_BOOK_MATCH),
    count(books, coveredPredicate),
  ]);
  return finalizeMeasurement(
    { stage: 'summaries', covered, total, queue_depth: Math.max(0, total - covered) },
    true,
  );
}

/** chapters — live books with a non-empty chapters array. */
export async function measureChapters(db) {
  const books = db.collection('books');
  const coveredPredicate = { ...LIVE_BOOK_MATCH, 'chapters.0': { $exists: true } };
  if (!(await controlFound(books, coveredPredicate))) {
    return finalizeMeasurement({ stage: 'chapters' }, false);
  }
  const [total, covered] = await Promise.all([
    count(books, LIVE_BOOK_MATCH),
    count(books, coveredPredicate),
  ]);
  return finalizeMeasurement(
    { stage: 'chapters', covered, total, queue_depth: Math.max(0, total - covered) },
    true,
  );
}

/**
 * images — gallery_images rows with a materialized extracted_url.
 * queue_depth is the #2430 canary: detections above the thumbnail-quality bar
 * (gallery_quality >= 0.5, generate-thumbnails' --min-quality) with no
 * extracted_url — bbox-only rows the batch collector wrote that the
 * thumbnail materializer hasn't picked up.
 */
export async function measureImages(db) {
  const gallery = db.collection('gallery_images');
  const coveredPredicate = { extracted_url: { $type: 'string', $ne: '' } };
  if (!(await controlFound(gallery, coveredPredicate))) {
    return finalizeMeasurement({ stage: 'images' }, false);
  }
  const [total, covered, bboxOnlyPending] = await Promise.all([
    gallery.estimatedDocumentCount(),
    count(gallery, coveredPredicate),
    count(gallery, {
      $or: [{ extracted_url: { $exists: false } }, { extracted_url: null }],
      gallery_quality: { $gte: 0.5 },
    }),
  ]);
  return finalizeMeasurement(
    {
      stage: 'images',
      covered,
      total,
      queue_depth: bboxOnlyPending,
      detail: { bbox_only_pending: bboxOnlyPending },
    },
    true,
  );
}

/** Exact row count of a Supabase table via PostgREST HEAD + Prefer: count=exact. */
export async function supabaseTableCount(table, { fetchImpl = fetch } = {}) {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetchImpl(`${url}/rest/v1/${table}?select=*`, {
      method: 'HEAD',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok && res.status !== 206) return null;
    return parseContentRangeCount(res.headers.get('content-range'));
  } catch {
    return null;
  }
}

/**
 * embeddings — Supabase row counts (REST HEAD, count=exact). Coverage is
 * book_embeddings rows vs live books (the only pair with a shared unit);
 * the other four tables are reported in detail as raw row counts.
 * Positive control: book_embeddings (known to hold tens of thousands of rows)
 * must return a parseable, nonzero count — otherwise the probe is broken
 * (bad env, changed REST behaviour, dropped table), not an empty corpus.
 */
export async function measureEmbeddings(db, { fetchImpl = fetch } = {}) {
  const [bookEmb, pageTr, artworkEmb, galleryTextEmb, clipEmb] = await Promise.all([
    supabaseTableCount('book_embeddings', { fetchImpl }),
    supabaseTableCount('page_translations', { fetchImpl }),
    supabaseTableCount('artwork_embeddings', { fetchImpl }),
    supabaseTableCount('gallery_text_embeddings', { fetchImpl }),
    supabaseTableCount('clip_embeddings', { fetchImpl }),
  ]);
  const detail = {
    book_embeddings: bookEmb,
    page_translations: pageTr,
    artwork_embeddings: artworkEmb,
    gallery_text_embeddings: galleryTextEmb,
    clip_embeddings: clipEmb,
  };
  if (bookEmb == null || bookEmb === 0) {
    return finalizeMeasurement({ stage: 'embeddings', detail }, false);
  }
  const total = await count(db.collection('books'), LIVE_BOOK_MATCH);
  return finalizeMeasurement(
    {
      stage: 'embeddings',
      covered: bookEmb,
      total,
      // book_embeddings includes hidden books, so covered can exceed total;
      // the queue is only meaningful when live books outnumber embedding rows.
      queue_depth: Math.max(0, total - bookEmb),
      detail,
    },
    true,
  );
}

/** identity — live books carrying BOTH work_id and edition_key (#3260/#3710). */
export async function measureIdentity(db) {
  const books = db.collection('books');
  const nonEmpty = { $exists: true, $nin: [null, ''] };
  const coveredPredicate = { ...LIVE_BOOK_MATCH, work_id: nonEmpty, edition_key: nonEmpty };
  if (!(await controlFound(books, coveredPredicate))) {
    return finalizeMeasurement({ stage: 'identity' }, false);
  }
  const [total, covered, withWork, withEdition] = await Promise.all([
    count(books, LIVE_BOOK_MATCH),
    count(books, coveredPredicate),
    count(books, { ...LIVE_BOOK_MATCH, work_id: nonEmpty }),
    count(books, { ...LIVE_BOOK_MATCH, edition_key: nonEmpty }),
  ]);
  return finalizeMeasurement(
    {
      stage: 'identity',
      covered,
      total,
      queue_depth: Math.max(0, total - covered),
      detail: { with_work_id: withWork, with_edition_key: withEdition },
    },
    true,
  );
}

/** All stage measurements, in line order. A throwing measurement is recorded
 *  as probe_broken rather than sinking the whole snapshot. */
export async function measureAllStages(db, { fetchImpl = fetch } = {}) {
  const measurements = [
    [['archived', 'ocr', 'translated'], () => measurePageStages(db)],
    ['summaries', () => measureSummaries(db)],
    ['chapters', () => measureChapters(db)],
    ['images', () => measureImages(db)],
    ['embeddings', () => measureEmbeddings(db, { fetchImpl })],
    ['identity', () => measureIdentity(db)],
  ];
  const out = [];
  for (const [stage, fn] of measurements) {
    try {
      const result = await fn();
      out.push(...(Array.isArray(result) ? result : [result]));
    } catch (err) {
      const error = String(err?.message || err).slice(0, 300);
      for (const s of [stage].flat()) {
        out.push({ ...finalizeMeasurement({ stage: s }, false), detail: { error } });
      }
    }
  }
  return out;
}
