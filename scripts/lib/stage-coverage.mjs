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
 * carries maxTimeMS. No unbounded aggregations over `pages`.
 *
 * Conventions reused:
 *   - visible pages: page_number > 0 (scripts/lib/page-counts.mjs, #3293)
 *   - live books: visible:true && pages_count>0 (canonical public filter)
 *   - archive failure markers: archived_photo starting 'failed:'
 *   - #2430 canary: gallery_images rows with a detection above the
 *     thumbnail-quality bar but no extracted_url — the batch collector writes
 *     bbox-only rows and generate-thumbnails materializes them; rows stuck in
 *     that state are the images queue.
 */

import { VISIBLE_PAGE_MATCH } from './page-counts.mjs';

const COUNT_MAX_TIME_MS = 10 * 60_000; // nightly job; pages is ~5M docs
const CONTROL_MAX_TIME_MS = 60_000;

/** Canonical "live" book filter used across public APIs. */
export const LIVE_BOOK_MATCH = { visible: true, pages_count: { $gt: 0 } };

/** Non-empty string, not an archive-failure marker. */
const ARCHIVED_OK = { $type: 'string', $ne: '', $not: /^failed:/ };

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

/**
 * Scoped positive control for `pages` probes: an unscoped findOne on an
 * unindexed predicate collscans ~19M docs and times out, which reads as
 * probe_broken (observed on the first supervised run, 2026-08-08 — the
 * control caught its own cost). Scope the control to ONE live processed
 * book's pages (book_id is indexed) so it answers in milliseconds.
 */
async function pagesControlFound(db, predicate) {
  try {
    const book = await db.collection('books').findOne(
      { visible: true, pages_ocr: { $gt: 0 }, pages_translated: { $gt: 0 } },
      { projection: { id: 1 }, maxTimeMS: CONTROL_MAX_TIME_MS },
    );
    if (!book?.id) return false;
    const doc = await db.collection('pages').findOne(
      { book_id: book.id, ...predicate },
      { projection: { _id: 1 }, maxTimeMS: CONTROL_MAX_TIME_MS },
    );
    return doc != null;
  } catch {
    return false;
  }
}

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

/** archived — pages whose archived_photo is a real URL (not a failure marker). */
export async function measureArchived(db) {
  const pages = db.collection('pages');
  const coveredPredicate = { archived_photo: ARCHIVED_OK };
  if (!(await pagesControlFound(db, coveredPredicate))) {
    return finalizeMeasurement({ stage: 'archived' }, false);
  }
  const [total, covered, failed] = await Promise.all([
    pages.estimatedDocumentCount(),
    count(pages, coveredPredicate),
    count(pages, { archived_photo: /^failed:/ }),
  ]);
  return finalizeMeasurement(
    {
      stage: 'archived',
      covered,
      total,
      // Failure markers are not queue — an archiver selects on the field being
      // empty, so marked pages are invisible to it (see Data Protection
      // corollary in CLAUDE.md). They're surfaced in detail instead.
      queue_depth: Math.max(0, total - covered - failed),
      detail: { failed_markers: failed },
    },
    true,
  );
}

/** ocr — visible pages carrying non-empty ocr.data (page-level, not books.pages_ocr). */
export async function measureOcr(db) {
  const pages = db.collection('pages');
  const coveredPredicate = { ...VISIBLE_PAGE_MATCH, 'ocr.data': { $type: 'string', $ne: '' } };
  if (!(await pagesControlFound(db, coveredPredicate))) {
    return finalizeMeasurement({ stage: 'ocr' }, false);
  }
  const [total, covered] = await Promise.all([
    count(pages, VISIBLE_PAGE_MATCH),
    count(pages, coveredPredicate),
  ]);
  return finalizeMeasurement(
    { stage: 'ocr', covered, total, queue_depth: Math.max(0, total - covered) },
    true,
  );
}

/** translated — visible NON-BLANK pages carrying a real translation.
 *  Mirrors isTranslatedPage() (#3747): blank leaves carry the literal
 *  placeholder, not a translation, and are excluded from BOTH sides —
 *  they can never be translated, so counting them as queue would show a
 *  permanently unreachable backlog. */
export async function measureTranslated(db) {
  const pages = db.collection('pages');
  const nonBlank = { ...VISIBLE_PAGE_MATCH, page_type: { $ne: 'blank' } };
  const coveredPredicate = { ...nonBlank, 'translation.data': { $type: 'string', $ne: '' } };
  if (!(await pagesControlFound(db, coveredPredicate))) {
    return finalizeMeasurement({ stage: 'translated' }, false);
  }
  const [total, covered] = await Promise.all([
    count(pages, nonBlank),
    count(pages, coveredPredicate),
  ]);
  return finalizeMeasurement(
    { stage: 'translated', covered, total, queue_depth: Math.max(0, total - covered) },
    true,
  );
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
    ['archived', () => measureArchived(db)],
    ['ocr', () => measureOcr(db)],
    ['translated', () => measureTranslated(db)],
    ['summaries', () => measureSummaries(db)],
    ['chapters', () => measureChapters(db)],
    ['images', () => measureImages(db)],
    ['embeddings', () => measureEmbeddings(db, { fetchImpl })],
    ['identity', () => measureIdentity(db)],
  ];
  const out = [];
  for (const [stage, fn] of measurements) {
    try {
      out.push(await fn());
    } catch (err) {
      out.push({
        ...finalizeMeasurement({ stage }, false),
        detail: { error: String(err?.message || err).slice(0, 300) },
      });
    }
  }
  return out;
}
