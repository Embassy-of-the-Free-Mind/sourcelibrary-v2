import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 30;

export const GET = withAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const db = await getDb();
    const match = { event: 'search_query', created_at: { $gte: cutoffDate } };

    const [
      topQueries,
      zeroResultQueries,
      searchesByDay,
      searchesBySource,
      totalSearches,
      recentSearches,
    ] = await Promise.all([
      // Top queries by frequency
      db.collection('analytics_events').aggregate([
        { $match: match },
        { $group: {
          _id: { $toLower: '$query' },
          count: { $sum: 1 },
          avg_results: { $avg: '$results_count' },
          last_searched: { $max: '$created_at' },
        }},
        { $sort: { count: -1 } },
        { $limit: 30 },
      ]).toArray(),

      // Queries that returned zero results (content gaps)
      db.collection('analytics_events').aggregate([
        { $match: { ...match, results_count: 0 } },
        { $group: {
          _id: { $toLower: '$query' },
          count: { $sum: 1 },
          last_searched: { $max: '$created_at' },
        }},
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]).toArray(),

      // Searches per day
      db.collection('analytics_events').aggregate([
        { $match: match },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
          count: { $sum: 1 },
          unique_queries: { $addToSet: { $toLower: '$query' } },
        }},
        { $project: {
          _id: 1,
          count: 1,
          unique_queries: { $size: '$unique_queries' },
        }},
        { $sort: { _id: 1 } },
      ]).toArray(),

      // Searches by source (global, unified, book_search)
      db.collection('analytics_events').aggregate([
        { $match: match },
        { $group: {
          _id: { $ifNull: ['$filters.source', 'global'] },
          count: { $sum: 1 },
        }},
        { $sort: { count: -1 } },
      ]).toArray(),

      // Total count
      db.collection('analytics_events').countDocuments(match),

      // Most recent individual searches
      db.collection('analytics_events')
        .find(match, { projection: { query: 1, results_count: 1, created_at: 1, 'filters.source': 1 } })
        .sort({ created_at: -1 })
        .limit(50)
        .toArray(),
    ]);

    return NextResponse.json({
      totalSearches,
      topQueries: topQueries.map(q => ({
        query: q._id,
        count: q.count,
        avg_results: Math.round(q.avg_results * 10) / 10,
        last_searched: q.last_searched,
      })),
      zeroResultQueries: zeroResultQueries.map(q => ({
        query: q._id,
        count: q.count,
        last_searched: q.last_searched,
      })),
      searchesByDay: searchesByDay.map(d => ({
        date: d._id,
        count: d.count,
        unique_queries: d.unique_queries,
      })),
      searchesBySource: searchesBySource.map(s => ({
        source: s._id,
        count: s.count,
      })),
      recentSearches: recentSearches.map(s => ({
        query: s.query,
        results_count: s.results_count,
        source: s.filters?.source || 'global',
        timestamp: s.created_at,
      })),
      query: { days },
    });
  } catch (error) {
    console.error('Search analytics error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch search analytics' },
      { status: 500 }
    );
  }
});
