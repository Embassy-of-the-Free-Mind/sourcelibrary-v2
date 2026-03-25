import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createCronLogger } from '@/lib/cron-logger';
import { SKIP_TRANSLATION_PAGE_TYPES } from '@/lib/types/prompts/defaults';

export const maxDuration = 120;

/**
 * GET /api/cron/sync-page-counts
 *
 * Refreshes cached page counts (pages_ocr, pages_translated) on all books.
 * Uses a single aggregation on the pages collection + bulk update.
 * Runs every 6 hours via Vercel Cron.
 *
 * These book-level fields are a performance cache — the source of truth
 * is always the pages collection. Workers update them inline, but they
 * can drift. This cron is the safety net.
 */
export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const logger = createCronLogger('sync-page-counts');

  try {
    const db = await getDb();

    // Single aggregation: count OCR and translation pages per book
    const pageStats = await db.collection('pages').aggregate([
      {
        $group: {
          _id: '$book_id',
          pages_count: { $sum: 1 },
          pages_ocr: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: [{ $type: '$ocr.data' }, 'string'] },
                  { $gt: [{ $strLenCP: '$ocr.data' }, 0] },
                ] },
                1, 0
              ]
            }
          },
          pages_translated: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: [{ $type: '$translation.data' }, 'string'] },
                  { $gt: [{ $strLenCP: '$translation.data' }, 0] },
                ] },
                1, 0
              ]
            }
          },
          // Blank pages with OCR — subtracted from denominator for translation_percent
          pages_blank: {
            $sum: {
              $cond: [
                { $and: [
                  { $in: [{ $ifNull: ['$page_type', ''] }, SKIP_TRANSLATION_PAGE_TYPES] },
                  { $eq: [{ $type: '$ocr.data' }, 'string'] },
                  { $gt: [{ $strLenCP: '$ocr.data' }, 0] },
                ] },
                1, 0
              ]
            }
          }
        }
      }
    ]).toArray();

    // Build a map: book_id -> counts
    const statsMap = new Map<string, { pages_count: number; pages_ocr: number; pages_translated: number; pages_blank: number }>();
    for (const stat of pageStats) {
      statsMap.set(stat._id, {
        pages_count: stat.pages_count,
        pages_ocr: stat.pages_ocr,
        pages_translated: stat.pages_translated,
        pages_blank: stat.pages_blank,
      });
    }

    // Fetch all books' current cached values
    const books = await db.collection('books')
      .find({}, { projection: { _id: 1, id: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1 } })
      .toArray();

    // Build bulk updates for books with mismatched counts
    const bulkOps = [];
    let mismatchCount = 0;

    for (const book of books) {
      const bookId = book.id || book._id?.toString();
      const actual = statsMap.get(bookId) || { pages_count: 0, pages_ocr: 0, pages_translated: 0, pages_blank: 0 };
      const current = {
        pages_count: book.pages_count || 0,
        pages_ocr: book.pages_ocr || 0,
        pages_translated: book.pages_translated || 0,
        pages_blank: book.pages_blank || 0,
      };

      if (
        current.pages_count !== actual.pages_count ||
        current.pages_ocr !== actual.pages_ocr ||
        current.pages_translated !== actual.pages_translated ||
        current.pages_blank !== actual.pages_blank
      ) {
        mismatchCount++;
        bulkOps.push({
          updateOne: {
            filter: { _id: book._id },
            update: {
              $set: {
                pages_count: actual.pages_count,
                pages_ocr: actual.pages_ocr,
                pages_translated: actual.pages_translated,
                pages_blank: actual.pages_blank,
                updated_at: new Date(),
              }
            }
          }
        });
      }
    }

    // Execute bulk update
    let updated = 0;
    if (bulkOps.length > 0) {
      const result = await db.collection('books').bulkWrite(bulkOps);
      updated = result.modifiedCount;
    }

    // --- Fix stale thumbnails (unsplit /uploads/ URLs on books with cropped pages) ---
    let thumbnailsFixed = 0;
    const staleThumbBooks = await db.collection('books')
      .find({ thumbnail: /\/uploads\// }, { projection: { id: 1 } })
      .toArray();
    for (const staleBook of staleThumbBooks) {
      const croppedPages = await db.collection('pages')
        .find({ book_id: staleBook.id, cropped_photo: { $exists: true, $ne: '' } })
        .sort({ page_number: 1 })
        .limit(20)
        .project({ page_number: 1, page_type: 1, cropped_photo: 1, thumbnail_blob: 1 })
        .toArray();
      if (croppedPages.length === 0) continue;
      const best = croppedPages.find(p => p.page_type === 'title-page')
        || croppedPages.find(p => p.page_type === 'frontispiece')
        || croppedPages.find(p => p.page_type && p.page_type !== 'blank')
        || croppedPages[0];
      if (best) {
        const thumbUpdate: Record<string, string> = { thumbnail: best.cropped_photo };
        if (best.thumbnail_blob) thumbUpdate.thumbnail_blob = best.thumbnail_blob;
        await db.collection('books').updateOne({ id: staleBook.id }, { $set: thumbUpdate });
        thumbnailsFixed++;
      }
    }

    // --- Sync collection book_count caches ---
    const collections = await db.collection('collections').find({}, { projection: { _id: 1, slug: 1, book_count: 1 } }).toArray();
    let collectionsUpdated = 0;
    const collectionOps = [];
    for (const col of collections) {
      const liveCount = await db.collection('books').countDocuments({
        collections: col.slug,
        status: { $ne: 'deleted' },
        hidden: { $ne: true },
        pages_count: { $gt: 0 },
        pages_translated: { $gt: 0 },
      });
      if ((col.book_count || 0) !== liveCount) {
        collectionOps.push({
          updateOne: {
            filter: { _id: col._id },
            update: { $set: { book_count: liveCount, updated_at: new Date() } },
          },
        });
      }
    }
    if (collectionOps.length > 0) {
      const colResult = await db.collection('collections').bulkWrite(collectionOps);
      collectionsUpdated = colResult.modifiedCount;
    }

    // --- Refresh gemini_usage_daily for today + yesterday ---
    let usageDaysRefreshed = 0;
    try {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      for (const dateStr of [yesterdayStr, todayStr]) {
        const dayStart = new Date(dateStr + 'T00:00:00Z');
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

        const [agg] = await db.collection('gemini_usage').aggregate([
          { $match: { timestamp: { $gte: dayStart, $lt: dayEnd } } },
          { $facet: {
            totals: [{ $group: {
              _id: null,
              totalCost: { $sum: { $ifNull: ['$cost_usd', 0] } },
              totalInputTokens: { $sum: { $ifNull: ['$input_tokens', 0] } },
              totalOutputTokens: { $sum: { $ifNull: ['$output_tokens', 0] } },
              totalRecords: { $sum: 1 },
            }}],
            byType: [{ $group: {
              _id: '$type',
              count: { $sum: 1 },
              cost: { $sum: { $ifNull: ['$cost_usd', 0] } },
              inputTokens: { $sum: { $ifNull: ['$input_tokens', 0] } },
              outputTokens: { $sum: { $ifNull: ['$output_tokens', 0] } },
              successCount: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
              failedCount: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
              pageCount: { $sum: { $ifNull: ['$page_count', 0] } },
            }}],
            byModel: [{ $group: {
              _id: '$model',
              count: { $sum: 1 },
              cost: { $sum: { $ifNull: ['$cost_usd', 0] } },
            }}],
            byEndpoint: [
              { $match: { endpoint: { $exists: true, $ne: null } } },
              { $group: { _id: '$endpoint', count: { $sum: 1 } } },
            ],
            byErrorCategory: [
              { $match: { status: 'failed', error_category: { $exists: true } } },
              { $group: {
                _id: '$error_category',
                count: { $sum: 1 },
                lastMessage: { $last: '$error_message' },
              }},
            ],
          }},
        ]).toArray();

        const totals = agg?.totals?.[0];
        if (!totals || totals.totalRecords === 0) continue;

        const byType: Record<string, any> = {};
        for (const t of (agg.byType || [])) {
          byType[t._id || 'unknown'] = {
            count: t.count, cost: t.cost, inputTokens: t.inputTokens,
            outputTokens: t.outputTokens, successCount: t.successCount,
            failedCount: t.failedCount, pageCount: t.pageCount,
          };
        }
        const byModel: Record<string, any> = {};
        for (const m of (agg.byModel || [])) {
          byModel[m._id || 'unknown'] = { count: m.count, cost: m.cost };
        }
        const byEndpoint: Record<string, number> = {};
        for (const e of (agg.byEndpoint || [])) {
          byEndpoint[e._id] = e.count;
        }
        const byErrorCategory: Record<string, any> = {};
        for (const e of (agg.byErrorCategory || [])) {
          byErrorCategory[e._id || 'unknown'] = {
            count: e.count,
            lastMessage: (e.lastMessage || '').substring(0, 200),
          };
        }

        await db.collection('gemini_usage_daily').updateOne(
          { date: dateStr },
          { $set: {
            date: dateStr,
            totalCost: totals.totalCost,
            totalInputTokens: totals.totalInputTokens,
            totalOutputTokens: totals.totalOutputTokens,
            totalRecords: totals.totalRecords,
            byType, byModel, byEndpoint, byErrorCategory,
            updatedAt: new Date(),
          }},
          { upsert: true },
        );
        usageDaysRefreshed++;
      }
    } catch (e) {
      console.warn('[sync-page-counts] gemini_usage_daily refresh failed:', (e as Error).message?.substring(0, 100));
    }

    console.log(`[sync-page-counts] ${updated} books updated (${mismatchCount} mismatches), ${collectionsUpdated} collections updated, ${thumbnailsFixed} thumbnails fixed, ${usageDaysRefreshed} usage days refreshed in ${logger.durationMs}ms`);

    logger.setActions({ books_checked: books.length, mismatches: mismatchCount, updated, collections_checked: collections.length, collections_updated: collectionsUpdated, thumbnails_fixed: thumbnailsFixed, usage_days_refreshed: usageDaysRefreshed });

    await logger.flush();

    return NextResponse.json({
      success: true,
      books_checked: books.length,
      mismatches: mismatchCount,
      updated,
      collections_checked: collections.length,
      collections_updated: collectionsUpdated,
      thumbnails_fixed: thumbnailsFixed,
      duration_ms: logger.durationMs,
    });
  } catch (error) {
    console.error('[sync-page-counts] Error:', error);
    logger.error(error instanceof Error ? error.message : 'Unknown error');
    logger.setFailed();
    await logger.flush();
    return NextResponse.json({ error: 'Failed to sync page counts' }, { status: 500 });
  }
}
