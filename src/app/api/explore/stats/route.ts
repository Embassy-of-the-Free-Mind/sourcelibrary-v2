import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

// In-memory cache (1 hour TTL)
const CACHE_TTL_MS = 60 * 60 * 1000;
let cachedResult: { data: unknown; timestamp: number } | null = null;

const EMPTY_RESPONSE = {
  totals: { entities: 0, with_dates: 0, with_coordinates: 0, with_wikidata: 0, books: 0 },
  type_distribution: {},
  heatmap: [],
  top_entities_by_era: [],
  data_sources: {},
};

/**
 * GET /api/explore/stats
 *
 * Reads from Supabase materialized views (instant) with MongoDB snapshot fallback.
 * Views are refreshed daily by pg_cron.
 */
export async function GET() {
  try {
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(cachedResult.data, {
        headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=7200' },
      });
    }

    // Try Supabase materialized views first
    const [statsResult, typesResult, heatmapResult, topResult] = await Promise.all([
      supabase.from('explore_stats').select('*').limit(1).single(),
      supabase.from('entity_type_distribution').select('*'),
      supabase.from('entity_heatmap').select('*').order('century'),
      supabase.from('top_entities_by_era').select('*').order('century'),
    ]);

    if (statsResult.data) {
      const stats = statsResult.data;

      const types: Record<string, number> = {};
      for (const row of typesResult.data || []) {
        types[row.type] = row.count;
      }

      const heatmap = (heatmapResult.data || []).map((r: { century: number; type: string; count: number }) => ({
        century: r.century,
        type: r.type,
        count: r.count,
      }));

      // Group top entities by century
      const eraMap = new Map<number, { name: string; type: string; book_count: number }[]>();
      for (const row of topResult.data || []) {
        if (!eraMap.has(row.century)) eraMap.set(row.century, []);
        eraMap.get(row.century)!.push({ name: row.name, type: row.type, book_count: row.book_count });
      }
      const topEntitiesByEra = [...eraMap.entries()]
        .sort(([a], [b]) => a - b)
        .map(([century, entities]) => ({ century, entities }));

      const data = {
        totals: {
          entities: stats.total_entities,
          with_dates: stats.with_dates,
          with_coordinates: stats.with_coordinates,
          with_wikidata: stats.with_wikidata,
          books: stats.total_books,
        },
        type_distribution: types,
        heatmap,
        top_entities_by_era: topEntitiesByEra,
        data_sources: {
          entities: { label: 'Entity Index', description: 'Extracted from AI-generated book indexes (people, places, concepts)', count: stats.total_entities },
          wikidata: { label: 'Wikidata Alignment', description: 'Entities linked to Wikidata via Wikipedia URLs and name matching', count: stats.with_wikidata, coverage: stats.total_entities > 0 ? +(stats.with_wikidata / stats.total_entities * 100).toFixed(1) : 0 },
          dates: { label: 'Biographical Dates', description: 'Birth/death years from Wikidata claims P569/P570', count: stats.with_dates },
          coordinates: { label: 'Geographic Coordinates', description: 'Lat/lon from Wikidata claim P625 (places) and P19 (birthplaces)', count: stats.with_coordinates },
          books: { label: 'Source Books', description: 'Digitized historical texts from 13 partner libraries', count: stats.total_books },
        },
      };

      cachedResult = { data, timestamp: Date.now() };
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=7200' },
      });
    }

    // Fallback: MongoDB snapshot (for before Supabase views are populated)
    const db = await getDb();
    const snapshot = await db.collection('system_config').findOne(
      { _id: 'explore_stats_snapshot' } as any,
      { maxTimeMS: 5000 },
    );
    const data = snapshot?.data ?? EMPTY_RESPONSE;
    cachedResult = { data, timestamp: Date.now() };
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    console.error('Error fetching explore stats:', error);
    return NextResponse.json(EMPTY_RESPONSE, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=30' },
    });
  }
}
