import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';
import { attribution, LISTED_VISIBILITY } from '@/lib/embassy/thread-visibility';

/**
 * GET /api/embassy/threads — List Embassy threads.
 * ?mine=true — list the current user's threads (auth required)
 * Default — list public threads (no auth required)
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const mine = url.searchParams.get('mine') === 'true';

  const db = await getReadDb();

  let filter: Record<string, unknown>;
  if (mine) {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ threads: [] });
    }
    filter = { creatorId: session.user.id, messageCount: { $gte: 2 } };
  } else {
    filter = { visibility: LISTED_VISIBILITY, messageCount: { $gte: 2 } };
  }

  const threads = await db.collection('embassy_threads')
    .find(filter)
    .sort({ lastMessageAt: -1 })
    .skip(offset)
    .limit(limit)
    .toArray();

  // Get the first user message and first AI response for each thread (preview)
  const threadPreviews = await Promise.all(
    threads.map(async (thread) => {
      const messages = await db.collection('embassy_messages')
        .find({ threadId: thread._id })
        .sort({ createdAt: 1 })
        .limit(2)
        .project({ authorType: 1, authorName: 1, content: 1, createdAt: 1 })
        .toArray();

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
    }),
  );

  return NextResponse.json({ threads: threadPreviews });
}
