import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;

export async function POST(request: NextRequest) {
  if (!MONGODB_URI || !MONGODB_DB) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 500 }
    );
  }

  try {
    const { path, referrer, userAgent } = await request.json();

    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(MONGODB_DB);

    // Parse referrer
    let referrerDomain = 'direct';
    if (referrer && referrer !== location.origin) {
      try {
        const url = new URL(referrer);
        referrerDomain = url.hostname.replace('www.', '');
      } catch {
        referrerDomain = referrer.split('/')[2] || 'unknown';
      }
    }

    // Detect country (basic - from IP via headers)
    const country = request.headers.get('cf-ipcountry') || 'Unknown';

    // Insert analytics record
    await db.collection('analytics_pageviews').insertOne({
      path,
      referrer: referrerDomain,
      country,
      userAgent: userAgent?.substring(0, 200),
      timestamp: new Date(),
      ip: request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown',
    });

    await client.close();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Track error:', error);
    return NextResponse.json(
      { error: 'Failed to track pageview' },
      { status: 500 }
    );
  }
}
