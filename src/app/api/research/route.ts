import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 15;

/**
 * GET /api/research
 *
 * List curator research sessions with optional filtering.
 *
 * Query params:
 *   - theme: filter by theme tag
 *   - type: filter by session_type (acquisition, research, gap_analysis, mixed)
 *   - sort: 'date' (default) or 'score'
 *   - limit: max results (default 20, max 100)
 *   - offset: pagination offset
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const theme = searchParams.get('theme');
    const type = searchParams.get('type');
    const sort = searchParams.get('sort') || 'date';
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    const db = await getDb();
    const collection = db.collection('curator_sessions');

    // Build filter
    const filter: Record<string, unknown> = {};
    if (theme) filter.themes = theme;
    if (type) filter.session_type = type;

    // Sort
    const sortObj: Record<string, 1 | -1> = sort === 'score'
      ? { curator_score: -1, date: -1 }
      : { date: -1 };

    // Query without messages for list view
    const [sessions, total, themesAgg, typesAgg] = await Promise.all([
      collection
        .find(filter, { projection: { messages: 0 } })
        .sort(sortObj)
        .skip(offset)
        .limit(limit)
        .toArray(),
      collection.countDocuments(filter),
      collection.aggregate([
        { $unwind: '$themes' },
        { $group: { _id: '$themes', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      collection.aggregate([
        { $group: { _id: '$session_type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
    ]);

    // Strip _id from results
    const cleaned = sessions.map(({ _id, ...rest }) => rest);

    return NextResponse.json({
      sessions: cleaned,
      total,
      themes: themesAgg.map(t => t._id as string),
      types: typesAgg.map(t => t._id as string),
    });
  } catch (error) {
    console.error('Research list error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch research sessions' },
      { status: 500 }
    );
  }
}
