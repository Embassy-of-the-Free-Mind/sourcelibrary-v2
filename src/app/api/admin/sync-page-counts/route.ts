import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 300;

/**
 * POST /api/admin/sync-page-counts
 *
 * Sync pages_count, pages_ocr, and pages_translated fields on books
 * based on actual page data in the pages collection.
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 0;
    const dryRun = searchParams.get('dry_run') === 'true';

    const db = await getDb();
    const books = db.collection('books');
    const pages = db.collection('pages');

    const query = books.find({});
    if (limit > 0) query.limit(limit);
    const allBooks = await query.toArray();

    let updatedCount = 0;
    let mismatchCount = 0;

    for (const book of allBooks) {
      const bookId = book.id || book._id?.toString();
      if (!bookId) continue;

      const pageStats = await pages.aggregate([
        { $match: { book_id: bookId } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            withOcr: {
              $sum: {
                $cond: [
                  { $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 0] },
                  1, 0
                ]
              }
            },
            withTranslation: {
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

      const stats = pageStats[0] || { total: 0, withOcr: 0, withTranslation: 0 };
      const currentCount = book.pages_count || 0;
      const currentOcr = book.pages_ocr || 0;
      const currentTranslated = book.pages_translated || 0;

      if (
        currentCount !== stats.total ||
        currentOcr !== stats.withOcr ||
        currentTranslated !== stats.withTranslation
      ) {
        mismatchCount++;
        if (!dryRun) {
          await books.updateOne(
            { _id: book._id },
            {
              $set: {
                pages_count: stats.total,
                pages_ocr: stats.withOcr,
                pages_translated: stats.withTranslation,
                updated_at: new Date()
              }
            }
          );
          updatedCount++;
        }
      }
    }

    const totalStats = await pages.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          withOcr: {
            $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 0] }, 1, 0] }
          },
          withTranslation: {
            $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$translation.data', ''] } }, 0] }, 1, 0] }
          }
        }
      }
    ]).toArray();

    const totals = totalStats[0] || { total: 0, withOcr: 0, withTranslation: 0 };

    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      books_processed: allBooks.length,
      books_updated: dryRun ? 0 : updatedCount,
      books_with_mismatches: mismatchCount,
      totals: { pages: totals.total, ocr: totals.withOcr, translation: totals.withTranslation },
    });
  } catch (error) {
    console.error('[sync-page-counts] Error:', error);
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const db = await getDb();
    const pages = db.collection('pages');
    const books = db.collection('books');

    const pageStats = await pages.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          withOcr: {
            $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 0] }, 1, 0] }
          },
          withTranslation: {
            $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$translation.data', ''] } }, 0] }, 1, 0] }
          }
        }
      }
    ]).toArray();

    const bookStats = await books.aggregate([
      {
        $group: {
          _id: null,
          total_pages: { $sum: '$pages_count' },
          total_ocr: { $sum: '$pages_ocr' },
          total_translated: { $sum: '$pages_translated' }
        }
      }
    ]).toArray();

    const actual = pageStats[0] || { total: 0, withOcr: 0, withTranslation: 0 };
    const counters = bookStats[0] || { total_pages: 0, total_ocr: 0, total_translated: 0 };

    return NextResponse.json({
      actual: { pages: actual.total, ocr: actual.withOcr, translation: actual.withTranslation },
      counters: { pages: counters.total_pages, ocr: counters.total_ocr, translation: counters.total_translated },
      discrepancy: {
        pages: actual.total - counters.total_pages,
        ocr: actual.withOcr - counters.total_ocr,
        translation: actual.withTranslation - counters.total_translated,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to check' }, { status: 500 });
  }
}
