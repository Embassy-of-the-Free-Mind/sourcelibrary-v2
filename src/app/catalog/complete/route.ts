import { createHash } from 'crypto';
import { getDb } from '@/lib/mongodb';
import { clientIpFromHeaders } from '@/lib/analytics-ingest';
import { TRIPWIRE_COLLECTION } from '@/lib/tripwire';

/**
 * The tripwire target (#5995) — see src/lib/tripwire.ts for why it exists.
 *
 * Must reach the origin on EVERY hit: a CDN-cached copy would answer the
 * scraper without recording it, so the response is no-store and the route is
 * dynamic. The body is a plain, cheap 200 — a 403 or a redirect would tell the
 * client it had been noticed.
 */
export const dynamic = 'force-dynamic';

const BODY = `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Catalogue</title></head><body><p>The catalogue is at <a href="https://sourcelibrary.org/catalog">sourcelibrary.org/catalog</a>. Bulk and machine access: <a href="https://sourcelibrary.org/licensing">sourcelibrary.org/licensing</a>.</p></body></html>`;

export async function GET(request: Request): Promise<Response> {
  const h = request.headers;
  const ip = clientIpFromHeaders(h); // already anonymised to a /24
  const ua = (h.get('user-agent') || '').slice(0, 400);
  const day = new Date().toISOString().slice(0, 10);
  // One doc per (day, /24, UA): a flood grows a counter, not the collection.
  const key = createHash('sha1').update(`${day}|${ip}|${ua}`).digest('hex');

  try {
    const db = await getDb();
    await db.collection<{ _id: string }>(TRIPWIRE_COLLECTION).updateOne(
      { _id: key },
      {
        $inc: { hits: 1 },
        $setOnInsert: { day, ip, user_agent: ua, first_seen: new Date() },
        $set: {
          last_seen: new Date(),
          last_referer: (h.get('referer') || '').slice(0, 300),
          host: (h.get('host') || '').slice(0, 100),
          country: h.get('cf-ipcountry') || null,
        },
      },
      { upsert: true },
    );
  } catch (err) {
    // Recording is best-effort; the response must look the same either way.
    console.error('[tripwire] write failed:', (err as Error).message);
  }

  return new Response(BODY, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'CDN-Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
