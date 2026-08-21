import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { z } from 'zod';
import { toUserId } from '@/lib/user-id';

const messageSchema = z.object({
  content: z.string().min(1, 'Message cannot be empty').max(5000, 'Message too long'),
});

/**
 * GET /api/embassy/rooms/[slug]/messages — Get messages in a room.
 * Supports polling: pass ?after=<ISO date> to get only new messages.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const url = new URL(request.url);
  const after = url.searchParams.get('after');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  const db = await getDb();

  const room = await db.collection('embassy_rooms').findOne({ slug });
  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  const query: any = { roomSlug: slug };
  if (after) {
    query.createdAt = { $gt: new Date(after) };
  }

  const messages = await db.collection('embassy_room_messages')
    .find(query)
    .sort({ createdAt: after ? 1 : -1 })
    .limit(limit)
    .toArray();

  // Initial load: reverse so oldest first
  if (!after) {
    messages.reverse();
  }

  return NextResponse.json({
    messages: messages.map(m => ({
      id: m._id.toString(),
      authorId: m.authorId,
      authorName: m.authorName,
      authorImage: m.authorImage,
      content: m.content,
      createdAt: m.createdAt,
    })),
  });
}

/**
 * POST /api/embassy/rooms/[slug]/messages — Send a message to a room.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
  }

  const db = await getDb();

  const room = await db.collection('embassy_rooms').findOne({ slug });
  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  const user = await db.collection('users').findOne(
    { _id: toUserId(session.user.id) as any },
    { projection: { name: 1, image: 1, membership: 1 } },
  );
  const displayName = user?.membership?.profile?.displayName || user?.name || 'A visitor';

  const now = new Date();

  const result = await db.collection('embassy_room_messages').insertOne({
    roomSlug: slug,
    authorId: session.user.id,
    authorName: displayName,
    authorImage: user?.image || null,
    content: parsed.data.content,
    createdAt: now,
  });

  await db.collection('embassy_rooms').updateOne(
    { slug },
    { $set: { lastMessageAt: now }, $inc: { messageCount: 1 } },
  );

  return NextResponse.json({
    message: {
      id: result.insertedId.toString(),
      authorId: session.user.id,
      authorName: displayName,
      authorImage: user?.image || null,
      content: parsed.data.content,
      createdAt: now,
    },
  }, { status: 201 });
}
