import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTestDb, cleanDb } from '../setup';

const TEST_USER_ID = '65a1b2c3d4e5f6a7b8c9d0e1';

// Mock auth for withAuth-wrapped routes.
vi.mock('@/lib/auth', () => ({
  ROLE_LEVEL: {
    reader: 1,
    editor: 2,
    admin: 3,
    superadmin: 4,
  },
  auth: vi.fn().mockResolvedValue({
    user: {
      id: '65a1b2c3d4e5f6a7b8c9d0e1',
      role: 'reader',
      tenantId: 'tenant-alpha',
      email: 'tenant-test@example.com',
    },
  }),
}));

// Mock MongoDB to use in-memory database from tests/setup.ts.
vi.mock('@/lib/mongodb', async () => {
  const { getTestDb } = await import('../setup');
  return {
    getDb: vi.fn().mockImplementation(async () => getTestDb()),
    getReadDb: vi.fn().mockImplementation(async () => getTestDb()),
    connectToDatabase: vi.fn(),
    isConnectionError: vi.fn().mockReturnValue(false),
  };
});

import { GET as likesGet } from '@/app/api/[tenant]/likes/route';
import { GET as likesPopularGet } from '@/app/api/[tenant]/likes/popular/route';
import { GET as readingHistoryGet } from '@/app/api/[tenant]/reading-history/route';
import { POST as analyticsTrackPost } from '@/app/api/[tenant]/analytics/track/route';
import { GET as likesMineGet } from '@/app/api/likes/mine/route';
import { GET as bookSearchGet } from '@/app/api/books/[id]/search/route';

function makeGet(url: string, headers?: Record<string, string>): Request {
  return new Request(`http://localhost:3000${url}`, {
    method: 'GET',
    headers: headers || {},
  }) as any;
}

function makePost(url: string, body: object, headers?: Record<string, string>): Request {
  return new Request(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(headers || {}),
    },
    body: JSON.stringify(body),
  }) as any;
}

