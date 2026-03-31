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
      // Total entities
      db.collection('entities').countDocuments(),

      // Entities with birth or death dates
      db.collection('entities').countDocuments({
        $or: [
          { wikidata_birth_date: { $exists: true, $ne: null } },
          { wikidata_death_date: { $exists: true, $ne: null } },
        ],
      }),

      // Entities with coordinates
      db.collection('entities').countDocuments({
        wikidata_coordinates: { $exists: true, $ne: null },
      }),

      // Entities with wikidata IDs
      db.collection('entities').countDocuments({
        wikidata_id: { $exists: true, $ne: null },
      }),

      // Total books
      db.collection('books').countDocuments({ visible: true }),

      // Type distribution
      db.collection('entities').aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]).toArray(),

      // Century × type heatmap
      // Uses books' years to bin entities into centuries
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
      ]).toArray(),

      // Top entities per era (top 5 per century by book_count)
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
      ]).toArray(),
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

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    });
  } catch (error) {
    console.error('Error fetching explore stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch explore stats' },
      { status: 500 }
    );
  }
}
