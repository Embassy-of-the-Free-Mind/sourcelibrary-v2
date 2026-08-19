import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { streamAgenticResponse, type LibrarianStep, type SourceCard } from '@/lib/embassy/librarian';
import { applyCitationFixes, applyImageRemovals, type CitationFix } from '@/lib/embassy/citation-fixes';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { chatRequestSchema } from '@/lib/embassy/chat-request';
import { threadVisibility } from '@/lib/embassy/thread-visibility';
import { toUserId } from '@/lib/user-id';

export const dynamic = 'force-dynamic';
// 120s was killing real research turns mid-stream: the agentic loop routinely
// runs 4–9 tool calls and embassy_errors logged daily timeout_warning rows at
// 110s elapsed. The killed function severs the SSE stream and the client shows
// "The Librarian seems to be away." 300 matches our other long-running routes.
export const maxDuration = 300;


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
 *   citation_fixes — broken book links repaired post-verification; clients
 *                    apply these rewrites to the streamed text
 *   image_removals — fabricated image embeds; clients strip them from the
 *                    streamed text
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
      { name: 'librarian-chat', limit: 5, windowSeconds: 3600 },
      getClientIp(request),
    );
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: 'You\'ve used your 5 free questions this hour. Sign in (free) to keep talking with the Librarian.',
          code: 'SIGNIN_REQUIRED',
        },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      );
    }
  }

  const body = await request.json();
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    // The client renders `error` verbatim as the Librarian's reply, so it must
    // read like a sentence, not a status code. Surface the first real issue.
    const firstIssue = parsed.error.issues[0]?.message;
    const friendly = firstIssue && firstIssue !== 'Required'
      ? firstIssue
      : 'I couldn\'t read that request — please refresh the page and try again.';
    try {
      const db = await getDb();
      await db.collection('embassy_errors').insertOne({
        kind: 'invalid_request',
        fieldErrors,
        messagePreview: typeof body?.message === 'string' ? body.message.slice(0, 500) : null,
        messageLength: typeof body?.message === 'string' ? body.message.length : null,
        historyLength: Array.isArray(body?.history) ? body.history.length : null,
        createdAt: new Date(),
      });
    } catch { /* best effort */ }
    return NextResponse.json(
      { error: friendly, details: fieldErrors },
      { status: 400 },
    );
  }

  const { threadId, message, history = [], visibility, stream = false, collection = null } = parsed.data;
  const db = await getDb();

  // Get user display name (anonymous visitors skip the lookup)
  const user = userId
    ? await db.collection('users').findOne(
        { _id: toUserId(userId) as any },
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

    // Apply the listing toggle to a conversation already under way. It used to
    // be read only in the create branch below, so a reader who turned listing
    // off after saying something personal was silently ignored — the one
    // moment the control most needs to work.
    const desired = threadVisibility(userId, visibility === 'public');
    if (thread.visibility !== desired) {
      await db.collection('embassy_threads').updateOne(
        { _id: new ObjectId(threadId) },
        { $set: { visibility: desired } },
      );
    }

    await db.collection('embassy_messages').insertOne({
      threadId: new ObjectId(threadId),
      authorType: 'human',
      authorId: userId,
      authorName: displayName,
      content: message,
      createdAt: now,
    });
  } else {
    // Listed by default for everyone, signed in or not — no name travels with
    // it (see lib/embassy/thread-visibility). Opting out lands on 'private'
    // for a signed-in reader and 'unlisted' for an anonymous one, which keeps
    // the conversation reachable by id so they can get back to it.
    const result = await db.collection('embassy_threads').insertOne({
      type: 'chat',
      title: message.slice(0, 120),
      creatorId: userId,
      creatorName: displayName,
      visibility: threadVisibility(userId, visibility === 'public'),
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

  // Collect full text + sources + token usage for DB write
  let fullText = '';
  let allSources: SourceCard[] = [];
  let turnUsage: LibrarianStep['usage'] | null = null;
  // Link repairs from the post-response citation check. Applied to the
  // persisted message (and the non-stream JSON reply); streaming clients get
  // the same fixes as a `citation_fixes` event and apply them on-screen.
  let citationFixes: CitationFix[] = [];
  // Fabricated image embeds to strip, same round trip as citationFixes.
  let imageRemovals: string[] = [];

  /** The text as the reader should see it: links repaired, dead images dropped. */
  const finalizeText = (text: string) =>
    applyImageRemovals(applyCitationFixes(text, citationFixes), imageRemovals);

  const saveAiResponse = async () => {
    if (!fullText && allSources.length === 0) return;
    const aiMessageTime = new Date();

    try {
      await db.collection('embassy_messages').insertOne({
        threadId: new ObjectId(activeThreadId),
        authorType: 'ai',
        authorName: 'The Librarian',
        content: finalizeText(fullText),
        sources: allSources.map(s => ({
          bookId: s.book_id,
          bookTitle: s.bookTitle,
          bookAuthor: s.bookAuthor,
          pageNumber: s.pageNumber,
          bookSlug: s.bookSlug,
          snippet: s.snippet,
          inCollection: s.inCollection,
        })),
        usage: turnUsage,
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
      for await (const step of streamAgenticResponse(message, history, activeThreadId, { collection })) {
        if (step.type === 'text') {
          fullText += step.text || '';
        } else if (step.type === 'sources') {
          allSources = step.sources || [];
        } else if (step.type === 'citation_fixes') {
          citationFixes = step.fixes || [];
        } else if (step.type === 'image_removals') {
          imageRemovals = step.removeUrls || [];
        } else if (step.type === 'usage') {
          turnUsage = step.usage ?? null;
        }
      }
    } catch (err) {
      console.error('[Embassy] Agentic response error:', err);
      try {
        await db.collection('embassy_errors').insertOne({
          kind: 'agent_error',
          threadId: activeThreadId,
          message: message.slice(0, 500),
          error: (err instanceof Error ? `${err.message}\n${err.stack}` : String(err)).slice(0, 5000),
          createdAt: new Date(),
        });
      } catch { /* best effort */ }
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
        content: finalizeText(fullText),
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
  // before the catch block. It also tells the reader what happened and
  // closes the stream gracefully — otherwise the platform kill severs the
  // SSE connection mid-read and the client can only guess at the cause.
  let timedOut = false;
  const watchdog = setTimeout(async () => {
    timedOut = true;
    try {
      await db.collection('embassy_errors').insertOne({
        kind: 'timeout_warning',
        threadId: activeThreadId,
        message: message.slice(0, 500),
        error: `Approaching maxDuration (${maxDuration}s). Last step: ${lastStepType}. Tool calls so far: ${toolCallCount}. Elapsed: ${Math.round((Date.now() - startedAt) / 1000)}s.`,
        createdAt: new Date(),
      });
    } catch { /* best effort */ }
    try {
      await send({ type: 'error', message: 'I’m sorry, I got distracted (my search timed out). Try again?' });
      await writer.close();
    } catch { /* stream already gone */ }
  }, (maxDuration - 10) * 1000);

  const pipePromise = (async () => {
    try {
      await send({ type: 'threadId', threadId: activeThreadId });

      for await (const step of streamAgenticResponse(message, history, activeThreadId, { collection })) {
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

          case 'citation_fixes':
            citationFixes = step.fixes || [];
            await send({ type: 'citation_fixes', fixes: step.fixes });
            break;

          case 'image_removals':
            imageRemovals = step.removeUrls || [];
            await send({ type: 'image_removals', removeUrls: step.removeUrls });
            break;

          case 'notebook_update':
            await send({ type: 'notebook_update', notebook: step.notebook });
            break;

          case 'usage':
            // Internal accounting only — persisted with the AI message, not
            // sent to the client.
            turnUsage = step.usage ?? null;
            break;
        }
      }

      clearTimeout(watchdog);
      await send({ type: 'done' });
      await writer.close();
    } catch (err) {
      clearTimeout(watchdog);
      // After a watchdog timeout the writer is already closed, so the loop's
      // next send() throws — that's the timeout surfacing again, not a new
      // agent error. The reader already got the timeout message; don't log
      // a spurious agent_error on top of the timeout_warning breadcrumb.
      if (timedOut) return;
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
        await send({ type: 'error', message: 'I’m sorry — I lost my train of thought mid-search. Try again?', debug: errMsg });
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
