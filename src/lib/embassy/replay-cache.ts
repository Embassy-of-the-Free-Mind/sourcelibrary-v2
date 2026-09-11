/**
 * Replay cache for identical first-turn questions.
 *
 * PRIOR ART: src/lib/embassy/greeting.ts — short-circuits a bare "hello"; this
 * is the same idea one step up: a question the Librarian answered yesterday,
 * word for word, does not need a second Gemini turn today. Nothing else in
 * src/lib/embassy memoises across threads.
 *
 * Why: the starter prompts ("Tell me about the Emerald Tablet") and the daily
 * e2e probe produce the same first turn again and again — 39 identical
 * "What is the Emerald Tablet?" threads in 45 days, each ~13K tokens and a
 * new row in the public Recent feed (#4704). A reader asking a canonical
 * question gets the same well-cited answer either way; the difference is
 * cost, latency (instant vs 20–60s), and feed noise.
 *
 * Scope is deliberately narrow: a NEW thread (no history), the default
 * library (no collection context), and an earlier answer that was full,
 * cited, carried no sourcing disclaimer, and is under a week old. Anything
 * else runs the agent. The replayed thread is kept (the visitor can continue
 * it — the agent takes over from turn two) but unlisted, so the feed shows
 * one copy of a canonical question, not one per asker.
 */
import type { Db, ObjectId } from 'mongodb';
import type { SourceCard } from '@/lib/embassy/librarian';

export const REPLAY_WINDOW_MS = 7 * 24 * 3600 * 1000;
const MIN_ANSWER_CHARS = 600;

/** Case/space/punctuation-insensitive key for "the same question". */
export function firstMessageKey(message: string): string {
  return message
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s ]+/g, ' ')
    .trim()
    .replace(/[\s?!.。？！]+$/u, '');
}

export interface ReplayableAnswer {
  messageId: ObjectId;
  threadId: ObjectId;
  content: string;
  sources: SourceCard[];
}

interface StoredSource {
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  pageNumber?: number;
  bookSlug?: string;
  snippet?: string;
  inCollection?: boolean;
}

/**
 * The most recent earlier answer to the same first-turn question, or null.
 * Older threads predate `firstMessageKey`, so the raw title is matched too.
 */
export async function findReplayableAnswer(
  db: Db,
  message: string,
  lang: string,
  now: Date = new Date(),
): Promise<ReplayableAnswer | null> {
  const key = firstMessageKey(message);
  if (key.length < 8) return null;
  // Threads that predate `firstMessageKey` are matched on the title, which is
  // the raw first message: case-insensitive, trailing punctuation optional.
  // The key comparison after the fetch is what decides; this only narrows.
  const titleProbe = message.slice(0, 120).trim().replace(/[\s?!.。？！]+$/u, '');
  const titlePattern = `^\\s*${titleProbe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s?!.。？！]*$`;

  const threads = await db.collection('embassy_threads')
    .find(
      {
        type: 'chat',
        lang,
        createdAt: { $gte: new Date(now.getTime() - REPLAY_WINDOW_MS) },
        messageCount: { $gte: 2 },
        // A private thread belongs to its reader; only replay what was public.
        visibility: { $in: ['public', 'unlisted'] },
        $or: [{ firstMessageKey: key }, { title: { $regex: titlePattern, $options: 'i' } }],
      },
      { projection: { _id: 1 }, sort: { createdAt: -1 }, limit: 5 },
    )
    .toArray();

  for (const t of threads) {
    const [human, ai] = await Promise.all([
      db.collection('embassy_messages').findOne(
        { threadId: t._id, authorType: 'human' },
        { projection: { content: 1 }, sort: { createdAt: 1 } },
      ),
      db.collection('embassy_messages').findOne(
        { threadId: t._id, authorType: 'ai' },
        { projection: { content: 1, sources: 1, cachedFrom: 1 }, sort: { createdAt: 1 } },
      ),
    ]);
    // The title is a prefix; confirm the whole first message matches.
    if (!human || firstMessageKey(String(human.content ?? '')) !== key) continue;
    if (!ai || ai.cachedFrom) continue; // never chain a replay off a replay
    const content = String(ai.content ?? '');
    const sources = (ai.sources ?? []) as StoredSource[];
    if (content.length < MIN_ANSWER_CHARS || sources.length === 0) continue;
    if (/note on sourcing|nota sobre las fuentes/i.test(content)) continue;
    return {
      messageId: ai._id,
      threadId: t._id,
      content,
      sources: sources.map(s => ({
        book_id: s.bookId,
        bookTitle: s.bookTitle,
        bookAuthor: s.bookAuthor,
        pageNumber: s.pageNumber,
        bookSlug: s.bookSlug,
        snippet: s.snippet,
        inCollection: s.inCollection ?? false,
      })),
    };
  }
  return null;
}
