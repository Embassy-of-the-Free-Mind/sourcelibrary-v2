import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyCronAuth } from '@/lib/cron-auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, languages, interests, message } = body;

    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }
    if (message && message.length > 5000) {
      return NextResponse.json({ error: 'Message too long' }, { status: 400 });
    }

    const db = await getDb();

    const doc = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      languages: Array.isArray(languages) ? languages.filter((l: string) => typeof l === 'string') : [],
      interests: Array.isArray(interests) ? interests.filter((i: string) => typeof i === 'string') : [],
      message: message?.trim() || null,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      created_at: new Date(),
      contacted: false,
    };

    await db.collection('volunteers').insertOne(doc);

    // TODO: Send email notification to derek@sourcelibrary.org on new submissions
    // Options: Resend API, or a simple webhook to Slack/Discord

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Volunteer signup error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  try {
    const db = await getDb();
    const [items, total] = await Promise.all([
      db.collection('volunteers').find().sort({ created_at: -1 }).limit(200).toArray(),
      db.collection('volunteers').countDocuments(),
    ]);
    return NextResponse.json({ volunteers: items, total });
  } catch (error) {
    console.error('Volunteer list error:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
