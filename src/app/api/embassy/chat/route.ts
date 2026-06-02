import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { streamAgenticResponse, type LibrarianStep, type SourceCard } from '@/lib/embassy/librarian';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
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
  // The Librarian is open to everyone — no login required. Signed-in users get
  // their threads tied to their account; anonymous visitors get ephemeral
  // public threads. We rate-limit anonymous traffic per-IP because this is an
  // expensive agentic endpoint (multiple tool calls, up to maxDuration each).
  const session = await auth();
  const userId = session?.user?.id ?? null;

  if (!userId) {
    const rl = checkRateLimit(
      { name: 'librarian-chat', limit: 20, windowSeconds: 3600 },
      getClientIp(request),
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'You\'ve reached the hourly limit for anonymous use. Sign in (free) to keep going, or try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      );
    }
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

  // Get user display name (anonymous visitors skip the lookup)
  const user = userId
    ? await db.collection('users').findOne(
        { _id: userId as any },
        { projection: { name: 1, membership: 1 } },
      )
    : null;
  const displayName = user?.membership?.profile?.displayName || user?.name || 'A visitor';

  const now = new Date();
  let activeThreadId: string;

  if (threadId) {
    // Continue existing thread — verify ownership. Signed-in users may only
    // continue their own threads; anonymous visitors may only continue
    // anonymous (creatorId: null) threads, so they can't append to a
    // logged-in user's conversation.
    const thread = await db.collection('embassy_threads').findOne({
      _id: new ObjectId(threadId),
      creatorId: userId,
    });
    if (!thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }
    activeThreadId = threadId;

    await db.collection('embassy_messages').insertOne({
      threadId: new ObjectId(threadId),
      authorType: 'human',
      authorId: userId,
      authorName: displayName,
      content: message,
      createdAt: now,
    });
  } else {
    // Create new thread. Anonymous threads are 'unlisted' (null creatorId,
    // so they can't be claimed via the "mine" filter and aren't surfaced in
    // the public Recent feed) — the conversation still continues in-session
    // via threadId. Signed-in users keep their public/private choice.
    const result = await db.collection('embassy_threads').insertOne({
      type: 'chat',
      title: message.slice(0, 120),
      creatorId: userId,
      creatorName: displayName,
      visibility: userId ? visibility : 'unlisted',
      aiEnabled: true,
      messageCount: 0,
      createdAt: now,
      lastMessageAt: now,
    });
    activeThreadId = result.insertedId.toString();

    await db.collection('embassy_messages').insertOne({
      threadId: result.insertedId,
      authorType: 'human',
      authorId: userId,
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

  const startedAt = Date.now();
  // Track the last step so the watchdog can record where we stalled if
  // Vercel kills the function before the catch block runs.
  let lastStepType: string = 'init';
  let toolCallCount = 0;

  // Watchdog: fires ~10s before maxDuration to leave a breadcrumb in
  // embassy_errors when a request is about to be killed. Without this,
  // a timeout produces zero server-side trace because the function dies
  // before the catch block.
  const watchdog = setTimeout(async () => {
    try {
      await db.collection('embassy_errors').insertOne({
        kind: 'timeout_warning',
        threadId: activeThreadId,
        message: message.slice(0, 500),
        error: `Approaching maxDuration (${maxDuration}s). Last step: ${lastStepType}. Tool calls so far: ${toolCallCount}. Elapsed: ${Math.round((Date.now() - startedAt) / 1000)}s.`,
        createdAt: new Date(),
      });
    } catch { /* best effort */ }
  }, (maxDuration - 10) * 1000);

  const pipePromise = (async () => {
    try {
      await send({ type: 'threadId', threadId: activeThreadId });

      for await (const step of streamAgenticResponse(message, history, activeThreadId)) {
        lastStepType = step.type;
        switch (step.type) {
          case 'thinking':
            await send({ type: 'thinking', text: step.text });
            break;

          case 'tool_call':
            toolCallCount++;
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

      clearTimeout(watchdog);
      await send({ type: 'done' });
      await writer.close();
    } catch (err) {
      clearTimeout(watchdog);
      const errMsg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
      console.error('[Embassy] Agentic stream error:', errMsg);
      // Log to DB for easier debugging
      try {
        await db.collection('embassy_errors').insertOne({
          kind: 'agent_error',
          threadId: activeThreadId,
          message: message.slice(0, 500),
          error: errMsg.slice(0, 5000),
          lastStepType,
          toolCallCount,
          elapsedMs: Date.now() - startedAt,
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
