import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Clear OCR/translation data from pages of a book.
 * Used to fix batch import errors where wrong content was mapped to pages.
 *
 * POST /api/books/[id]/clear-ocr
 * Body: {
 *   type: "ocr" | "translation" | "both",
 *   pageRange?: { start: number, end: number },  // Optional: only clear specific pages
 *   reason?: string  // For audit logging
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const body = await request.json();
    const {
      type = 'ocr',
      pageRange,
      reason = 'Manual cleanup'
    }: {
      type?: 'ocr' | 'translation' | 'both';
      pageRange?: { start: number; end: number };
      reason?: string;
    } = body;

    if (!['ocr', 'translation', 'both'].includes(type)) {
      return NextResponse.json(
        { error: 'type must be "ocr", "translation", or "both"' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Find the book
    const book = await db.collection('books').findOne({
      $or: [{ id: bookId }, { ia_identifier: bookId }]
    });

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const actualBookId = book.id || book._id.toString();

    // Build query for pages
    const pageQuery: Record<string, unknown> = { book_id: actualBookId };
    if (pageRange) {
      pageQuery.page_number = {
        $gte: pageRange.start,
        $lte: pageRange.end
      };
    }

    // Build unset operation based on type
    const unsetFields: Record<string, string> = {};
    if (type === 'ocr' || type === 'both') {
      unsetFields['ocr'] = '';
    }
    if (type === 'translation' || type === 'both') {
      unsetFields['translation'] = '';
    }

    // Get count of affected pages before update
    const affectedCount = await db.collection('pages').countDocuments({
      ...pageQuery,
      $or: [
        ...(type === 'ocr' || type === 'both' ? [{ ocr: { $exists: true } }] : []),
        ...(type === 'translation' || type === 'both' ? [{ translation: { $exists: true } }] : [])
      ]
    });

    // Clear the data
    const result = await db.collection('pages').updateMany(
      pageQuery,
      {
        $unset: unsetFields,
        $set: {
          updated_at: new Date(),
          cleared_at: new Date(),
          cleared_reason: reason
        }
      }
    );

    // Log the operation for audit
    console.log(`[CLEAR-OCR] Book ${actualBookId}: Cleared ${type} from ${result.modifiedCount} pages. Reason: ${reason}`);

    // Recalculate book stats
    const ocrCount = await db.collection('pages').countDocuments({
      book_id: actualBookId,
      'ocr.data': { $exists: true, $ne: '' }
    });
    const transCount = await db.collection('pages').countDocuments({
      book_id: actualBookId,
      'translation.data': { $exists: true, $ne: '' }
    });

    await db.collection('books').updateOne(
      { id: actualBookId },
      {
        $set: {
          pages_ocr: ocrCount,
          pages_translated: transCount,
          updated_at: new Date()
        }
      }
    );

    return NextResponse.json({
      success: true,
      bookId: actualBookId,
      type,
      clearedPages: result.modifiedCount,
      affectedPages: affectedCount,
      pageRange: pageRange || 'all',
      reason,
      newCounts: {
        pages_ocr: ocrCount,
        pages_translated: transCount
      }
    });

  } catch (error) {
    console.error('Clear OCR error:', error);
    return NextResponse.json(
      { error: 'Clear failed', details: String(error) },
      { status: 500 }
    );
  }
}
