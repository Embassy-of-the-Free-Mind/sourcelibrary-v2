import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 15;

/**
 * GET /api/research/[id]
 *
 * Get a single curator research session with paginated messages.
 *
 * Query params:
 *   - page: message page (default 1)
 *   - per_page: messages per page (default 50, max 200)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const perPage = Math.min(parseInt(searchParams.get('per_page') || '50'), 200);

    const db = await getDb();
    const session = await db.collection('curator_sessions').findOne({ id });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const { _id, messages: allMessages, ...rest } = session;
    const totalMessages = (allMessages as unknown[])?.length || 0;
    const start = (page - 1) * perPage;
    const paginatedMessages = (allMessages as unknown[])?.slice(start, start + perPage) || [];

    return NextResponse.json({
      ...rest,
      messages: paginatedMessages,
      total_messages: totalMessages,
      page,
      per_page: perPage,
    });
  } catch (error) {
    console.error('Research detail error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch research session' },
      { status: 500 }
    );
  }
}
