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
          wikidata_birth_date: 1,
          wikidata_death_date: 1,
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

      // Prefer biographical dates for century range, fall back to book years
      let century_range: [number, number] | null = null;

      const birthStr = e.wikidata_birth_date as string | undefined;
      const deathStr = e.wikidata_death_date as string | undefined;
      // parseInt handles negative dates: "-0384-01-01" → -384
      const birthYear = birthStr ? parseInt(birthStr, 10) : NaN;
      const deathYear = deathStr ? parseInt(deathStr, 10) : NaN;

      if (!isNaN(birthYear) || !isNaN(deathYear)) {
        const bioYears = [birthYear, deathYear].filter((y) => !isNaN(y) && y !== 0);
        if (bioYears.length > 0) {
          const minY = Math.min(...bioYears);
          const maxY = Math.max(...bioYears);
          const toCentury = (y: number) => y < 0
            ? -Math.floor((Math.abs(y) - 1) / 100) - 1
            : Math.floor((y - 1) / 100) + 1;
          century_range = [toCentury(minY), toCentury(maxY)];
        }
      }

      if (!century_range) {
        const years = (e.years as number[]).filter((y) => y > 0);
        if (years.length > 0) {
          const minY = Math.min(...years);
          const maxY = Math.max(...years);
          const minC = Math.floor((minY - 1) / 100) + 1;
          const maxC = Math.floor((maxY - 1) / 100) + 1;
          century_range = [minC, maxC];
        }
      }

      if (century_range) {
        for (let c = century_range[0]; c <= century_range[1]; c++) {
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
