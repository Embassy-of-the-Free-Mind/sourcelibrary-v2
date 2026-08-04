import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Every route that rewrites a page's text must be gated at `editor` (#3511).
 *
 * The UI has always gated editing correctly: the Read/Edit toggle in
 * TranslationEditor is wrapped in `<AuthCheck role="inner_circle">`, so a reader
 * never sees it. The API gates had drifted to `withAuth`'s default of `reader`,
 * which meant any signed-in account could overwrite OCR or translation text by
 * calling the route directly — and two of the routes (`quick-fix`, `restore`)
 * apply no tenant filter, so the reach was the whole corpus from the main
 * domain, not one tenant.
 *
 * This test runs the REAL `withAuth` against the REAL route modules. Only
 * `auth()` and the database are faked. Deleting the `{ minRole: 'editor' }`
 * option from any route below turns its case red — verified by doing exactly
 * that, per the "a test that greps source is not a guard" rule in CLAUDE.md.
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

// Records every query filter the routes issue, so the tenant-scope suite below
// can assert on the shape of the filter and not merely on the status code.
const { dbCalls } = vi.hoisted(() => ({
  dbCalls: [] as { collection: string; op: string; filter: unknown }[],
}));

// No memberships, no platform-superadmin grant, no page found. The handler is
// allowed to run and fail on its own terms — this test only cares whether the
// gate let it through at all.
vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: (name: string) => ({
      findOne: async (filter: unknown) => {
        dbCalls.push({ collection: name, op: 'findOne', filter });
        return null;
      },
      findOneAndUpdate: async (filter: unknown) => {
        dbCalls.push({ collection: name, op: 'findOneAndUpdate', filter });
        return null;
      },
      updateOne: async (filter: unknown) => {
        dbCalls.push({ collection: name, op: 'updateOne', filter });
        return { matchedCount: 0 };
      },
      deleteOne: async (filter: unknown) => {
        dbCalls.push({ collection: name, op: 'deleteOne', filter });
        return { deletedCount: 1 };
      },
    }),
  })),
}));

vi.mock('@/lib/page-revisions', () => ({
  createRevision: async () => undefined,
  restoreRevision: async () => ({ success: false, error: 'Revision not found' }),
}));

type RouteCase = {
  name: string;
  method: 'PATCH' | 'POST' | 'DELETE';
  /** Lowest role the route must accept. */
  minRole: 'editor' | 'admin';
  load: () => Promise<Record<string, unknown>>;
  params: Record<string, string>;
  body?: unknown;
};

const PAGE_TEXT_BODY = {
  ocr: { data: 'Aurum nostrum non est aurum vulgi.', language: 'Latin' },
};

const QUICK_FIX_BODY = {
  field: 'ocr',
  fix: { type: 'insert', position: 0, text: 'x' },
};

/**
 * Every route that can rewrite or destroy stored page content. A new one added
 * without a `minRole` will not be covered here automatically — the companion
 * enumeration test below is what catches that.
 */
const CASES: RouteCase[] = [
  {
    name: 'PATCH /api/pages/[id]',
    method: 'PATCH',
    minRole: 'editor',
    load: () => import('@/app/api/pages/[id]/route'),
    params: { id: 'page-1' },
    body: PAGE_TEXT_BODY,
  },
  {
    name: 'PATCH /api/[tenant]/pages/[id]',
    method: 'PATCH',
    minRole: 'editor',
    load: () => import('@/app/api/[tenant]/pages/[id]/route'),
    params: { tenant: 'bph', id: 'page-1' },
    body: PAGE_TEXT_BODY,
  },
  {
    name: 'DELETE /api/[tenant]/pages/[id]',
    method: 'DELETE',
    minRole: 'admin',
    load: () => import('@/app/api/[tenant]/pages/[id]/route'),
    params: { tenant: 'bph', id: 'page-1' },
  },
  {
    name: 'DELETE /api/pages/[id]',
    method: 'DELETE',
    minRole: 'admin',
    load: () => import('@/app/api/pages/[id]/route'),
    params: { id: 'page-1' },
  },
  {
    name: 'PATCH /api/pages/[id]/quick-fix',
    method: 'PATCH',
    minRole: 'editor',
    load: () => import('@/app/api/pages/[id]/quick-fix/route'),
    params: { id: 'page-1' },
    body: QUICK_FIX_BODY,
  },
  {
    name: 'PATCH /api/[tenant]/pages/[id]/quick-fix',
    method: 'PATCH',
    minRole: 'editor',
    load: () => import('@/app/api/[tenant]/pages/[id]/quick-fix/route'),
    params: { tenant: 'bph', id: 'page-1' },
    body: QUICK_FIX_BODY,
  },
  {
    name: 'POST /api/pages/[id]/revisions/[revisionId]/restore',
    method: 'POST',
    minRole: 'editor',
    load: () => import('@/app/api/pages/[id]/revisions/[revisionId]/restore/route'),
    params: { id: 'page-1', revisionId: 'rev-1' },
  },
  {
    name: 'POST /api/pages/[id]/reset',
    method: 'POST',
    minRole: 'editor',
    load: () => import('@/app/api/pages/[id]/reset/route'),
    params: { id: 'page-1' },
  },
  {
    name: 'POST /api/pages/batch-split',
    method: 'POST',
    minRole: 'editor',
    load: () => import('@/app/api/pages/batch-split/route'),
    params: {},
    body: { splits: [{ pageId: 'page-1', splitPosition: 500 }] },
  },
  {
    name: 'POST /api/[tenant]/pages/batch-split',
    method: 'POST',
    minRole: 'editor',
    load: () => import('@/app/api/[tenant]/pages/batch-split/route'),
    params: { tenant: 'bph' },
    body: { splits: [{ pageId: 'page-1', splitPosition: 500 }] },
  },
];

