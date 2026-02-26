import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/progress — collection growth data for the progress page.
 * Returns weekly book imports, OCR'd pages, and translated pages over time.
 */
export async function GET() {
  try {
    const db = await getDb();

    // Book imports by week
    const booksByWeek = await db.collection('books').aggregate([
      { $match: { created_at: { $exists: true } } },
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

    // Pages OCR'd by week (using ocr.updated_at)
    const ocrByWeek = await db.collection('pages').aggregate([
      { $match: { 'ocr.data': { $exists: true, $ne: '' }, 'ocr.updated_at': { $exists: true } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: '$ocr.updated_at', unit: 'week' } } },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray();

    // Pages translated by week
    const translationByWeek = await db.collection('pages').aggregate([
      { $match: { 'translation.data': { $exists: true, $ne: '' }, 'translation.updated_at': { $exists: true } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: '$translation.updated_at', unit: 'week' } } },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray();

    // Current totals
    const totalBooks = await db.collection('books').countDocuments();
    const totalPages = await db.collection('pages').countDocuments();
    const totalOcr = await db.collection('pages').countDocuments({ 'ocr.data': { $exists: true, $ne: '' } });
    const totalTranslated = await db.collection('pages').countDocuments({ 'translation.data': { $exists: true, $ne: '' } });

    // Convert to cumulative
    const booksCumulative = toCumulative(booksByWeek as Array<{ _id: string; count: number }>);
    const ocrCumulative = toCumulative(ocrByWeek as Array<{ _id: string; count: number }>);
    const translationCumulative = toCumulative(translationByWeek as Array<{ _id: string; count: number }>);

    return NextResponse.json({
      books: { weekly: booksByWeek.map(r => ({ x: r._id, y: r.count })), cumulative: booksCumulative },
      ocr: { weekly: ocrByWeek.map(r => ({ x: r._id, y: r.count })), cumulative: ocrCumulative },
      translation: { weekly: translationByWeek.map(r => ({ x: r._id, y: r.count })), cumulative: translationCumulative },
      totals: { books: totalBooks, pages: totalPages, ocr: totalOcr, translated: totalTranslated },
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
