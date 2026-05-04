import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Auto-log 404 page hits.
 * Fire-and-forget — never fails to the client.
 *
 * POST /api/analytics/not-found
 * Body: { url: string, referrer?: string }
 */
const DB_TIMEOUT_MS = 3000;

export async function POST(request: NextRequest) {
  try {
    const { url, referrer } = await request.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ ok: true });
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ua = request.headers.get('user-agent') || '';

    const dbWork = (async () => {
      const db = await getDb();

      // Deduplicate: same URL + IP within 1 hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const anonIp = ip.replace(/\.\d+$/, '.0');

      await db.collection('not_found_reports').findOneAndUpdate(
        { url, ip: anonIp, created_at: { $gte: oneHourAgo } },
        {
          $setOnInsert: {
            url,
            referrer: referrer || null,
            ip: anonIp,
            ua: ua.slice(0, 200),
            created_at: new Date(),
          },
          $inc: { hit_count: 1 },
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
