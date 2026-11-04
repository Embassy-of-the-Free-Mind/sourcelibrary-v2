import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  ANON_EMBED_DAILY_BOOK_CAP,
  isPartnerEmbedDownloadFor,
  partnerEmbedTenantFromLocation,
  partnerEmbedTenantFromRequest,
} from '@/lib/partner-embed-download';

/**
 * #7702. Inside the EFM embed nobody can sign in (the sign-in page is DENY in
 * a frame, the session cookie is SameSite=Lax), so the EFM's own books
 * download anonymously there, under a per-IP cap. Everywhere else an
 * anonymous download is still a 401. The route cases drive the REAL route
 * modules; only auth() and the database are faked.
 */

const BPH_ID = 'bce03f71-c18d-4460-b8ad-224c817f9aa0';
const EFM_BOOK = { id: 'efm-book', slug: 'efm-book', title: 'An EFM book', tenantId: BPH_ID, visible: true, pages_count: 1 };
const OTHER_BOOK = { id: 'other-book', slug: 'other-book', title: 'Not EFM', visible: true, pages_count: 1 };
const EMBED_REF = 'https://sourcelibrary.org/embed/bph/book/efm-book';

describe('partnerEmbedTenantFromRequest', () => {
  it('reads the embed path from a sourcelibrary.org Referer', () => {
    expect(partnerEmbedTenantFromRequest('sourcelibrary.org', EMBED_REF)).toBe('bph');
    expect(partnerEmbedTenantFromRequest('sourcelibrary.org', 'https://www.sourcelibrary.org/embed/bph')).toBe('bph');
  });
  it('accepts the partner subdomain host itself', () => {
    expect(partnerEmbedTenantFromRequest('bph.sourcelibrary.org', null)).toBe('bph');
    expect(partnerEmbedTenantFromRequest('bph.sourcelibrary.org:443', 'https://bph.sourcelibrary.org/book/x')).toBe('bph');
  });
  it('accepts an embed Referer on the request\'s own host (preview deploys)', () => {
    expect(partnerEmbedTenantFromRequest('sl-git-x.vercel.app', 'https://sl-git-x.vercel.app/embed/bph/book/x')).toBe('bph');
  });
  it('refuses the main site, no Referer, foreign hosts and other tenants', () => {
    expect(partnerEmbedTenantFromRequest('sourcelibrary.org', 'https://sourcelibrary.org/book/efm-book')).toBeNull();
    expect(partnerEmbedTenantFromRequest('sourcelibrary.org', null)).toBeNull();
    expect(partnerEmbedTenantFromRequest('sourcelibrary.org', 'https://evil.example/embed/bph/book/x')).toBeNull();
    expect(partnerEmbedTenantFromRequest('sourcelibrary.org', 'https://sourcelibrary.org/embed/kloss/book/x')).toBeNull();
    expect(partnerEmbedTenantFromRequest('kloss.sourcelibrary.org', null)).toBeNull();
    expect(partnerEmbedTenantFromRequest('www.sourcelibrary.org', null)).toBeNull();
    expect(partnerEmbedTenantFromRequest('sourcelibrary.org', 'not a url')).toBeNull();
  });
});

describe('partnerEmbedTenantFromLocation (client)', () => {
  it('matches the embed path and the subdomain, not the main site', () => {
    expect(partnerEmbedTenantFromLocation('sourcelibrary.org', '/embed/bph/book/x/page/1')).toBe('bph');
    expect(partnerEmbedTenantFromLocation('bph.sourcelibrary.org', '/book/x')).toBe('bph');
    expect(partnerEmbedTenantFromLocation('sourcelibrary.org', '/book/x')).toBeNull();
  });
});

describe('isPartnerEmbedDownloadFor', () => {
  const tenantIds = { bph: BPH_ID };
  it('EFM book + embed Referer → true', () => {
    expect(isPartnerEmbedDownloadFor({ host: 'sourcelibrary.org', referer: EMBED_REF, bookTenantId: BPH_ID, tenantIds })).toBe(true);
  });
  it('non-EFM book → false', () => {
    expect(isPartnerEmbedDownloadFor({ host: 'sourcelibrary.org', referer: EMBED_REF, bookTenantId: undefined, tenantIds })).toBe(false);
    expect(isPartnerEmbedDownloadFor({ host: 'sourcelibrary.org', referer: EMBED_REF, bookTenantId: 'another-tenant', tenantIds })).toBe(false);
  });
  it('sourcelibrary.org Referer → false', () => {
    expect(isPartnerEmbedDownloadFor({ host: 'sourcelibrary.org', referer: 'https://sourcelibrary.org/book/efm-book', bookTenantId: BPH_ID, tenantIds })).toBe(false);
  });
  it('no Referer → false', () => {
    expect(isPartnerEmbedDownloadFor({ host: 'sourcelibrary.org', referer: null, bookTenantId: BPH_ID, tenantIds })).toBe(false);
  });
  it('unresolved tenant id → false (fails closed)', () => {
    expect(isPartnerEmbedDownloadFor({ host: 'sourcelibrary.org', referer: EMBED_REF, bookTenantId: BPH_ID, tenantIds: {} })).toBe(false);
  });
});

