import { NextRequest, NextResponse } from 'next/server';
import type { ObjectId } from 'mongodb';
import { getReadDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';
import { attribution, LISTED_VISIBILITY } from '@/lib/embassy/thread-visibility';

type PreviewMessage = { authorType?: string; content?: string };

type ThreadDoc = {
  _id: ObjectId;
  title?: string;
  creatorName?: string | null;
  messageCount?: number;
  createdAt?: Date;
  lastMessageAt?: Date;
  firstMessages?: PreviewMessage[];
};

/**
 * GET /api/embassy/threads — List Embassy threads.
 * ?mine=true — list the current user's threads (auth required)
 * Default — list public threads (no auth required)
 *
 * The previews come from a single `$lookup` rather than one query per thread.
 * The N+1 shape cost 20 round-trips per request and, with no index on
 * `embassy_messages.threadId`, every one of them was a collection scan plus an
 * in-memory sort (~500ms measured) — slow enough that the sidebar routinely
 * rendered its "No conversations yet" empty state before the data arrived, and
 * a reader with 112 conversations reported having none (#4070).
 *
 * A failure here MUST be a non-2xx response, never `{ threads: [] }`. An empty
 * list is indistinguishable from "you have no history" on the client, and that
 * is the same lie by a different route.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const mine = url.searchParams.get('mine') === 'true';

  let filter: Record<string, unknown>;
  if (mine) {
    const session = await auth();
    if (!session?.user?.id) {
      // Genuinely nothing to list: there is no reader to list it for. The
      // client only asks for `mine=true` when it believes it is signed in, so
      // say why rather than returning a bare empty list.
      return NextResponse.json({ threads: [], signedIn: false }, { status: 401 });
    }
    filter = { creatorId: session.user.id, messageCount: { $gte: 2 } };
  } else {
    filter = { visibility: LISTED_VISIBILITY, messageCount: { $gte: 2 } };
  }

  let threads: ThreadDoc[];
  try {
    const db = await getReadDb();
    threads = await db.collection('embassy_threads')
      .aggregate<ThreadDoc>([
        { $match: filter },
        { $sort: { lastMessageAt: -1 } },
        { $skip: offset },
        { $limit: limit },
        {
          $lookup: {
            from: 'embassy_messages',
            let: { tid: '$_id' },
            pipeline: [
              { $match: { $expr: { $eq: ['$threadId', '$$tid'] } } },
              { $sort: { createdAt: 1 } },
              { $limit: 2 },
              { $project: { _id: 0, authorType: 1, content: 1 } },
            ],
            as: 'firstMessages',
          },
        },
        {
          $project: {
            title: 1,
            creatorName: 1,
            messageCount: 1,
            createdAt: 1,
            lastMessageAt: 1,
            firstMessages: 1,
          },
        },
      ], { maxTimeMS: 15000 })
      .toArray();
  } catch (error) {
    console.error('[embassy/threads] list failed', { mine, error });
    return NextResponse.json({ error: 'Could not load conversations' }, { status: 503 });
  }

  const threadPreviews = threads.map((thread) => {
    const messages = thread.firstMessages ?? [];
    const userMsg = messages.find(m => m.authorType === 'human');
    const aiMsg = messages.find(m => m.authorType === 'ai');

    return {
      id: thread._id.toString(),
      title: thread.title,
      // Only the reader's own list carries a name. The public feed is
      // anonymised here rather than in the sidebar that renders it — the
      // 2026-07-30 leak was in this payload, so a component-level fix would
      // still be one `curl` away.
      creatorName: attribution(thread.creatorName, mine),
      messageCount: thread.messageCount,
      createdAt: thread.createdAt,
      lastMessageAt: thread.lastMessageAt,
      preview: {
        question: userMsg?.content?.slice(0, 200) || '',
        answer: aiMsg?.content?.slice(0, 300) || '',
      },
    };
  });

  return NextResponse.json(
    { threads: threadPreviews, signedIn: mine || undefined },
    // A reader's own list is per-account and must never be shared by a cache.
    { headers: { 'Cache-Control': mine ? 'private, no-store' : 'private, max-age=0' } },
  );
}