async function waitForReadCount(bookId: string, tenantId: string, expected: number): Promise<void> {
  const db = getTestDb();
  const timeoutMs = 1500;
  const intervalMs = 50;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const book = await db.collection('books').findOne({ id: bookId, tenantId });
    if ((book?.read_count || 0) === expected) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for read_count=${expected} on ${tenantId}/${bookId}`);
}

describe('Tenant API isolation', () => {
  beforeEach(async () => {
    await cleanDb();

    const db = getTestDb();
    await db.collection('tenants').insertMany([
      { id: 'tenant-alpha', slug: 'alpha', status: 'active' },
      { id: 'tenant-beta', slug: 'beta', status: 'active' },
    ]);
  });

  it('isolates likes counts/state to the requested tenant', async () => {
    const db = getTestDb();

    // Same target across both tenants; alpha has 2 likes, beta has 1.
    // The authenticated test user (TEST_USER_ID) owns one of the alpha likes
    // so `liked` reflects the server-side session, which takes precedence
    // over any client-supplied visitor_id.
    await db.collection('likes').insertMany([
      { target_type: 'page', target_id: 'page-1', visitor_id: TEST_USER_ID, tenantId: 'tenant-alpha', created_at: new Date() },
      { target_type: 'page', target_id: 'page-1', visitor_id: 'v2', tenantId: 'tenant-alpha', created_at: new Date() },
      { target_type: 'page', target_id: 'page-1', visitor_id: 'v3', tenantId: 'tenant-beta', created_at: new Date() },
    ]);

    const targets = encodeURIComponent(JSON.stringify([{ type: 'page', id: 'page-1' }]));
    // visitor_id=spoofed is ignored — auth() wins, so liked is computed for TEST_USER_ID.
    const req = makeGet(`/api/alpha/likes?targets=${targets}&visitor_id=spoofed`);

    const res = await likesGet(req as any, { params: Promise.resolve({ tenant: 'alpha' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.results['page:page-1'].count).toBe(2);
    expect(data.results['page:page-1'].liked).toBe(true);
  });

  it('isolates popular likes results to the requested tenant', async () => {
    const db = getTestDb();

    await db.collection('books').insertMany([
      { id: 'book-1', title: 'Alpha Book', tenantId: 'tenant-alpha' },
      { id: 'book-1', title: 'Beta Book', tenantId: 'tenant-beta' },
    ]);

    await db.collection('likes').insertMany([
      { target_type: 'book', target_id: 'book-1', visitor_id: 'a1', tenantId: 'tenant-alpha', created_at: new Date() },
      { target_type: 'book', target_id: 'book-1', visitor_id: 'a2', tenantId: 'tenant-alpha', created_at: new Date() },
      { target_type: 'book', target_id: 'book-1', visitor_id: 'b1', tenantId: 'tenant-beta', created_at: new Date() },
      { target_type: 'book', target_id: 'book-1', visitor_id: 'b2', tenantId: 'tenant-beta', created_at: new Date() },
      { target_type: 'book', target_id: 'book-1', visitor_id: 'b3', tenantId: 'tenant-beta', created_at: new Date() },
    ]);

    const req = makeGet('/api/alpha/likes/popular?type=book&limit=5');
    const res = await likesPopularGet(req as any, { params: Promise.resolve({ tenant: 'alpha' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(1);
    expect(data.items[0].id).toBe('book-1');
    expect(data.items[0].likeCount).toBe(2);
    expect(data.items[0].title).toBe('Alpha Book');
  });

  it('isolates reading history entries and joined book data by tenant', async () => {
    const db = getTestDb();

    await db.collection('books').insertMany([
      { id: 'book-1', title: 'Alpha Reading', tenantId: 'tenant-alpha' },
      { id: 'book-1', title: 'Beta Reading', tenantId: 'tenant-beta' },
    ]);

    await db.collection('reading_history').insertMany([
      {
        user_id: TEST_USER_ID,
        tenantId: 'tenant-alpha',
        book_id: 'book-1',
        first_page_id: 'p1',
        first_page_number: 1,
        last_page_id: 'p2',
        last_page_number: 2,
        pages_viewed: 2,
        pages_read: [{ page_id: 'p1', page_number: 1 }],
        started_at: new Date(),
        updated_at: new Date(),
      },
      {
        user_id: TEST_USER_ID,
        tenantId: 'tenant-beta',
        book_id: 'book-1',
        first_page_id: 'p3',
        first_page_number: 3,
        last_page_id: 'p4',
        last_page_number: 4,
        pages_viewed: 2,
        pages_read: [{ page_id: 'p3', page_number: 3 }],
        started_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const req = makeGet('/api/alpha/reading-history?limit=20&offset=0');
    const res = await readingHistoryGet(req as any, { params: Promise.resolve({ tenant: 'alpha' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(1);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].book_id).toBe('book-1');
    expect(data.entries[0].book.title).toBe('Alpha Reading');
  });

  it('tracks analytics events and counter updates only within the requested tenant', async () => {
    const db = getTestDb();

    await db.collection('books').insertMany([
      { id: 'book-1', tenantId: 'tenant-alpha', read_count: 0 },
      { id: 'book-1', tenantId: 'tenant-beta', read_count: 0 },
    ]);

    const req = makePost(
      '/api/alpha/analytics/track',
      { event: 'book_read', book_id: 'book-1' },
      { 'x-forwarded-for': '203.0.113.10' }
    );

    const res = await analyticsTrackPost(req as any, { params: Promise.resolve({ tenant: 'alpha' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    await waitForReadCount('book-1', 'tenant-alpha', 1);

    const alphaBook = await db.collection('books').findOne({ id: 'book-1', tenantId: 'tenant-alpha' });
    const betaBook = await db.collection('books').findOne({ id: 'book-1', tenantId: 'tenant-beta' });

    expect(alphaBook?.read_count).toBe(1);
    expect(betaBook?.read_count).toBe(0);

    const alphaEvents = await db.collection('analytics_events').find({ tenantId: 'tenant-alpha' }).toArray();
    const betaEvents = await db.collection('analytics_events').find({ tenantId: 'tenant-beta' }).toArray();

    expect(alphaEvents).toHaveLength(1);
    expect(alphaEvents[0].book_id).toBe('book-1');
    expect(betaEvents).toHaveLength(0);
  });

  it('isolates root likes/mine results by proxy-injected tenant headers', async () => {
    const db = getTestDb();

    await db.collection('books').insertMany([
      { id: 'book-a', title: 'Alpha Favorites', tenantId: 'tenant-alpha' },
      { id: 'book-b', title: 'Beta Favorites', tenantId: 'tenant-beta' },
    ]);

    // Likes filed under the authenticated user — auth() now wins over the
    // visitor_id query param, so the favorites listing follows the session.
    await db.collection('likes').insertMany([
      { target_type: 'book', target_id: 'book-a', visitor_id: TEST_USER_ID, tenantId: 'tenant-alpha', created_at: new Date() },
      { target_type: 'book', target_id: 'book-b', visitor_id: TEST_USER_ID, tenantId: 'tenant-beta', created_at: new Date() },
    ]);

    const req = makeGet('/api/likes/mine?visitor_id=spoofed&type=book', {
      'x-tenant-slug': 'alpha',
      'x-tenant-id': 'tenant-alpha',
    });

    const res = await likesMineGet(req as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(1);
    expect(data.items[0].id).toBe('book-a');
    expect(data.items[0].title).toBe('Alpha Favorites');
  });

  it('isolates root per-book page search by proxy-injected tenant headers', async () => {
    const db = getTestDb();

    await db.collection('pages').insertMany([
      {
        id: 'alpha-page-1',
        book_id: 'book-1',
        page_number: 1,
        tenantId: 'tenant-alpha',
        ocr: { data: 'Arcana alchemy mercury sulfur salt' },
      },
      {
        id: 'beta-page-1',
        book_id: 'book-1',
        page_number: 1,
        tenantId: 'tenant-beta',
        ocr: { data: 'Arcana alchemy mercury sulfur salt' },
      },
    ]);

    const req = makeGet('/api/books/book-1/search?q=alchemy', {
      'x-tenant-slug': 'alpha',
      'x-tenant-id': 'tenant-alpha',
    });

    const res = await bookSearchGet(req as any, { params: Promise.resolve({ id: 'book-1' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.results).toHaveLength(1);
    expect(data.results[0].pageId).toBe('alpha-page-1');
  });
});
