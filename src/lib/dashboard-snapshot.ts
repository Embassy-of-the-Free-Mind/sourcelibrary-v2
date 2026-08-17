import type { Db } from 'mongodb';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * The `/admin` dashboard rollup: `system_config.dashboard_snapshot`.
 *
 * This lives outside the route because it has two callers that must never
 * drift — the cron (`/api/cron/dashboard-snapshot`) and the manual refresh
 * button (`POST /api/admin/dashboard`). It used to live inside the route with
 * POST as its only caller, and nothing called POST: no cron entry, no button.
 * The snapshot was last written 2026-04-01 and served for 138 days, showing
 * 13,713 books against a real 22,069 — and `/contribute` and
 * `/developers/pipeline` read the same document, so the stale numbers were
 * public, not just internal.
 *
 * Anything that reads this document must check `updated_at` and refuse or
 * label anything old. A number that looks authoritative and is wrong is worse
 * than no number (`.claude/docs/invariants/measurement-instruments.md`).
 */

export const DASHBOARD_SNAPSHOT_ID = 'dashboard_snapshot';

/** Past this age the snapshot is not fit to render as a current figure. */
export const DASHBOARD_SNAPSHOT_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

/** The cron runs hourly; past this the UI says so instead of implying freshness. */
export const DASHBOARD_SNAPSHOT_STALE_AFTER_MS = 90 * 60 * 1000;

export interface CollectionStats {
  total_books: number;
  total_pages: number;
  pages_ocr: number;
  pages_translated: number;
  first_translations: number;
}

export interface DashboardSnapshot {
  canon: {
    total_books: number;
    total_pages: number;
    readable_books: number;
    readable_percent: number;
    first_translations: number;
    first_translations_complete: number;
  };
  coverage: {
    ocr_pages: number;
    ocr_percent: number;
    translated_pages: number;
    translated_percent: number;
  };
  enrichment: {
    with_summary: number;
    with_index: number;
    with_images: number;
    tagged: number;
  };
  pipeline: { processing: number; queued: number };
  economics: {
    cost_per_page_30d: number;
    total_cost_30d: number;
    pages_translated_30d: number;
    /** True when the cost query hit its page cap and the totals are a floor. */
    truncated: boolean;
  };
  invisible?: CollectionStats;
  warehouse?: CollectionStats;
}

/** supabase-js silently caps a response at 1,000 rows regardless of `.limit()`. */
const SUPABASE_PAGE = 1000;
/** Bounds the paginated read at 500k rows so a runaway table can't hang the cron. */
const MAX_COST_PAGES = 500;

/**
 * 30-day translation spend from Supabase `gemini_usage`.
 *
 * Must paginate: supabase-js truncates every response at 1,000 rows with no
 * error and no warning (see CLAUDE.md, "Stack"). The previous implementation
 * asked for `.limit(50000)` and summed whatever came back, so against 18,298
 * real rows it reported the cost of the first 1,000 — understating spend ~18x
 * — and published `pages_translated_30d: 1000`, which was the cap constant
 * wearing a metric's clothes.
 */
async function fetchThirtyDayCost(db: Db): Promise<{ total_cost: number; pages: number; truncated: boolean }> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  if (!supabaseAdmin) {
    // MongoDB `gemini_usage` is a near-empty stub kept only as a build-time
    // fallback; Supabase has been the primary store since 2026-04-10 (#567).
    const rows = await db
      .collection('gemini_usage')
      .aggregate<{ total_cost: number; pages: number }>(
        [
          { $match: { type: { $in: ['translate', 'translation'] }, status: 'success', timestamp: { $gte: cutoff } } },
          { $group: { _id: null, total_cost: { $sum: { $ifNull: ['$cost_usd', 0] } }, pages: { $sum: 1 } } },
        ],
        { maxTimeMS: 10000 },
      )
      .toArray()
      .catch(() => []);
    const r = rows[0];
    return { total_cost: r?.total_cost ?? 0, pages: r?.pages ?? 0, truncated: false };
  }

  let total_cost = 0;
  let pages = 0;
  let truncated = false;

  for (let page = 0; page < MAX_COST_PAGES; page++) {
    const from = page * SUPABASE_PAGE;
    const { data, error } = await supabaseAdmin
      .from('gemini_usage')
      .select('cost_usd')
      .in('type', ['translate', 'translation'])
      .eq('status', 'success')
      .gte('timestamp', cutoff.toISOString())
      .order('timestamp', { ascending: true })
      .range(from, from + SUPABASE_PAGE - 1);

    if (error) {
      // Report what we actually summed rather than zero, but mark it a floor.
      console.warn('[dashboard-snapshot] Supabase cost query failed:', error.message);
      return { total_cost, pages, truncated: true };
    }

    const batch = data ?? [];
    for (const row of batch) total_cost += row.cost_usd ?? 0;
    pages += batch.length;

    if (batch.length < SUPABASE_PAGE) return { total_cost, pages, truncated: false };
    if (page === MAX_COST_PAGES - 1) truncated = true;
  }

  console.warn(`[dashboard-snapshot] cost query hit the ${MAX_COST_PAGES}-page cap — totals are a floor`);
  return { total_cost, pages, truncated };
}

