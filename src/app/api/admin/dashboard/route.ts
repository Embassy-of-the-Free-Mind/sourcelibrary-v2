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
  const books = db.collection('books');
  const notHidden = { hidden: { $ne: true } };

  // All lightweight queries in parallel — countDocuments + small aggregations
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

    // Totals for pages — single group, uses cached book-level fields
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

    // Enrichment — simple exists checks, much faster than $type/$isArray in aggregation
    books.countDocuments({ ...notHidden, summary: { $exists: true, $nin: ['', null] } }),
    books.countDocuments({ ...notHidden, index_of_topics: { $exists: true, $nin: ['', null] } }),
    books.countDocuments({ ...notHidden, 'detected_images.0': { $exists: true } }),
    books.countDocuments({ ...notHidden, faceted_tags: { $exists: true, $ne: null } }),

    // Cost (gemini_usage collection)
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

    // Jobs
    db.collection('jobs').aggregate([
      { $match: { status: { $in: ['processing', 'queued'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const t = totals[0] || { pages: 0, pages_ocr: 0, pages_translated: 0 };
  const cost = costData[0] || { total_cost: 0, pages: 0 };
  const jobMap = Object.fromEntries(jobsActive.map((j: any) => [j._id, j.count]));

  const data = {
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

  cache = { data, ts: Date.now() };
  return NextResponse.json(data);
});
