import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyCronAuth } from '@/lib/cron-auth';

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

  const startTime = Date.now();

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
                { $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 0] },
                1, 0
              ]
            }
          },
          pages_translated: {
            $sum: {
              $cond: [
                { $gt: [{ $strLenCP: { $ifNull: ['$translation.data', ''] } }, 0] },
                1, 0
              ]
            }
          }
        }
      }
    ]).toArray();

    // Build a map: book_id -> { pages_count, pages_ocr, pages_translated }
    const statsMap = new Map<string, { pages_count: number; pages_ocr: number; pages_translated: number }>();
    for (const stat of pageStats) {
      statsMap.set(stat._id, {
        pages_count: stat.pages_count,
        pages_ocr: stat.pages_ocr,
        pages_translated: stat.pages_translated,
      });
    }

    // Fetch all books' current cached values
    const books = await db.collection('books')
      .find({}, { projection: { _id: 1, id: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1 } })
      .toArray();

    // Build bulk updates for books with mismatched counts
    const bulkOps = [];
    let mismatchCount = 0;

    for (const book of books) {
      const bookId = book.id || book._id?.toString();
      const actual = statsMap.get(bookId) || { pages_count: 0, pages_ocr: 0, pages_translated: 0 };
      const current = {
        pages_count: book.pages_count || 0,
        pages_ocr: book.pages_ocr || 0,
        pages_translated: book.pages_translated || 0,
      };

      if (
        current.pages_count !== actual.pages_count ||
        current.pages_ocr !== actual.pages_ocr ||
        current.pages_translated !== actual.pages_translated
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

    const duration = Date.now() - startTime;
    console.log(`[sync-page-counts] ${updated} books updated (${mismatchCount} mismatches) in ${duration}ms`);

    return NextResponse.json({
      success: true,
      books_checked: books.length,
      mismatches: mismatchCount,
      updated,
      duration_ms: duration,
    });
  } catch (error) {
    console.error('[sync-page-counts] Error:', error);
    return NextResponse.json({ error: 'Failed to sync page counts' }, { status: 500 });
  }
}