// ── Route cases ──────────────────────────────────────────────────────────────

let events: { user_id: string; book_id: string; ts: Date }[] = [];

vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('@/lib/auth-helpers', () => ({ isInnerCircle: vi.fn(async () => false) }));
vi.mock('@/lib/book-access', () => ({ isBookReadable: vi.fn(async () => true) }));
vi.mock('@/lib/tenant-context', () => ({
  resolveTenantId: vi.fn(async (slug: string) => (slug === 'bph' ? BPH_ID : null)),
}));
vi.mock('@/lib/mongodb', () => {
  const books = [EFM_BOOK, OTHER_BOOK];
  const match = (doc: Record<string, unknown>, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([k, v]) => doc[k] === v);
  const db = {
    collection: (name: string) => {
      if (name === 'books') {
        return { findOne: async (f: Record<string, unknown>) => books.find(b => match(b, f)) ?? null };
      }
      if (name === 'download_events') {
        return {
          distinct: async (_field: string, f: { user_id: string }) =>
            [...new Set(events.filter(e => e.user_id === f.user_id).map(e => e.book_id))],
          insertOne: async (doc: { user_id: string; book_id: string; ts: Date }) => { events.push(doc); },
        };
      }
      return {
        findOne: async () => null,
        find: () => ({ sort: () => ({ toArray: async () => [] }), toArray: async () => [] }),
      };
    },
  };
  return { getDb: vi.fn(async () => db), getReadDb: vi.fn(async () => db) };
});

function req(url: string, referer?: string): NextRequest {
  const headers: Record<string, string> = { host: 'sourcelibrary.org', 'x-forwarded-for': '203.0.113.7' };
  if (referer) headers.referer = referer;
  return new NextRequest(url, { headers });
}

const download = async (bookId: string, format: string, referer?: string) => {
  const { GET } = await import('@/app/api/books/[id]/download/route');
  return GET(req(`https://sourcelibrary.org/api/books/${bookId}/download?format=${format}`, referer), { params: Promise.resolve({ id: bookId }) });
};
const tenantDownload = async (bookId: string, format: string, referer?: string) => {
  const { GET } = await import('@/app/api/[tenant]/books/[id]/download/route');
  return GET(req(`https://sourcelibrary.org/api/bph/books/${bookId}/download?format=${format}`, referer), { params: Promise.resolve({ tenant: 'bph', id: bookId }) });
};
const pagePackage = async (bookId: string, referer?: string) => {
  const { GET } = await import('@/app/api/books/[id]/pages/[pageId]/package/route');
  return GET(req(`https://sourcelibrary.org/api/books/${bookId}/pages/p1/package`, referer), { params: Promise.resolve({ id: bookId, pageId: 'p1' }) });
};

describe('download routes: anonymous outside the embed is still 401', () => {
  beforeEach(() => { events = []; });

  for (const [name, call] of [['global', download], ['tenant', tenantDownload]] as const) {
    it(`${name}: EFM book with no Referer → 401`, async () => {
      expect((await call('efm-book', 'translation')).status).toBe(401);
    });
    it(`${name}: EFM book from the main site → 401`, async () => {
      expect((await call('efm-book', 'translation', 'https://sourcelibrary.org/book/efm-book')).status).toBe(401);
    });
    it(`${name}: premium format from the embed → 401 (paid tier unchanged)`, async () => {
      expect((await call('efm-book', 'pdf-facsimile', EMBED_REF)).status).toBe(401);
    });
    it(`${name}: EFM book from the embed passes the gate and is counted per IP`, async () => {
      const res = await call('efm-book', 'translation', EMBED_REF);
      expect([401, 429]).not.toContain(res.status);
      expect(events).toHaveLength(1);
      expect(events[0].user_id).toMatch(/^anon-ip:[0-9a-f]{32}$/);
      expect(events[0].user_id).not.toContain('203.0.113.7');
    });
    it(`${name}: the anonymous cap is ${ANON_EMBED_DAILY_BOOK_CAP} books → 429`, async () => {
      await call('efm-book', 'translation', EMBED_REF);
      const key = events[0].user_id;
      for (let i = 1; i < ANON_EMBED_DAILY_BOOK_CAP; i++) events.push({ user_id: key, book_id: `b${i}`, ts: new Date() });
      events = events.filter(e => e.book_id !== 'efm-book');
      events.push({ user_id: key, book_id: 'b-last', ts: new Date() });
      expect((await call('efm-book', 'translation', EMBED_REF)).status).toBe(429);
    });
  }

  it('global: non-EFM book from the embed → 401', async () => {
    expect((await download('other-book', 'translation', EMBED_REF)).status).toBe(401);
  });

  it('page package: anonymous with no Referer → 401', async () => {
    expect((await pagePackage('efm-book')).status).toBe(401);
  });
  it('page package: non-EFM book from the embed → 401', async () => {
    expect((await pagePackage('other-book', EMBED_REF)).status).toBe(401);
  });
  it('page package: EFM book from the embed passes the gate', async () => {
    // No page exists in the fake db, so a passed gate surfaces as the 404.
    expect((await pagePackage('efm-book', EMBED_REF)).status).toBe(404);
  });
});
