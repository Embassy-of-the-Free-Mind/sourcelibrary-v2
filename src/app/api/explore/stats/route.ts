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
 * - Century × type heatmap data (from snapshot — too expensive to compute live)
 * - Top entities per era (from snapshot)
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
    const MAX_TIME = 15000;

    // Load snapshot for expensive heatmap/topByEra data (pre-computed by cron/script)
    const snapshotPromise = db.collection('system_config').findOne(
      { _id: 'explore_stats_snapshot' } as any,
      { maxTimeMS: 3000 },
    );

    // Run cheap queries live for fresh counts
    const [
      totalEntities,
      withDates,
      withCoordinates,
      withWikidata,
      totalBooks,
      typeDistribution,
      snapshot,
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

      db.collection('books').countDocuments({ visible: true, pages_count: { $gt: 0 } }, { maxTimeMS: MAX_TIME }),

      db.collection('entities').aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ], { maxTimeMS: MAX_TIME }).toArray(),

      snapshotPromise,
    ]);

    // Format type distribution
    const types: Record<string, number> = {};
    for (const row of typeDistribution) {
      types[row._id as string] = row.count as number;
    }

    // Use snapshot for expensive cross-collection data, empty arrays if not available
    const heatmap = snapshot?.data?.heatmap ?? [];
    const topEntitiesByEra = snapshot?.data?.top_entities_by_era ?? [];

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

    // Return empty-but-valid structure so the UI doesn't break
    return NextResponse.json({
      totals: { entities: 0, with_dates: 0, with_coordinates: 0, with_wikidata: 0, books: 0 },
      type_distribution: {},
      heatmap: [],
      top_entities_by_era: [],
      data_sources: {},
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' },
    });
  }
}
