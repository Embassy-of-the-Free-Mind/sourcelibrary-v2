import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/progress — collection growth data for the progress page.
 * Returns weekly book imports, OCR'd pages, and translated pages over time.
 * Uses book-level cached counts to avoid scanning the 900k+ pages collection.
 */
export async function GET() {
  try {
    const db = await getDb();

    // Book imports by week — small collection, fast
    const booksByWeek = await db.collection('books').aggregate([
      { $match: { created_at: { $exists: true, $type: 'date' } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: '$created_at', unit: 'week' } } },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray();

    // Use book-level cached page counts instead of scanning pages collection.
    // These are refreshed by sync-page-counts cron every 6h.
    const bookStats = await db.collection('books').aggregate([
      { $match: { created_at: { $exists: true, $type: 'date' } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: '$created_at', unit: 'week' } } },
          },
          pages_ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
          pages_translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray();

    // Current totals from book-level caches
    const totalsAgg = await db.collection('books').aggregate([
      {
        $group: {
          _id: null,
          books: { $sum: 1 },
          pages: { $sum: { $ifNull: ['$pages_count', 0] } },
          ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
          translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
        },
      },
    ]).toArray();
    const totals = totalsAgg[0] || { books: 0, pages: 0, ocr: 0, translated: 0 };

    // Convert to cumulative
    const booksCumulative = toCumulative(booksByWeek as Array<{ _id: string; count: number }>);

    // For OCR and translation, build cumulative from book stats
    // (This shows when books were imported, weighted by their OCR/translation counts.
    //  Not perfect — would be better with page-level dates — but avoids 900k doc scan.)
    const ocrCumulative = toCumulative(
      bookStats.filter(r => r.pages_ocr > 0).map(r => ({ _id: r._id, count: r.pages_ocr }))
    );
    const translationCumulative = toCumulative(
      bookStats.filter(r => r.pages_translated > 0).map(r => ({ _id: r._id, count: r.pages_translated }))
    );

    return NextResponse.json({
      books: {
        weekly: booksByWeek.map(r => ({ x: r._id, y: r.count })),
        cumulative: booksCumulative,
      },
      ocr: {
        weekly: bookStats.map(r => ({ x: r._id, y: r.pages_ocr })),
        cumulative: ocrCumulative,
      },
      translation: {
        weekly: bookStats.map(r => ({ x: r._id, y: r.pages_translated })),
        cumulative: translationCumulative,
      },
      totals: { books: totals.books, pages: totals.pages, ocr: totals.ocr, translated: totals.translated },
    });
  } catch (error) {
    console.error('Progress API error:', error);
    return NextResponse.json({ error: 'Failed to fetch progress data' }, { status: 500 });
  }
}

function toCumulative(weekly: Array<{ _id: string; count: number }>) {
  let running = 0;
  return weekly.map(r => {
    running += r.count;
    return { x: r._id, y: running };
  });
}
