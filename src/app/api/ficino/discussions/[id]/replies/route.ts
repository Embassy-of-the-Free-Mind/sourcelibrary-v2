import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

/**
 * POST /api/ficino/discussions/[id]/replies — reply to a discussion thread
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const db = await getDb();
  const user = await db.collection('users').findOne(
    { _id: session.user.id as any },
    { projection: { membership: 1, name: 1 } }
  );

  if (!user?.membership?.active) {
    return NextResponse.json({ error: 'Membership required' }, { status: 403 });
  }

  const { id } = await params;

  let threadId: ObjectId;
  try {
    threadId = new ObjectId(id);
  } catch {
    return NextResponse.json({ error: 'Invalid thread ID' }, { status: 400 });
  }

  const thread = await db.collection('discussions').findOne({ _id: threadId });
  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  const body = await request.json();
  const content = (body.body || '').trim().slice(0, 10000);

  if (!content) {
    return NextResponse.json({ error: 'Reply body is required' }, { status: 400 });
  }

  const displayName = user.membership?.profile?.displayName || user.name || 'A member';
  const now = new Date();

  await db.collection('discussion_replies').insertOne({
    discussionId: threadId,
    body: content,
    authorId: session.user.id,
    authorName: displayName,
    createdAt: now,
  });

  // Update thread's last activity and reply count
  await db.collection('discussions').updateOne(
    { _id: threadId },
    {
      $set: { lastActivityAt: now },
      $inc: { replyCount: 1 },
    }
  );

  return NextResponse.json({ ok: true }, { status: 201 });
}
