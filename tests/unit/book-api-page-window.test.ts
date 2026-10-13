/**
 * #6281 step 1: anonymous callers of the book API get the page list in capped
 * windows; signed-in readers and API keys get every page.
 *
 * Exercises the real GET handlers of /api/books/[id] and its tenant twin over
 * an in-memory pages collection (250 pages), so the assertions are about what
 * a caller receives, not about how the route is spelled. Negative control, run
 * by hand when this was written: with `resolvePageWindow(searchParams, false)`
 * in either route (cap removed), the anon cases go red with 250 pages returned.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { ApiIdentity } from '@/lib/api-auth';

const BOOK_ID = 'book-6281';
const TOTAL = 250;
const ALL_PAGES = Array.from({ length: TOTAL }, (_, i) => ({
  id: `p${String(i + 1).padStart(3, '0')}`,
  book_id: BOOK_ID,
  tenantId: 'bph',
  page_number: i + 1,
}));

let identity: ApiIdentity = { kind: 'anon' };
let tenantSession: { user: { id: string } } | null = null;

/** Minimal Mongo cursor over ALL_PAGES that honours skip/limit like the driver. */
function pagesCollection() {
  return {
    find: () => {
      let skip = 0;
      let limit = 0;
      const cursor = {
        project: () => cursor,
        sort: () => cursor,
        skip: (n: number) => { skip = n; return cursor; },
        limit: (n: number) => { limit = n; return cursor; },
        toArray: async () => {
          const rows = ALL_PAGES.slice(skip);
          return (limit > 0 ? rows.slice(0, limit) : rows).map(p => ({ ...p }));
        },
      };
      return cursor;
    },
    countDocuments: async () => TOTAL,
    findOne: async () => null,
  };
}
const fakeDb = { collection: () => pagesCollection() };

