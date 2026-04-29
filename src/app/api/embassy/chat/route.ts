import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { streamAgenticResponse, type LibrarianStep, type SourceCard } from '@/lib/embassy/librarian';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(10000), // Allow empty for assistant messages (e.g., choices-only responses)
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
 * Creates or continues a thread. Returns the AI response as structured SSE events.
 *
 * SSE event types:
 *   threadId   — thread identifier (sent first)
 *   thinking   — Librarian's reasoning before searching
 *   tool_call  — search step starting (name + query)
 *   tool_result — search step completed (name + summary + found count)
 *   choices    — branching options for the user to select
 *   chunk      — response text chunk
 *   sources    — source cards array
 *   done       — stream complete
 *   error      — something went wrong
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

    await db.collection('embassy_messages').insertOne({
      threadId: result.insertedId,
      authorType: 'human',
      authorId: session.user.id,
      authorName: displayName,
      content: message,
      createdAt: now,
    });
  }

  // Collect full text + sources for DB write
  let fullText = '';
  let allSources: SourceCard[] = [];

  const saveAiResponse = async () => {
    if (!fullText && allSources.length === 0) return;
    const aiMessageTime = new Date();

    try {
      await db.collection('embassy_messages').insertOne({
        threadId: new ObjectId(activeThreadId),
        authorType: 'ai',
        authorName: 'The Librarian',
        content: fullText,
        sources: allSources.map(s => ({
          bookId: s.book_id,
          bookTitle: s.bookTitle,
          bookAuthor: s.bookAuthor,
          pageNumber: s.pageNumber,
          bookSlug: s.bookSlug,
          snippet: s.snippet,
          inCollection: s.inCollection,
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
  };

  if (!stream) {
    try {
      for await (const step of streamAgenticResponse(message, history, activeThreadId)) {
        if (step.type === 'text') {
          fullText += step.text || '';
        } else if (step.type === 'sources') {
          allSources = step.sources || [];
        }
      }
    } catch (err) {
      console.error('[Embassy] Agentic response error:', err);
      return NextResponse.json(
        { error: 'The Librarian was interrupted. Please try again.' },
        { status: 500 },
      );
    }

    await saveAiResponse();

    return NextResponse.json({
      threadId: activeThreadId,
      message: {
        role: 'assistant',
        content: fullText,
        sources: allSources,
      },
    });
  }

  // Stream mode — send step-by-step SSE events
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const send = (event: Record<string, unknown>) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

  const pipePromise = (async () => {
    try {
      await send({ type: 'threadId', threadId: activeThreadId });

      for await (const step of streamAgenticResponse(message, history, activeThreadId)) {
        switch (step.type) {
          case 'thinking':
            await send({ type: 'thinking', text: step.text });
            break;

          case 'tool_call':
            await send({ type: 'tool_call', name: step.name, query: step.query });
            break;

          case 'tool_result':
            await send({
              type: 'tool_result',
              name: step.name,
              query: step.query,
              summary: step.summary,
              found: step.found,
            });
            break;

          case 'choices':
            await send({ type: 'choices', text: step.text, options: step.options, descriptions: step.descriptions });
            break;

          case 'text':
            fullText += step.text || '';
            await send({ type: 'chunk', text: step.text });
            break;

          case 'sources':
            allSources = step.sources || [];
            await send({ type: 'sources', sources: step.sources });
            break;

          case 'notebook_update':
            await send({ type: 'notebook_update', notebook: step.notebook });
            break;
        }
      }

      await send({ type: 'done' });
      await writer.close();
    } catch (err) {
      const errMsg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
      console.error('[Embassy] Agentic stream error:', errMsg);
      // Log to DB for easier debugging
      try {
        await db.collection('embassy_errors').insertOne({
          threadId: activeThreadId,
          message: message.slice(0, 500),
          error: errMsg.slice(0, 5000),
          createdAt: new Date(),
        });
      } catch { /* best effort */ }
      try {
        await send({ type: 'error', message: 'The Librarian was interrupted. Please try again.', debug: errMsg });
        await writer.close();
      } catch { /* already closed */ }
    }
  })();

  // Defer DB writes; in test/runtime contexts without request scope, fall back gracefully.
  const deferredSave = async () => {
    await pipePromise;
    await saveAiResponse();
  };

  try {
    after(deferredSave);
  } catch {
    void deferredSave();
  }

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
