import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 60;

// In-memory cache (5 minutes)
let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export const GET = withAdminAuth(async () => {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }

  const db = await getDb();

  const [
    totals,
    readableBooks,
    firstTranslations,
    enrichment,
    costData,
    jobsActive,
  ] = await Promise.all([
    // Overall totals
    db.collection('books').aggregate([
      { $match: { hidden: { $ne: true } } },
      {
        $group: {
          _id: null,
          books: { $sum: 1 },
          pages: { $sum: { $ifNull: ['$pages_count', 0] } },
          pages_ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
          pages_translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
        },
      },
    ]).toArray(),

    // Readable books (>=90% translated)
    db.collection('books').countDocuments({
      hidden: { $ne: true },
      pages_ocr: { $gte: 1 },
      $expr: { $gte: ['$pages_translated', { $multiply: ['$pages_ocr', 0.9] }] },
    }),

    // First translations
    db.collection('books').aggregate([
      { $match: { hidden: { $ne: true }, is_first_translation: true } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          complete: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$pages_ocr', 10] },
                    { $gte: ['$pages_translated', { $multiply: ['$pages_ocr', 0.9] }] },
                  ],
                },
                1, 0,
              ],
            },
          },
        },
      },
    ]).toArray(),

    // Enrichment counts
    db.collection('books').aggregate([
      { $match: { hidden: { $ne: true } } },
      {
        $group: {
          _id: null,
          with_summary: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $and: [{ $eq: [{ $type: '$summary' }, 'string'] }, { $ne: ['$summary', ''] }] },
                    { $ne: [{ $ifNull: ['$summary.data', ''] }, ''] },
                  ],
                },
                1, 0,
              ],
            },
          },
          with_index: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $and: [{ $eq: [{ $type: '$index_of_topics' }, 'string'] }, { $ne: ['$index_of_topics', ''] }] },
                    { $ne: [{ $ifNull: ['$index_of_topics.data', ''] }, ''] },
                  ],
                },
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

    // Cost per translated page (last 30 days)
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

    // Active pipeline jobs
    db.collection('jobs').aggregate([
      { $match: { status: { $in: ['processing', 'queued'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const t = totals[0] || { books: 0, pages: 0, pages_ocr: 0, pages_translated: 0 };
  const ft = firstTranslations[0] || { count: 0, complete: 0 };
  const en = enrichment[0] || { with_summary: 0, with_index: 0, with_images: 0, tagged: 0 };
  const cost = costData[0] || { total_cost: 0, pages: 0 };
  const jobMap = Object.fromEntries(jobsActive.map((j: any) => [j._id, j.count]));

  const data = {
    canon: {
      total_books: t.books,
      total_pages: t.pages,
      readable_books: readableBooks,
      readable_percent: t.books > 0 ? +(readableBooks / t.books * 100).toFixed(1) : 0,
      first_translations: ft.count,
      first_translations_complete: ft.complete,
    },
    coverage: {
      ocr_pages: t.pages_ocr,
      ocr_percent: t.pages > 0 ? +(t.pages_ocr / t.pages * 100).toFixed(1) : 0,
      translated_pages: t.pages_translated,
      translated_percent: t.pages > 0 ? +(t.pages_translated / t.pages * 100).toFixed(1) : 0,
    },
    enrichment: {
      with_summary: en.with_summary,
      with_index: en.with_index,
      with_images: en.with_images,
      tagged: en.tagged,
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
