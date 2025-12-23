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

    // Get global stats
    const [totalReads, totalEdits, totalBooks, totalPages] = await Promise.all([
      db.collection('books').aggregate([
        { $group: { _id: null, total: { $sum: '$read_count' } } }
      ]).toArray(),
      db.collection('books').aggregate([
        { $group: { _id: null, total: { $sum: '$edit_count' } } }
      ]).toArray(),
      db.collection('books').countDocuments(),
      db.collection('pages').countDocuments(),
    ]);

    // Get pages with translations (edits completed)
    const pagesTranslated = await db.collection('pages').countDocuments({
      'translation.data': { $exists: true, $ne: '' }
    });

    return NextResponse.json({
      global: true,
      totalReads: totalReads[0]?.total || 0,
      totalEdits: totalEdits[0]?.total || 0,
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
