import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
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
 * Non-human traffic is classified and dropped here (counted in aggregate only),
 * exactly as `/api/track` does for pageviews — see src/lib/analytics-ingest.ts
 * and #3405. Events that ARE stored carry `traffic_class` + `user_agent` so a
 * future contamination is diagnosable from the data instead of by inference.
 *
 * `host` is stored for the same reason. The apex is behind Cloudflare but the
 * bare `sourcelibrary-v2.vercel.app` deployment host answers the whole site
 * with no `cf-ray` at all, so every Cloudflare-layer control — the ASN blocks,
 * the crawler gate's entire first layer — is bypassed by anyone who uses that
 * hostname instead. Without `host` on the event there is no way to tell an
 * edge rule that isn't working from one that is being routed around.
 */
// Analytics is fire-and-forget — don't hold a serverless slot during DB degradation
const DB_TIMEOUT_MS = 3000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { event, book_id, page_id } = body;

    // No tenantId check: the events written below don't carry a tenant field
    // anyway, and counter updates are keyed by book/page id alone. Requiring
    // one just broke tracking on the global main domain.

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

    // Classify at write time. The IP is anonymized (last octet zeroed) and also
    // serves as the dedup key.
    const { cls, isHuman, userAgent, ip, host } = classifyRequest(request);

    // Race all DB work against a short timeout
    const dbWork = (async () => {
      const db = await getDb();
      const now = new Date();

      // Crawlers: aggregate counter only. They must not land in
      // analytics_events (they swamped reading depth 34:1) and must not bump
      // books/pages.read_count — that counter sorts "popular" surfaces AND
      // picks which books get paid OCR batches, so inflating it spends money.
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
