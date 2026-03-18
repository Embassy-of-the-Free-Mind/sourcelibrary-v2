import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

/**
 * GET /api/ficino/discussions/[id] — get a thread and its replies
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const db = await getDb();
  const user = await db.collection('users').findOne(
    { _id: session.user.id as any },
    { projection: { membership: 1 } }
  );

  if (!user?.membership?.joined && !user?.membership?.active) {
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

  const replies = await db.collection('discussion_replies')
    .find({ discussionId: threadId })
    .sort({ createdAt: 1 })
    .limit(200)
    .toArray();

  return NextResponse.json({
    thread: {
      id: thread._id.toString(),
      title: thread.title,
      body: thread.body,
      authorId: thread.authorId,
      authorName: thread.authorName,
      createdAt: thread.createdAt,
      replyCount: thread.replyCount || 0,
      pinned: thread.pinned || false,
    },
    replies: replies.map(r => ({
      id: r._id.toString(),
      body: r.body,
      authorId: r.authorId,
      authorName: r.authorName,
      createdAt: r.createdAt,
    })),
    currentUserId: session.user.id,
  });
}
