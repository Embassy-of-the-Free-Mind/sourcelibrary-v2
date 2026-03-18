import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { anonymizeIp } from '@/lib/anonymize-ip';

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
// Analytics is fire-and-forget — don't hold a serverless slot during DB degradation
const DB_TIMEOUT_MS = 3000;

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

    // Get client IP for deduplication (anonymized — last octet zeroed)
    const rawIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    const ip = anonymizeIp(rawIp);

    // Race all DB work against a short timeout
    const dbWork = (async () => {
      const db = await getDb();
      const now = new Date();

      // For reads, use atomic upsert to prevent race condition duplicates
      if (event === 'book_read' || event === 'page_read') {
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const dedupeQuery: Record<string, unknown> = {
          event,
          book_id,
          ip,
          timestamp: { $gte: oneHourAgo }
        };
        if (event === 'page_read' && page_id) {
          dedupeQuery.page_id = page_id;
        }

        const result = await db.collection('analytics_events').findOneAndUpdate(
          dedupeQuery,
          {
            $setOnInsert: {
              event,
              book_id,
              page_id: page_id || null,
              ip,
              timestamp: now,
              created_at: new Date(),
            }
          },
          { upsert: true, returnDocument: 'before' }
        );

        if (result) return { deduplicated: true };
      } else {
        await db.collection('analytics_events').insertOne({
          event,
          book_id,
          page_id: page_id || null,
          ip,
          timestamp: now,
          created_at: new Date(),
        });
      }

      // Update book/page counters for fast reads (fire-and-forget, don't await)
      if (event === 'book_read') {
        db.collection('books').updateOne({ id: book_id }, { $inc: { read_count: 1 } }).catch(() => {});
      } else if (event === 'page_read' && page_id) {
        db.collection('pages').updateOne({ id: page_id }, { $inc: { read_count: 1 } }).catch(() => {});
      } else if (event === 'page_edit') {
        db.collection('books').updateOne({ id: book_id }, { $inc: { edit_count: 1 } }).catch(() => {});
        if (page_id) {
          db.collection('pages').updateOne({ id: page_id }, { $inc: { edit_count: 1 } }).catch(() => {});
        }
      }

      return { deduplicated: false };
    })();

    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), DB_TIMEOUT_MS)
    );

    const result = await Promise.race([dbWork, timeout]);
    if (result === 'timeout') {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true, ...result });
  } catch {
    // Silently succeed — analytics must never error to the client
    return NextResponse.json({ success: true });
  }
}
