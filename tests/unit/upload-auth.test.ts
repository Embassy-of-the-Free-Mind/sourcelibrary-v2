import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Every route under /api/upload must be gated at `editor`.
 *
 * `POST /api/upload/update-book` was reported as a fully unauthenticated write
 * to the `books` collection, keyed on an attacker-supplied `bookId`. It
 * recomputes its values from the database rather than accepting them, so the
 * damage ceiling is a wrong `pages_count`/`thumbnail` — but `pages_count` feeds
 * the canonical public filter (`visible: true && pages_count > 0`), so it can
 * flip a book's visibility on every public surface.
 *
 * The reported instance was not the class. Its two siblings had the same
 * defect and a higher ceiling, because they insert page images rather than
 * recompute a count:
 *   - `/api/upload/from-s3` was also fully unauthenticated.
 *   - `/api/upload` sat on `withAuth`'s permissive `reader` default, so any
 *     signed-in account could append pages to any book (the #3511 shape).
 *
 * This runs the REAL `withAuth` against the REAL route modules; only `auth()`,
 * the database and the upload helpers are faked. Deleting `{ minRole: 'editor' }`
 * from any route below turns its case red — verified by doing exactly that, per
 * the "a test that greps source is not a guard" rule in CLAUDE.md.
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

// No memberships, no platform-superadmin grant, no book found. The handler is
// allowed to run and fail on its own terms — this test only cares whether the
// gate let it through at all.
vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: () => ({
      findOne: async () => null,
      insertMany: async () => ({ insertedCount: 0 }),
      updateOne: async () => ({ matchedCount: 0 }),
    }),
  })),
}));

vi.mock('@/lib/uploads/utils', () => ({
  validateBookAndGetPageNumber: async () => {
    throw new Error('Book not found');
  },
  updateBookAfterUpload: async () => undefined,
  getMimeTypeFromExtension: () => 'image/jpeg',
  getExtensionFromMimeType: () => '.jpg',
}));

// Nothing below should be reached — a refused request must never fetch or
// write an image. Calling either is a failure in its own right.
const processImageUpload = vi.fn(async () => {
  throw new Error('processImageUpload must not run in an auth test');
});
const fetchBufferWithMimeType = vi.fn(async () => {
  throw new Error('S3 fetch must not run in an auth test');
});

vi.mock('@/lib/uploads/processing', () => ({ processImageUpload }));
vi.mock('@/lib/api-client/images', () => ({
  images: { fetchBufferWithMimeType },
}));

type RouteCase = {
  name: string;
  path: string;
  load: () => Promise<Record<string, unknown>>;
  /** Built fresh per call — a Request body can only be consumed once. */
  makeBody: () => BodyInit | undefined;
  headers?: Record<string, string>;
};

const CASES: RouteCase[] = [
  {
    name: 'POST /api/upload/update-book',
    path: 'src/app/api/upload/update-book/route.ts',
    load: () => import('@/app/api/upload/update-book/route'),
    makeBody: () => JSON.stringify({ bookId: 'book-123' }),
    headers: { 'content-type': 'application/json' },
  },
  {
    name: 'POST /api/upload/from-s3',
    path: 'src/app/api/upload/from-s3/route.ts',
    load: () => import('@/app/api/upload/from-s3/route'),
    makeBody: () =>
      JSON.stringify({
        bookId: 'book-123',
        imageUrls: ['https://example-bucket.s3.amazonaws.com/image1.jpg'],
      }),
    headers: { 'content-type': 'application/json' },
  },
  {
    name: 'POST /api/upload',
    path: 'src/app/api/upload/route.ts',
    load: () => import('@/app/api/upload/route'),
    makeBody: () => {
      const fd = new FormData();
      fd.append('bookId', 'book-123');
      fd.append('files', new File([new Uint8Array([1, 2, 3])], 'page.jpg', { type: 'image/jpeg' }));
      return fd;
    },
  },
];

async function call(c: RouteCase, role: string) {
  currentRole = role;
  const mod = await c.load();
  const handler = mod.POST as (req: unknown, ctx?: unknown) => Promise<Response>;
  const req = new Request(`https://sourcelibrary.org/${c.path}`, {
    method: 'POST',
    headers: c.headers,
    body: c.makeBody(),
  });
  return handler(req, { params: Promise.resolve({}) });
}

describe('upload routes are gated at editor', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    // A stray CRON_SECRET would not matter (we send no Authorization header),
    // but PLATFORM_ADMIN_EMAILS would silently promote our test user.
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', '');
    processImageUpload.mockClear();
    fetchBufferWithMimeType.mockClear();
  });

  for (const c of CASES) {
    for (const role of ['reader', 'contributor'] as const) {
      it(`${c.name} refuses a signed-in ${role}`, async () => {
        const res = await call(c, role);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'Forbidden - Insufficient role' });
        expect(processImageUpload).not.toHaveBeenCalled();
        expect(fetchBufferWithMimeType).not.toHaveBeenCalled();
      });
    }

    it(`${c.name} admits an editor`, async () => {
      const res = await call(c, 'editor');
      // The handler runs and then fails on the mocked-empty database, so "did
      // the gate let it through" cannot be read from the status alone; it is
      // the gate's own error body that has to be absent.
      expect(res.status).not.toBe(401);
      const body = await res.json().catch(() => ({}));
      expect(body).not.toEqual({ error: 'Forbidden - Insufficient role' });
    });
  }
});

describe('the upload route list stays complete', () => {
  /**
   * The gates above are only as good as this list, and the issue that reported
   * one of these three named only one. A new route under /api/upload must get
   * an auth case here.
   */
  it('covers every route module under /api/upload', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (entry === 'route.ts') found.push(p);
      }
    };
    walk('src/app/api/upload');

    const covered = new Set(CASES.map((c) => c.path));
    const uncovered = found.filter((f) => !covered.has(f));
    expect(uncovered, `upload routes with no auth case in CASES: ${uncovered.join(', ')}`).toEqual([]);
  });
});
