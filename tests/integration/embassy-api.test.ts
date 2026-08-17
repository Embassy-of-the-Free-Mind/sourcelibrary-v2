import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTestDb, cleanDb } from '../setup';
import { ObjectId } from 'mongodb';

/**
 * Integration tests for Embassy API routes.
 * Uses MongoMemoryServer (via setup.ts) for a real MongoDB instance.
 * Auth and Gemini are mocked; MongoDB queries are real.
 */

// Mock auth — default: authenticated user
// Note: vi.mock is hoisted, so we can't reference outer variables in the factory.
// We use a stable user ID string directly.
const TEST_USER_ID = '65a1b2c3d4e5f6a7b8c9d0e1';
vi.mock('@/lib/auth', () => {
  const { ObjectId } = require('mongodb');
  return {
    auth: vi.fn().mockResolvedValue({
      user: { id: '65a1b2c3d4e5f6a7b8c9d0e1', name: 'Test User', email: 'test@example.com' },
    }),
  };
});

// Mock Gemini (no real AI calls in tests)
vi.mock('@/lib/embassy/librarian', () => ({
  streamAgenticResponse: vi.fn().mockImplementation(async function* () {
    yield { type: 'text', text: 'The Librarian responds with knowledge about the collection.' };
    yield { type: 'sources', sources: [{ book_id: 'b1', bookTitle: 'Test Book', bookAuthor: 'Author', pageNumber: 1, bookSlug: 'test-book' }] };
  }),
}));

// Mock getDb to use the test database from MongoMemoryServer
vi.mock('@/lib/mongodb', async () => {
  const { getTestDb } = await import('../setup');
  return {
    getDb: vi.fn().mockImplementation(async () => getTestDb()),
    getReadDb: vi.fn().mockImplementation(async () => getTestDb()),
    connectToDatabase: vi.fn(),
    isConnectionError: vi.fn().mockReturnValue(false),
  };
});

// Import route handlers
import { POST as chatPost } from '@/app/api/embassy/chat/route';
import { GET as threadsGet } from '@/app/api/embassy/threads/route';
import { GET as threadDetailGet } from '@/app/api/embassy/threads/[id]/route';
import { GET as roomsGet, POST as roomsPost } from '@/app/api/embassy/rooms/route';

