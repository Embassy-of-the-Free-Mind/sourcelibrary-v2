import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The read routes behind /analytics, /experiments and /jobs admit the people
 * who can open those pages; the write routes beside them do not.
 *
 * The three pages are gated by `requireInnerCircle()`, which admits a GLOBAL
 * membership (`memberships` row, `tenantId: null`, role `inner_circle` or
 * `editor`). Their data routes were on `withAuth`, which never reads a global
 * membership, so once `withAuth` stopped defaulting to `reader` every request
 * those pages made came back 403 for the staff the pages exist for (v3#186).
 * The GET handlers the pages call are now on `withInnerCircleAuth`. Handlers
 * in the same folders that write, spend or queue stay on `withAuth` at
 * `editor`: an inner-circle member is deliberately not an editor.
 *
 * This drives the REAL wrappers against the REAL route modules; only `auth()`
 * and the database are faked. The fake `memberships` collection evaluates the
 * query it is given (email, tenantId, role, status), so a tenant-scoped row
 * does not pass for a global one. Negative controls run on a copy of each
 * file: putting `withAuth(…, { minRole: 'editor' })` back on a read route
 * turns its inner-circle cases red, and moving a write route to
 * `withInnerCircleAuth` turns its "still refuses" case red.
 */

const ROLE_LEVEL = { reader: 1, contributor: 2, editor: 3, admin: 4, superadmin: 5 };

type SessionUser = { id: string; name: string; email: string; role: string };
let currentUser: SessionUser | null = null;

vi.mock('@/lib/auth', () => ({
  ROLE_LEVEL,
  auth: vi.fn(async () =>
    currentUser
      ? { user: currentUser, expires: new Date(Date.now() + 3600_000).toISOString() }
      : null
  ),
}));

type Membership = { email: string; tenantId: string | null; role: string; status: string };
let memberships: Membership[] = [];
let writes: string[] = [];

function matches(row: Record<string, unknown>, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, want]) => {
    const got = row[key];
    if (want && typeof want === 'object' && '$in' in (want as object)) {
      return ((want as { $in: unknown[] }).$in).includes(got);
    }
    return got === want;
  });
}

// Every collection but `memberships` is empty. A cursor answers any chained
// call with itself and resolves to []; a write is recorded so a test can show
// a refused request never reached the handler.
function emptyCursor(): unknown {
  const cursor: Record<string, unknown> = {};
  for (const m of ['sort', 'limit', 'skip', 'project', 'maxTimeMS', 'hint']) cursor[m] = () => cursor;
  cursor.toArray = async () => [];
  return cursor;
}

function fakeDb() {
  return {
    collection: (name: string) => ({
      findOne: async (query: Record<string, unknown>) =>
        name === 'memberships' ? memberships.find((m) => matches(m, query)) ?? null : null,
      find: () => emptyCursor(),
      aggregate: () => emptyCursor(),
      countDocuments: async () => 0,
      estimatedDocumentCount: async () => 0,
      distinct: async () => [],
      insertOne: async () => { writes.push(`${name}.insertOne`); return { insertedId: 'x' }; },
      updateOne: async () => { writes.push(`${name}.updateOne`); return { matchedCount: 0, modifiedCount: 0 }; },
      deleteOne: async () => { writes.push(`${name}.deleteOne`); return { deletedCount: 0 }; },
    }),
  };
}

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => fakeDb()),
  getReadDb: vi.fn(async () => fakeDb()),
}));

type RouteCase = {
  name: string;
  method: 'GET' | 'POST' | 'DELETE';
  load: () => Promise<Record<string, unknown>>;
  params?: Record<string, string>;
  body?: unknown;
};

// Reads the dashboard pages make on load.
const READ_ROUTES: RouteCase[] = [
  // /jobs, and the Logs tab of /analytics
  { name: 'GET /api/jobs', method: 'GET', load: () => import('@/app/api/jobs/route') },
  // /experiments and /experiments/compare
  { name: 'GET /api/experiments', method: 'GET', load: () => import('@/app/api/experiments/route') },
  // /experiments/ocr-quality
  { name: 'GET /api/experiments/ocr-quality', method: 'GET', load: () => import('@/app/api/experiments/ocr-quality/route') },
];

// Buttons on the same pages. They change or spend, so they stay at editor.
const WRITE_ROUTES: RouteCase[] = [
  { name: 'DELETE /api/jobs/[id]', method: 'DELETE', load: () => import('@/app/api/jobs/[id]/route'), params: { id: 'job-1' } },
  {
    name: 'POST /api/experiments',
    method: 'POST',
    load: () => import('@/app/api/experiments/route'),
    body: { name: 'probe', book_id: 'book-1' },
  },
  {
    name: 'POST /api/experiments/ocr-quality/[id]/judge',
    method: 'POST',
    load: () => import('@/app/api/experiments/ocr-quality/[id]/judge/route'),
    params: { id: 'exp-1' },
    body: { page_id: 'p1', comparison_type: 'q', winner: 'a' },
  },
];

