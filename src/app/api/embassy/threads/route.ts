import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/embassy/threads — List public Embassy threads (activity feed).
 * No auth required — public threads are visible to everyone.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const db = await getDb();

  const threads = await db.collection('embassy_threads')
    .find({ visibility: 'public', messageCount: { $gte: 2 } }) // Only show threads with at least one exchange
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
        creatorName: thread.creatorName,
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