vi.mock('@/lib/api-auth', () => ({
  withApiAuth: (handler: (req: NextRequest, ctx: unknown, id: ApiIdentity) => Promise<Response>) =>
    (req: NextRequest, ctx: unknown) => handler(req, ctx, identity),
}));
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => tenantSession) }));
vi.mock('@/lib/mongodb', () => ({ getDb: async () => fakeDb, getReadDb: async () => fakeDb }));
vi.mock('@/lib/tenant-context', () => ({
  getTenantContextFromRequest: () => ({ id: undefined }),
  resolveTenantId: async () => 'bph',
}));
vi.mock('@/lib/auth-helpers', () => ({
  withAdminAuth: (h: unknown) => h,
  withCuratorAuth: (h: unknown) => h,
  isAdmin: async () => false,
}));
vi.mock('@/lib/book-lookup', () => ({
  findBookByIdOrSlug: async () => ({ book: { id: BOOK_ID, title: 'A long book', visible: true } }),
}));
vi.mock('@/lib/book-access', () => ({
  isBookReadable: async () => true,
  hiddenBookMetadataCard: (b: unknown) => b,
}));
vi.mock('@/lib/book-index', () => ({ getBookIndexFields: async () => null }));
vi.mock('@/lib/page-translations', () => ({ EDITION_COUNTER_PROJECTION: {} }));
vi.mock('@/lib/audit-logger', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/book-changelog', () => ({ logMetadataChange: vi.fn(), diffBookFields: vi.fn() }));
vi.mock('@/lib/books-catalog', () => ({ mirrorBookToCatalog: vi.fn() }));
vi.mock('@/lib/cloudflare-cache', () => ({ purgeCloudflareUrls: vi.fn() }));
vi.mock('@/lib/delete-book', () => ({ deleteBookArchived: vi.fn(), purgeBookUnarchived: vi.fn() }));
vi.mock('@/lib/prune-deleted-book', () => ({ pruneSearchRowsForDeletedBook: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { GET } = await import('@/app/api/books/[id]/route');
const { GET: TENANT_GET } = await import('@/app/api/[tenant]/books/[id]/route');

type Body = { pages: Array<{ id: string; page_number: number }>; pages_window: { offset: number; limit: number; returned: number; total: number } };

async function getBook(query = ''): Promise<{ body: Body; res: Response }> {
  const req = new NextRequest(`https://sourcelibrary.org/api/books/${BOOK_ID}${query}`);
  const res = await (GET as (r: NextRequest, c: unknown) => Promise<Response>)(req, { params: Promise.resolve({ id: BOOK_ID }) });
  return { body: await res.json(), res };
}

async function getTenantBook(query = ''): Promise<{ body: Body; res: Response }> {
  const req = new NextRequest(`https://sourcelibrary.org/api/bph/books/${BOOK_ID}${query}`);
  const res = await TENANT_GET(req, { params: Promise.resolve({ tenant: 'bph', id: BOOK_ID }) });
  return { body: await res.json(), res };
}

describe('/api/books/[id] page windows (#6281)', () => {
  beforeEach(() => { identity = { kind: 'anon' }; delete process.env.API_ANON_PAGE_WINDOW; });
  afterEach(() => { delete process.env.API_ANON_PAGE_WINDOW; });

  it('anon with no params gets the first 100 pages and the true total', async () => {
    const { body, res } = await getBook();
    expect(body.pages).toHaveLength(100);
    expect(body.pages[0].page_number).toBe(1);
    expect(body.pages_window).toEqual({ offset: 0, limit: 100, returned: 100, total: TOTAL });
    expect(res.headers.get('cache-control')).toMatch(/^public/);
    expect(res.headers.get('vary')).toMatch(/Cookie/);
  });

  it('anon asking for pageLimit=0 (the old "all") or above the cap still gets the cap', async () => {
    for (const q of ['?pageLimit=0', '?pageLimit=5000', '?pageLimit=-1', '?pageLimit=abc']) {
      const { body } = await getBook(q);
      expect(body.pages.length, q).toBe(100);
      expect(body.pages_window.total, q).toBe(TOTAL);
    }
  });

  it('a verified bot is capped like anon', async () => {
    identity = { kind: 'bot', bot: 'googlebot' };
    const { body } = await getBook('?pageLimit=0');
    expect(body.pages).toHaveLength(100);
  });

  it('anon windows are contiguous, non-overlapping, and cover the book', async () => {
    const seen: string[] = [];
    let offset = 0;
    for (let i = 0; i < 10; i++) {
      const { body } = await getBook(`?pageOffset=${offset}&pageLimit=0`);
      expect(body.pages_window.offset).toBe(offset);
      if (seen.length) expect(body.pages[0].page_number).toBe(offset + 1);
      seen.push(...body.pages.map(p => p.id));
      offset = body.pages_window.offset + body.pages_window.returned;
      if (offset >= body.pages_window.total) break;
    }
    expect(seen).toHaveLength(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL);
    expect(seen).toEqual(ALL_PAGES.map(p => p.id));
  });

  it('a smaller pageLimit is honoured for anon', async () => {
    const { body } = await getBook('?pageOffset=240&pageLimit=20');
    expect(body.pages_window).toEqual({ offset: 240, limit: 20, returned: 10, total: TOTAL });
  });

  it('API_ANON_PAGE_WINDOW overrides the cap', async () => {
    process.env.API_ANON_PAGE_WINDOW = '30';
    const { body } = await getBook();
    expect(body.pages).toHaveLength(30);
  });

  it('a signed-in session gets every page, privately cached', async () => {
    identity = { kind: 'session', userId: 'u1' };
    const { body, res } = await getBook();
    expect(body.pages).toHaveLength(TOTAL);
    expect(body.pages_window).toEqual({ offset: 0, limit: 0, returned: TOTAL, total: TOTAL });
    expect(res.headers.get('cache-control')).toMatch(/^private/);
  });

  it('an API key gets every page', async () => {
    identity = { kind: 'apikey', apiKeyId: 'k1' };
    const { body } = await getBook('?pageLimit=0');
    expect(body.pages).toHaveLength(TOTAL);
  });
});

describe('/api/[tenant]/books/[id] page windows (#6281)', () => {
  beforeEach(() => { tenantSession = null; });

  it('no session: capped, with the true total', async () => {
    const { body, res } = await getTenantBook('?pageLimit=0');
    expect(body.pages).toHaveLength(100);
    expect(body.pages_window.total).toBe(TOTAL);
    expect(res.headers.get('cache-control')).toMatch(/^public/);
  });

  it('no session: offset windows are contiguous', async () => {
    const { body } = await getTenantBook('?pageOffset=100');
    expect(body.pages[0].page_number).toBe(101);
    expect(body.pages).toHaveLength(100);
  });

  it('signed in: every page, privately cached', async () => {
    tenantSession = { user: { id: 'u1' } };
    const { body, res } = await getTenantBook();
    expect(body.pages).toHaveLength(TOTAL);
    expect(res.headers.get('cache-control')).toMatch(/^private/);
  });
});
