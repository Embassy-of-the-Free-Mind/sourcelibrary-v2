import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// POST /api/admin/sync-page-counts
// Recalculates pages_count for all books based on actual page records
export async function POST() {
  try {
    const db = await getDb();

    // Get page counts per book
    const pageCounts = await db.collection('pages').aggregate([
      {
        $group: {
          _id: '$book_id',
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    // Create a map of book_id -> count
    const countMap = new Map(pageCounts.map(p => [p._id, p.count]));

    // Get all books
    const books = await db.collection('books').find({}).toArray();

    let updated = 0;
    for (const book of books) {
      const actualCount = countMap.get(book.id) || 0;
      if (book.pages_count !== actualCount || book.pageCount !== actualCount) {
        await db.collection('books').updateOne(
          { id: book.id },
          { $set: { pages_count: actualCount, pageCount: actualCount, updated_at: new Date() } }
        );
        updated++;
      }
    }

    return NextResponse.json({
      success: true,
      booksChecked: books.length,
      booksUpdated: updated
    });
  } catch (error) {
    console.error('Error syncing page counts:', error);
    return NextResponse.json(
      { error: 'Failed to sync page counts' },
      { status: 500 }
    );
  }
}
