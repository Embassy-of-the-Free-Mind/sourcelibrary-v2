import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { resolveTenantId } from '@/lib/tenant-context';
import { classifyRequest, recordDroppedEvent } from '@/lib/analytics-ingest';

/**
 * Track analytics events (book reads, page reads, page edits)
 *
 * POST /api/analytics/track
 * Body: {
 *   event: 'book_read' | 'page_read' | 'page_edit',
 *   book_id: string,
 *   page_id?: string,
 * }
 *
 * Tenant twin of /api/analytics/track — same write-time bot classification
 * (#3405). Partner reading rooms are crawled too, and a tenant's own reading
 * stats are exactly the kind of number that gets quoted to a partner.
 */
// Analytics is fire-and-forget — don't hold a serverless slot during DB degradation
const DB_TIMEOUT_MS = 3000;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ tenant: string }> }
) {
  try {
    const body = await request.json();
    const { event, book_id, page_id } = body;
    const { tenant } = await context.params;
    const tenantId = await resolveTenantId(tenant);

    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 400 }
      );
    }

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

    // Classify at write time; the anonymized IP doubles as the dedup key.
    const { cls, isHuman, userAgent, ip, host } = classifyRequest(request);

    // Race all DB work against a short timeout
    const dbWork = (async () => {
      const db = await getDb();
      const now = new Date();

      // Crawlers: aggregate counter only — no event row, no read_count bump.
      if (!isHuman) {
        await recordDroppedEvent(db, host, cls, event);
        return { deduplicated: false, dropped: true };
      }

      // For reads, use atomic upsert to prevent race condition duplicates
      if (event === 'book_read' || event === 'page_read') {
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const dedupeQuery: Record<string, unknown> = {
          event,
          book_id,
          tenantId,
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
              user_agent: userAgent,
              traffic_class: cls,
              host,
              tenantId,
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
          user_agent: userAgent,
          traffic_class: cls,
          host,
          tenantId,
          timestamp: now,
          created_at: new Date(),
        });
      }

      // Update book/page counters for fast reads (fire-and-forget, don't await)
      if (event === 'book_read') {
        db.collection('books').updateOne({ id: book_id, tenantId }, { $inc: { read_count: 1 } }).catch(() => {});
      } else if (event === 'page_read' && page_id) {
        db.collection('pages').updateOne({ id: page_id, tenantId }, { $inc: { read_count: 1 } }).catch(() => {});
      } else if (event === 'page_edit') {
        db.collection('books').updateOne({ id: book_id, tenantId }, { $inc: { edit_count: 1 } }).catch(() => {});
        if (page_id) {
          db.collection('pages').updateOne({ id: page_id, tenantId }, { $inc: { edit_count: 1 } }).catch(() => {});
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
