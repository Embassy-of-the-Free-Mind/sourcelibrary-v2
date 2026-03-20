import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 30;

// In-memory cache (5 minutes)
let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export const GET = withAdminAuth(async () => {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }

  const db = await getDb();

  // Single scan of books collection for all metrics
  const [bookStats, costData, jobsActive] = await Promise.all([
    db.collection('books').aggregate([
      { $match: { hidden: { $ne: true } } },
      {
        $group: {
          _id: null,
          books: { $sum: 1 },
          pages: { $sum: { $ifNull: ['$pages_count', 0] } },
          pages_ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
          pages_translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
          readable: {
            $sum: {
              $cond: [
                { $and: [
                  { $gte: ['$pages_ocr', 1] },
                  { $gte: ['$pages_translated', { $multiply: ['$pages_ocr', 0.9] }] },
                ] },
                1, 0,
              ],
            },
          },
          first_translations: {
            $sum: { $cond: [{ $eq: ['$is_first_translation', true] }, 1, 0] },
          },
          first_translations_complete: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$is_first_translation', true] },
                  { $gte: ['$pages_ocr', 10] },
                  { $gte: ['$pages_translated', { $multiply: ['$pages_ocr', 0.9] }] },
                ] },
                1, 0,
              ],
            },
          },
          with_summary: {
            $sum: {
              $cond: [
                { $or: [
                  { $and: [{ $eq: [{ $type: '$summary' }, 'string'] }, { $ne: ['$summary', ''] }] },
                  { $ne: [{ $ifNull: ['$summary.data', ''] }, ''] },
                ] },
                1, 0,
              ],
            },
          },
          with_index: {
            $sum: {
              $cond: [
                { $or: [
                  { $and: [{ $eq: [{ $type: '$index_of_topics' }, 'string'] }, { $ne: ['$index_of_topics', ''] }] },
                  { $ne: [{ $ifNull: ['$index_of_topics.data', ''] }, ''] },
                ] },
                1, 0,
              ],
            },
          },
          with_images: {
            $sum: {
              $cond: [
                { $and: [{ $isArray: '$detected_images' }, { $gte: [{ $size: '$detected_images' }, 1] }] },
                1, 0,
              ],
            },
          },
          tagged: {
            $sum: {
              $cond: [
                { $and: [{ $ne: [{ $ifNull: ['$faceted_tags', null] }, null] }, { $ne: ['$faceted_tags', {}] }] },
                1, 0,
              ],
            },
          },
        },
      },
    ]).toArray(),

    // Cost (different collection, must be separate)
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

    // Jobs (different collection, must be separate)
    db.collection('jobs').aggregate([
      { $match: { status: { $in: ['processing', 'queued'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const b = bookStats[0] || {
    books: 0, pages: 0, pages_ocr: 0, pages_translated: 0,
    readable: 0, first_translations: 0, first_translations_complete: 0,
    with_summary: 0, with_index: 0, with_images: 0, tagged: 0,
  };
  const cost = costData[0] || { total_cost: 0, pages: 0 };
  const jobMap = Object.fromEntries(jobsActive.map((j: any) => [j._id, j.count]));

  const data = {
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

  cache = { data, ts: Date.now() };
  return NextResponse.json(data);
});
