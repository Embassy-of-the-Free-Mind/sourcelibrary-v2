import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Track analytics events (book reads, page reads, page edits)
 *
 * POST /api/analytics/track
 * Body: {
 *   event: 'book_read' | 'page_read' | 'page_edit',
 *   book_id: string,
 *   page_id?: string,
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { event, book_id, page_id } = body;

    if (!event || !book_id) {
      return NextResponse.json(
        { error: 'Missing required fields: event, book_id' },
        { status: 400 }
      );
    }

    if (!['book_read', 'page_read', 'page_edit'].includes(event)) {
      return NextResponse.json(
        { error: 'Invalid event type' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Get client IP for deduplication
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';

    // For reads, dedupe by IP + target within last hour
    if (event === 'book_read' || event === 'page_read') {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const dedupeQuery: Record<string, unknown> = {
        event,
        book_id,
        ip,
        timestamp: { $gte: oneHourAgo }
      };
      if (event === 'page_read' && page_id) {
        dedupeQuery.page_id = page_id;
      }

      const existing = await db.collection('analytics_events').findOne(dedupeQuery);
      if (existing) {
        return NextResponse.json({ success: true, deduplicated: true });
      }
    }

    // Insert event
    await db.collection('analytics_events').insertOne({
      event,
      book_id,
      page_id: page_id || null,
      ip,
      timestamp: Date.now(),
      created_at: new Date(),
    });

    // Update book/page counters for fast reads
    if (event === 'book_read') {
      await db.collection('books').updateOne(
        { id: book_id },
        { $inc: { read_count: 1 } }
      );
    } else if (event === 'page_read' && page_id) {
      // Increment page read count
      await db.collection('pages').updateOne(
        { id: page_id },
        { $inc: { read_count: 1 } }
      );
    } else if (event === 'page_edit') {
      await db.collection('books').updateOne(
        { id: book_id },
        { $inc: { edit_count: 1 } }
      );
      if (page_id) {
        await db.collection('pages').updateOne(
          { id: page_id },
          { $inc: { edit_count: 1 } }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Analytics track error:', error);
    return NextResponse.json(
      { error: 'Failed to track event' },
      { status: 500 }
    );
  }
}
