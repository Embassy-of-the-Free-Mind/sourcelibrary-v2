import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Log broken image reports from the client.
 * Fire-and-forget — never fails to the client.
 *
 * POST /api/analytics/broken-image
 * Body: { urls: string[], page: string, timestamp: string }
 */
const DB_TIMEOUT_MS = 3000;

export async function POST(request: NextRequest) {
  try {
    const { urls, page, timestamp } = await request.json();
    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ ok: true });
    }

    // Cap at 20 per report to prevent abuse
    const capped = urls.slice(0, 20);

    const ua = request.headers.get('user-agent') || '';
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

    const dbWork = (async () => {
      const db = await getDb();
      await db.collection('broken_image_reports').insertOne({
        urls: capped,
        page,
        reported_at: timestamp ? new Date(timestamp) : new Date(),
        ip: ip.replace(/\.\d+$/, '.0'), // anonymize last octet
        ua: ua.slice(0, 200),
        created_at: new Date(),
      });
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
