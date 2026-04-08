import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { generateLibrarianResponse, streamLibrarianResponse } from '@/lib/embassy/librarian';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(10000),
});

const chatRequestSchema = z.object({
  threadId: z.string().nullable().optional(),
  message: z.string().min(1, 'Message cannot be empty').max(5000, 'Message too long'),
  history: z.array(messageSchema).max(50).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  stream: z.boolean().optional(),
});

/**
 * POST /api/embassy/chat — Send a message to the Librarian.
 * Creates or continues a thread. Returns the AI response.
 * Supports streaming via SSE when stream=true.
 * Auth required.
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

  const { threadId, message, history = [], visibility = 'public', stream = false } = parsed.data;
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

  // Streaming response via TransformStream (flush-friendly on Vercel)
  if (stream) {
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Start piping immediately — search + stream happen in background
    const pipePromise = (async () => {
      try {
        // Send threadId immediately so client knows the connection is live
        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'threadId', threadId: activeThreadId })}\n\n`));
        // Send a status event so the UI can show "Searching..."
        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'status', text: 'Searching the collection...' })}\n\n`));

        // Now do the slow search + Gemini init
        const { stream: textStream, sources, getFullText } = await streamLibrarianResponse(message, history);

        for await (const chunk of textStream) {
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`));
        }

        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
        await writer.close();

        // Return data needed for after() DB writes
        return { getFullText, sources };
      } catch (err) {
        console.error('[Embassy] Stream error:', err);
        try {
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'The Librarian was interrupted. Please try again.' })}\n\n`));
          await writer.close();
        } catch { /* already closed */ }
        return null;
      }
    })();

      // Defer DB writes to after the response is sent
      after(async () => {
        const result = await pipePromise;
        if (!result) return; // Stream errored
        const fullText = result.getFullText();
        const sources = result.sources;
        const aiMessageTime = new Date();

        try {
          await db.collection('embassy_messages').insertOne({
            threadId: new ObjectId(activeThreadId),
            authorType: 'ai',
            authorName: 'The Librarian',
            content: fullText,
            sources: sources.map(s => ({
              bookId: s.book_id,
              bookTitle: s.bookTitle,
              bookAuthor: s.bookAuthor,
              pageNumber: s.page_number,
              bookSlug: s.bookSlug,
            })),
            createdAt: aiMessageTime,
          });

          await db.collection('embassy_threads').updateOne(
            { _id: new ObjectId(activeThreadId) },
            { $set: { lastMessageAt: aiMessageTime }, $inc: { messageCount: 2 } },
          );
        } catch (err) {
          console.error('[Embassy] Failed to save AI response:', err);
        }
      });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // Non-streaming response (fallback)
  try {
    const { content: aiResponse, sources } = await generateLibrarianResponse(message, history);
    const aiMessageTime = new Date();

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

    await db.collection('embassy_threads').updateOne(
      { _id: new ObjectId(activeThreadId) },
      { $set: { lastMessageAt: aiMessageTime }, $inc: { messageCount: 2 } },
    );

    return NextResponse.json({
      threadId: activeThreadId,
      message: { role: 'assistant', content: aiResponse },
    });
  } catch (error) {
    console.error('[Embassy] Librarian error:', error);
    return NextResponse.json(
      { error: 'The Librarian is momentarily away. Please try again.' },
      { status: 500 },
    );
  }
}
