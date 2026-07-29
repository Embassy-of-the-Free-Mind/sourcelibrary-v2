import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// Query-time guard: 4 aggregations run in parallel via Promise.all, so each
// gets up to this budget concurrently. Kept well below maxDuration (15s) to
// leave headroom for connection setup + response serialization, and so a
// slow Mongo query fails cleanly (503) instead of the whole function getting
// hard-killed at 15s while the aggregation keeps running server-side.
const QUERY_TIMEOUT_MS = 10_000;

function isMongoTimeout(err: unknown): boolean {
  const e = err as { codeName?: string; code?: number } | null;
  return e?.codeName === 'MaxTimeMSExpired' || e?.code === 50;
}

/**
 * GET /api/dataset/v1/stats
 *
 * Public endpoint — no auth required.
 * Returns corpus statistics for the marketing page and API consumers.
 */
export async function GET() {
  const db = await getReadDb();
  const books = db.collection('books');
  const visible = { visible: true };

  let totalBooks: number;
  let languagesAgg: Array<{ _id: string; count: number; pages_ocr: number; pages_translated: number }>;
  let clustersAgg: Array<{ _id: string; count: number; pages_translated: number }>;
  let pageTotalsAgg: Array<{ _id: null; pages: number; ocr: number; translated: number }>;
  let dateRangeAgg: Array<{ _id: null; earliest: number; latest: number }>;

  try {
    [
      totalBooks,
      languagesAgg,
      clustersAgg,
      pageTotalsAgg,
      dateRangeAgg,
    ] = await Promise.all([
      books.countDocuments(visible, { maxTimeMS: QUERY_TIMEOUT_MS }),

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
      ], { maxTimeMS: QUERY_TIMEOUT_MS }).toArray(),

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
      ], { maxTimeMS: QUERY_TIMEOUT_MS }).toArray(),

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
      ], { maxTimeMS: QUERY_TIMEOUT_MS }).toArray(),

      books.aggregate<{ _id: null; earliest: number; latest: number }>([
        { $match: { ...visible, year: { $exists: true, $type: 'number' } } },
        { $group: { _id: null, earliest: { $min: '$year' }, latest: { $max: '$year' } } },
      ], { maxTimeMS: QUERY_TIMEOUT_MS }).toArray(),
    ]);
  } catch (err) {
    if (isMongoTimeout(err)) {
      return NextResponse.json(
        { error: 'Corpus stats are temporarily unavailable — the database is under load. Try again shortly.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    console.error('Dataset stats API error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

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
  }, {
    // Corpus stats change slowly (daily pipeline cadence at most) — cache at
    // the edge so repeat/bot traffic doesn't re-run these 4 scans. Mirrors
    // the CDN-Cache-Control convention in next.config.ts / api/image.
    headers: {
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
      'CDN-Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
