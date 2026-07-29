import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { toUserId } from '@/lib/user-id';

/**
 * GET /api/ficino/discussions — list discussion threads (members only)
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const db = await getDb();
  const user = await db.collection('users').findOne(
    { _id: toUserId(session.user.id) as any },
    { projection: { membership: 1 } }
  );

  // Check Society membership (free join), not financial contribution
  if (!user?.membership?.joined && !user?.membership?.active) {
    return NextResponse.json({ error: 'Membership required' }, { status: 403 });
  }

  const threads = await db.collection('discussions')
    .find({})
    .sort({ pinned: -1, lastActivityAt: -1 })
    .limit(50)
    .toArray();

  return NextResponse.json({
    threads: threads.map(t => ({
      id: t._id.toString(),
      title: t.title,
      body: t.body,
      authorName: t.authorName,
      createdAt: t.createdAt,
      lastActivityAt: t.lastActivityAt,
      replyCount: t.replyCount || 0,
      pinned: t.pinned || false,
    })),
  });
}

/**
 * POST /api/ficino/discussions — create a new discussion thread
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const db = await getDb();
  const user = await db.collection('users').findOne(
    { _id: toUserId(session.user.id) as any },
    { projection: { membership: 1, name: 1 } }
  );

  if (!user?.membership?.joined && !user?.membership?.active) {
    return NextResponse.json({ error: 'Membership required' }, { status: 403 });
  }

  const body = await request.json();
  const title = (body.title || '').trim().slice(0, 200);
  const content = (body.body || '').trim().slice(0, 10000);

  if (!title || !content) {
    return NextResponse.json({ error: 'Title and body are required' }, { status: 400 });
  }

  const displayName = user.membership?.profile?.displayName || user.name || 'A member';
  const now = new Date();

  const result = await db.collection('discussions').insertOne({
    title,
    body: content,
    authorId: session.user.id,
    authorName: displayName,
    createdAt: now,
    lastActivityAt: now,
    replyCount: 0,
    pinned: false,
  });

  return NextResponse.json({ id: result.insertedId.toString() }, { status: 201 });
}
