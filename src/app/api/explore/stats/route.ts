import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

// In-memory cache (1 hour TTL, matches CDN s-maxage)
const CACHE_TTL_MS = 60 * 60 * 1000;
let cachedResult: { data: unknown; timestamp: number } | null = null;

/**
 * GET /api/explore/stats
 *
 * Aggregated overview data for the /explore dashboard:
 * - Entity totals (overall, with dates, with coordinates, with wikidata)
 * - Century × type heatmap data
 * - Top entities per era
 * - Type distribution
 */
export async function GET() {
  try {
    // Return cached result if fresh
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(cachedResult.data, {
        headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
      });
    }

    const db = await getDb();

    // Try pre-computed snapshot first (these aggregations take 30-80s on Atlas)
    const snapshot = await db.collection('system_config').findOne(
      { _id: 'explore_stats_snapshot' } as any,
      { maxTimeMS: 3000 },
    );

    if (snapshot?.data && snapshot?.updated_at) {
      const age = Date.now() - new Date(snapshot.updated_at).getTime();
      if (age < 24 * 60 * 60 * 1000) { // 24h — this data changes slowly
        cachedResult = { data: snapshot.data, timestamp: Date.now() };
        return NextResponse.json(snapshot.data, {
          headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
        });
      }
    }

    const MAX_TIME = 15000;

    const [
      totalEntities,
      withDates,
      withCoordinates,
      withWikidata,
      totalBooks,
      typeDistribution,
      heatmapData,
      topByEra,
    ] = await Promise.all([
      db.collection('entities').countDocuments({}, { maxTimeMS: MAX_TIME }),

      db.collection('entities').countDocuments({
        $or: [
          { wikidata_birth_date: { $exists: true, $ne: null } },
          { wikidata_death_date: { $exists: true, $ne: null } },
        ],
      }, { maxTimeMS: MAX_TIME }),

      db.collection('entities').countDocuments({
        wikidata_coordinates: { $exists: true, $ne: null },
      }, { maxTimeMS: MAX_TIME }),

      db.collection('entities').countDocuments({
        wikidata_id: { $exists: true, $ne: null },
      }, { maxTimeMS: MAX_TIME }),

      db.collection('books').countDocuments({ visible: true }, { maxTimeMS: MAX_TIME }),

      db.collection('entities').aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ], { maxTimeMS: MAX_TIME }).toArray(),

      db.collection('entities').aggregate([
        { $unwind: '$books' },
        {
          $lookup: {
            from: 'books',
            localField: 'books.book_id',
            foreignField: 'id',
            as: 'book_doc',
          },
        },
        { $unwind: '$book_doc' },
        { $match: { 'book_doc.year': { $exists: true, $gt: 0 } } },
        {
          $group: {
            _id: {
              entity: '$name',
              type: '$type',
              century: {
                $add: [
                  { $floor: { $divide: [{ $subtract: ['$book_doc.year', 1] }, 100] } },
                  1,
                ],
              },
            },
          },
        },
        {
          $group: {
            _id: { century: '$_id.century', type: '$_id.type' },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.century': 1 } },
      ], { maxTimeMS: 30000 }).toArray(),

      db.collection('entities').aggregate([
        { $match: { book_count: { $gte: 2 } } },
        { $unwind: '$books' },
        {
          $lookup: {
            from: 'books',
            localField: 'books.book_id',
            foreignField: 'id',
            as: 'book_doc',
          },
        },
        { $unwind: '$book_doc' },
        { $match: { 'book_doc.year': { $exists: true, $gt: 0 } } },
        {
          $group: {
            _id: {
              entity: '$name',
              type: '$type',
              century: {
                $add: [
                  { $floor: { $divide: [{ $subtract: ['$book_doc.year', 1] }, 100] } },
                  1,
                ],
              },
            },
            book_count: { $first: '$book_count' },
          },
        },
        { $sort: { book_count: -1 } },
        {
          $group: {
            _id: '$_id.century',
            entities: {
              $push: {
                name: '$_id.entity',
                type: '$_id.type',
                book_count: '$book_count',
              },
            },
          },
        },
        {
          $project: {
            century: '$_id',
            entities: { $slice: ['$entities', 5] },
          },
        },
        { $sort: { century: 1 } },
      ], { maxTimeMS: 30000 }).toArray(),
    ]);

    // Format heatmap data
    const heatmap = heatmapData.map((row) => ({
      century: row._id.century as number,
      type: row._id.type as string,
      count: row.count as number,
    }));

    // Format type distribution
    const types: Record<string, number> = {};
    for (const row of typeDistribution) {
      types[row._id as string] = row.count as number;
    }

    // Format top by era
    const topEntitiesByEra = topByEra.map((row) => ({
      century: row.century as number,
      entities: row.entities as Array<{ name: string; type: string; book_count: number }>,
    }));

    // Data sources — what alignment produced these numbers
    const dataSources = {
      entities: {
        label: 'Entity Index',
        description: 'Extracted from AI-generated book indexes (people, places, concepts)',
        count: totalEntities,
      },
      wikidata: {
        label: 'Wikidata Alignment',
        description: 'Entities linked to Wikidata via Wikipedia URLs and name matching',
        count: withWikidata,
        coverage: totalEntities > 0 ? +(withWikidata / totalEntities * 100).toFixed(1) : 0,
      },
      dates: {
        label: 'Biographical Dates',
        description: 'Birth/death years from Wikidata claims P569/P570',
        count: withDates,
      },
      coordinates: {
        label: 'Geographic Coordinates',
        description: 'Lat/lon from Wikidata claim P625 (places) and P19 (birthplaces)',
        count: withCoordinates,
      },
      books: {
        label: 'Source Books',
        description: 'Digitized historical texts from 13 partner libraries',
        count: totalBooks,
      },
    };

    const data = {
      totals: {
        entities: totalEntities,
        with_dates: withDates,
        with_coordinates: withCoordinates,
        with_wikidata: withWikidata,
        books: totalBooks,
      },
      type_distribution: types,
      heatmap,
      top_entities_by_era: topEntitiesByEra,
      data_sources: dataSources,
    };

    cachedResult = { data, timestamp: Date.now() };

    // Write snapshot for next cold start (fire-and-forget)
    db.collection('system_config').updateOne(
      { _id: 'explore_stats_snapshot' } as any,
      { $set: { data, updated_at: new Date().toISOString() } },
      { upsert: true },
    ).catch(() => {});

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    });
  } catch (error) {
    console.error('Error fetching explore stats:', error);

    // Serve stale snapshot on error
    try {
      const db = await getDb();
      const stale = await db.collection('system_config').findOne(
        { _id: 'explore_stats_snapshot' } as any,
        { maxTimeMS: 3000 },
      );
      if (stale?.data) {
        return NextResponse.json(stale.data, {
          headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' },
        });
      }
    } catch { /* ignore */ }

    return NextResponse.json(
      { error: 'Failed to fetch explore stats' },
      { status: 500 }
    );
  }
}