async function call(c: RouteCase, headers: Record<string, string> = {}) {
  const mod = await c.load();
  const handler = mod[c.method] as (req: NextRequest, ctx: unknown) => Promise<Response>;
  const req = new NextRequest('https://sourcelibrary.org/api/probe', {
    method: c.method,
    headers: { 'content-type': 'application/json', ...headers },
    body: c.method === 'GET' ? undefined : JSON.stringify(c.body ?? {}),
  });
  return handler(req, { params: Promise.resolve(c.params ?? {}) });
}

const user = (email: string, role = 'reader'): SessionUser => ({ id: 'u1', name: 'Test', email, role });
const INNER_CIRCLE_403 = { error: 'Forbidden - inner-circle access required' };
const WITHAUTH_403 = { error: 'Forbidden - Insufficient role' };

beforeEach(() => {
  vi.unstubAllEnvs();
  // PLATFORM_ADMIN_EMAILS would silently promote a test user to superadmin.
  vi.stubEnv('PLATFORM_ADMIN_EMAILS', '');
  vi.stubEnv('CRON_SECRET', 'test-cron-secret');
  currentUser = null;
  writes = [];
  memberships = [
    { email: 'inner@example.com', tenantId: null, role: 'inner_circle', status: 'active' },
    { email: 'global-editor@example.com', tenantId: null, role: 'editor', status: 'active' },
    // A tenant's own inner-circle row is not a global grant.
    { email: 'tenant-only@example.com', tenantId: 'bph', role: 'inner_circle', status: 'active' },
    { email: 'revoked@example.com', tenantId: null, role: 'inner_circle', status: 'revoked' },
    { email: 'late-superadmin@example.com', tenantId: null, role: 'superadmin', status: 'active' },
  ];
});

describe('dashboard read routes admit the people who can open the dashboards', () => {
  for (const c of READ_ROUTES) {
    it(`${c.name} answers 401 with no session`, async () => {
      const res = await call(c);
      expect(res.status).toBe(401);
    });

    it(`${c.name} refuses a signed-in reader with no membership`, async () => {
      currentUser = user('reader@example.com');
      const res = await call(c);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(INNER_CIRCLE_403);
    });

    it(`${c.name} admits a global inner_circle member`, async () => {
      currentUser = user('inner@example.com');
      const res = await call(c);
      expect(res.status).toBe(200);
    });

    it(`${c.name} admits the global editor membership`, async () => {
      currentUser = user('global-editor@example.com');
      const res = await call(c);
      expect(res.status).toBe(200);
    });

    it(`${c.name} admits a superadmin session, and a superadmin granted after sign-in`, async () => {
      currentUser = user('boss@example.com', 'superadmin');
      expect((await call(c)).status).toBe(200);
      currentUser = user('late-superadmin@example.com', 'reader');
      expect((await call(c)).status).toBe(200);
    });

    it(`${c.name} refuses a tenant-scoped or revoked inner_circle row`, async () => {
      currentUser = user('tenant-only@example.com');
      expect((await call(c, { 'x-tenant-id': 'bph' })).status).toBe(403);
      currentUser = user('revoked@example.com');
      expect((await call(c)).status).toBe(403);
    });

    // No script or workflow calls these reads, so the cron bearer that
    // withAuth accepts is not carried over. Pinned so that adding it is a
    // decision rather than a side effect.
    it(`${c.name} does not take the cron bearer in place of a session`, async () => {
      const res = await call(c, { authorization: 'Bearer test-cron-secret' });
      expect(res.status).toBe(401);
    });
  }
});

describe('dashboard write routes still need an editor', () => {
  for (const c of WRITE_ROUTES) {
    for (const email of ['inner@example.com', 'global-editor@example.com', 'reader@example.com']) {
      it(`${c.name} refuses ${email}`, async () => {
        currentUser = user(email);
        const res = await call(c);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual(WITHAUTH_403);
        expect(writes).toEqual([]);
      });
    }

    it(`${c.name} answers 401 with no session`, async () => {
      expect((await call(c)).status).toBe(401);
    });

    // The gate, not the fake database, is what refuses above.
    it(`${c.name} lets a superadmin through to the handler`, async () => {
      currentUser = user('boss@example.com', 'superadmin');
      const res = await call(c);
      expect([401, 403]).not.toContain(res.status);
    });

    it(`${c.name} still takes the cron bearer`, async () => {
      const res = await call(c, { authorization: 'Bearer test-cron-secret' });
      expect([401, 403]).not.toContain(res.status);
    });
  }
});
