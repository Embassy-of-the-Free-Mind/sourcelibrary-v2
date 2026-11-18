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
import { PAGES_MATERIALIZED_FILTER } from './pages-state.mjs';
import { ObjectId } from 'mongodb';

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
  const { stage, covered, total, queue_depth, queue_visible, residue, detail, per_day, also, stall_watch, sampled_at } = measurement;
  // stall_watch:false keeps a stage out of findStalled; it is a property of the stage, so it survives a broken probe.
  const watch = stall_watch === false ? { stall_watch: false } : {};
  if (!controlOk) {
    return {
      stage,
      status: 'probe_broken',
      covered: null,
      total: total ?? null,
      queue_depth: null,
      ...watch,
      ...(detail !== undefined ? { detail } : {}),
    };
  }
  return {
    stage,
    status: 'ok',
    covered,
    total,
    queue_depth,
    ...watch,
    ...(queue_visible !== undefined ? { queue_visible } : {}),
    ...(residue !== undefined ? { residue } : {}),
    ...(per_day !== undefined ? { per_day } : {}),
    ...(also !== undefined ? { also } : {}),
    ...(sampled_at !== undefined ? { sampled_at } : {}),
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
 * A stage marked stall_watch:false is excluded too: its queue is not one a
 * worker drains every night (a paid phase behind the shut dial, a step done by
 * hand), so a still night there is not a stall, and paging on it would be a
 * false alarm (#428).
 */
export function findStalled(stagesWithDeltas) {
  return (stagesWithDeltas ?? [])
    .filter(
      (s) =>
        s.status === 'ok' &&
        s.stall_watch !== false &&
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

// How many books to draw BEFORE filtering to materialized ones. On 2026-11-14
// `books` held 598,759 rows of which 408,920 were manifest-only (#7343), so
// ~32% survive the filter: 1,500 draws yield ~470 candidates for 100 slots.
const COUNTER_SAMPLE_POOL = 1500;

/**
 * Pure: the aggregation that picks the books to recount (#359).
 *
 * `$sample` MUST be the first stage. Behind a `$match`, Mongo cannot use the
 * random cursor: it walks the pages_count index and FETCHes every matching
 * book (570,899 of them, 4.7 GB collection) to test pages_state, then samples
 * in memory — measured 87.6 s against the 60 s limit on 2026-11-14, and the
 * archived/ocr/translated rows went probe_broken on about half the nights from
 * 2026-10-31 as the manifest-only imports grew `books` past half a million rows.
 * First-stage `$sample` returns in ~20 ms. The random cursor is not perfectly
 * uniform, which is acceptable for a drift check (not for an estimate).
 */
export function buildCounterSamplePipeline(sampleSize = COUNTER_CHECK_BOOKS, pool = COUNTER_SAMPLE_POOL) {
  return [
    { $sample: { size: Math.max(pool, sampleSize) } },
    // A manifest-only book (#7343) has no pages by design: not counter drift.
    { $match: { pages_count: { $gt: 0 }, ...PAGES_MATERIALIZED_FILTER } },
    { $limit: sampleSize },
    { $project: { _id: 0, id: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1, pages_archived: 1 } },
  ];
}

/** Recount COUNTER_CHECK_BOOKS random books exactly from `pages`; compare to their counters. */
async function checkPageCounters(db, sampleSize = COUNTER_CHECK_BOOKS) {
  const books = await db.collection('books').aggregate(
    buildCounterSamplePipeline(sampleSize),
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

// ── Queues count only what a worker will take (#368) ───────────────────────
//
// A queue that holds rows no worker selects never drains, so findStalled pages
// "STALLED" every night nothing new arrives (images 532 and identity 755, the
// same numbers every night from 10-29 to 11-14). Each queue below counts the
// rows its worker would take; the rest is `residue` ("no worker takes these"),
// kept beside it so it stays visible. Positive control for the rule: rows the
// worker WOULD take, left unprocessed, still stall (tests/unit/stage-coverage).

/**
 * The thumbnail maker's own selection, per detection (scripts/workers/
 * generate-thumbnails.mjs matchFilter + its per-detection loop, run from cron
 * with --min-quality=0.5): a bbox, no extracted_url, a detection_source it
 * accepts, gallery_quality at or above the bar ON THE PAGE'S detection, and a
 * page with a source image to crop from. The test pins these against the
 * worker's source so the two cannot drift apart silently.
 */
export const THUMBNAILER_SOURCES = ['vision_model', 'manual', 'ocr_tag'];
export const THUMBNAILER_MIN_QUALITY = 0.5;
export const PAGE_SOURCE_FIELDS = ['archived_photo', 'cropped_photo', 'photo_original', 'photo'];
export function thumbnailerTakes(page, detectionIndex) {
  const det = page?.detected_images?.[detectionIndex];
  if (!det || !det.bbox || det.extracted_url) return false;
  if (!THUMBNAILER_SOURCES.includes(det.detection_source)) return false;
  if ((det.gallery_quality || 0) < THUMBNAILER_MIN_QUALITY) return false;
  return PAGE_SOURCE_FIELDS.some((f) => page[f] != null);
}

/** Above this many bbox-only rows the page lookup is skipped and every row counts as queue (the conservative side). */
export const IMAGE_QUEUE_CHECK_CAP = 20_000;

/**
 * images — gallery_images rows with a materialized extracted_url.
 * queue_depth is the #2430 canary narrowed to what the thumbnail maker takes:
 * bbox-only gallery rows (gallery_quality >= 0.5, no extracted_url) whose page
 * detection the maker would select. The rest — on 2026-11-14 all 532, whose
 * page detections carry gallery_quality null (#359) — is `residue`. Pages are
 * read by `id` (indexed), only for the bbox-only rows.
 */
export async function measureImages(db) {
  const gallery = db.collection('gallery_images');
  const coveredPredicate = { extracted_url: { $type: 'string', $ne: '' } };
  if (!(await controlFound(gallery, coveredPredicate))) {
    return finalizeMeasurement({ stage: 'images' }, false);
  }
  const bboxOnly = {
    $or: [{ extracted_url: { $exists: false } }, { extracted_url: null }],
    gallery_quality: { $gte: THUMBNAILER_MIN_QUALITY },
  };
  const [total, covered, bboxOnlyPending] = await Promise.all([
    gallery.estimatedDocumentCount(),
    count(gallery, coveredPredicate),
    count(gallery, bboxOnly),
  ]);
  let queue = bboxOnlyPending;
  let residue = 0;
  let checked = false;
  if (bboxOnlyPending > 0 && bboxOnlyPending <= IMAGE_QUEUE_CHECK_CAP) {
    const rows = await gallery
      .find(bboxOnly, { projection: { page_id: 1, detection_index: 1 }, maxTimeMS: COUNT_MAX_TIME_MS })
      .toArray();
    const pageIds = [...new Set(rows.map((r) => r.page_id).filter(Boolean))];
    const pages = new Map();
    for (let i = 0; i < pageIds.length; i += 1000) {
      const batch = await db
        .collection('pages')
        .find(
          { id: { $in: pageIds.slice(i, i + 1000) } },
          { projection: { id: 1, detected_images: 1, ...Object.fromEntries(PAGE_SOURCE_FIELDS.map((f) => [f, 1])) }, maxTimeMS: COUNT_MAX_TIME_MS },
        )
        .toArray();
      for (const p of batch) pages.set(p.id, p);
    }
    queue = rows.filter((r) => thumbnailerTakes(pages.get(r.page_id), r.detection_index)).length;
    residue = rows.length - queue;
    checked = true;
  }
  return finalizeMeasurement(
    {
      stage: 'images',
      covered,
      total,
      queue_depth: queue,
      residue: checked ? residue : null,
      detail: { bbox_only_pending: bboxOnlyPending, thumbnailer_takes: checked ? queue : null },
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

/**
 * What the two identity workers will take (#368):
 *  - identity-worker (every 2 h): non-artwork books whose edition_key or
 *    normalized_title is ABSENT (its ABSENCE_QUEUE; null = computed, unkeyable,
 *    never re-selected).
 *  - mint-local-work-ids (02:30 nightly): books with no work_id in a textual
 *    language. It re-selects every such book each night but refuses most of
 *    them for good (dry run 2026-11-15: 13,355 selected, 31 mintable; 10,523
 *    "author-unnormalisable"), so a book still without one after
 *    MINTER_RETRY_DAYS is one it has refused — identity-worker's own "older than
 *    7 days = not done" line. Those are residue until the minter changes.
 */
export const MINTER_RETRY_DAYS = 7;
export function identityQueueMatch(now = new Date()) {
  const since = new Date(now.getTime() - MINTER_RETRY_DAYS * 86400_000);
  return {
    $or: [
      {
        content_type: { $ne: 'artwork' },
        $or: [{ edition_key: { $exists: false } }, { normalized_title: { $exists: false } }],
      },
      {
        language: { $nin: ['Visual', 'Unknown', null] },
        $or: [{ work_id: { $exists: false } }, { work_id: null }],
        created_at: { $gte: since },
      },
    ],
  };
}

/** identity — live books carrying BOTH work_id and edition_key (#3260/#3710). */
export async function measureIdentity(db, { now = new Date() } = {}) {
  const books = db.collection('books');
  const nonEmpty = { $exists: true, $nin: [null, ''] };
  const coveredPredicate = { ...LIVE_BOOK_MATCH, work_id: nonEmpty, edition_key: nonEmpty };
  if (!(await controlFound(books, coveredPredicate))) {
    return finalizeMeasurement({ stage: 'identity' }, false);
  }
  const notCovered = { ...LIVE_BOOK_MATCH, $nor: [{ work_id: nonEmpty, edition_key: nonEmpty }] };
  const [total, covered, withWork, withEdition, queue] = await Promise.all([
    count(books, LIVE_BOOK_MATCH),
    count(books, coveredPredicate),
    count(books, { ...LIVE_BOOK_MATCH, work_id: nonEmpty }),
    count(books, { ...LIVE_BOOK_MATCH, edition_key: nonEmpty }),
    count(books, { $and: [notCovered, identityQueueMatch(now)] }),
  ]);
  return finalizeMeasurement(
    {
      stage: 'identity',
      covered,
      total,
      queue_depth: queue,
      residue: Math.max(0, total - covered - queue),
      detail: { with_work_id: withWork, with_edition_key: withEdition },
    },
    true,
  );
}

// ── Book-level steps (#428) ─────────────────────────────────────────────────
//
// The rows of "The whole line" (/admin/pipeline) that read NOT MEASURED until
// v3#428, each counted from the field its own writer sets (named per stage
// below, verified against the writer's code on 2026-11-16). Three shapes:
//
//   stock  covered of total visible books (catalogue, quality_score, cover,
//          places, ft_search, book_checks)
//   count  covered with total null: a number with no denominator (copy_holds)
//   flow   covered/total null, per_day = { day, n, parts } for the last FULL
//          UTC day (imported, published)
//
// None of them is stall-watched (stall_watch:false): catalogue and scoring are
// paid phases behind the spend dial, publishing is by hand, and a quiet night
// in any of them is not a stalled worker. A new false alarm is worse than a
// missing number.
//
// Cost: one pass over the ~71K live books (one aggregation, booleans only,
// 12.6 s on 2026-11-16), two small distincts (first_translation_attempts 97K
// rows, book_checks 3K), one distinct over sweep_log for the page-number
// fitter (10.6 s; sweep_log has no index but _id), and indexed counts. No query
// touches `pages`.

/** Pure: the last full UTC day before `now`: { day: 'YYYY-MM-DD', start, end } with end exclusive. */
export function lastFullUtcDay(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 86400_000);
  return { day: start.toISOString().slice(0, 10), start, end };
}

/** Pure: an ObjectId-shaped hex lower bound for a time (the first 4 bytes of an ObjectId are its seconds). */
export function objectIdHexAt(date) {
  return Math.floor(date.getTime() / 1000).toString(16).padStart(8, '0') + '0000000000000000';
}

/** `{visible: {$in: [true, false, null]}}` lets the {visible, created_at} index serve a created_at range over every book. */
export const ANY_VISIBILITY = { $in: [true, false, null] };

/** Pure: does a projected value count as present (the writers' own `!= null` tests). */
const present = (path) => ({ $ne: [{ $ifNull: [`$${path}`, null] }, null] });

/**
 * Pure: the one aggregation over live books. Each flag is the field the step's writer sets:
 *   catalogue      ai_metadata.enriched_at — orchestrator phase 1.6, and the phase selects on its absence
 *   quality_score  quality_score            — enrich-worker phase 7.5
 *   collections    collection_scores        — enrich-worker phase 7.6
 *   cover          cover_page, or cover_selected_at (phase 8.9 stamps it also when it keeps a manual cover)
 *   place          locations[] with type 'publication' — geocode-publication-places.mjs
 *   author_place   locations[] with type author_birth / author_death — backfill-*-author-locations.mjs
 *   split          split_completed — orchestrator phase 1.3 (split-book.mjs) and phase 3.1 set it after the cut
 *   pictures       detected_images_count, pipeline_auto.images_done_at or .images_skipped_reason — the extraction
 *                  writers (image-extract-worker.mjs, orchestrator phase 8); runs before ~2026-10 set only the count
 *   pictures_stamp images_done_at or images_skipped_reason only: what pipeline-next-step.mjs reads as done (#425)
 */
export function buildBookStepPipeline() {
  const types = { $ifNull: ['$locations.type', []] };
  return [
    { $match: LIVE_BOOK_MATCH },
    {
      $project: {
        _id: 1,
        id: 1,
        catalogue: present('ai_metadata.enriched_at'),
        quality_score: present('quality_score'),
        collections: present('collection_scores'),
        cover_page: present('cover_page'),
        cover_selected: present('cover_selected_at'),
        place: { $in: ['publication', types] },
        split: { $eq: ['$split_completed', true] },
        author_place: { $or: [{ $in: ['author_birth', types] }, { $in: ['author_death', types] }] },
        pictures_stamp: { $or: [present('pipeline_auto.images_done_at'), present('pipeline_auto.images_skipped_reason')] },
        pictures_count: present('detected_images_count'),
      },
    },
  ];
}

/** Hold reason the pre-OCR duplicate screen writes (scripts/audit/pre-ocr-duplicate-screen.ts HOLD_REASON). */
export const COPY_HOLD_REASON = 'same-edition-copy-unread';
/** sweep_log rows the printed-page fitter writes, one per book it fitted (backfill-printed-page-4291.mjs). */
export const PRINTED_PAGE_SWEEP = { sweep: 'backfill-printed-page-4291', action: 'printed-page-fitted' };

/**
 * Pure: the book-level stock stages from the projected live books.
 *
 * `sets` are book ids read from other collections. A set is a positive control on itself: an empty
 * set, or a set none of whose ids is a live book, is a broken probe (a renamed collection or field,
 * or book ids written in another shape — 16K books carry a re-minted _id, so both `id` and `_id` are
 * tried), never 0 coverage. `controls` are findOne results for the field stages, true when a live
 * book carrying the field was found independently of the aggregation.
 */
export function bookStepStages(rows, { ftBooks, checkedBooks, pageNumberBooks }, controls) {
  const split = controls.split ?? {};
  const total = rows.length;
  const n = (pred) => rows.reduce((a, r) => a + (pred(r) ? 1 : 0), 0);
  const inSet = (set) => (r) => set.has(String(r.id)) || set.has(String(r._id));
  const setOk = (set) => set.size > 0 && rows.some(inSet(set));
  const stock = (stage, covered, ok, rest = {}) =>
    finalizeMeasurement({ stage, covered, total, queue_depth: null, stall_watch: false, ...rest }, ok && total > 0);

  return [
    stock('catalogue', n((r) => r.catalogue), controls.catalogue),
    stock('quality_score', n((r) => r.quality_score), controls.quality_score, {
      also: [{ label: 'placed in collections by score', n: n((r) => r.collections) }],
    }),
    stock('cover', n((r) => r.cover_page || r.cover_selected), controls.cover, {
      queue_depth: controls.coverQueue ?? null,
      detail: { with_cover_page: n((r) => r.cover_page) },
    }),
    // The page-number figure rides beside the places one; a broken fitter log drops that figure, not the row.
    stock('places', n((r) => r.place), controls.place, {
      also: [
        { label: 'with an author birth or death place', n: n((r) => r.author_place) },
        ...(setOk(pageNumberBooks) ? [{ label: 'with printed page numbers fitted', n: n(inSet(pageNumberBooks)) }] : []),
      ],
      ...(setOk(pageNumberBooks) ? {} : { detail: { printed_page: 'probe_broken: no fitter rows match a live book' } }),
    }),
    // Books, beside the pictures stage's count of pictures cut out (#425). Done: the book's pages were searched.
    stock('image_books', n((r) => r.pictures_count || r.pictures_stamp), controls.pictures, {
      also: [{ label: 'with the done or skip stamp the waiting count reads', n: n((r) => r.pictures_stamp) }],
    }),
    stock('ft_search', n(inSet(ftBooks)), setOk(ftBooks)),
    stock('book_checks', n(inSet(checkedBooks)), setOk(checkedBooks)),
    // A count (total null): a book has spreads or it does not, and nothing stored says which until phase 1.25 looks.
    // Waiting is phase 1.3's queue: flagged as spreads at archive_complete and not yet cut.
    finalizeMeasurement({
      stage: 'split', covered: n((r) => r.split), total: null, queue_depth: split.flagged ?? null, queue_visible: split.flaggedVisible ?? null, stall_watch: false,
      also: [
        ...(typeof split.pagesCut === 'number' ? [{ label: 'pages cut from spreads, hidden books included', n: split.pagesCut }] : []),
        ...(typeof split.unchecked === 'number' ? [{ label: 'books at archive_complete not yet checked for spreads', n: split.unchecked }] : []),
      ],
    }, !!split.control && total > 0),
  ];
}

/** catalogue, quality_score, cover, places, image_books, ft_search, book_checks, split — one pass over live books (#428). */
export async function measureBookSteps(db) {
  const books = db.collection('books');
  const opts = { maxTimeMS: CONTROL_MAX_TIME_MS };
  const has = { $exists: true, $ne: null };
  const [rows, ftIds, checkIds, pageNumberIds, catalogue, quality_score, cover, place, coverQueue, splitControl, splitQueue, pagesCut, pictures] = await Promise.all([
    books.aggregate(buildBookStepPipeline(), { maxTimeMS: COUNT_MAX_TIME_MS }).toArray(),
    // first_translation_attempts: one row per search, written by every search lane (ft-search/ingest.mjs and the verifiers).
    db.collection('first_translation_attempts').distinct('book_id', {}, { maxTimeMS: COUNT_MAX_TIME_MS }),
    // book_checks: one row per book read by a check (paired-fifths daily, v3#381; reader reports).
    db.collection('book_checks').distinct('book_id', {}, { maxTimeMS: COUNT_MAX_TIME_MS }),
    db.collection('sweep_log').distinct('book_id', PRINTED_PAGE_SWEEP, { maxTimeMS: COUNT_MAX_TIME_MS }),
    controlFound(books, { ...LIVE_BOOK_MATCH, 'ai_metadata.enriched_at': has }),
    controlFound(books, { ...LIVE_BOOK_MATCH, quality_score: has }),
    controlFound(books, { ...LIVE_BOOK_MATCH, cover_page: has }),
    controlFound(books, { ...LIVE_BOOK_MATCH, 'locations.type': 'publication' }),
    // What phase 8.9 takes: books at images_complete (indexed on pipeline_auto.status).
    books.countDocuments({ ...LIVE_BOOK_MATCH, 'pipeline_auto.status': 'images_complete' }, opts).catch(() => null),
    controlFound(books, { ...LIVE_BOOK_MATCH, split_completed: true }),
    // Phases 1.25 and 1.3 select at archive_complete (indexed on pipeline_auto.status; ~40K books, 12 s on 2026-11-16).
    books.aggregate([
      { $match: { 'pipeline_auto.status': 'archive_complete' } },
      { $group: {
        _id: null,
        unchecked: { $sum: { $cond: [{ $eq: ['$pipeline_auto.split_checked', true] }, 0, 1] } },
        flagged: { $sum: { $cond: [{ $and: [{ $eq: ['$pipeline_auto.split_checked', true] }, { $eq: ['$needs_splitting', true] }, { $ne: ['$split_completed', true] }] }, 1, 0] } },
        flaggedVisible: { $sum: { $cond: [{ $and: [{ $eq: ['$visible', true] }, { $eq: ['$pipeline_auto.split_checked', true] }, { $eq: ['$needs_splitting', true] }, { $ne: ['$split_completed', true] }] }, 1, 0] } },
      } },
    ], { maxTimeMS: COUNT_MAX_TIME_MS }).next().catch(() => null),
    // Each half page a split writes carries split_from_spread (indexed).
    db.collection('pages').countDocuments({ split_from_spread: true }, opts).catch(() => null),
    controlFound(books, { ...LIVE_BOOK_MATCH, 'pipeline_auto.images_done_at': has }),
  ]);
  const set = (ids) => new Set(ids.filter((x) => x != null).map(String));
  return bookStepStages(
    rows,
    { ftBooks: set(ftIds), checkedBooks: set(checkIds), pageNumberBooks: set(pageNumberIds) },
    { catalogue, quality_score, cover, place, coverQueue, pictures,
      split: { control: splitControl, flagged: splitQueue?.flagged ?? null, flaggedVisible: splitQueue?.flaggedVisible ?? null, unchecked: splitQueue?.unchecked ?? null, pagesCut } },
  );
}

/**
 * copy_holds — books the pre-OCR duplicate screen holds out of paid OCR as the same printing as a
 * copy we hold (pipeline_auto.hold.reason; status `held` is indexed). A count, not a share: hidden
 * queued books included, and there is no denominator a hold is "of". The control is the hold field
 * itself (any held book with a reason), so a screen that has released every hold still reads 0, not
 * broken.
 */
export async function measureCopyHolds(db) {
  const books = db.collection('books');
  const held = { 'pipeline_auto.status': 'held' };
  if (!(await controlFound(books, { ...held, 'pipeline_auto.hold.reason': { $type: 'string' } }))) {
    return finalizeMeasurement({ stage: 'copy_holds', stall_watch: false }, false);
  }
  // pages_count > 0 lets the planner walk the pages_count index (~190K books) instead of every `held`
  // book (~480K, nearly all manifest-only holds): 54 s on 2026-11-16. The screen compares page images,
  // so a book it holds has pages.
  const [g] = await books.aggregate(
    [
      { $match: { pages_count: { $gt: 0 }, ...held, 'pipeline_auto.hold.reason': COPY_HOLD_REASON } },
      { $group: { _id: null, n: { $sum: 1 }, visible: { $sum: { $cond: [{ $eq: ['$visible', true] }, 1, 0] } } } },
    ],
    { maxTimeMS: COUNT_MAX_TIME_MS },
  ).toArray();
  const covered = g?.n ?? 0;
  const visible = g?.visible ?? 0;
  // The other half of the row. Repeat captures (#5056) carry repeat_of, served by a partial index (42 ms). The
  // end pages phase 1.97 hides get page_number < 0 and hidden_reason 'ia_trailing_dupe', which no index serves,
  // so they are not counted; its queue is (archive_complete, not dedup_complete, on the status index).
  const pages = db.collection('pages');
  const opts = { maxTimeMS: CONTROL_MAX_TIME_MS };
  const [repeatControl, repeats, dedupQueue] = await Promise.all([
    controlFound(pages, { repeat_of: { $type: 'string' } }),
    pages.countDocuments({ repeat_of: { $type: 'string' } }, { ...opts, hint: { book_id: 1, repeat_of: 1, page_number: 1 } }).catch(() => null),
    books.aggregate([
      { $match: { 'pipeline_auto.status': 'archive_complete', 'pipeline_auto.dedup_complete': { $ne: true } } },
      { $group: { _id: null, n: { $sum: 1 }, visible: { $sum: { $cond: [{ $eq: ['$visible', true] }, 1, 0] } } } },
    ], opts).toArray().then(([q]) => q ?? { n: 0, visible: 0 }).catch(() => null),
  ]);
  return finalizeMeasurement(
    { stage: 'copy_holds', covered, total: null, queue_depth: dedupQueue?.n ?? null, queue_visible: dedupQueue?.visible ?? null, stall_watch: false, detail: { visible },
      also: repeatControl && typeof repeats === 'number' ? [{ label: 'pages hidden as repeat captures', n: repeats }] : [] },
    true,
  );
}

/** Pure: parts of a per-day figure, largest first, at most `max` with the rest summed as "other". */
export function dayPartsOf(groups, max = 3) {
  const sorted = [...groups].filter((g) => g.n > 0).sort((a, b) => b.n - a.n);
  const head = sorted.slice(0, max);
  const rest = sorted.slice(max).reduce((a, g) => a + g.n, 0);
  return rest > 0 ? [...head, { label: 'other', n: rest }] : head;
}

/**
 * imported — book records created on the last full UTC day, hidden included (books.created_at;
 * every importer stamps it, through insertBookIfNew). Split into books and artwork records,
 * because a museum harvest creates thousands of one-image records in a day. Served by the
 * {visible, created_at} index. The control: a book whose created_at is a date.
 */
export async function measureImports(db, { now = new Date() } = {}) {
  const books = db.collection('books');
  if (!(await controlFound(books, { visible: ANY_VISIBILITY, created_at: { $type: 'date' } }))) {
    return finalizeMeasurement({ stage: 'imported', stall_watch: false }, false);
  }
  const { day, start, end } = lastFullUtcDay(now);
  const groups = await books.aggregate(
    [
      { $match: { visible: ANY_VISIBILITY, created_at: { $gte: start, $lt: end } } },
      { $group: { _id: { $eq: ['$content_type', 'artwork'] }, n: { $sum: 1 } } },
    ],
    { maxTimeMS: COUNT_MAX_TIME_MS },
  ).toArray();
  const parts = groups.map((g) => ({ label: g._id ? 'artwork records' : 'books', n: g.n }));
  return finalizeMeasurement(
    { stage: 'imported', covered: null, total: null, queue_depth: null, stall_watch: false,
      per_day: { day, n: parts.reduce((a, p) => a + p.n, 0), parts: dayPartsOf(parts) } },
    true,
  );
}

/**
 * published — books made public on the last full UTC day through the publication writer
 * (publication_events rows with to:'public', one per transition; src/lib/publication.ts and its
 * .mjs twin). A writer that sets `visible` directly leaves no event and is not counted. The
 * collection has no index on `at`, so the day is bounded by _id (an ObjectId carries its insert
 * time) and then filtered on `at`. Parts are the writers (`by`).
 */
export async function measurePublished(db, { now = new Date() } = {}) {
  const events = db.collection('publication_events');
  if (!(await controlFound(events, { to: 'public', at: { $type: 'date' } }))) {
    return finalizeMeasurement({ stage: 'published', stall_watch: false }, false);
  }
  const { day, start, end } = lastFullUtcDay(now);
  const slack = 3600_000; // client clocks: an _id may be minted a little before or after `at`
  const groups = await events.aggregate(
    [
      { $match: {
        _id: { $gte: new ObjectId(objectIdHexAt(new Date(start.getTime() - slack))), $lt: new ObjectId(objectIdHexAt(new Date(end.getTime() + slack))) },
        to: 'public', at: { $gte: start, $lt: end },
      } },
      { $group: { _id: '$book_id', by: { $last: '$by' } } },
      { $group: { _id: '$by', n: { $sum: 1 } } },
    ],
    { maxTimeMS: COUNT_MAX_TIME_MS },
  ).toArray();
  const parts = groups.map((g) => ({ label: String(g._id ?? 'unnamed'), n: g.n }));
  return finalizeMeasurement(
    { stage: 'published', covered: null, total: null, queue_depth: null, stall_watch: false,
      per_day: { day, n: parts.reduce((a, p) => a + p.n, 0), parts: dayPartsOf(parts) } },
    true,
  );
}

// ── Page-level steps (#428) ─────────────────────────────────────────────────
//
// seams and search are flows (per_day, the last full UTC day), each read from the record its own writer leaves:
// book_events for the seam pass, cron_runs for the search copy. display and marks are SAMPLES: nothing stored
// counts pages without a reader-sized copy, and a mark can only be read from the image bytes, so both come from
// the weekly image-provenance audit, which draws random visible pages and reads each from R2. A sampled stage
// carries `sampled_at` and its sample size as the total; it is never differenced night to night.

/** book_events type the seam pass and seam-repair.mjs write, one row per write call (scripts/maintenance/seam-repair-6742). */
export const SEAM_EVENT = 'translation_seam_repaired';

/** Pure: a seam run id's family: 'seam-pass-8399-20261115…' → 'seam-pass-8399'. */
export function runFamily(run) {
  return typeof run === 'string' && run ? run.replace(/-\d{8,}.*$/, '') : 'unnamed run';
}

/**
 * seams — pages whose page-turn edge was rewritten on the last full UTC day. Joins the pass checked and left
 * alone are not stored (only seam-pass.jsonl on the box holds them), so this counts repairs, not checks.
 * book_events has no index on type or at; the day is bounded by _id, as in measurePublished.
 */
export async function measureSeams(db, { now = new Date() } = {}) {
  const events = db.collection('book_events');
  if (!(await controlFound(events, { type: SEAM_EVENT, at: { $type: 'date' } }))) {
    return finalizeMeasurement({ stage: 'seams', stall_watch: false }, false);
  }
  const { day, start, end } = lastFullUtcDay(now);
  const slack = 3600_000;
  const rows = await events.aggregate(
    [
      { $match: {
        _id: { $gte: new ObjectId(objectIdHexAt(new Date(start.getTime() - slack))), $lt: new ObjectId(objectIdHexAt(new Date(end.getTime() + slack))) },
        type: SEAM_EVENT, at: { $gte: start, $lt: end },
      } },
      { $project: { _id: 0, book_id: 1, run: '$details.run', pages: '$details.pages' } },
    ],
    { maxTimeMS: COUNT_MAX_TIME_MS },
  ).toArray();
  return finalizeMeasurement(
    { stage: 'seams', covered: null, total: null, queue_depth: null, stall_watch: false, ...seamDay(rows, day) },
    true,
  );
}

/** Pure: the seams per-day figure from that day's book_events rows. */
export function seamDay(rows, day) {
  const by = new Map();
  for (const r of rows) {
    const f = runFamily(r.run);
    by.set(f, (by.get(f) ?? 0) + (Number(r.pages) || 0));
  }
  const parts = [...by.entries()].map(([label, n]) => ({ label, n }));
  return {
    per_day: { day, n: parts.reduce((a, p) => a + p.n, 0), parts: dayPartsOf(parts) },
    detail: { repair_rows: rows.length, books: new Set(rows.map((r) => String(r.book_id))).size },
  };
}

/** cron_runs name sync-pages-content writes, one row per run that saw pages (scripts/workers/sync-pages-content.mjs). */
export const SEARCH_COPY_CRON = 'sync-pages-content';
/** sync-pages-content --max default: a run that saw this many pages did not cover its window. */
export const SEARCH_COPY_MAX_PAGES = 50000;

/**
 * search — pages copied to the search database on the last full UTC day, and pages that failed to copy. The gap
 * (pages whose text has not reached Supabase) is not stored anywhere; a capped run (one that saw --max pages) is
 * the record that the copy fell behind, so it is reported beside the figure. cron_runs {cron, timestamp} is indexed.
 */
export async function measureSearchCopy(db, { now = new Date() } = {}) {
  const runs = db.collection('cron_runs');
  if (!(await controlFound(runs, { cron: SEARCH_COPY_CRON, 'actions.synced': { $type: 'number' } }))) {
    return finalizeMeasurement({ stage: 'search', stall_watch: false }, false);
  }
  const { day, start, end } = lastFullUtcDay(now);
  const [rows, last] = await Promise.all([
    runs.find({ cron: SEARCH_COPY_CRON, timestamp: { $gte: start, $lt: end } }, { projection: { _id: 0, status: 1, actions: 1 }, maxTimeMS: CONTROL_MAX_TIME_MS }).toArray(),
    runs.find({ cron: SEARCH_COPY_CRON, status: 'success' }, { projection: { _id: 0, timestamp: 1 }, maxTimeMS: CONTROL_MAX_TIME_MS }).sort({ timestamp: -1 }).limit(1).next(),
  ]);
  const { per_day, detail } = searchCopyDay(rows, day);
  const last_success_at = last?.timestamp ? new Date(last.timestamp).toISOString() : null;
  return finalizeMeasurement(
    { stage: 'search', covered: null, total: null, queue_depth: null, stall_watch: false, per_day, detail: { ...detail, last_success_at } },
    true,
  );
}

/** Pure: the search per-day figure from that day's sync-pages-content run rows. */
export function searchCopyDay(rows, day) {
  const sum = (k) => rows.reduce((a, r) => a + (Number(r.actions?.[k]) || 0), 0);
  const synced = sum('synced'), failed = sum('failed');
  const parts = [{ label: 'copied', n: synced }, { label: 'failed to copy', n: failed }].filter((p) => p.n > 0);
  return {
    per_day: { day, n: synced, parts },
    detail: { runs: rows.length, failed_runs: rows.filter((r) => r.status !== 'success').length,
      capped_runs: rows.filter((r) => (Number(r.actions?.seen) || 0) >= SEARCH_COPY_MAX_PAGES).length },
  };
}

/** ops_reports _id image-provenance-coverage.mjs writes each week (#428). */
export const PROVENANCE_REPORT_ID = 'image-provenance-coverage';
/** A weekly report older than this is a stopped audit, not a measurement. */
export const PROVENANCE_MAX_AGE_DAYS = 15;

/**
 * Pure: display and marks from the stored provenance report, page-weighted frame. display: sampled visible pages
 * whose display_photo is an object on R2 (`noR2Display` is the rest). marks: of the sampled pages that are served
 * and can carry the mark, those the keyed detector found it on. A missing, stale or uncontrolled report is a broken
 * probe for both, never 0.
 */
export function provenanceStages(report, { now = new Date() } = {}) {
  const at = report?.at ? new Date(report.at) : null;
  const fresh = at && !Number.isNaN(at.getTime()) && now.getTime() - at.getTime() <= PROVENANCE_MAX_AGE_DAYS * 86400_000;
  const p = report?.pages;
  const ok = !!(fresh && report?.controls?.pass === true && p && typeof p.sampled === 'number' && p.sampled > 0);
  const why = !report ? 'no stored report' : !fresh ? `report older than ${PROVENANCE_MAX_AGE_DAYS} days` : 'controls failed or empty sample';
  const sampled_at = ok ? at.toISOString() : undefined;
  const broken = (stage) => ({ ...finalizeMeasurement({ stage, stall_watch: false }, false), detail: { reason: why, ...(report?.at ? { report_at: String(report.at) } : {}) } });
  if (!ok) return [broken('display'), broken('marks')];
  return [
    finalizeMeasurement({ stage: 'display', covered: p.sampled - (p.noR2Display ?? 0), total: p.sampled, queue_depth: null,
      stall_watch: false, sampled_at, detail: { without_r2_display: p.noR2Display ?? 0 } }, true),
    finalizeMeasurement({ stage: 'marks', covered: p.marked, total: p.n, queue_depth: null, stall_watch: false, sampled_at,
      detail: { by_book_rate: report.books?.rate ?? null, recent_rate: report.recent?.rate ?? null, recent_n: report.recent?.n ?? null } }, true),
  ];
}

/** display, marks — read from the weekly provenance report (ops_reports), not measured here. */
export async function measureProvenance(db, { now = new Date() } = {}) {
  const report = await db.collection('ops_reports').findOne({ _id: PROVENANCE_REPORT_ID }, { maxTimeMS: CONTROL_MAX_TIME_MS });
  return provenanceStages(report, { now });
}

// ── Reporting (#359) ─────────────────────────────────────────────────────────
//
// A broken probe says nothing about the pipeline; a stalled stage says the
// pipeline stopped. On 2026-11-14 both went out as one "Pipeline line: 5
// issue(s)" page, and nobody could tell which half was the instrument. They
// are reported separately everywhere a human reads them: the log line and
// two different ntfy pushes.

/** Pure: why a probe is broken, in one short phrase. */
export function brokenReason(stage) {
  const d = stage?.detail ?? {};
  if (d.error) return String(d.error).replace(/^.*::\s*caused by\s*::\s*/, '').slice(0, 120);
  if (d.counters_checked === 0) return 'the counter check drew no materialized books to recount';
  if (typeof d.counters_drifted === 'number') {
    return `page counters disagree with a recount on ${d.counters_drifted}/${d.counters_checked} books`;
  }
  return 'positive control found nothing';
}

/** Pure: broken stages grouped by reason — ["archived,ocr,translated: <reason>"]. */
export function describeBroken(stages) {
  const byReason = new Map();
  for (const s of stages ?? []) {
    if (s.status !== 'probe_broken') continue;
    const r = brokenReason(s);
    byReason.set(r, [...(byReason.get(r) ?? []), s.stage]);
  }
  return [...byReason].map(([reason, names]) => `${names.join(',')}: ${reason}`);
}

/**
 * Pure: the ntfy pushes for one snapshot. Pipeline problems (stalls, the
 * collector, aging batches) and instrument problems (broken probes) never share
 * a push or a count.
 */
export function buildAlertPushes({ stages, stalled, collectorAgeHours, agingUncollected }) {
  const pushes = [];
  const pipeline = [];
  if (stalled?.length) pipeline.push(`STALLED (queue>0, no progress since last snapshot): ${stalled.join(', ')}`);
  if (collectorAgeHours === Infinity) pipeline.push('Batch collector last ran NEVER (cron is every 30min)');
  else if (collectorAgeHours > 2) pipeline.push(`Batch collector last ran ${Math.round(collectorAgeHours)}h ago (cron is every 30min)`);
  if (typeof agingUncollected === 'number' && agingUncollected > 0) {
    pipeline.push(`${agingUncollected} paid batch job(s) uncollected >24h — Gemini discards output at ~2 days`);
  }
  if (pipeline.length) {
    pushes.push({
      title: `Pipeline line: ${pipeline.length} pipeline issue(s)`,
      body: pipeline.join('\n') + '\n\nsourcelibrary.org/platform/admin/line',
      priority: 'high',
    });
  }
  const broken = (stages ?? []).filter((s) => s.status === 'probe_broken');
  if (broken.length) {
    pushes.push({
      title: `Pipeline line INSTRUMENT broken: ${broken.map((s) => s.stage).join(', ')}`,
      body:
        'These probes could not measure. This is the monitor failing, NOT a stalled stage: ' +
        'it says nothing about whether these stages moved.\n' +
        describeBroken(broken).join('\n') +
        '\n\nscripts/lib/stage-coverage.mjs · sourcelibrary.org/platform/admin/line',
      priority: 'default',
    });
  }
  return pushes;
}

/** Pure: the one-line cron-log summary. A broken probe is never printed as a coverage figure or a stall. */
export function formatSummaryLine(doc, { dryRun = false } = {}) {
  const stages = doc.stages ?? [];
  const cell = (s) =>
    s.status !== 'ok' ? 'n/a'
      : s.per_day ? `${s.per_day.n} on ${s.per_day.day}`
      : s.total == null && typeof s.covered === 'number' ? String(s.covered)
      : (s.total ? `${((100 * s.covered) / s.total).toFixed(1)}%` : '—') +
        (typeof s.residue === 'number' && s.residue > 0 ? ` (queue ${s.queue_depth}, residue ${s.residue} no worker takes)` : '');
  const broken = describeBroken(stages);
  const stalled = doc.stalled ?? [];
  return (
    `[stage-coverage] ${stages.map((s) => `${s.stage} ${cell(s)}`).join(' | ')}` +
    ` | stalled: ${stalled.length ? stalled.join(',') : 'none'}` +
    ` | instrument broken: ${broken.length ? broken.join('; ') : 'none'}` +
    ` | dial: ${doc.dial?.paused ? 'PAUSED' : 'running'} budget=$${doc.dial?.daily_budget_usd ?? 'unset'}` +
    ` spend=$${Number(doc.spend_today_usd ?? 0).toFixed(2)} | ${doc.duration_ms}ms${dryRun ? ' (dry-run)' : ''}`
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
    // Book-level steps of the whole line (#428); none is stall-watched.
    ['imported', () => measureImports(db)],
    [['catalogue', 'quality_score', 'cover', 'places', 'image_books', 'ft_search', 'book_checks', 'split'], () => measureBookSteps(db)],
    ['copy_holds', () => measureCopyHolds(db)],
    ['published', () => measurePublished(db)],
    // Page-level steps (#428).
    ['seams', () => measureSeams(db)],
    ['search', () => measureSearchCopy(db)],
    [['display', 'marks'], () => measureProvenance(db)],
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
