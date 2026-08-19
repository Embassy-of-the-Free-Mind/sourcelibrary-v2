import { NextRequest, NextResponse } from 'next/server';
import { getReadDb, getDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';
import { ObjectId } from 'mongodb';
import {
  attribution,
  messageAttribution,
  threadVisibility,
} from '@/lib/embassy/thread-visibility';

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
  const session = await auth();
  const isOwner = Boolean(
    session?.user?.id && thread.creatorId && thread.creatorId === session.user.id,
  );

  if (thread.visibility === 'private' && !isOwner) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  const messages = await db.collection('embassy_messages')
    .find({ threadId: new ObjectId(id) })
    .sort({ createdAt: 1 })
    .toArray();

  // A conversation is readable without its author being identifiable. Names
  // are stripped here, before they reach the response body, for everyone but
  // the reader who wrote it — including creatorId, which is a stable handle
  // that links a stranger's threads to each other.
  return NextResponse.json({
    thread: {
      id: thread._id.toString(),
      type: thread.type,
      title: thread.title,
      creatorName: attribution(thread.creatorName, isOwner),
      creatorId: isOwner ? thread.creatorId : null,
      isOwner,
      visibility: thread.visibility,
      messageCount: thread.messageCount,
      createdAt: thread.createdAt,
      lastMessageAt: thread.lastMessageAt,
    },
    messages: messages.map(m => ({
      id: m._id.toString(),
      authorType: m.authorType,
      authorName: messageAttribution(
        { authorType: m.authorType, authorName: m.authorName },
        isOwner,
      ),
      content: m.content,
      sources: m.sources || [],
      createdAt: m.createdAt,
    })),
  });
}

/**
 * PATCH /api/embassy/threads/[id] — Change whether a thread is listed.
 * Body: { listed: boolean }
 *
 * The asymmetry here is deliberate. Un-listing is allowed to anyone holding
 * the thread id; listing requires being the signed-in creator. Holding the id
 * already grants read access to a non-private thread, so letting the holder
 * hide it is not an escalation — and it is the only way an anonymous visitor
 * can retract a conversation they just realised was personal. Publishing, the
 * direction that can expose someone, stays locked to the account that owns it.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Invalid thread ID' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  if (typeof body?.listed !== 'boolean') {
    return NextResponse.json({ error: 'listed must be a boolean' }, { status: 400 });
  }

  const db = await getDb();
  const thread = await db.collection('embassy_threads').findOne({ _id: new ObjectId(id) });
  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  const session = await auth();
  const isOwner = Boolean(
    session?.user?.id && thread.creatorId && thread.creatorId === session.user.id,
  );

  // A private thread is invisible to non-owners everywhere else; don't let an
  // id-holder learn it exists, or flip it, through this route either.
  if (thread.visibility === 'private' && !isOwner) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }
  if (body.listed && !isOwner) {
    return NextResponse.json({ error: 'Sign in as the author to list this' }, { status: 403 });
  }

  const visibility = threadVisibility(thread.creatorId ?? null, body.listed);
  await db.collection('embassy_threads').updateOne(
    { _id: new ObjectId(id) },
    { $set: { visibility } },
  );

  return NextResponse.json({ ok: true, visibility });
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
