import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { generateLibrarianResponse } from '@/lib/embassy/librarian';
import { z } from 'zod';

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(10000),
});

const chatRequestSchema = z.object({
  threadId: z.string().nullable().optional(),
  message: z.string().min(1, 'Message cannot be empty').max(5000, 'Message too long'),
  history: z.array(messageSchema).max(50).optional(),
  visibility: z.enum(['public', 'private']).optional(),
});

/**
 * POST /api/embassy/chat — Send a message to the Librarian.
 * Creates or continues a thread. Returns the AI response.
 * Auth required (free Ficino Society membership).
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { threadId, message, history = [], visibility = 'public' } = parsed.data;
  const db = await getDb();

  // Get user display name
  const user = await db.collection('users').findOne(
    { _id: session.user.id as any },
    { projection: { name: 1, membership: 1 } },
  );
  const displayName = user?.membership?.profile?.displayName || user?.name || 'A visitor';

  const now = new Date();
  let activeThreadId: string;

  if (threadId) {
    // Continue existing thread — verify ownership
    const thread = await db.collection('embassy_threads').findOne({
      _id: new ObjectId(threadId),
      creatorId: session.user.id,
    });
    if (!thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }
    activeThreadId = threadId;

    // Save user message
    await db.collection('embassy_messages').insertOne({
      threadId: new ObjectId(threadId),
      authorType: 'human',
      authorId: session.user.id,
      authorName: displayName,
      content: message,
      createdAt: now,
    });
  } else {
    // Create new thread
    const result = await db.collection('embassy_threads').insertOne({
      type: 'chat',
      title: message.slice(0, 120),
      creatorId: session.user.id,
      creatorName: displayName,
      visibility,
      aiEnabled: true,
      messageCount: 0,
      createdAt: now,
      lastMessageAt: now,
    });
    activeThreadId = result.insertedId.toString();

    // Save user message
    await db.collection('embassy_messages').insertOne({
      threadId: result.insertedId,
      authorType: 'human',
      authorId: session.user.id,
      authorName: displayName,
      content: message,
      createdAt: now,
    });
  }

  try {
    // Generate Librarian response
    const { content: aiResponse, sources } = await generateLibrarianResponse(message, history);

    const aiMessageTime = new Date();

    // Save AI response
    await db.collection('embassy_messages').insertOne({
      threadId: new ObjectId(activeThreadId),
      authorType: 'ai',
      authorName: 'The Librarian',
      content: aiResponse,
      sources: sources.map(s => ({
        bookId: s.book_id,
        bookTitle: s.bookTitle,
        bookAuthor: s.bookAuthor,
        pageNumber: s.page_number,
        bookSlug: s.bookSlug,
      })),
      createdAt: aiMessageTime,
    });

    // Update thread
    await db.collection('embassy_threads').updateOne(
      { _id: new ObjectId(activeThreadId) },
      {
        $set: { lastMessageAt: aiMessageTime },
        $inc: { messageCount: 2 }, // user + AI
      },
    );

    return NextResponse.json({
      threadId: activeThreadId,
      message: {
        role: 'assistant',
        content: aiResponse,
      },
    });
  } catch (error) {
    console.error('[Embassy] Librarian error:', error);
    return NextResponse.json(
      { error: 'The Librarian is momentarily away. Please try again.' },
      { status: 500 },
    );
  }
}
