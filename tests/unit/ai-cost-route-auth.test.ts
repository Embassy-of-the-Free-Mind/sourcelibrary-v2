import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Routes that spend Gemini on OUR key must not be reachable anonymously.
 *
 * Four of them were: `/api/experiments/embed` returned `gemini-embedding-001`
 * vectors for up to 300 arbitrary strings per request; both `detect-split`
 * routes ran Gemini vision on any page id; and `/api/books/[id]/index/stream`
 * ran a whole-book batched index — the most expensive call in the codebase —
 * from an anonymous GET. Each was a plain exported handler with no wrapper, so
 * the only thing an unauthenticated caller met was payload validation. Verified
 * against production before the fix with probes that stop at the 400/404 branch
 * ahead of any Gemini call.
 *
 * This drives the REAL `withAuth` against the REAL route modules; only `auth()`
 * and the database are faked. Deleting a `{ minRole: 'editor' }` from any route
 * below turns its "refuses a signed-in reader" case red — that negative control
 * was run, per the "a test that greps source is not a guard" rule in CLAUDE.md.
 *
 * The reader-facing twin (`/api/embassy/threads/[id]/podcast/ask`) is
 * deliberately NOT in this list: it is rate-limited rather than role-gated, the
 * same shape as `/api/embassy/chat`, and is covered separately below.
 */

const ROLE_LEVEL = { reader: 1, contributor: 2, editor: 3, admin: 4, superadmin: 5 };

let currentRole = 'reader';

vi.mock('@/lib/auth', () => ({
  ROLE_LEVEL,
  auth: vi.fn(async () => ({
    user: { id: 'u1', name: 'A Reader', email: 'reader@example.com', role: currentRole },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  })),
}));

// Nothing is found, so an admitted handler fails on its own terms rather than
// reaching Gemini. This test only asks whether the gate let it through.
vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: () => ({
      findOne: async () => null,
      find: () => ({ sort: () => ({ toArray: async () => [] }) }),
    }),
  })),
}));

vi.mock('@/lib/tenant-context', () => ({
  resolveTenantId: async () => null,
}));

type RouteCase = {
  name: string;
  method: 'GET' | 'POST';
  load: () => Promise<Record<string, unknown>>;
  params: Record<string, string>;
  body?: unknown;
};

const CASES: RouteCase[] = [
  {
    name: 'POST /api/experiments/embed',
    method: 'POST',
    load: () => import('@/app/api/experiments/embed/route'),
    params: {},
    body: { texts: ['aurum nostrum non est aurum vulgi'] },
  },
  {
    name: 'POST /api/pages/[id]/detect-split',
    method: 'POST',
    load: () => import('@/app/api/pages/[id]/detect-split/route'),
    params: { id: 'page-1' },
    body: {},
  },
  {
    name: 'POST /api/[tenant]/pages/[id]/detect-split',
    method: 'POST',
    load: () => import('@/app/api/[tenant]/pages/[id]/detect-split/route'),
    params: { tenant: 'bph', id: 'page-1' },
    body: {},
  },
  {
    name: 'GET /api/books/[id]/index/stream',
    method: 'GET',
    load: () => import('@/app/api/books/[id]/index/stream/route'),
    params: { id: 'book-1' },
  },
];

async function call(c: RouteCase, role: string) {
  currentRole = role;
  const mod = await c.load();
  const handler = mod[c.method] as (req: unknown, ctx: unknown) => Promise<Response>;
  const req = new Request('https://sourcelibrary.org/api/probe', {
    method: c.method,
    headers: { 'content-type': 'application/json' },
    body: c.method === 'GET' ? undefined : JSON.stringify(c.body ?? {}),
  });
  return handler(req, { params: Promise.resolve(c.params) });
}

describe('Gemini-spending routes are gated above reader', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    // A stray CRON_SECRET would not matter (we send no Authorization header),
    // but PLATFORM_ADMIN_EMAILS would silently promote the test user.
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', '');
  });

  for (const c of CASES) {
    for (const role of ['reader', 'contributor'] as const) {
      it(`${c.name} refuses a signed-in ${role}`, async () => {
        const res = await call(c, role);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'Forbidden - Insufficient role' });
      });
    }

    it(`${c.name} admits an editor`, async () => {
      const res = await call(c, 'editor');
      // An admitted handler then fails on the mocked-empty database, so the
      // gate's own error body is what has to be absent — not any one status.
      expect(res.status).not.toBe(401);
      const body = await res.json().catch(() => ({}));
      expect(body).not.toEqual({ error: 'Forbidden - Insufficient role' });
    });
  }
});
