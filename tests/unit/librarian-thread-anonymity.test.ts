import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A listed Librarian conversation must never carry its author's name.
 *
 * This is the same leak twice over. Conversations were public by default AND
 * attributed to the account holder, so a reader found her questions on the
 * site under her first and last name (feedback 6a6ab4808b1d5089bd554672).
 * Flipping everything to private closed it and emptied the Recent feed to zero
 * of 1,240 threads — the opposite failure (feedback 6a7ca639e9e3ddd465b53523).
 *
 * The fix separates listing from naming, and the naming half has to hold in
 * the RESPONSE BODY, not in the sidebar that renders it: the original leak was
 * visible in this payload, so a component-level fix would still have been one
 * `curl` away. Hence the assertions below check the serialised JSON for the
 * name rather than the field it was expected in.
 *
 * These drive the REAL route modules; only `auth()` and Mongo are faked.
 * Negative control run: dropping `attribution()` from either route turns the
 * "stranger" cases red.
 */

const OWNER_ID = 'user-owner-1';
const OWNER_NAME = 'Rocio Bernardiner';
const THREAD_ID = '6a7ca639e9e3ddd465b53523';

let currentUserId: string | null = null;

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () =>
    currentUserId ? { user: { id: currentUserId }, expires: 'later' } : null,
  ),
}));

type ThreadDoc = {
  _id: unknown;
  title: string;
  creatorId: string | null;
  creatorName: string;
  visibility: string;
  messageCount: number;
  createdAt: Date;
  lastMessageAt: Date;
};

let thread: ThreadDoc;
const updates: Record<string, unknown>[] = [];

const MESSAGES = [
  { _id: 'm1', authorType: 'human', authorName: OWNER_NAME, content: 'What is the prisca theologia?', createdAt: new Date() },
  { _id: 'm2', authorType: 'ai', authorName: 'The Librarian', content: 'It is the doctrine that…', sources: [], createdAt: new Date() },
];

function fakeDb() {
  return {
    collection: (name: string) => {
      if (name === 'embassy_threads') {
        return {
          findOne: async () => thread,
          updateOne: async (_f: unknown, u: Record<string, unknown>) => {
            updates.push(u);
            return { modifiedCount: 1 };
          },
          find: () => ({
            sort: () => ({
              skip: () => ({ limit: () => ({ toArray: async () => [thread] }) }),
            }),
          }),
        };
      }
      return {
        find: () => ({
          sort: () => ({
            toArray: async () => MESSAGES,
            limit: () => ({ project: () => ({ toArray: async () => MESSAGES }) }),
          }),
        }),
      };
    },
  };
}

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => fakeDb()),
  getReadDb: vi.fn(async () => fakeDb()),
}));

const { GET, PATCH } = await import('@/app/api/embassy/threads/[id]/route');
const { GET: LIST } = await import('@/app/api/embassy/threads/route');

const params = Promise.resolve({ id: THREAD_ID });
const detailReq = () => new Request(`http://localhost/api/embassy/threads/${THREAD_ID}`) as never;
const patchReq = (body: unknown) =>
  new Request(`http://localhost/api/embassy/threads/${THREAD_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }) as never;

beforeEach(() => {
  currentUserId = null;
  updates.length = 0;
  thread = {
    _id: { toString: () => THREAD_ID },
    title: 'What is the prisca theologia?',
    creatorId: OWNER_ID,
    creatorName: OWNER_NAME,
    visibility: 'public',
    messageCount: 2,
    createdAt: new Date(),
    lastMessageAt: new Date(),
  };
});

describe('a listed thread served to a stranger', () => {
  it('carries the author name nowhere in the payload', async () => {
    const res = await GET(detailReq(), { params });
    const raw = await res.text();

    expect(raw).not.toContain(OWNER_NAME);
    expect(raw).not.toContain(OWNER_ID);

    const data = JSON.parse(raw);
    expect(data.thread.creatorName).toBe('A reader');
    expect(data.thread.creatorId).toBeNull();
    expect(data.thread.isOwner).toBe(false);
    expect(data.messages.find((m: { authorType: string }) => m.authorType === 'human').authorName)
      .toBe('A reader');
  });

  it('keeps the Librarian byline, which is not a person', async () => {
    const res = await GET(detailReq(), { params });
    const data = await res.json();
    expect(data.messages.find((m: { authorType: string }) => m.authorType === 'ai').authorName)
      .toBe('The Librarian');
  });

  it('still serves the conversation itself — anonymity is not suppression', async () => {
    const res = await GET(detailReq(), { params });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.messages).toHaveLength(2);
    expect(data.messages[0].content).toContain('prisca theologia');
  });

  it('anonymises the Recent feed too', async () => {
    const res = await LIST(new Request('http://localhost/api/embassy/threads') as never);
    const raw = await res.text();
    expect(raw).not.toContain(OWNER_NAME);
    expect(JSON.parse(raw).threads[0].creatorName).toBe('A reader');
  });
});

describe('the author of the thread', () => {
  beforeEach(() => { currentUserId = OWNER_ID; });

  it('sees their own name back', async () => {
    const res = await GET(detailReq(), { params });
    const data = await res.json();
    expect(data.thread.creatorName).toBe(OWNER_NAME);
    expect(data.thread.isOwner).toBe(true);
  });

  it('gets their real name on their own list', async () => {
    const res = await LIST(new Request('http://localhost/api/embassy/threads?mine=true') as never);
    const data = await res.json();
    expect(data.threads[0].creatorName).toBe(OWNER_NAME);
  });
});

describe('an unlisted thread stays reachable by id', () => {
  it('serves anonymously rather than 404ing', async () => {
    thread.visibility = 'unlisted';
    thread.creatorId = null;
    thread.creatorName = 'A visitor';
    const res = await GET(detailReq(), { params });
    expect(res.status).toBe(200);
  });
});

describe('a private thread', () => {
  beforeEach(() => { thread.visibility = 'private'; });

  it('404s for a stranger', async () => {
    const res = await GET(detailReq(), { params });
    expect(res.status).toBe(404);
  });

  it('opens for its author', async () => {
    currentUserId = OWNER_ID;
    const res = await GET(detailReq(), { params });
    expect(res.status).toBe(200);
  });
});

describe('changing whether a thread is listed', () => {
  it('lets anyone holding the id take it OFF the list', async () => {
    // Un-listing only ever removes. An anonymous visitor who realises they
    // said something personal has no account to authenticate with, and the id
    // already granted them read access, so this is not an escalation.
    thread.creatorId = null;
    const res = await PATCH(patchReq({ listed: false }), { params });
    expect(res.status).toBe(200);
    expect(updates[0]).toEqual({ $set: { visibility: 'unlisted' } });
  });

  it('refuses to PUT a thread ON the list for anyone but its author', async () => {
    thread.visibility = 'unlisted';
    const res = await PATCH(patchReq({ listed: true }), { params });
    expect(res.status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it('lets the author list their own thread', async () => {
    currentUserId = OWNER_ID;
    thread.visibility = 'private';
    const res = await PATCH(patchReq({ listed: true }), { params });
    expect(res.status).toBe(200);
    expect(updates[0]).toEqual({ $set: { visibility: 'public' } });
  });

  it('will not confirm a private thread exists to a stranger', async () => {
    thread.visibility = 'private';
    const res = await PATCH(patchReq({ listed: false }), { params });
    expect(res.status).toBe(404);
    expect(updates).toHaveLength(0);
  });

  it('rejects a body without a listed boolean', async () => {
    const res = await PATCH(patchReq({ visibility: 'public' }), { params });
    expect(res.status).toBe(400);
  });
});
