import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// POST /api/admin/sync-page-counts
// Recalculates pages_count and pages_translated for all books
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

    // Get translated page counts per book
    const translatedCounts = await db.collection('pages').aggregate([
      {
        $match: {
          'translation.data': { $exists: true, $nin: [null, ''] }
        }
      },
      {
        $group: {
          _id: '$book_id',
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    // Get OCR page counts per book
    const ocrCounts = await db.collection('pages').aggregate([
      {
        $match: {
          'ocr.data': { $exists: true, $nin: [null, ''] }
        }
      },
      {
        $group: {
          _id: '$book_id',
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    // Create maps
    const countMap = new Map(pageCounts.map(p => [p._id, p.count]));
    const translatedMap = new Map(translatedCounts.map(p => [p._id, p.count]));
    const ocrMap = new Map(ocrCounts.map(p => [p._id, p.count]));

    // Get all books
    const books = await db.collection('books').find({}).toArray();

    let updated = 0;
    for (const book of books) {
      const actualCount = countMap.get(book.id) || 0;
      const translatedCount = translatedMap.get(book.id) || 0;
      const ocrCount = ocrMap.get(book.id) || 0;

      const needsUpdate =
        book.pages_count !== actualCount ||
        book.pages_translated !== translatedCount ||
        book.pages_ocr !== ocrCount;

      if (needsUpdate) {
        await db.collection('books').updateOne(
          { id: book.id },
          {
            $set: {
              pages_count: actualCount,
              pages_translated: translatedCount,
              pages_ocr: ocrCount,
              updated_at: new Date()
            }
          }
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
