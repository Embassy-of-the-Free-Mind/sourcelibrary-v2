import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Get analytics stats
 *
 * GET /api/analytics/stats
 * Query params:
 *   - book_id: optional, get stats for specific book
 *   - global: if true, get global stats
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('book_id');

    const db = await getDb();

    if (bookId) {
      // Get stats for specific book
      const book = await db.collection('books').findOne(
        { id: bookId },
        { projection: { read_count: 1, edit_count: 1 } }
      );

      return NextResponse.json({
        book_id: bookId,
        reads: book?.read_count || 0,
        edits: book?.edit_count || 0,
      });
    }

    // Get global stats - fast queries only (called on every page load via footer)
    // Uses cached pages_translated from books instead of scanning 916k pages
    const [bookStats, totalBooks, totalPages] = await Promise.all([
      db.collection('books').aggregate([
        { $match: { hidden: { $ne: true } } },
        { $group: {
          _id: null,
          totalReads: { $sum: '$read_count' },
          totalEdits: { $sum: '$edit_count' },
          pagesTranslated: { $sum: { $ifNull: ['$pages_translated', 0] } },
        } }
      ]).toArray(),
      db.collection('books').countDocuments({ hidden: { $ne: true } }),
      db.collection('pages').estimatedDocumentCount(),
    ]);
    const pagesTranslated = bookStats[0]?.pagesTranslated || 0;

    return NextResponse.json({
      global: true,
      totalReads: bookStats[0]?.totalReads || 0,
      totalEdits: bookStats[0]?.totalEdits || 0,
      totalBooks,
      totalPages,
      pagesTranslated,
    });
  } catch (error) {
    console.error('Analytics stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
