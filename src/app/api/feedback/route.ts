import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// POST /api/feedback — save feedback
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, page, name, email } = body;

    if (!message || typeof message !== 'string' || message.trim().length < 2) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    if (message.length > 5000) {
      return NextResponse.json({ error: 'Message too long' }, { status: 400 });
    }

    const db = await getDb();

    const doc = {
      message: message.trim(),
      page: page || null,
      name: name?.trim() || null,
      email: email?.trim() || null,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: request.headers.get('user-agent') || null,
      created_at: new Date(),
      read: false,
    };

    await db.collection('feedback').insertOne(doc);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Feedback error:', error);
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
  }
}

// GET /api/feedback — list feedback
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    const unreadOnly = searchParams.get('unread') === 'true';

    const db = await getDb();

    const query: Record<string, unknown> = {};
    if (unreadOnly) query.read = false;

    const [items, total] = await Promise.all([
      db.collection('feedback')
        .find(query)
        .sort({ created_at: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('feedback').countDocuments(query),
    ]);

    return NextResponse.json({ feedback: items, total });
  } catch (error) {
    console.error('Feedback list error:', error);
    return NextResponse.json({ error: 'Failed to load feedback' }, { status: 500 });
  }
}
