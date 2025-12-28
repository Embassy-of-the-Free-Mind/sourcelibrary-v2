import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * POST /api/books/[id]/reset-ocr
 *
 * Clear OCR and/or translation data for a book's pages.
 * Used to fix misaligned batch imports.
 *
 * Body: {
 *   clearOcr?: boolean,        // Clear OCR data (default: true)
 *   clearTranslation?: boolean, // Clear translation data (default: true)
 *   pageNumbers?: number[],     // Specific pages to clear (optional)
 *   beforeDate?: string,        // Only clear OCR updated before this date
 *   afterDate?: string,         // Only clear OCR updated after this date
 *   dryRun?: boolean           // Preview what would be cleared
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const body = await request.json().catch(() => ({}));

    const {
      clearOcr = true,
      clearTranslation = true,
      pageNumbers,
      beforeDate,
      afterDate,
      dryRun = false,
    } = body;

    const db = await getDb();

    // Verify book exists
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Build query for pages to reset
    const query: Record<string, unknown> = { book_id: bookId };

    // Filter by specific page numbers if provided
    if (pageNumbers && Array.isArray(pageNumbers) && pageNumbers.length > 0) {
      query.page_number = { $in: pageNumbers };
    }

    // Filter by OCR date range if provided
    if (beforeDate || afterDate) {
      const dateFilter: Record<string, Date> = {};
      if (beforeDate) {
        dateFilter.$lt = new Date(beforeDate);
      }
      if (afterDate) {
        dateFilter.$gt = new Date(afterDate);
      }
      if (clearOcr) {
        query['ocr.updated_at'] = dateFilter;
      }
    }

    // Get pages that would be affected
    const pages = await db.collection('pages')
      .find(query)
      .project({ id: 1, page_number: 1, 'ocr.updated_at': 1, 'translation.updated_at': 1 })
      .toArray();

    // Count pages with OCR/translation
    const pagesWithOcr = pages.filter(p => p.ocr?.updated_at).length;
    const pagesWithTranslation = pages.filter(p => p.translation?.updated_at).length;

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        bookId,
        bookTitle: book.title,
        totalPagesMatched: pages.length,
        wouldClearOcr: clearOcr ? pagesWithOcr : 0,
        wouldClearTranslation: clearTranslation ? pagesWithTranslation : 0,
        samplePages: pages.slice(0, 10).map(p => ({
          pageNumber: p.page_number,
          hasOcr: !!p.ocr?.updated_at,
          hasTranslation: !!p.translation?.updated_at,
          ocrDate: p.ocr?.updated_at,
        })),
      });
    }

    // Build update operation
    const unsetFields: Record<string, string> = {};
    if (clearOcr) {
      unsetFields['ocr.data'] = '';
      unsetFields['ocr.updated_at'] = '';
      unsetFields['ocr.model'] = '';
      unsetFields['ocr.prompt'] = '';
      unsetFields['ocr.input_tokens'] = '';
      unsetFields['ocr.output_tokens'] = '';
      unsetFields['ocr.cost_usd'] = '';
      unsetFields['ocr.image_url'] = '';
      unsetFields['ocr.batch_size'] = '';
    }
    if (clearTranslation) {
      unsetFields['translation.data'] = '';
      unsetFields['translation.updated_at'] = '';
      unsetFields['translation.model'] = '';
      unsetFields['translation.prompt'] = '';
      unsetFields['translation.input_tokens'] = '';
      unsetFields['translation.output_tokens'] = '';
      unsetFields['translation.cost_usd'] = '';
    }

    // Execute the reset
    const pageIds = pages.map(p => p.id);
    const result = await db.collection('pages').updateMany(
      { id: { $in: pageIds } },
      {
        $unset: unsetFields,
        $set: { updated_at: new Date() }
      }
    );

    // Log the operation
    await db.collection('audit_log').insertOne({
      timestamp: new Date(),
      action: 'reset_book_ocr',
      book_id: bookId,
      book_title: book.title,
      pages_affected: result.modifiedCount,
      cleared_ocr: clearOcr,
      cleared_translation: clearTranslation,
      page_numbers: pageNumbers || 'all',
      date_filter: { beforeDate, afterDate },
    });

    return NextResponse.json({
      success: true,
      bookId,
      bookTitle: book.title,
      pagesReset: result.modifiedCount,
      clearedOcr: clearOcr ? pagesWithOcr : 0,
      clearedTranslation: clearTranslation ? pagesWithTranslation : 0,
      message: `Reset ${result.modifiedCount} pages. Ready for reprocessing.`,
    });

  } catch (error) {
    console.error('Reset OCR error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Reset failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/books/[id]/reset-ocr
 *
 * Get info about potentially misaligned OCR in a book.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();

    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get all pages with OCR
    const pages = await db.collection('pages')
      .find({ book_id: bookId, 'ocr.updated_at': { $exists: true } })
      .project({
        page_number: 1,
        photo: 1,
        'ocr.updated_at': 1,
        'ocr.data': 1,
        'ocr.image_url': 1,
      })
      .sort({ page_number: 1 })
      .toArray();

    // Group by OCR timestamp to identify batches
    const batches: Record<string, number[]> = {};
    pages.forEach(p => {
      if (p.ocr?.updated_at) {
        const timestamp = new Date(p.ocr.updated_at).toISOString().slice(0, 19);
        if (!batches[timestamp]) {
          batches[timestamp] = [];
        }
        batches[timestamp].push(p.page_number);
      }
    });

    // Check for potential misalignment by looking for [[page number: X]] markers
    const potentiallyMisaligned: Array<{
      pageNumber: number;
      photoIndex: string;
      ocrPageMarker: string | null;
      offset: number | null;
    }> = [];

    for (const page of pages.slice(0, 50)) { // Check first 50
      const ocrData = page.ocr?.data || '';
      const match = ocrData.match(/\[\[page.*?number.*?:?\s*(\d+)/i);
      const ocrPageMarker = match ? match[1] : null;

      // Extract photo index from URL
      const photoMatch = page.photo?.match(/page\/n(\d+)/);
      const photoIndex = photoMatch ? photoMatch[1] : '?';

      if (ocrPageMarker) {
        const expectedPhotoIndex = page.page_number - 1;
        const ocrNum = parseInt(ocrPageMarker, 10);
        const offset = ocrNum - page.page_number;

        if (Math.abs(offset) > 10) { // Significant offset
          potentiallyMisaligned.push({
            pageNumber: page.page_number,
            photoIndex: `n${photoIndex}`,
            ocrPageMarker,
            offset,
          });
        }
      }
    }

    return NextResponse.json({
      bookId,
      bookTitle: book.title,
      totalPages: book.pages_count || pages.length,
      pagesWithOcr: pages.length,
      batches: Object.entries(batches).map(([timestamp, pageNums]) => ({
        timestamp,
        pageCount: pageNums.length,
        pages: pageNums.slice(0, 10),
        hasMore: pageNums.length > 10,
      })),
      potentiallyMisaligned,
      hasMisalignment: potentiallyMisaligned.length > 0,
    });

  } catch (error) {
    console.error('Check alignment error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Check failed' },
      { status: 500 }
    );
  }
}
