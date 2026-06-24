import { NextRequest, NextResponse } from 'next/server';
import { getReadDb, getDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';
import { ObjectId } from 'mongodb';

/**
 * GET /api/embassy/threads/[id] — Get a single thread with all messages.
 * Public threads visible to everyone; private threads require creator auth.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Invalid thread ID' }, { status: 400 });
  }

  const db = await getReadDb();

  const thread = await db.collection('embassy_threads').findOne({
    _id: new ObjectId(id),
  });

  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  // Private threads require auth from the creator. 'unlisted' threads
  // (anonymous conversations — never surfaced in the Recent feed) stay
  // readable by anyone holding the id: the chat client restores them via
  // /librarian?thread=<id> when an anonymous visitor navigates back.
  if (thread.visibility === 'private') {
    const session = await auth();
    if (!session?.user?.id || thread.creatorId !== session.user.id) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }
  }

  const messages = await db.collection('embassy_messages')
    .find({ threadId: new ObjectId(id) })
    .sort({ createdAt: 1 })
    .toArray();

  return NextResponse.json({
    thread: {
      id: thread._id.toString(),
      type: thread.type,
      title: thread.title,
      creatorName: thread.creatorName,
      creatorId: thread.creatorId,
      visibility: thread.visibility,
      messageCount: thread.messageCount,
      createdAt: thread.createdAt,
      lastMessageAt: thread.lastMessageAt,
    },
    messages: messages.map(m => ({
      id: m._id.toString(),
      authorType: m.authorType,
      authorName: m.authorName,
      content: m.content,
      sources: m.sources || [],
      createdAt: m.createdAt,
    })),
  });
}

/**
 * DELETE /api/embassy/threads/[id] — Delete a thread and all its messages.
 * Only the thread creator can delete.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Invalid thread ID' }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const db = await getDb();
  const thread = await db.collection('embassy_threads').findOne({
    _id: new ObjectId(id),
  });

  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  if (thread.creatorId !== session.user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const oid = new ObjectId(id);
  await Promise.all([
    db.collection('embassy_threads').deleteOne({ _id: oid }),
    db.collection('embassy_messages').deleteMany({ threadId: oid }),
    db.collection('research_notebooks').deleteMany({ threadId: oid }),
  ]);

  return NextResponse.json({ deleted: true });
}
