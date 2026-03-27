import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

/**
 * GET /api/embassy/threads/[id] — Get a single thread with all messages.
 * Public threads visible to everyone; private threads require auth.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Invalid thread ID' }, { status: 400 });
  }

  const db = await getDb();

  const thread = await db.collection('embassy_threads').findOne({
    _id: new ObjectId(id),
  });

  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  // For now, only public threads are accessible without auth
  if (thread.visibility !== 'public') {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
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