async function call(c: RouteCase, role: string) {
  currentRole = role;
  const mod = await c.load();
  const handler = mod[c.method] as (req: unknown, ctx: unknown) => Promise<Response>;
  const req = new Request('https://sourcelibrary.org/api/pages/page-1', {
    method: c.method,
    headers: { 'content-type': 'application/json' },
    body: c.body ? JSON.stringify(c.body) : undefined,
  });
  return handler(req, { params: Promise.resolve(c.params) });
}

/** Roles strictly below the route's required role. */
function rolesBelow(minRole: 'editor' | 'admin') {
  return (['reader', 'contributor', 'editor', 'admin'] as const).filter(
    (r) => ROLE_LEVEL[r] < ROLE_LEVEL[minRole],
  );
}

describe('page-write routes are gated above reader (#3511)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    // A stray CRON_SECRET would not matter (we send no Authorization header),
    // but PLATFORM_ADMIN_EMAILS would silently promote our test user.
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', '');
  });

  for (const c of CASES) {
    for (const role of rolesBelow(c.minRole)) {
      it(`${c.name} refuses a signed-in ${role}`, async () => {
        const res = await call(c, role);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'Forbidden - Insufficient role' });
      });
    }

    it(`${c.name} admits ${c.minRole}`, async () => {
      const res = await call(c, c.minRole);
      // The handler runs and then fails on the mocked-empty database — several
      // of these routes answer 403 themselves when they cannot resolve a
      // tenant. So "did the gate let it through" cannot be read from the status
      // alone; it is the gate's own error body that has to be absent.
      expect(res.status).not.toBe(401);
      const body = await res.json().catch(() => ({}));
      expect(body).not.toEqual({ error: 'Forbidden - Insufficient role' });
    });
  }
});

/**
 * An absent tenant means GLOBAL SCOPE on the global route, not a refusal (#3542).
 *
 * The reader lives at `/book/<slug>/page/<id>`, so `getTenantSlug()` returns ''
 * and the API client lands on `/api/pages/[id]` with no tenant. The only thing
 * that ever supplied one there was the proxy's referer fallback, which resolves
 * the tenant FROM THE BOOK — so it returns null for the 88.5% of visible books
 * that carry no `tenantId`, and every save on them answered 403.
 *
 * These cases drive the real `withAuth` and the real route modules; only `auth()`
 * and the DB are faked. Note the mocked session hands the route an `editor` role
 * directly, which production cannot currently produce without a tenant header
 * (the JWT role is only `superadmin` or `reader`) — that limit lives in the role
 * model, not in this route, and is tracked separately.
 */
