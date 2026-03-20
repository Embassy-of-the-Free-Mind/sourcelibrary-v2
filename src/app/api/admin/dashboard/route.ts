import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 30;

const STALE_AFTER_MS = 15 * 60 * 1000; // 15 minutes

async function computeSnapshot(db: any) {
  const books = db.collection('books');
  const notHidden = { hidden: { $ne: true } };

  const [
    totalBooks,
    totals,
    readable,
    firstTranslations,
    firstTranslationsComplete,
    withSummary,
    withIndex,
    withImages,
    tagged,
    costData,
    jobsActive,
  ] = await Promise.all([
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
    ]).toArray(),
    books.countDocuments({
      ...notHidden,
      pages_ocr: { $gte: 1 },
      $expr: { $gte: ['$pages_translated', { $multiply: ['$pages_ocr', 0.9] }] },
    }),
    books.countDocuments({ ...notHidden, is_first_translation: true }),
    books.countDocuments({
      ...notHidden,
      is_first_translation: true,
      pages_ocr: { $gte: 10 },
      $expr: { $gte: ['$pages_translated', { $multiply: ['$pages_ocr', 0.9] }] },
    }),
    books.countDocuments({ ...notHidden, summary: { $exists: true, $nin: ['', null] } }),
    books.countDocuments({ ...notHidden, index_of_topics: { $exists: true, $nin: ['', null] } }),
    books.countDocuments({ ...notHidden, 'detected_images.0': { $exists: true } }),
    books.countDocuments({ ...notHidden, faceted_tags: { $exists: true, $ne: null } }),
    db.collection('gemini_usage').aggregate([
      {
        $match: {
          type: { $in: ['translate', 'translation'] },
          status: 'success',
          timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      },
      {
        $group: {
          _id: null,
          total_cost: { $sum: { $ifNull: ['$cost_usd', 0] } },
          pages: { $sum: 1 },
        },
      },
    ]).toArray(),
    db.collection('jobs').aggregate([
      { $match: { status: { $in: ['processing', 'queued'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const t = totals[0] || { pages: 0, pages_ocr: 0, pages_translated: 0 };
  const cost = costData[0] || { total_cost: 0, pages: 0 };
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
    economics: {
      cost_per_page_30d: cost.pages > 0 ? +(cost.total_cost / cost.pages).toFixed(4) : 0,
      total_cost_30d: +cost.total_cost.toFixed(2),
      pages_translated_30d: cost.pages,
    },
  };
}

export const GET = withAdminAuth(async () => {
  const db = await getDb();
  const config = db.collection('system_config');

  // Try to read cached snapshot
  const snapshot = await config.findOne({ _id: 'dashboard_snapshot' as any });

  if (snapshot?.data) {
    const age = Date.now() - new Date(snapshot.updated_at).getTime();
    const isStale = age > STALE_AFTER_MS;

    // Return cached data immediately; recompute in background if stale
    if (isStale) {
      // Fire and forget — don't await
      computeSnapshot(db).then(data => {
        config.updateOne(
          { _id: 'dashboard_snapshot' as any },
          { $set: { data, updated_at: new Date() } },
          { upsert: true },
        );
      }).catch(() => {});
    }

    return NextResponse.json({
      ...snapshot.data,
      _snapshot: {
        updated_at: snapshot.updated_at,
        stale: isStale,
      },
    });
  }

  // No snapshot yet — compute synchronously (first ever load)
  const data = await computeSnapshot(db);

  // Save snapshot
  await config.updateOne(
    { _id: 'dashboard_snapshot' as any },
    { $set: { data, updated_at: new Date() } },
    { upsert: true },
  ).catch(() => {});

  return NextResponse.json({
    ...data,
    _snapshot: {
      updated_at: new Date(),
      stale: false,
    },
  });
});
