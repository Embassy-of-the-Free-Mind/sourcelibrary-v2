import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The three public, unauthenticated submission inboxes must be rate limited
 * (#3509). They are the only write surfaces on the site a stranger can reach
 * with no credential of any kind, and each one lands in a queue a human reads.
 *
 * The routes are exercised for real; only the limiter and the database are
 * faked. Removing the `guardPublicSubmission` call from any of them turns its
 * case red — verified by deleting each one in turn.
 */

let denied = false;

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return {
    ...actual,
    checkRateLimitShared: vi.fn(async () =>
      denied ? { allowed: false as const, retryAfter: 900 } : { allowed: true as const },
    ),
  };
});

// Each route also exports an admin-only GET. Only POST is under test here, and
// importing the real wrapper drags in next-auth, which will not load under
// vitest.
vi.mock('@/lib/auth-helpers', () => ({
  withAdminAuth: (h: unknown) => h,
}));

const inserted: Record<string, unknown[]> = {};

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: (name: string) => ({
      insertOne: async (doc: unknown) => {
        (inserted[name] ??= []).push(doc);
        return { insertedId: 'inserted-1' };
      },
      updateOne: async () => ({ matchedCount: 1 }),
      findOne: async () => null,
      find: () => ({ toArray: async () => [] }),
      countDocuments: async () => 0,
    }),
  })),
}));

const ROUTES = [
  {
    name: 'POST /api/feedback',
    load: () => import('@/app/api/feedback/route'),
    body: { message: 'The translation on this page drops a whole line.' },
  },
  {
    name: 'POST /api/share-findings',
    load: () => import('@/app/api/share-findings/route'),
    body: {
      title: 'Mercury in the Ripley scrolls',
      summary: 'A thread across three books.',
      citations: [{ book_id: 'book-1', page: 12, note: 'the sealed vessel' }],
    },
  },
  {
    name: 'POST /api/collection-proposals',
    load: () => import('@/app/api/collection-proposals/route'),
    body: {
      title: 'Alchemical Emblems',
      rationale: 'These plates belong together.',
      book_ids: ['book-1', 'book-2'],
    },
  },
];

async function post(r: (typeof ROUTES)[number]) {
  const { POST } = await r.load();
  const req = new Request('https://sourcelibrary.org/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    body: JSON.stringify(r.body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (POST as any)(req);
}

describe('public submission inboxes are rate limited (#3509)', () => {
  beforeEach(() => {
    denied = false;
    for (const k of Object.keys(inserted)) delete inserted[k];
  });

  for (const r of ROUTES) {
    it(`${r.name} returns 429 once the limit is hit`, async () => {
      denied = true;
      const res = await post(r);
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBe('900');
    });

    it(`${r.name} writes nothing when refused`, async () => {
      denied = true;
      await post(r);
      // The whole point is keeping spam out of a human's queue, so the refusal
      // has to happen before the insert, not alongside it.
      expect(Object.values(inserted).flat()).toEqual([]);
    });

    it(`${r.name} still accepts a submission under the limit`, async () => {
      denied = false;
      const res = await post(r);
      expect(res.status).not.toBe(429);
      expect(Object.values(inserted).flat().length).toBeGreaterThan(0);
    });
  }

  it('keys the limiter on the CDN-aware client IP, not x-forwarded-for', async () => {
    const { checkRateLimitShared } = await import('@/lib/rate-limit');
    denied = false;
    const { POST } = await ROUTES[0].load();
    const req = new Request('https://sourcelibrary.org/api/feedback', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // What a real request looks like behind Cloudflare: x-forwarded-for is
        // a Cloudflare edge node, and using it would bucket unrelated readers
        // together (#3491).
        'cf-connecting-ip': '203.0.113.9',
        'x-forwarded-for': '172.68.1.1',
      },
      body: JSON.stringify({ message: 'A note from a reader.' }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (POST as any)(req);
    expect(checkRateLimitShared).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'feedback' }),
      '203.0.113.9',
    );
  });
});

describe('the public submission route list stays complete', () => {
  /**
   * Scoped deliberately to the three inboxes #3509 is about — the ones that
   * take a submission from an anonymous stranger and put it in front of a
   * person. It is NOT a sweep of every unauthenticated POST in the app: a
   * first draft of this test tried that and surfaced ~20 routes that
   * authenticate inside the handler, verify a webhook signature, or write
   * telemetry. Auditing those is real work and has its own issue; pretending
   * this test covers them would be the more dangerous outcome.
   */
  it('each anonymous submission inbox calls the shared guard', async () => {
    const { readFileSync } = await import('node:fs');

    const inboxes = [
      'src/app/api/feedback/route.ts',
      'src/app/api/share-findings/route.ts',
      'src/app/api/collection-proposals/route.ts',
    ];

    for (const f of inboxes) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} no longer calls guardPublicSubmission`).toContain(
        'guardPublicSubmission(request,',
      );
    }

    // The behavioural cases above cover the same three routes. If that list and
    // this one drift apart, one of them is no longer testing what it claims.
    expect(ROUTES.length).toBe(inboxes.length);
  });
});
