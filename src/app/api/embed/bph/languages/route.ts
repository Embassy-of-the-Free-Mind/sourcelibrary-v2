import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';

export const revalidate = 86400; // 24h cache

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/embed/bph/languages
 *
 * Returns all languages in the BPH collection with book counts.
 * Useful for building filter dropdowns.
 */
export async function GET() {
  try {
    const db = await getReadDb();

    const result = await db.collection('books').aggregate([
      {
        $match: {
          'image_source.provider': 'bph',
          visible: true,
          pages_count: { $gt: 0 },
          language: { $exists: true, $ne: null, $ne: '' },
        },
      },
      { $group: { _id: '$language', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ], { maxTimeMS: 8000 }).toArray();

    const languages = result.map(r => ({
      language: r._id as string,
      count: r.count as number,
    }));

    return NextResponse.json({ languages }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('BPH languages error:', error);
    return NextResponse.json({ error: 'Failed to fetch languages' }, { status: 500, headers: CORS_HEADERS });
  }
}
