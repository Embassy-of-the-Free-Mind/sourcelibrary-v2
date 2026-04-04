import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 60;

const STALE_AFTER_MS = 15 * 60 * 1000;

async function computeSnapshot(db: any) {
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

  // Phase 1: Core visible-books queries (same as before, ~10 parallel queries)
  const [
    totalBooks, totals,
    firstTranslations,
    withSummary, withIndex, withImages, tagged,
    jobsActive,
    readable, firstTranslationsComplete,
    costData,
  ] = await Promise.all([
    books.countDocuments(notHidden),
    books.aggregate([{ $match: notHidden }, groupStage], { maxTimeMS: 15000 }).toArray(),
    books.countDocuments({ ...notHidden, is_first_translation: true }),
    books.countDocuments({ ...notHidden, summary: { $exists: true, $ne: null } }),
    books.countDocuments({ ...notHidden, index_of_topics: { $exists: true, $ne: null } }),
    books.countDocuments({ ...notHidden, 'detected_images.0': { $exists: true } }),
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
    db.collection('gemini_usage').aggregate([
      { $match: { type: { $in: ['translate', 'translation'] }, status: 'success', timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
      { $group: { _id: null, total_cost: { $sum: { $ifNull: ['$cost_usd', 0] } }, pages: { $sum: 1 } } },
    ], { maxTimeMS: 10000 }).toArray().catch(() => []),
  ]);

  const t = totals[0] || { pages: 0, pages_ocr: 0, pages_translated: 0 };
  const jobMap = Object.fromEntries(jobsActive.map((j: any) => [j._id, j.count]));
  const cost = costData[0] || { total_cost: 0, pages: 0 };
  const economics = {
    cost_per_page_30d: cost.pages > 0 ? +(cost.total_cost / cost.pages).toFixed(4) : 0,
    total_cost_30d: +cost.total_cost.toFixed(2),
    pages_translated_30d: cost.pages,
  };

  // Phase 2: Invisible + warehouse (optional, gracefully degrades)
  let invisibleStats = null;
  let warehouseStats = null;
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
    const it = invisibleTotals[0] || { pages: 0, pages_ocr: 0, pages_translated: 0 };
    const wt = warehouseTotals[0] || { pages: 0, pages_ocr: 0, pages_translated: 0 };
    invisibleStats = { total_books: invisibleCount, total_pages: it.pages, pages_ocr: it.pages_ocr, pages_translated: it.pages_translated, first_translations: invisibleFT };
    warehouseStats = { total_books: warehouseCount, total_pages: wt.pages, pages_ocr: wt.pages_ocr, pages_translated: wt.pages_translated, first_translations: warehouseFT };
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
    economics,
    ...(invisibleStats && { invisible: invisibleStats }),
    ...(warehouseStats && { warehouse: warehouseStats }),
  };
}

// GET: read-only — just returns the snapshot. Never computes inline.
// Snapshot is refreshed by POST (called from cron or manually).
export const GET = withAdminAuth(async () => {
  const db = await getDb();
  const snapshot = await db.collection('system_config').findOne({ _id: 'dashboard_snapshot' as any });

  if (!snapshot?.data) {
    return NextResponse.json(
      { _computing: true, message: 'No snapshot yet. Hit the refresh button or wait for the next cron run.' },
      { status: 202 },
    );
  }

  const age = Date.now() - new Date(snapshot.updated_at).getTime();
  return NextResponse.json({
    ...snapshot.data,
    _snapshot: {
      updated_at: snapshot.updated_at,
      stale: age > STALE_AFTER_MS,
    },
  });
});

// POST: recompute snapshot. Called from cron or admin UI.
export const POST = withAdminAuth(async () => {
  const db = await getDb();
  const data = await computeSnapshot(db);
  await db.collection('system_config').updateOne(
    { _id: 'dashboard_snapshot' as any },
    { $set: { data, updated_at: new Date() } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true, data });
});
