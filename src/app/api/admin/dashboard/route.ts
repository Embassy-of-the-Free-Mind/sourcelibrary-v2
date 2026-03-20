import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 60;

const STALE_AFTER_MS = 15 * 60 * 1000;

async function computeSnapshot(db: any) {
  const books = db.collection('books');
  const notHidden = { hidden: { $ne: true } };

  // Single aggregation — one collection scan, all metrics computed together
  const [stats] = await books.aggregate([
    { $match: notHidden },
    {
      $group: {
        _id: null,
        books: { $sum: 1 },
        pages: { $sum: { $ifNull: ['$pages_count', 0] } },
        pages_ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
        pages_translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
        readable: {
          $sum: { $cond: [{ $gte: [{ $ifNull: ['$translation_percent', 0] }, 90] }, 1, 0] },
        },
        first_translations: {
          $sum: { $cond: [{ $eq: ['$is_first_translation', true] }, 1, 0] },
        },
        first_translations_complete: {
          $sum: {
            $cond: [
              { $and: [
                { $eq: ['$is_first_translation', true] },
                { $gte: [{ $ifNull: ['$translation_percent', 0] }, 90] },
              ] },
              1, 0,
            ],
          },
        },
        with_summary: {
          $sum: { $cond: [{ $gt: [{ $ifNull: ['$summary', null] }, null] }, 1, 0] },
        },
        with_index: {
          $sum: { $cond: [{ $gt: [{ $ifNull: ['$index_of_topics', null] }, null] }, 1, 0] },
        },
        with_images: {
          $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$detected_images', []] } }, 0] }, 1, 0] },
        },
        tagged: {
          $sum: { $cond: [{ $gt: [{ $ifNull: ['$faceted_tags', null] }, null] }, 1, 0] },
        },
      },
    },
  ]).toArray();

  const b = stats || {
    books: 0, pages: 0, pages_ocr: 0, pages_translated: 0, readable: 0,
    first_translations: 0, first_translations_complete: 0,
    with_summary: 0, with_index: 0, with_images: 0, tagged: 0,
  };

  // Only 2 extra queries on different collections
  const [costData, jobsActive] = await Promise.all([
    db.collection('gemini_usage').aggregate([
      {
        $match: {
          type: { $in: ['translate', 'translation'] },
          status: 'success',
          timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      },
      { $group: { _id: null, total_cost: { $sum: { $ifNull: ['$cost_usd', 0] } }, pages: { $sum: 1 } } },
    ]).toArray(),
    db.collection('jobs').aggregate([
      { $match: { status: { $in: ['processing', 'queued'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const cost = costData[0] || { total_cost: 0, pages: 0 };
  const jobMap = Object.fromEntries(jobsActive.map((j: any) => [j._id, j.count]));

  return {
    canon: {
      total_books: b.books,
      total_pages: b.pages,
      readable_books: b.readable,
      readable_percent: b.books > 0 ? +(b.readable / b.books * 100).toFixed(1) : 0,
      first_translations: b.first_translations,
      first_translations_complete: b.first_translations_complete,
    },
    coverage: {
      ocr_pages: b.pages_ocr,
      ocr_percent: b.pages > 0 ? +(b.pages_ocr / b.pages * 100).toFixed(1) : 0,
      translated_pages: b.pages_translated,
      translated_percent: b.pages > 0 ? +(b.pages_translated / b.pages * 100).toFixed(1) : 0,
    },
    enrichment: {
      with_summary: b.with_summary,
      with_index: b.with_index,
      with_images: b.with_images,
      tagged: b.tagged,
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

  const snapshot = await config.findOne({ _id: 'dashboard_snapshot' as any });

  if (snapshot?.data) {
    const age = Date.now() - new Date(snapshot.updated_at).getTime();
    const isStale = age > STALE_AFTER_MS;

    if (isStale) {
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
      _snapshot: { updated_at: snapshot.updated_at, stale: isStale },
    });
  }

  // First ever load — compute and save
  const data = await computeSnapshot(db);
  await config.updateOne(
    { _id: 'dashboard_snapshot' as any },
    { $set: { data, updated_at: new Date() } },
    { upsert: true },
  ).catch(() => {});

  return NextResponse.json({
    ...data,
    _snapshot: { updated_at: new Date(), stale: false },
  });
});