export async function computeDashboardSnapshot(db: Db): Promise<DashboardSnapshot> {
  const books = db.collection('books');
  const warehouse = db.collection('books_warehouse');
  const notHidden = { visible: true, pages_count: { $gt: 0 } };
  const invisible = { visible: { $ne: true } };
  const groupStage = {
    $group: {
      _id: null,
      pages: { $sum: { $ifNull: ['$pages_count', 0] } },
      pages_ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
      pages_translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
    },
  };

  const [
    totalBooks, totals,
    firstTranslations,
    withSummary, withIndex, withImages, tagged,
    jobsActive,
    readable, firstTranslationsComplete,
    cost,
  ] = await Promise.all([
    books.countDocuments(notHidden),
    books.aggregate([{ $match: notHidden }, groupStage], { maxTimeMS: 15000 }).toArray(),
    books.countDocuments({ ...notHidden, is_first_translation: true }),
    books.countDocuments({ ...notHidden, summary: { $exists: true, $ne: null } }),
    // `index`, not `index_of_topics` — and `detected_images_count`, not a
    // `detected_images` array. Both of the old names matched zero documents, so
    // the dashboard published "0 indexes, 0 images extracted" for months
    // against a real 17,215 and 9,111. Absence of a field is not a count of
    // zero (`.claude/docs/invariants/field-sprawl.md`).
    books.countDocuments({ ...notHidden, index: { $exists: true, $ne: null } }),
    books.countDocuments({ ...notHidden, detected_images_count: { $gt: 0 } }),
    books.countDocuments({ ...notHidden, faceted_tags: { $exists: true, $ne: null } }),
    db.collection('jobs').aggregate([
      { $match: { status: { $in: ['processing', 'queued'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ], { maxTimeMS: 5000 }).toArray(),
    books.countDocuments({
      ...notHidden, pages_ocr: { $gte: 1 },
      $expr: { $gte: ['$pages_translated', { $multiply: ['$pages_ocr', 0.9] }] },
    }),
    books.countDocuments({
      ...notHidden, is_first_translation: true, pages_ocr: { $gte: 10 },
      $expr: { $gte: ['$pages_translated', { $multiply: ['$pages_ocr', 0.9] }] },
    }),
    fetchThirtyDayCost(db),
  ]);

  const t = (totals[0] as { pages: number; pages_ocr: number; pages_translated: number } | undefined)
    ?? { pages: 0, pages_ocr: 0, pages_translated: 0 };
  const jobMap = Object.fromEntries(
    (jobsActive as Array<{ _id: string; count: number }>).map(j => [j._id, j.count]),
  );

  // Phase 2: invisible + warehouse. Optional — Atlas under pipeline load will
  // time these out, and a dashboard missing two rows beats no dashboard.
  let invisibleStats: CollectionStats | null = null;
  let warehouseStats: CollectionStats | null = null;
  try {
    const [
      invisibleCount, invisibleTotals, invisibleFT,
      warehouseCount, warehouseTotals, warehouseFT,
    ] = await Promise.all([
      books.countDocuments(invisible),
      books.aggregate([{ $match: invisible }, groupStage], { maxTimeMS: 10000 }).toArray(),
      books.countDocuments({ ...invisible, is_first_translation: true }),
      warehouse.countDocuments({}),
      warehouse.aggregate([groupStage], { maxTimeMS: 10000 }).toArray(),
      warehouse.countDocuments({ is_first_translation: true }),
    ]);
    const it = (invisibleTotals[0] as typeof t | undefined) ?? { pages: 0, pages_ocr: 0, pages_translated: 0 };
    const wt = (warehouseTotals[0] as typeof t | undefined) ?? { pages: 0, pages_ocr: 0, pages_translated: 0 };
    invisibleStats = {
      total_books: invisibleCount, total_pages: it.pages,
      pages_ocr: it.pages_ocr, pages_translated: it.pages_translated,
      first_translations: invisibleFT,
    };
    warehouseStats = {
      total_books: warehouseCount, total_pages: wt.pages,
      pages_ocr: wt.pages_ocr, pages_translated: wt.pages_translated,
      first_translations: warehouseFT,
    };
  } catch { /* Atlas overloaded — skip extended stats */ }

  return {
    canon: {
      total_books: totalBooks,
      total_pages: t.pages,
      readable_books: readable,
      readable_percent: totalBooks > 0 ? +(readable / totalBooks * 100).toFixed(1) : 0,
      first_translations: firstTranslations,
      first_translations_complete: firstTranslationsComplete,
    },
    coverage: {
      ocr_pages: t.pages_ocr,
      ocr_percent: t.pages > 0 ? +(t.pages_ocr / t.pages * 100).toFixed(1) : 0,
      translated_pages: t.pages_translated,
      translated_percent: t.pages > 0 ? +(t.pages_translated / t.pages * 100).toFixed(1) : 0,
    },
    enrichment: {
      with_summary: withSummary,
      with_index: withIndex,
      with_images: withImages,
      tagged,
    },
    pipeline: {
      processing: jobMap.processing || 0,
      queued: jobMap.queued || 0,
    },
    economics: {
      cost_per_page_30d: cost.pages > 0 ? +(cost.total_cost / cost.pages).toFixed(4) : 0,
      total_cost_30d: +cost.total_cost.toFixed(2),
      pages_translated_30d: cost.pages,
      truncated: cost.truncated,
    },
    ...(invisibleStats && { invisible: invisibleStats }),
    ...(warehouseStats && { warehouse: warehouseStats }),
  };
}

/** Compute and persist. Returns the snapshot that was written. */
export async function refreshDashboardSnapshot(db: Db): Promise<DashboardSnapshot> {
  const data = await computeDashboardSnapshot(db);
  await db.collection('system_config').updateOne(
    { _id: DASHBOARD_SNAPSHOT_ID as unknown as import('mongodb').ObjectId },
    { $set: { data, updated_at: new Date() } },
    { upsert: true },
  );
  return data;
}

/**
 * Read the snapshot, refusing anything past `maxAgeMs`.
 *
 * Callers that render public figures should use this rather than reading
 * `system_config` directly, so a dead rollup degrades to "no number" instead
 * of to a confident wrong one.
 */
export async function readFreshDashboardSnapshot(
  db: Db,
  maxAgeMs: number = DASHBOARD_SNAPSHOT_MAX_AGE_MS,
): Promise<{ data: DashboardSnapshot; updatedAt: Date; ageMs: number } | null> {
  const doc = await db.collection('system_config').findOne(
    { _id: DASHBOARD_SNAPSHOT_ID as unknown as import('mongodb').ObjectId },
  );
  if (!doc?.data || !doc.updated_at) return null;

  const updatedAt = new Date(doc.updated_at);
  const ageMs = Date.now() - updatedAt.getTime();
  if (!Number.isFinite(ageMs) || ageMs > maxAgeMs) {
    console.warn(
      `[dashboard-snapshot] snapshot is ${Math.round(ageMs / 86_400_000)}d old ` +
      `(max ${Math.round(maxAgeMs / 86_400_000)}d) — refusing to serve stale totals`,
    );
    return null;
  }
  return { data: doc.data as DashboardSnapshot, updatedAt, ageMs };
}