function makeRequest(url: string, body?: object): Request {
  return new Request(`http://localhost:3000${url}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as any;
}

describe('Embassy API', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  describe('POST /api/embassy/chat', () => {
    it('creates a new thread and returns AI response', async () => {
      const db = getTestDb();
      // Seed the user
      await db.collection('users').insertOne({
        _id: new ObjectId(TEST_USER_ID),
        name: 'Test User',
        email: 'test@example.com',
      });

      const req = makeRequest('/api/embassy/chat', {
        message: 'What did Agrippa write about planetary seals?',
        visibility: 'public',
      });

      const res = await chatPost(req as any);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.threadId).toBeDefined();
      expect(data.message.role).toBe('assistant');
      expect(data.message.content).toBeTruthy();

      // Verify thread was created in DB
      const thread = await db.collection('embassy_threads').findOne({
        _id: new ObjectId(data.threadId),
      });
      expect(thread).toBeTruthy();
      expect(thread!.creatorId).toBe(TEST_USER_ID);
      expect(thread!.visibility).toBe('public');
      expect(thread!.messageCount).toBe(2);

      // Verify messages were saved
      const messages = await db.collection('embassy_messages')
        .find({ threadId: new ObjectId(data.threadId) })
        .sort({ createdAt: 1 })
        .toArray();
      expect(messages).toHaveLength(2);
      expect(messages[0].authorType).toBe('human');
      expect(messages[0].content).toContain('Agrippa');
      expect(messages[1].authorType).toBe('ai');
      expect(messages[1].authorName).toBe('The Librarian');
    });

    it('lists an anonymous visitor\'s thread, with no creator attached', async () => {
      const { auth } = await import('@/lib/auth');
      (auth as any).mockResolvedValueOnce(null);

      const req = makeRequest('/api/embassy/chat', {
        message: 'Hello',
        visibility: 'public',
      });

      const res = await chatPost(req as any);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.threadId).toBeDefined();

      // Anonymous threads used to be forced 'unlisted' regardless of what was
      // asked, because listing meant publishing a name. It no longer does —
      // names are stripped server-side — so a visitor's conversation joins the
      // Recent feed like anyone else's, still carrying a null creatorId.
      const db = getTestDb();
      const thread = await db.collection('embassy_threads').findOne({
        _id: new ObjectId(data.threadId),
      });
      expect(thread!.creatorId).toBeNull();
      expect(thread!.visibility).toBe('public');
    });

    it('honours an anonymous opt-out as unlisted, not private', async () => {
      const { auth } = await import('@/lib/auth');
      (auth as any).mockResolvedValueOnce(null);

      const req = makeRequest('/api/embassy/chat', {
        message: 'Something personal',
        visibility: 'private',
      });

      const res = await chatPost(req as any);
      const data = await res.json();
      expect(res.status).toBe(200);

      // 'private' would lock the visitor out of their own conversation: a null
      // creatorId can never match a session id, so the detail route would 404
      // the person who wrote it.
      const db = getTestDb();
      const thread = await db.collection('embassy_threads').findOne({
        _id: new ObjectId(data.threadId),
      });
      expect(thread!.visibility).toBe('unlisted');
    });

    it('validates message length', async () => {
      const req = makeRequest('/api/embassy/chat', {
        message: '',
      });

      const res = await chatPost(req as any);
      expect(res.status).toBe(400);
    });

    it('clips oversized history instead of rejecting the follow-up', async () => {
      // The Librarian's own answers can exceed 10k chars; the client sends
      // them back verbatim as history. Rejecting made every follow-up in such
      // a thread fail with "Invalid request" — the thread looked dead.
      const db = getTestDb();
      await db.collection('users').insertOne({
        _id: new ObjectId(TEST_USER_ID),
        name: 'Test User',
      });

      const req = makeRequest('/api/embassy/chat', {
        message: 'And where can I read that book?',
        history: [
          { role: 'user', content: 'Tell me about Jung' },
          { role: 'assistant', content: 'x'.repeat(12000) },
        ],
      });

      const res = await chatPost(req as any);
      expect(res.status).toBe(200);
    });

    it('rejects an overlong message with a human-readable error and logs it', async () => {
      const req = makeRequest('/api/embassy/chat', {
        message: 'x'.repeat(5001),
      });

      const res = await chatPost(req as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      // The client renders this string verbatim as the Librarian's reply.
      expect(data.error).toMatch(/too long/i);

      const logged = await getTestDb()
        .collection('embassy_errors')
        .findOne({ kind: 'invalid_request' });
      expect(logged).toBeTruthy();
      expect(logged!.messageLength).toBe(5001);
    });

    it('continues an existing thread', async () => {
      const db = getTestDb();
      await db.collection('users').insertOne({
        _id: new ObjectId(TEST_USER_ID),
        name: 'Test User',
      });

      // Create first message
      const req1 = makeRequest('/api/embassy/chat', {
        message: 'Tell me about Ficino',
      });
      const res1 = await chatPost(req1 as any);
      const data1 = await res1.json();
      const threadId = data1.threadId;

      // Continue the thread
      const req2 = makeRequest('/api/embassy/chat', {
        threadId,
        message: 'What did he translate?',
        history: [
          { role: 'user', content: 'Tell me about Ficino' },
          { role: 'assistant', content: 'Ficino was a scholar...' },
        ],
      });
      const res2 = await chatPost(req2 as any);
      const data2 = await res2.json();

      expect(res2.status).toBe(200);
      expect(data2.threadId).toBe(threadId);

      // Thread should now have 4 messages
      const thread = await db.collection('embassy_threads').findOne({
        _id: new ObjectId(threadId),
      });
      expect(thread!.messageCount).toBe(4);
    });

    it('rejects continuing another user\'s thread', async () => {
      const db = getTestDb();
      const otherThread = await db.collection('embassy_threads').insertOne({
        type: 'chat',
        title: 'Someone else\'s thread',
        creatorId: 'other-user-id',
        creatorName: 'Other User',
        visibility: 'public',
        messageCount: 2,
        createdAt: new Date(),
        lastMessageAt: new Date(),
      });

      const req = makeRequest('/api/embassy/chat', {
        threadId: otherThread.insertedId.toString(),
        message: 'Hijacking this thread',
      });

      const res = await chatPost(req as any);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/embassy/threads', () => {
    it('returns public threads with previews', async () => {
      const db = getTestDb();
      const threadId = new ObjectId();

      await db.collection('embassy_threads').insertOne({
        _id: threadId,
        type: 'chat',
        title: 'Question about alchemy',
        creatorId: 'user-1',
        creatorName: 'Scholar',
        visibility: 'public',
        messageCount: 2,
        createdAt: new Date(),
        lastMessageAt: new Date(),
      });

      await db.collection('embassy_messages').insertMany([
        {
          threadId,
          authorType: 'human',
          authorId: 'user-1',
          authorName: 'Scholar',
          content: 'What is the philosopher\'s stone?',
          createdAt: new Date(Date.now() - 1000),
        },
        {
          threadId,
          authorType: 'ai',
          authorName: 'The Librarian',
          content: 'The philosopher\'s stone is a legendary alchemical substance...',
          createdAt: new Date(),
        },
      ]);

      const req = makeRequest('/api/embassy/threads?limit=10');
      const res = await threadsGet(req as any);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.threads).toHaveLength(1);
      // The feed shows the conversation, never who had it. 'Scholar' is the
      // stored creatorName; a stranger must not receive it.
      expect(data.threads[0].creatorName).toBe('A reader');
      expect(JSON.stringify(data)).not.toContain('Scholar');
      expect(data.threads[0].preview.question).toContain('philosopher');
      expect(data.threads[0].preview.answer).toContain('alchemical');
    });

    it('excludes private threads', async () => {
      const db = getTestDb();
      const threadId = new ObjectId();

      await db.collection('embassy_threads').insertOne({
        _id: threadId,
        type: 'chat',
        title: 'Private question',
        creatorId: 'user-1',
        creatorName: 'Scholar',
        visibility: 'private',
        messageCount: 2,
        createdAt: new Date(),
        lastMessageAt: new Date(),
      });

      const req = makeRequest('/api/embassy/threads');
      const res = await threadsGet(req as any);
      const data = await res.json();

      expect(data.threads).toHaveLength(0);
    });

    it('excludes threads with fewer than 2 messages', async () => {
      const db = getTestDb();
      await db.collection('embassy_threads').insertOne({
        type: 'chat',
        title: 'Started but no response',
        creatorId: 'user-1',
        creatorName: 'Scholar',
        visibility: 'public',
        messageCount: 1,
        createdAt: new Date(),
        lastMessageAt: new Date(),
      });

      const req = makeRequest('/api/embassy/threads');
      const res = await threadsGet(req as any);
      const data = await res.json();

      expect(data.threads).toHaveLength(0);
    });
  });

  describe('GET /api/embassy/threads/[id]', () => {
    it('returns unlisted (anonymous) threads to anyone holding the id', async () => {
      // The chat client restores anonymous conversations via
      // /librarian?thread=<id> after back-navigation — unlisted means
      // "not in the Recent feed", not "creator-only".
      const db = getTestDb();
      const threadId = new ObjectId();
      await db.collection('embassy_threads').insertOne({
        _id: threadId,
        type: 'chat',
        title: 'Anon question',
        creatorId: null,
        creatorName: 'A visitor',
        visibility: 'unlisted',
        messageCount: 2,
        createdAt: new Date(),
        lastMessageAt: new Date(),
      });
      await db.collection('embassy_messages').insertMany([
        { threadId, authorType: 'human', authorName: 'A visitor', content: 'Where do I start with Jung?', createdAt: new Date() },
        { threadId, authorType: 'ai', authorName: 'The Librarian', content: 'Start with the Red Book.', sources: [], createdAt: new Date() },
      ]);

      const req = makeRequest(`/api/embassy/threads/${threadId}`);
      const res = await threadDetailGet(req as any, { params: Promise.resolve({ id: threadId.toString() }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.messages).toHaveLength(2);
    });

    it('still hides private threads from non-creators', async () => {
      const db = getTestDb();
      const threadId = new ObjectId();
      await db.collection('embassy_threads').insertOne({
        _id: threadId,
        type: 'chat',
        title: 'Private research',
        creatorId: 'someone-else',
        creatorName: 'Scholar',
        visibility: 'private',
        messageCount: 2,
        createdAt: new Date(),
        lastMessageAt: new Date(),
      });

      const req = makeRequest(`/api/embassy/threads/${threadId}`);
      const res = await threadDetailGet(req as any, { params: Promise.resolve({ id: threadId.toString() }) });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/embassy/rooms', () => {
    it('seeds default rooms on first load', async () => {
      const req = makeRequest('/api/embassy/rooms');
      const res = await roomsGet(req as any);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.rooms.length).toBeGreaterThanOrEqual(7);

      const slugs = data.rooms.map((r: any) => r.slug);
      expect(slugs).toContain('general');
      expect(slugs).toContain('alchemy');
      expect(slugs).toContain('hermetica');
      expect(slugs).toContain('kabbalah');
    });

    it('returns existing rooms on subsequent loads', async () => {
      // First load seeds
      const req1 = makeRequest('/api/embassy/rooms');
      await roomsGet(req1 as any);

      // Second load should return same rooms, not double them
      const req2 = makeRequest('/api/embassy/rooms');
      const res2 = await roomsGet(req2 as any);
      const data2 = await res2.json();

      const generalRooms = data2.rooms.filter((r: any) => r.slug === 'general');
      expect(generalRooms).toHaveLength(1);
    });
  });
});
