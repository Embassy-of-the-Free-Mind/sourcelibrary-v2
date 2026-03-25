import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * GET /api/admin/audit-ocr-prompts
 *
 * Classify books by OCR prompt quality: "rich" vs "simple" vs "none".
 * Rich prompt pages contain XML tags like <vocab>, <lang>, <page-num>.
 * Simple prompt pages have plain text only.
 *
 * Query params:
 *   ?limit=100       - Max books to scan (default: all)
 *   ?provider=bph    - Filter by image source provider
 *   ?backfill=true   - Backfill prompt_version on pages that have it missing
 */
export const GET = withAdminAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 0;
    const provider = searchParams.get('provider');
    const backfill = searchParams.get('backfill') === 'true';

    const db = await getDb();

    // Build book query
    const bookQuery: Record<string, unknown> = {};
    if (provider) {
      bookQuery['image_source.provider'] = provider;
    }

    const booksCursor = db.collection('books').find(bookQuery);
    if (limit > 0) booksCursor.limit(limit);
    const allBooks = await booksCursor.toArray();

    const results: {
      rich: Array<{ id: string; title: string; pages_ocr: number; rich_pages: number; simple_pages: number }>;
      simple: Array<{ id: string; title: string; pages_ocr: number; rich_pages: number; simple_pages: number }>;
      mixed: Array<{ id: string; title: string; pages_ocr: number; rich_pages: number; simple_pages: number }>;
      no_ocr: Array<{ id: string; title: string; pages_count: number }>;
    } = { rich: [], simple: [], mixed: [], no_ocr: [] };

    let backfillCount = 0;

    for (const book of allBooks) {
      const bookId = book.id || book._id?.toString();

      // Use aggregation to check for <vocab> tag in OCR data (most reliable rich-prompt marker)
      const stats = await db.collection('pages').aggregate([
        { $match: { book_id: bookId } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            with_ocr: {
              $sum: {
                $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 0] }, 1, 0]
              }
            },
            rich_pages: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 0] },
                      {
                        $or: [
                          { $gte: [{ $indexOfCP: [{ $ifNull: ['$ocr.data', ''] }, '<vocab>'] }, 0] },
                          { $gte: [{ $indexOfCP: [{ $ifNull: ['$ocr.data', ''] }, '<lang>'] }, 0] },
                        ]
                      }
                    ]
                  },
                  1, 0
                ]
              }
            },
            has_prompt_version: {
              $sum: {
                $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$ocr.prompt_version', ''] } }, 0] }, 1, 0]
              }
            }
          }
        }
      ]).toArray();

      const stat = stats[0] || { total: 0, with_ocr: 0, rich_pages: 0, has_prompt_version: 0 };
      const simplePagesCount = stat.with_ocr - stat.rich_pages;

      const entry = {
        id: bookId,
        title: (book.title || '').slice(0, 80),
        pages_ocr: stat.with_ocr,
        rich_pages: stat.rich_pages,
        simple_pages: simplePagesCount,
      };

      if (stat.with_ocr === 0) {
        results.no_ocr.push({ id: bookId, title: entry.title, pages_count: stat.total });
      } else if (stat.rich_pages === stat.with_ocr) {
        results.rich.push(entry);
      } else if (stat.rich_pages === 0) {
        results.simple.push(entry);
      } else {
        results.mixed.push(entry);
      }

      // Backfill prompt_version on pages missing it
      if (backfill && stat.with_ocr > 0 && stat.has_prompt_version < stat.with_ocr) {
        // Mark rich-prompt pages as 'legacy-rich', simple as 'legacy-simple'
        if (stat.rich_pages > 0) {
          const richResult = await db.collection('pages').updateMany(
            {
              book_id: bookId,
              'ocr.data': { $exists: true, $nin: [null, ''] },
              'ocr.prompt_version': { $exists: false },
              $or: [
                { 'ocr.data': { $regex: '<vocab>' } },
                { 'ocr.data': { $regex: '<lang>' } },
              ]
            },
            { $set: { 'ocr.prompt_version': 'legacy-rich' } }
          );
          backfillCount += richResult.modifiedCount;
        }

        if (simplePagesCount > 0) {
          const simpleResult = await db.collection('pages').updateMany(
            {
              book_id: bookId,
              'ocr.data': { $exists: true, $nin: [null, ''] },
              'ocr.prompt_version': { $exists: false },
            },
            { $set: { 'ocr.prompt_version': 'legacy-simple' } }
          );
          backfillCount += simpleResult.modifiedCount;
        }
      }
    }

    return NextResponse.json({
      scanned: allBooks.length,
      summary: {
        rich_prompt_books: results.rich.length,
        simple_prompt_books: results.simple.length,
        mixed_prompt_books: results.mixed.length,
        no_ocr_books: results.no_ocr.length,
      },
      ...(backfill ? { backfilled_pages: backfillCount } : {}),
      simple_prompt_books: results.simple.slice(0, 50),
      mixed_prompt_books: results.mixed.slice(0, 50),
      rich_prompt_books_count: results.rich.length,
      no_ocr_books_count: results.no_ocr.length,
    });

  } catch (error) {
    console.error('Audit OCR prompts error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Audit failed' },
      { status: 500 }
    );
  }
});
