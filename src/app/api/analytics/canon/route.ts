import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 60;

// In-memory cache (5 minutes)
let cache: { data: any; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * GET /api/analytics/canon
 *
 * Mission-critical metrics for Source Library's canon:
 * - Books readable (fully translated) vs total
 * - Books translated for the first time (non-English originals with translation)
 * - Translation velocity and coverage by language/tradition
 * - Cost per translated page
 * - Pipeline health summary
 */
export const GET = withAuth(async () => {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
      return NextResponse.json(cache.data);
    }

    const db = await getDb();

    // All queries use book-level cached counts (fast, no pages scan)
    const [
      totals,
      readableBooks,
      firstTranslations,
      byLanguage,
      byCollection,
      recentlyCompleted,
      costData,
      jobsActive,
    ] = await Promise.all([
      // 1. Overall totals
      db.collection('books').aggregate([
        { $match: { visible: true, pages_count: { $gt: 0 } } },
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

      // 2. Books that are "readable" — >=90% of translatable pages translated
      //    Denominator: pages_ocr - pages_blank (blank pages don't need translation)
      db.collection('books').countDocuments({
        visible: true,
        pages_count: { $gt: 0 },
        pages_ocr: { $gte: 1 },
        $expr: {
          $gte: [
            '$pages_translated',
            { $multiply: [{ $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $ifNull: ['$pages_blank', 0] }] }, 0.9] },
          ],
        },
      }),

      // 3. "First translations" — uses verified is_first_translation flag from metadata enrichment
      db.collection('books').aggregate([
        {
          $match: {
            visible: true,
            pages_count: { $gt: 0 },
            is_first_translation: true,
          },
        },
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
                      { $gte: ['$pages_translated', { $multiply: [{ $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $ifNull: ['$pages_blank', 0] }] }, 0.9] }] },
                    ],
                  },
                  1, 0,
                ],
              },
            },
            pages: { $sum: { $ifNull: ['$pages_translated', 0] } },
          },
        },
      ]).toArray(),

      // 4. Breakdown by original language
      db.collection('books').aggregate([
        { $match: { visible: true, pages_count: { $gte: 1 } } },
        {
          $group: {
            _id: { $ifNull: ['$language', 'Unknown'] },
            books: { $sum: 1 },
            pages: { $sum: { $ifNull: ['$pages_count', 0] } },
            ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
            translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
            readable: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$pages_ocr', 1] },
                      { $gte: ['$pages_translated', { $multiply: [{ $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $ifNull: ['$pages_blank', 0] }] }, 0.9] }] },
                    ],
                  },
                  1, 0,
                ],
              },
            },
          },
        },
        { $sort: { books: -1 } },
        { $limit: 20 },
      ]).toArray(),

      // 5. Breakdown by collection (top traditions)
      db.collection('books').aggregate([
        { $match: { visible: true, collections: { $exists: true, $ne: [] } } },
        { $unwind: '$collections' },
        {
          $group: {
            _id: '$collections',
            books: { $sum: 1 },
            translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
            readable: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$pages_ocr', 1] },
                      { $gte: ['$pages_translated', { $multiply: [{ $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $ifNull: ['$pages_blank', 0] }] }, 0.9] }] },
                    ],
                  },
                  1, 0,
                ],
              },
            },
          },
        },
        { $sort: { books: -1 } },
        { $limit: 15 },
      ]).toArray(),

      // 6. Recently completed translations (last 30 days, by pipeline completion)
      db.collection('books').find({
        visible: true,
        'pipeline_auto.status': 'complete',
        'pipeline_auto.completed_at': { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        language: { $nin: ['English', 'english'] },
        pages_translated: { $gte: 1 },
      }, {
        projection: {
          id: 1, title: 1, display_title: 1, language: 1,
          pages_count: 1, pages_translated: 1, pages_ocr: 1,
          'pipeline_auto.completed_at': 1,
        },
      })
        .sort({ 'pipeline_auto.completed_at': -1 })
        .limit(20)
        .toArray(),

      // 7. Cost per translated page (last 30 days)
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

      // 8. Active pipeline jobs
      db.collection('jobs').aggregate([
        { $match: { status: { $in: ['processing', 'queued'] } } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]).toArray(),
    ]);

    const t = totals[0] || { books: 0, pages: 0, pages_ocr: 0, pages_translated: 0 };
    const ft = firstTranslations[0] || { count: 0, complete: 0, pages: 0 };
    const cost = costData[0] || { total_cost: 0, pages: 0 };
    const jobMap = Object.fromEntries(jobsActive.map((j: any) => [j._id, j.count]));

    const data = {
      // The headline numbers
      canon: {
        total_books: t.books,
        total_pages: t.pages,
        readable_books: readableBooks,
        readable_percent: t.books > 0 ? +(readableBooks / t.books * 100).toFixed(1) : 0,
        first_translations: ft.count,
        first_translations_complete: ft.complete,
        first_translation_pages: ft.pages,
      },

      // Pipeline coverage
      coverage: {
        ocr_pages: t.pages_ocr,
        ocr_percent: t.pages > 0 ? +(t.pages_ocr / t.pages * 100).toFixed(1) : 0,
        translated_pages: t.pages_translated,
        translated_percent: t.pages > 0 ? +(t.pages_translated / t.pages * 100).toFixed(1) : 0,
      },

      // By language
      languages: byLanguage.map((l: any) => ({
        language: l._id,
        books: l.books,
        pages: l.pages,
        ocr: l.ocr,
        translated: l.translated,
        readable: l.readable,
        coverage: l.pages > 0 ? +(l.translated / l.pages * 100).toFixed(1) : 0,
      })),

      // By collection/tradition
      traditions: byCollection.map((c: any) => ({
        collection: c._id,
        books: c.books,
        translated_pages: c.translated,
        readable: c.readable,
      })),

      // Recently completed first translations
      recent_completions: recentlyCompleted.map((b: any) => ({
        id: b.id,
        title: b.display_title || b.title,
        language: b.language,
        pages: b.pages_count,
        translated: b.pages_translated,
        completed: b.pipeline_auto?.completed_at,
      })),

      // Economics
      economics: {
        cost_per_page_30d: cost.pages > 0 ? +(cost.total_cost / cost.pages).toFixed(4) : 0,
        total_cost_30d: +cost.total_cost.toFixed(2),
        pages_translated_30d: cost.pages,
      },

      // Pipeline health (minimal)
      pipeline: {
        processing: jobMap.processing || 0,
        queued: jobMap.queued || 0,
      },
    };

    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (error) {
    console.error('Canon analytics error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch canon analytics' },
      { status: 500 },
    );
  }
});
