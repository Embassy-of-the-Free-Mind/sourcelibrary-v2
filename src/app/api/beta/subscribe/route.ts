import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = body.email;
    const source = body.source;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const db = await getDb();
    const collection = db.collection('beta_subscribers');

    // Check for existing subscriber
    const existing = await collection.findOne({ email: normalizedEmail });
    if (existing) {
      return NextResponse.json({ message: 'Already subscribed!', alreadySubscribed: true });
    }

    // Get IP and country from headers (Cloudflare / Vercel)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    const country = request.headers.get('x-vercel-ip-country')
      || request.headers.get('cf-ipcountry')
      || null;

    await collection.insertOne({
      email: normalizedEmail,
      ip,
      country,
      source: source === 'reader_gate' ? 'reader_gate' : 'beta_landing',
      subscribed_at: new Date(),
      notified: false,
    });

    return NextResponse.json({ message: 'Subscribed successfully' });
  } catch (error) {
    console.error('Beta subscribe error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
