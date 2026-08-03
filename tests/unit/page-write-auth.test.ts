import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Every route that rewrites a page's stored state, or spends on Gemini, must be
 * gated at `editor` (#3511, extended by ops#6).
 *
 * The UI has always gated editing correctly: the Read/Edit toggle in
 * TranslationEditor is wrapped in `<AuthCheck role="inner_circle">`, so a reader
 * never sees it. The API gates had drifted to `withAuth`'s default of `reader`,
 * which meant any signed-in account could overwrite OCR or translation text by
 * calling the route directly — and two of the routes (`quick-fix`, `restore`)
 * apply no tenant filter, so the reach was the whole corpus from the main
 * domain, not one tenant.
 *
 * ops#6 added the AI routes — `modernize`, `ask`, `detect-split` and their
 * tenant twins — which had no wrapper at all rather than a drifted one. Two
 * harms per route: an unauthenticated write to page state, and an
 * unauthenticated paid Gemini call (`{ regenerate: true }` skips the cache).
 * The db mock below returns no page, so none of them reaches Gemini here.
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

// No memberships, no platform-superadmin grant, no page found. The handler is
// allowed to run and fail on its own terms — this test only cares whether the
// gate let it through at all.
vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: () => ({
      findOne: async () => null,
      findOneAndUpdate: async () => null,
      updateOne: async () => ({ matchedCount: 0 }),
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
  // The AI routes (ops#6). Each of these writes page state and/or spends on
  // Gemini, and each had no auth wrapper whatsoever before that issue.
  {
    name: 'POST /api/pages/[id]/modernize',
    method: 'POST',
    minRole: 'editor',
    load: () => import('@/app/api/pages/[id]/modernize/route'),
    params: { id: 'page-1' },
    body: { regenerate: true },
  },
  {
    name: 'POST /api/[tenant]/pages/[id]/modernize',
    method: 'POST',
    minRole: 'editor',
    load: () => import('@/app/api/[tenant]/pages/[id]/modernize/route'),
    params: { tenant: 'bph', id: 'page-1' },
    body: { regenerate: true },
  },
  {
    name: 'POST /api/pages/[id]/ask',
    method: 'POST',
    minRole: 'editor',
    load: () => import('@/app/api/pages/[id]/ask/route'),
    params: { id: 'page-1' },
    // Empty body: the handler answers 400 before reaching Gemini.
    body: {},
  },
  {
    name: 'POST /api/[tenant]/pages/[id]/ask',
    method: 'POST',
    minRole: 'editor',
    load: () => import('@/app/api/[tenant]/pages/[id]/ask/route'),
    params: { tenant: 'bph', id: 'page-1' },
    body: {},
  },
  {
    name: 'POST /api/pages/[id]/detect-split',
    method: 'POST',
    minRole: 'editor',
    load: () => import('@/app/api/pages/[id]/detect-split/route'),
    params: { id: 'page-1' },
  },
  {
    name: 'POST /api/[tenant]/pages/[id]/detect-split',
    method: 'POST',
    minRole: 'editor',
    load: () => import('@/app/api/[tenant]/pages/[id]/detect-split/route'),
    params: { tenant: 'bph', id: 'page-1' },
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
        // The criterion used to be "assigns client-supplied text into a page
        // field", which excluded `modernize` and `transliterate` on the grounds
        // that they write only model output. That reasoning holds for text
        // integrity and misses cost entirely: an uncached call on either is a
        // paid Gemini call an anonymous caller chose to make (ops#6). So the
        // criterion is now "writes page state OR spends on Gemini".
        const writesPageText =
          /\[`?\$?\{?(?:revision\.)?field\}?`?\.data`?\]|['"](?:ocr|translation|summary)\.data['"]/.test(src);
        const writesModelOutput =
          /['"](?:modernized|transliteration)\.data['"]|\bsplit_detection:/.test(src);
        const deletesPage = /deleteOne\(\s*\{\s*id/.test(src);
        if (writesPageText || writesModelOutput || deletesPage) found.push(p);
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
      'src/app/api/pages/[id]/modernize/route.ts',
      'src/app/api/[tenant]/pages/[id]/modernize/route.ts',
      'src/app/api/pages/[id]/detect-split/route.ts',
      'src/app/api/[tenant]/pages/[id]/detect-split/route.ts',
      // TODO(ops#6 PR 2): `transliterate` is the one route in this group with
      // real anonymous reader traffic — TranslationEditor auto-fires it when
      // the panel opens, outside every <AuthCheck>. Editor-gating it would
      // break signed-out reading, so it gets `anonActionGate` on the
      // cache-miss path instead and is covered by its own test, not by CASES.
      'src/app/api/pages/[id]/transliterate/route.ts',
      'src/app/api/[tenant]/pages/[id]/transliterate/route.ts',
    ]);

    const uncovered = found.filter((f) => !covered.has(f));
    expect(uncovered, `page-write routes with no auth case in CASES: ${uncovered.join(', ')}`).toEqual([]);
    expect(CASES.length).toBeGreaterThanOrEqual(covered.size);
  });
});