describe('global page writes are tenant-optional, tenant-scoped when present (#3542)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', '');
    dbCalls.length = 0;
  });

  async function patchGlobal(role: string, headers: Record<string, string> = {}) {
    currentRole = role;
    const mod = await import('@/app/api/pages/[id]/route');
    const handler = mod.PATCH as (req: unknown, ctx: unknown) => Promise<Response>;
    const req = new Request('https://sourcelibrary.org/api/pages/page-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(PAGE_TEXT_BODY),
    });
    return handler(req, { params: Promise.resolve({ id: 'page-1' }) });
  }

  /** The filter the route used to locate the page it was about to rewrite. */
  const pageWriteFilter = () =>
    dbCalls.find((c) => c.collection === 'pages' && c.op === 'findOneAndUpdate')?.filter as
      | Record<string, unknown>
      | undefined;

  it('does not refuse an editor for want of a tenant', async () => {
    const res = await patchGlobal('editor');
    // 404 from the mocked-empty DB is the pass condition: the handler ran.
    expect(await res.json()).not.toEqual({ error: 'Unauthorized' });
    expect(res.status).not.toBe(403);
  });

  it('omits tenantId from the write filter entirely when no tenant is resolved', async () => {
    await patchGlobal('editor');
    const filter = pageWriteFilter();
    expect(filter).toBeDefined();
    expect(filter).toEqual({ id: 'page-1' });
    // Not `{ tenantId: null }` — that matches missing-and-null in Mongo, so it
    // would read as working on global books while never matching a tenant page.
    expect(Object.keys(filter!)).not.toContain('tenantId');
  });

  it('still scopes the write to the tenant when one is resolved', async () => {
    const res = await patchGlobal('superadmin', { 'x-tenant-id': 'bce03f71-tenant' });
    expect(res.status).not.toBe(403);
    expect(pageWriteFilter()).toEqual({ id: 'page-1', tenantId: 'bce03f71-tenant' });
  });

  it('still refuses a reader that has no tenant', async () => {
    const res = await patchGlobal('reader');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden - Insufficient role' });
  });

  it('keeps the tenant twin refusing an unresolvable tenant', async () => {
    // Deliberate divergence: there `tenantId` comes from the `[tenant]` path
    // segment, so failing to resolve one is a misroute, not a global call.
    currentRole = 'superadmin';
    const mod = await import('@/app/api/[tenant]/pages/[id]/route');
    const handler = mod.PATCH as (req: unknown, ctx: unknown) => Promise<Response>;
    const req = new Request('https://sourcelibrary.org/api/no-such-tenant/pages/page-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PAGE_TEXT_BODY),
    });
    const res = await handler(req, {
      params: Promise.resolve({ tenant: 'no-such-tenant', id: 'page-1' }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });
});

describe('the page-write route list stays complete', () => {
  /**
   * The gates above are only as good as this list. Five of these six routes
   * were missed by the issue that reported the sixth, which is the recurring
   * shape here (see the five `entities.books[]` writers in CLAUDE.md). If a new
   * page-text write route appears, add it to CASES.
   */
  it('covers every route module that writes page text', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const roots = ['src/app/api/pages', 'src/app/api/[tenant]/pages'];
    const found: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (entry !== 'route.ts') continue;
        const src = readFileSync(p, 'utf8');
        // Routes that assign client-supplied text into a page's stored fields,
        // or remove a page outright. `modernize` and `transliterate` write only
        // model output and take no text from the caller, so they are excluded.
        const writesPageText =
          /\[`?\$?\{?(?:revision\.)?field\}?`?\.data`?\]|['"](?:ocr|translation|summary)\.data['"]/.test(src);
        const deletesPage = /deleteOne\(\s*\{\s*id/.test(src);
        if (writesPageText || deletesPage) found.push(p);
      }
    };

    for (const r of roots) walk(r);

    // restoreRevision lives in a lib, so the restore route matches neither
    // pattern by itself; it is covered in CASES and asserted separately.
    const covered = new Set([
      'src/app/api/pages/[id]/route.ts',
      'src/app/api/[tenant]/pages/[id]/route.ts',
      'src/app/api/pages/[id]/quick-fix/route.ts',
      'src/app/api/[tenant]/pages/[id]/quick-fix/route.ts',
      'src/app/api/pages/[id]/revisions/[revisionId]/restore/route.ts',
      'src/app/api/pages/[id]/reset/route.ts',
      'src/app/api/pages/batch-split/route.ts',
      'src/app/api/[tenant]/pages/batch-split/route.ts',
    ]);

    const uncovered = found.filter((f) => !covered.has(f));
    expect(uncovered, `page-write routes with no auth case in CASES: ${uncovered.join(', ')}`).toEqual([]);
    expect(CASES.length).toBeGreaterThanOrEqual(covered.size);
  });
});
