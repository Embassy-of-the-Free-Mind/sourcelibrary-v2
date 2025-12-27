import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// GET: Check for split pages that might have bad OCR
// (pages with crop data where OCR used full spread instead of cropped image)
export async function GET(request: NextRequest) {
  try {
    const db = await getDb();

    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('book_id');
    const fix = searchParams.get('fix') === 'true';

    // Find pages that:
    // 1. Have crop data (are split pages)
    // 2. Have OCR data
    // 3. Either: no image_url in OCR metadata, OR image_url is full spread (not cropped)
    const query: Record<string, unknown> = {
      'crop.xStart': { $exists: true },
      'ocr.data': { $exists: true, $ne: null },
      $or: [
        // No image_url tracking (processed before fix)
        { 'ocr.image_url': { $exists: false } },
        // image_url is a full spread (contains photo_original or photo, not cropped)
        { 'ocr.image_url': { $regex: /^https:\/\/(?!.*cropped).*/ } },
      ],
    };

    if (bookId) {
      query.book_id = bookId;
    }

    const suspectPages = await db.collection('pages')
      .find(query)
      .project({
        id: 1,
        book_id: 1,
        page_number: 1,
        'crop.xStart': 1,
        'crop.xEnd': 1,
        cropped_photo: 1,
        'ocr.image_url': 1,
        'ocr.updated_at': 1,
      })
      .toArray();

    // Group by book
    const byBook: Record<string, { title?: string; pages: typeof suspectPages }> = {};
    for (const page of suspectPages) {
      const bid = page.book_id as string;
      if (!byBook[bid]) {
        byBook[bid] = { pages: [] };
      }
      byBook[bid].pages.push(page);
    }

    // Get book titles
    const bookIds = Object.keys(byBook);
    if (bookIds.length > 0) {
      const books = await db.collection('books')
        .find({ id: { $in: bookIds } })
        .project({ id: 1, title: 1 })
        .toArray();

      for (const book of books) {
        if (byBook[book.id as string]) {
          byBook[book.id as string].title = book.title as string;
        }
      }
    }

    // If fix=true, clear OCR for these pages so they can be re-processed
    if (fix && suspectPages.length > 0) {
      const pageIds = suspectPages.map(p => p.id);
      await db.collection('pages').updateMany(
        { id: { $in: pageIds } },
        { $unset: { ocr: 1 }, $set: { updated_at: new Date() } }
      );

      return NextResponse.json({
        message: `Cleared OCR for ${pageIds.length} suspect pages`,
        affectedBooks: byBook,
        pageIds,
      });
    }

    return NextResponse.json({
      totalSuspect: suspectPages.length,
      books: Object.entries(byBook).map(([id, data]) => ({
        book_id: id,
        title: data.title,
        suspectPages: data.pages.length,
        pageNumbers: data.pages.map(p => p.page_number).sort((a, b) => (a as number) - (b as number)),
      })),
      hint: 'Add ?fix=true to clear OCR for these pages so they can be re-processed',
    });
  } catch (error) {
    console.error('Error checking split OCR:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Check failed' },
      { status: 500 }
    );
  }
}
