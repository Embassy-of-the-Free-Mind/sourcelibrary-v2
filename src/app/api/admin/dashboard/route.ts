import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 60;

const STALE_AFTER_MS = 15 * 60 * 1000;

async function computeSnapshot(db: any) {
  const books = db.collection('books');
  const notHidden = { hidden: { $ne: true } };

  // Use simple countDocuments — each one is fast with proper filters
  // Run in two batches to avoid overwhelming cold connections
  const [totalBooks, totals] = await Promise.all([
    books.countDocuments(notHidden),
    books.aggregate([
      { $match: notHidden },
      {
        $group: {
          _id: null,
          pages: { $sum: { $ifNull: ['$pages_count', 0] } },
          pages_ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
          pages_translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
        },
      },
    ], { maxTimeMS: 15000 }).toArray(),
  ]);

  const t = totals[0] || { pages: 0, pages_ocr: 0, pages_translated: 0 };

  // Second batch: simple indexed counts
  // NOTE: translation_percent is NOT stored on docs — must use $expr on pages_ocr/pages_translated
  const [
    firstTranslations,
    withSummary,
    withIndex,
    withImages,
    tagged,
    jobsActive,
  ] = await Promise.all([
    books.countDocuments({ ...notHidden, is_first_translation: true }),
    books.countDocuments({ ...notHidden, summary: { $exists: true, $ne: null } }),
    books.countDocuments({ ...notHidden, index_of_topics: { $exists: true, $ne: null } }),
    books.countDocuments({ ...notHidden, 'detected_images.0': { $exists: true } }),
    books.countDocuments({ ...notHidden, faceted_tags: { $exists: true, $ne: null } }),
    db.collection('jobs').aggregate([
      { $match: { status: { $in: ['processing', 'queued'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ], { maxTimeMS: 5000 }).toArray(),
  ]);

  // Readable = >=90% of OCR'd pages translated (uses cached page counts)
  const readable = await books.countDocuments({
    ...notHidden,
    pages_ocr: { $gte: 1 },
    $expr: { $gte: ['$pages_translated', { $multiply: ['$pages_ocr', 0.9] }] },
  });

  const firstTranslationsComplete = await books.countDocuments({
    ...notHidden,
    is_first_translation: true,
    pages_ocr: { $gte: 10 },
    $expr: { $gte: ['$pages_translated', { $multiply: ['$pages_ocr', 0.9] }] },
  });

  // Cost query last (different collection, can be slow)
  let economics = { cost_per_page_30d: 0, total_cost_30d: 0, pages_translated_30d: 0 };
  try {
    const costData = await db.collection('gemini_usage').aggregate([
      {
        $match: {
          type: { $in: ['translate', 'translation'] },
          status: 'success',
          timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      },
      { $group: { _id: null, total_cost: { $sum: { $ifNull: ['$cost_usd', 0] } }, pages: { $sum: 1 } } },
    ], { maxTimeMS: 10000 }).toArray();
    const cost = costData[0] || { total_cost: 0, pages: 0 };
    economics = {
      cost_per_page_30d: cost.pages > 0 ? +(cost.total_cost / cost.pages).toFixed(4) : 0,
      total_cost_30d: +cost.total_cost.toFixed(2),
      pages_translated_30d: cost.pages,
    };
  } catch { /* cost query timed out — use defaults */ }

  const jobMap = Object.fromEntries(jobsActive.map((j: any) => [j._id, j.count]));

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
