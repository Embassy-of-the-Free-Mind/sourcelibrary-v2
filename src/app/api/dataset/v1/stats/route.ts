import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

/**
 * GET /api/dataset/v1/stats
 *
 * Public endpoint — no auth required.
 * Returns corpus statistics for the marketing page and API consumers.
 */
export async function GET() {
  const db = await getDb();
  const books = db.collection('books');
  const visible = { hidden: { $ne: true } };

  const [
    totalBooks,
    languagesAgg,
    clustersAgg,
    pageTotalsAgg,
    dateRangeAgg,
  ] = await Promise.all([
    books.countDocuments(visible),

    books.aggregate<{ _id: string; count: number; pages_ocr: number; pages_translated: number }>([
      { $match: { ...visible, language: { $exists: true, $ne: 'Unknown' } } },
      {
        $group: {
          _id: '$language',
          count: { $sum: 1 },
          pages_ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
          pages_translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
        },
      },
      { $sort: { count: -1 } },
    ]).toArray(),

    books.aggregate<{ _id: string; count: number; pages_translated: number }>([
      { $match: { ...visible, 'taxonomy.cluster': { $exists: true } } },
      {
        $group: {
          _id: '$taxonomy.cluster',
          count: { $sum: 1 },
          pages_translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
        },
      },
      { $sort: { count: -1 } },
    ]).toArray(),

    books.aggregate<{ _id: null; pages: number; ocr: number; translated: number }>([
      { $match: visible },
      {
        $group: {
          _id: null,
          pages: { $sum: { $ifNull: ['$pages_count', 0] } },
          ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
          translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
        },
      },
    ]).toArray(),

    books.aggregate<{ _id: null; earliest: number; latest: number }>([
      { $match: { ...visible, year: { $exists: true, $type: 'number' } } },
      { $group: { _id: null, earliest: { $min: '$year' }, latest: { $max: '$year' } } },
    ]).toArray(),
  ]);

  const pageTotals = pageTotalsAgg[0] ?? { pages: 0, ocr: 0, translated: 0 };
  const dateRange = dateRangeAgg[0] ?? { earliest: 0, latest: 0 };

  return NextResponse.json({
    corpus: {
      total_books: totalBooks,
      total_pages: pageTotals.pages,
      pages_with_ocr: pageTotals.ocr,
      pages_with_translation: pageTotals.translated,
      languages_count: languagesAgg.length,
      clusters_count: clustersAgg.length,
      date_range: { earliest_year: dateRange.earliest, latest_year: dateRange.latest },
    },
    languages: languagesAgg.map(l => ({
      language: l._id,
      books: l.count,
      pages_ocr: l.pages_ocr,
      pages_translated: l.pages_translated,
    })),
    clusters: clustersAgg.map(c => ({
      cluster: c._id,
      books: c.count,
      pages_translated: c.pages_translated,
    })),
    pricing_url: 'https://sourcelibrary.org/dataset',
    api_docs_url: 'https://sourcelibrary.org/dataset#api',
  });
}
