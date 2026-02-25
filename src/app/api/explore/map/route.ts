import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

/**
 * GET /api/explore/map
 *
 * Returns all entities with geographic coordinates, projected to minimal fields.
 * Includes century ranges derived from associated books.
 */
export async function GET() {
  try {
    const db = await getDb();

    // Get all entities with coordinates — lookup books for century data
    const entities = await db.collection('entities').aggregate([
      { $match: { wikidata_coordinates: { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: 'books',
          localField: 'books.book_id',
          foreignField: 'id',
          as: 'book_docs',
          pipeline: [
            { $match: { year: { $exists: true, $gt: 0 } } },
            { $project: { year: 1 } },
          ],
        },
      },
      {
        $project: {
          _id: 0,
          name: 1,
          type: 1,
          coordinates: '$wikidata_coordinates',
          book_count: 1,
          total_mentions: 1,
          description: 1,
          wikidata_id: 1,
          years: '$book_docs.year',
        },
      },
    ]).toArray();

    // Compute century range + stats
    const byType: Record<string, number> = {};
    const byCentury: Record<string, number> = {};

    const mapped = entities.map((e) => {
      const type = e.type as string;
      byType[type] = (byType[type] || 0) + 1;

      const years = (e.years as number[]).filter((y) => y > 0);
      let century_range: [number, number] | null = null;
      if (years.length > 0) {
        const minY = Math.min(...years);
        const maxY = Math.max(...years);
        const minC = Math.floor((minY - 1) / 100) + 1;
        const maxC = Math.floor((maxY - 1) / 100) + 1;
        century_range = [minC, maxC];
        for (let c = minC; c <= maxC; c++) {
          byCentury[String(c)] = (byCentury[String(c)] || 0) + 1;
        }
      }

      return {
        name: e.name as string,
        type: type,
        coordinates: e.coordinates as { lat: number; lng: number },
        book_count: e.book_count as number,
        total_mentions: e.total_mentions as number,
        description: (e.description as string) || undefined,
        wikidata_id: (e.wikidata_id as string) || undefined,
        century_range,
      };
    });

    return NextResponse.json({
      entities: mapped,
      stats: {
        total: mapped.length,
        by_type: byType,
        by_century: byCentury,
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    });
  } catch (error) {
    console.error('Error fetching map data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch map data' },
      { status: 500 }
    );
  }
}
