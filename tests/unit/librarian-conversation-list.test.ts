import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A reader with history must never be told they have none (#4070).
 *
 * Derek reported an empty "My Conversations" while holding 112 conversations.
 * The list route's failure and empty-result paths were the same shape —
 * `{ threads: [] }` with a 200 — so the sidebar could not tell "your history is
 * empty" from "the query died", and rendered the first for both. These pin the
 * distinction at the API boundary: only a genuinely empty result is a 200 with
 * an empty array.
 *
 * Negative control run: reverting the route's catch block to
 * `return NextResponse.json({ threads: [] })` turns the failure case red.
 */

let currentUserId: string | null = null;
let dbFails = false;

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () =>
    currentUserId ? { user: { id: currentUserId }, expires: 'later' } : null,
  ),
}));

const THREAD = {
  _id: { toString: () => '6a7ca639e9e3ddd465b53523' },
  title: 'What is the prisca theologia?',
  creatorName: 'Derek Lomas',
  messageCount: 4,
  createdAt: new Date(),
  lastMessageAt: new Date(),
  firstMessages: [
    { authorType: 'human', content: 'What is the prisca theologia?' },
    { authorType: 'ai', content: 'It is the doctrine that…' },
  ],
};

let lastPipeline: unknown[] = [];

vi.mock('@/lib/mongodb', () => ({
  getReadDb: vi.fn(async () => {
    if (dbFails) throw new Error('connection reset');
    return {
      collection: () => ({
        aggregate: (pipeline: unknown[]) => {
          lastPipeline = pipeline;
          return { toArray: async () => [THREAD] };
        },
      }),
    };
  }),
}));

const { GET } = await import('@/app/api/embassy/threads/route');

const req = (qs: string) => new Request(`http://localhost/api/embassy/threads${qs}`) as never;

beforeEach(() => {
  currentUserId = null;
  dbFails = false;
  lastPipeline = [];
});

describe('a signed-in reader asking for their own conversations', () => {
  beforeEach(() => { currentUserId = 'user-derek-1'; });

  it('gets them', async () => {
    const res = await GET(req('?mine=true&limit=20'));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.threads).toHaveLength(1);
    expect(data.threads[0].preview.question).toContain('prisca theologia');
    expect(data.threads[0].preview.answer).toContain('doctrine');
  });

  it('is scoped to their own account id', async () => {
    await GET(req('?mine=true'));
    const match = lastPipeline.find(s => (s as Record<string, unknown>).$match) as
      { $match: Record<string, unknown> };
    expect(match.$match.creatorId).toBe('user-derek-1');
  });

  it('never has its list cached — it is one account’s history', async () => {
    const res = await GET(req('?mine=true'));
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('is told the list FAILED, not that it is empty, when the query dies', async () => {
    dbFails = true;
    const res = await GET(req('?mine=true'));
    // The whole bug: a 200 with an empty array here reads as "no history".
    expect(res.status).toBe(503);
    expect((await res.json()).threads).toBeUndefined();
  });
});

describe('a visitor who is not signed in', () => {
  it('cannot get a "mine" list, and is told so rather than shown an empty one', async () => {
    const res = await GET(req('?mine=true'));
    expect(res.status).toBe(401);
    expect((await res.json()).signedIn).toBe(false);
  });

  it('still gets the public Recent feed', async () => {
    const res = await GET(req('?limit=50'));
    expect(res.status).toBe(200);
    expect((await res.json()).threads).toHaveLength(1);
  });

  it('gets a failure status on the Recent feed too, not a silent empty feed', async () => {
    dbFails = true;
    const res = await GET(req('?limit=50'));
    expect(res.status).toBe(503);
  });
});
