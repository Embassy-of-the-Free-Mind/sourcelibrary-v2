import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

/**
 * Podcast listen events from the episode-page player.
 * Fire-and-forget — never fails to the client. No cookies, no PII:
 * `vid` is an ephemeral per-pageview id generated in the player.
 *
 * POST /api/podcast/events
 * Body: { threadId, format, event: play|q1|q2|q3|complete, position?, duration?, vid }
 *
 * Read the funnel with scripts/analytics/podcast-listens.mjs.
 */
const DB_TIMEOUT_MS = 3000;
const EVENTS = new Set(['play', 'q1', 'q2', 'q3', 'complete']);

export async function POST(request: NextRequest) {
  try {
    // sendBeacon posts as text/plain, so parse the raw body
    const body = JSON.parse(await request.text());
    const { threadId, format, event, position, duration, vid } = body || {};

    if (
      !ObjectId.isValid(threadId) ||
      !EVENTS.has(event) ||
      typeof vid !== 'string' || vid.length > 64
    ) {
      return NextResponse.json({ ok: true });
    }

    const dbWork = (async () => {
      const db = await getDb();
      // One row per (pageview, event) — replays within a pageview don't double-count
      await db.collection('podcast_plays').updateOne(
        { vid, thread_id: threadId, event },
        {
          $setOnInsert: {
            vid,
            thread_id: threadId,
            format: typeof format === 'string' ? format.slice(0, 20) : 'deep-dive',
            event,
            position: Number.isFinite(position) ? Math.round(position) : null,
            duration: Number.isFinite(duration) ? Math.round(duration) : null,
            created_at: new Date(),
          },
        },
        { upsert: true },
      );
    })();

    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), DB_TIMEOUT_MS)
    );

    await Promise.race([dbWork, timeout]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
