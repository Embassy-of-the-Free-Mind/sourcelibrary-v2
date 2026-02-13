import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

const SITE_HOST = 'sourcelibrary.org';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // Support both formats: { path, referrer, userAgent } and { event, properties: { path, referrer, userAgent } }
    const { path, referrer, userAgent } = body.properties || body;

    const db = await getDb();

    // Parse referrer — filter out self-referrals
    let referrerDomain = 'direct';
    if (referrer) {
      try {
        const url = new URL(referrer);
        const hostname = url.hostname.replace('www.', '');
        if (hostname !== SITE_HOST) {
          referrerDomain = hostname;
        }
      } catch {
        referrerDomain = referrer.split('/')[2] || 'unknown';
      }
    }

    // Detect country (basic - from IP via headers)
    const country = request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || 'Unknown';

    // Insert analytics record
    await db.collection('analytics_pageviews').insertOne({
      path,
      referrer: referrerDomain,
      country,
      userAgent: userAgent?.substring(0, 200),
      timestamp: new Date(),
      ip: request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Track error:', error);
    return NextResponse.json(
      { error: 'Failed to track pageview' },
      { status: 500 }
    );
  }
}
