import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Public GET routes serve published books only, and pipeline figures need a
 * staff sign-in (ops #17).
 *
 * Every case drives the REAL route handler. Only the session (`auth()`), the
 * database and the vector store are faked, and the fake database evaluates the
 * filter it is handed, so a case passes because the unpublished row was left
 * out of the answer, not because a filter is spelled a certain way. Each case
 * was run against a copy of its route with the change reverted and went red.
 *
 * Fixture: PUBLIC is a published book (`visible: true`, pages), HIDDEN is a
 * withdrawn one (`visible: false`). Both carry the same category, collection,
 * likes, revisions and edition, so the only thing that tells them apart is the
 * publication state.
 */

type Doc = Record<string, unknown>;

// ── session ──
let session: { user: Doc; expires: string } | null = null;
const ROLE_LEVEL = { reader: 1, contributor: 2, editor: 3, admin: 4, superadmin: 5 };
vi.mock('@/lib/auth', () => ({ ROLE_LEVEL, auth: vi.fn(async () => session) }));

// ── a small Mongo: filters are evaluated, not recorded ──
function values(doc: unknown, path: string[]): unknown[] {
  if (path.length === 0) return Array.isArray(doc) ? [doc, ...doc] : [doc];
  if (Array.isArray(doc)) return /^\d+$/.test(path[0]) ? values(doc[Number(path[0])], path.slice(1)) : doc.flatMap((d) => values(d, path));
  if (doc == null || typeof doc !== 'object') return [undefined];
  return values((doc as Doc)[path[0]], path.slice(1));
}
function operand(doc: Doc, v: unknown): unknown {
  return typeof v === 'string' && v.startsWith('$') ? values(doc, v.slice(1).split('.'))[0] : v;
}
function expr(doc: Doc, e: Doc): boolean {
  const [[op, args]] = Object.entries(e) as [string, unknown[]][];
  const [a, b] = args.map((x) => operand(doc, x)) as number[];
  if (op === '$lt') return (a ?? 0) < (b ?? 0);
  if (op === '$eq') return a === b;
  throw new Error(`fake mongo: $expr ${op}`);
}
function test1(v: unknown, cond: unknown): boolean {
  if (cond instanceof RegExp) return typeof v === 'string' && cond.test(v);
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && Object.keys(cond).some((k) => k.startsWith('$'))) {
    return Object.entries(cond as Doc).every(([op, x]) => {
      switch (op) {
        case '$in': return (x as unknown[]).includes(v);
        case '$nin': return !(x as unknown[]).includes(v);
        case '$ne': return v !== x;
        case '$gt': return v != null && (v as number) > (x as number);
        case '$gte': return v != null && (v as number) >= (x as number);
        case '$lt': return v != null && (v as number) < (x as number);
        case '$lte': return v != null && (v as number) <= (x as number);
        case '$exists': return (v !== undefined) === x;
        case '$regex': return typeof v === 'string' && new RegExp(x as string).test(v);
        default: throw new Error(`fake mongo: ${op}`);
      }
    });
  }
  return cond === null ? v == null : v === cond;
}
function matches(doc: Doc, filter: Doc, vars: Doc = {}): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === '$or') return (cond as Doc[]).some((f) => matches(doc, f, vars));
    if (k === '$and') return (cond as Doc[]).every((f) => matches(doc, f, vars));
    if (k === '$expr') return expr({ ...doc, ...vars }, cond as Doc);
    const vs = values(doc, k.split('.'));
    const negative = cond !== null && typeof cond === 'object' && ('$ne' in (cond as Doc) || '$nin' in (cond as Doc));
    return negative ? vs.every((v) => test1(v, cond)) : vs.some((v) => test1(v, cond));
  });
}

let store: Record<string, Doc[]> = {};
/** Answers for aggregations this fake does not evaluate ($group over likes). */
let aggregateAnswer: Record<string, Doc[]> = {};
/** The largest `.limit()` a route asked for, per collection. */
let limitsAsked: Record<string, number[]> = {};

function cursor(name: string, rows: Doc[]) {
  const c = {
    project: () => c,
    sort: () => c,
    maxTimeMS: () => c,
    skip: (n: number) => { rows = rows.slice(n); return c; },
    limit: (n: number) => { (limitsAsked[name] ||= []).push(n); if (n > 0) rows = rows.slice(0, n); return c; },
    toArray: async () => rows,
  };
  return c;
}
function runPipeline(name: string, pipeline: Doc[]): Doc[] {
  let rows = store[name] || [];
  for (const stage of pipeline) {
    const [[op, arg]] = Object.entries(stage) as [string, Doc][];
    if (op === '$match') rows = rows.filter((d) => matches(d, arg));
    else if (op === '$limit') rows = rows.slice(0, arg as unknown as number);
    else if (op === '$lookup') {
      rows = rows.map((d) => {
        const from = store[arg.from as string] || [];
        let joined: Doc[];
        if (arg.pipeline) {
          const vars = Object.fromEntries(Object.entries((arg.let as Doc) || {}).map(([k, v]) => [`$${k}`, operand(d, v)]));
          const m = (arg.pipeline as Doc[]).find((s) => '$match' in s)!.$match as Doc;
          joined = from.filter((f) => matches(f, m, vars));
        } else {
          joined = from.filter((f) => f[arg.foreignField as string] === d[arg.localField as string]);
        }
        return { ...d, [arg.as as string]: joined };
      });
    } else if (op === '$unwind') {
      const field = (arg as unknown as string).slice(1);
      rows = rows.flatMap((d) => ((d[field] as Doc[]) || []).map((x) => ({ ...d, [field]: x })));
    }
    // $addFields, $project, $sort: not needed to tell which books come back.
  }
  return rows;
}
const fakeDb = {
  collection: (name: string) => ({
    findOne: async (filter: Doc = {}) => (store[name] || []).find((d) => matches(d, filter)) ?? null,
    find: (filter: Doc = {}) => cursor(name, (store[name] || []).filter((d) => matches(d, filter))),
    countDocuments: async (filter: Doc = {}) => (store[name] || []).filter((d) => matches(d, filter)).length,
    aggregate: (pipeline: Doc[]) => ({
      toArray: async () => aggregateAnswer[name] ?? runPipeline(name, pipeline),
    }),
  }),
};
vi.mock('@/lib/mongodb', () => ({
  getDb: async () => fakeDb,
  getReadDb: async () => fakeDb,
  default: Promise.resolve({ db: () => fakeDb }),
}));

// ── tenant and vector store ──
vi.mock('@/lib/tenant-context', async (orig) => ({
  ...(await orig<typeof import('@/lib/tenant-context')>()),
  resolveTenantId: async (slug: string) => (slug === 'default' ? 'tenant-1' : null),
}));
let clipTarget: Doc | null = null;
let clipRows: Doc[] = [];
vi.mock('@/lib/supabase', () => {
  const q = { select: () => q, eq: () => q, single: async () => ({ data: clipTarget }) };
  return { supabase: { from: () => q } };
});
vi.mock('@/lib/tenant-search-scope', () => ({
  resolveSearchScope: async () => ({ kind: 'global' }),
  closedScopeResponse: () => { throw new Error('scope is global in this test'); },
  matchClip: async () => ({ rows: clipRows }),
  matchGalleryText: async () => ({ rows: [] }),
}));

// ── fixture ──
const EDITION = { version: '1.0.0', published_at: '2026-01-01T00:00:00Z', page_ids: ['pub-p1', 'hid-p1'] };
const VOCAB = (tag: string) =>
  ['alpha', 'beta', 'gamma', 'delta']
    .map((t) => `The <term>${tag}${t}</term> <note>${tag} meaning of ${t} in this text</note> appears here.`)
    .join(' ');

function seed() {
  const book = (id: string, visible: boolean): Doc => ({
    id, slug: `${id}-slug`, title: `${id} title`, author: `${id} author`, tenantId: 'tenant-1',
    visible, pages_count: 10, pages_ocr: 4, pages_translated: 2,
    categories: ['alchemy'], collections: ['hermetica'], held_by: 'bph', editions: [EDITION],
  });
  const page = (bookId: string, prefix: string, tag: string): Doc => ({
    _id: `oid-${prefix}`, id: `${prefix}-p1`, book_id: bookId, page_number: 1, tenantId: 'tenant-1',
    translation: { data: VOCAB(tag) }, ocr: { data: `${tag} ocr text` },
    detected_images: [{ type: 'engraving', description: `${tag} image`, gallery_quality: 0.9, bbox: { x: 0, y: 0, width: 1, height: 1 }, metadata: { subjects: ['sun'] } }],
  });
  store = {
    books: [book('PUBLIC', true), book('HIDDEN', false), book('OTHER', true)],
    pages: [
      page('PUBLIC', 'pub', 'pub'), page('HIDDEN', 'hid', 'hid'),
      // The image a reader is looking at when asking for similar ones.
      { ...page('OTHER', 'oth', 'oth') },
    ],
    page_revisions: [
      { id: 'rev-pub', page_id: 'pub-p1', field: 'translation', data: 'pub earlier text', created_at: new Date('2025-01-01') },
      { id: 'rev-hid', page_id: 'hid-p1', field: 'translation', data: 'hid earlier text', created_at: new Date('2025-01-01') },
    ],
    gallery_images: [
      { page_id: 'pub-p1', book_id: 'PUBLIC', book_title: 'PUBLIC title', book_visible: true, gallery_quality: 0.9, updated_at: new Date() },
      { page_id: 'hid-p1', book_id: 'HIDDEN', book_title: 'HIDDEN title', book_visible: false, gallery_quality: 0.9, updated_at: new Date() },
    ],
    collections: [
      { slug: 'hermetica', name: 'Hermetica', visible: true },
      { slug: 'withdrawn-shelf', name: 'Withdrawn shelf', description: 'not for readers', visible: false },
    ],
  };
  aggregateAnswer = {};
  limitsAsked = {};
  clipTarget = null;
  clipRows = [];
  session = null;
}

beforeEach(() => {
  seed();
  vi.stubEnv('CRON_SECRET', 'test-cron-secret');
  vi.stubEnv('METERED_READER', '');
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function get(
  load: () => Promise<unknown>,
  url: string,
  params: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  const { GET } = (await load()) as { GET: Handler };
  const res = await GET(new NextRequest(`https://sourcelibrary.org${url}`, { headers }), { params: Promise.resolve(params) });
  const text = await res.text();
  return { status: res.status, text };
}

describe('book lists hold published books only', () => {
  it('GET /api/contribute/books lists the published book and caps the limit', async () => {
    const r = await get(() => import('@/app/api/contribute/books/route'), '/api/contribute/books?type=ocr&limit=100000');
    expect(r.status).toBe(200);
    expect(r.text).toContain('PUBLIC title');
    expect(r.text).not.toContain('HIDDEN');
    expect(Math.max(...limitsAsked.books)).toBeLessThanOrEqual(200);

    const t = await get(() => import('@/app/api/contribute/books/route'), '/api/contribute/books?type=translation');
    expect(t.text).toContain('PUBLIC title');
    expect(t.text).not.toContain('HIDDEN');
  });

  it('GET /api/categories/[id]', async () => {
    const r = await get(() => import('@/app/api/categories/[id]/route'), '/api/categories/alchemy', { id: 'alchemy' });
    expect(r.status).toBe(200);
    expect(r.text).toContain('PUBLIC title');
    expect(r.text).not.toContain('HIDDEN');
  });

  it('GET /api/catalog', async () => {
    const r = await get(() => import('@/app/api/catalog/route'), '/api/catalog');
    expect(r.status).toBe(200);
    expect(r.text).toContain('PUBLIC title');
    expect(r.text).not.toContain('HIDDEN');
  });

  it('GET /api/dts/collection lists a collection\'s published members', async () => {
    const r = await get(() => import('@/app/api/dts/collection/route'), '/api/dts/collection?id=hermetica');
    expect(r.status).toBe(200);
    expect(r.text).toContain('PUBLIC title');
    expect(r.text).not.toContain('HIDDEN');
  });

  it('GET /api/embed/bph/featured never asks for an unlimited list', async () => {
    const r = await get(() => import('@/app/api/embed/bph/featured/route'), '/api/embed/bph/featured?limit=0');
    expect(r.status).toBe(200);
    expect(limitsAsked.books.length).toBeGreaterThan(0);
    for (const n of limitsAsked.books) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(24);
    }
  });
});

describe('collections, feeds and likes', () => {
  it('GET /api/collections/[id] does not serve a withdrawn collection', async () => {
    const load = () => import('@/app/api/collections/[id]/route');
    const hidden = await get(load, '/api/collections/withdrawn-shelf?mode=manifest', { id: 'withdrawn-shelf' });
    expect(hidden.status).toBe(404);
    expect(hidden.text).not.toContain('not for readers');
    const open = await get(load, '/api/collections/hermetica?mode=manifest', { id: 'hermetica' });
    expect(open.status).not.toBe(404);
  });

  it('GET /api/feed/gallery', async () => {
    const r = await get(() => import('@/app/api/feed/gallery/route'), '/api/feed/gallery');
    expect(r.status).toBe(200);
    expect(r.text).toContain('PUBLIC title');
    expect(r.text).not.toContain('HIDDEN');
  });

  for (const [name, load, params] of [
    ['GET /api/likes/popular', () => import('@/app/api/likes/popular/route'), {}],
    ['GET /api/[tenant]/likes/popular', () => import('@/app/api/[tenant]/likes/popular/route'), { tenant: 'default' }],
  ] as const) {
    it(`${name} leaves out pages and books of an unpublished book`, async () => {
      aggregateAnswer.likes = [{ _id: 'pub-p1', count: 3 }, { _id: 'hid-p1', count: 9 }];
      const pages = await get(load, '/api/likes/popular?type=page', params);
      expect(pages.status).toBe(200);
      expect(pages.text).toContain('pub-p1');
      expect(pages.text).not.toContain('hid');
      expect(pages.text).not.toContain('HIDDEN');

      aggregateAnswer.likes = [{ _id: 'PUBLIC', count: 3 }, { _id: 'HIDDEN', count: 9 }];
      aggregateAnswer.gallery_images = [];
      const books = await get(load, '/api/likes/popular?type=book', params);
      expect(books.text).toContain('PUBLIC title');
      expect(books.text).not.toContain('HIDDEN');
    });
  }

  it('GET /api/gallery/similar (nearest images) keeps to published books', async () => {
    clipTarget = { embedding: [0.1, 0.2], book_id: 'OTHER' };
    clipRows = [
      { id: 'gallery-pub-p1-0', source_type: 'gallery_image', book_id: 'PUBLIC', similarity: 0.9 },
      { id: 'gallery-hid-p1-0', source_type: 'gallery_image', book_id: 'HIDDEN', similarity: 0.8 },
    ];
    // Three more published books, so the nearest-image answer is used as it stands.
    for (const n of [1, 2, 3]) {
      store.books.push({ id: `MORE${n}`, title: `MORE${n} title`, visible: true, pages_count: 5 });
      store.pages.push({ id: `more${n}-p1`, book_id: `MORE${n}`, page_number: 1, detected_images: [{ type: 'engraving', description: 'x' }] });
      clipRows.push({ id: `gallery-more${n}-p1-0`, source_type: 'gallery_image', book_id: `MORE${n}`, similarity: 0.5 });
    }
    const r = await get(() => import('@/app/api/gallery/similar/route'), '/api/gallery/similar?id=oth-p1-0');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text).method).toBe('clip');
    expect(r.text).toContain('PUBLIC title');
    expect(r.text).not.toContain('HIDDEN');
  });

  it('GET /api/gallery/similar (shared subjects) keeps to published books', async () => {
    const r = await get(() => import('@/app/api/gallery/similar/route'), '/api/gallery/similar?id=oth-p1-0');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text).method).toBe('metadata');
    expect(r.text).toContain('PUBLIC title');
    expect(r.text).not.toContain('HIDDEN');
  });

  it('GET /api/learn draws vocabulary from published books', async () => {
    const r = await get(() => import('@/app/api/learn/route'), '/api/learn?mode=vocab&count=8');
    expect(r.status).toBe(200);
    expect(r.text).toContain('pubalpha');
    expect(r.text).not.toContain('hid');
    expect(r.text).not.toContain('HIDDEN');
  });
});

describe('page text follows the book\'s reader gate', () => {
  const bearer = { authorization: 'Bearer test-cron-secret' };

  it('GET /api/books/[id]/edition-page', async () => {
    const load = () => import('@/app/api/books/[id]/edition-page/route');
    const open = await get(load, '/api/books/PUBLIC/edition-page?v=1.0.0&page_id=pub-p1', { id: 'PUBLIC' });
    expect(open.status).toBe(200);
    expect(open.text).toContain('pubalpha');

    const hidden = await get(load, '/api/books/HIDDEN/edition-page?v=1.0.0&page_id=hid-p1', { id: 'HIDDEN' });
    expect(hidden.status).toBe(404);
    expect(hidden.text).not.toContain('hidalpha');
    const batch = await get(load, '/api/books/HIDDEN-slug/edition-page?v=1.0.0&page_id=hid-p1,pub-p1', { id: 'HIDDEN-slug' });
    expect(batch.status).toBe(404);

    const pipeline = await get(load, '/api/books/HIDDEN/edition-page?v=1.0.0&page_id=hid-p1', { id: 'HIDDEN' }, bearer);
    expect(pipeline.status).toBe(200);
  });

  for (const [name, load, params] of [
    ['GET /api/pages/[id]/revisions', () => import('@/app/api/pages/[id]/revisions/route'), {}],
    ['GET /api/[tenant]/pages/[id]/revisions', () => import('@/app/api/[tenant]/pages/[id]/revisions/route'), { tenant: 'default' }],
  ] as const) {
    it(name, async () => {
      const open = await get(load, '/api/pages/pub-p1/revisions?field=translation&limit=100000&offset=-5', { ...params, id: 'pub-p1' });
      expect(open.status).toBe(200);
      expect(open.text).toContain('pub earlier text');
      expect(JSON.parse(open.text).limit).toBeLessThanOrEqual(200);
      expect(JSON.parse(open.text).offset).toBe(0);

      const hidden = await get(load, '/api/pages/hid-p1/revisions?field=translation', { ...params, id: 'hid-p1' });
      expect(hidden.status).toBe(404);
      expect(hidden.text).not.toContain('hid earlier text');

      const pipeline = await get(load, '/api/pages/hid-p1/revisions?field=translation', { ...params, id: 'hid-p1' }, bearer);
      expect(pipeline.status).toBe(200);
    });
  }

  it('GET /api/pages/[id]/revisions/[revisionId]', async () => {
    const load = () => import('@/app/api/pages/[id]/revisions/[revisionId]/route');
    const open = await get(load, '/api/pages/pub-p1/revisions/rev-pub', { id: 'pub-p1', revisionId: 'rev-pub' });
    expect(open.status).toBe(200);
    expect(open.text).toContain('pub earlier text');
    // The page in the URL is not what decides: the revision's own page does.
    const hidden = await get(load, '/api/pages/pub-p1/revisions/rev-hid', { id: 'pub-p1', revisionId: 'rev-hid' });
    expect(hidden.status).toBe(404);
    expect(hidden.text).not.toContain('hid earlier text');
  });

  it('GET /api/dts/document', async () => {
    const load = () => import('@/app/api/dts/document/route');
    const tenant = { 'x-tenant-id': 'tenant-1' };
    const open = await get(load, '/api/dts/document?resource=PUBLIC', {}, tenant);
    expect(open.status).toBe(200);
    expect(open.text).toContain('pub ocr text');
    const hidden = await get(load, '/api/dts/document?resource=HIDDEN', {}, tenant);
    expect(hidden.status).toBe(404);
    expect(hidden.text).not.toContain('hid ocr text');
  });
});

describe('pipeline figures need a staff sign-in', () => {
  const ROUTES = [
    ['GET /api/analytics/pipeline-velocity', () => import('@/app/api/analytics/pipeline-velocity/route'), {}],
    ['GET /api/[tenant]/analytics/pipeline-velocity', () => import('@/app/api/[tenant]/analytics/pipeline-velocity/route'), { tenant: 'default' }],
    ['GET /api/admin/display-backfill-stats', () => import('@/app/api/admin/display-backfill-stats/route'), {}],
    ['GET /api/admin/knowledge-graph', () => import('@/app/api/admin/knowledge-graph/route'), {}],
  ] as const;
  const as = (role: string) => ({ user: { id: 'u1', email: `${role}@example.com`, role, tenantId: 'tenant-1' }, expires: new Date(Date.now() + 3600_000).toISOString() });

  // The proxy names the tenant on every request; the global velocity route reads it.
  const tenant = { 'x-tenant-id': 'tenant-1' };

  for (const [name, load, params] of ROUTES) {
    it(`${name}: 401 signed out, 403 for a reader, open to an editor and to the cron bearer`, async () => {
      store.gemini_usage_daily = [{ date: '2026-11-12', totalCost: 12.34 }];
      store.system_config = [{ _id: 'display_backfill_stats', runs: [{ gb: 3, rate: 7 }], cpuLoad: [1.5] }];
      aggregateAnswer.pages = [];
      aggregateAnswer.gemini_usage_daily = [];

      session = null;
      const anon = await get(load, '/api/x?scope=all&minYear=0&maxYear=3000', params, tenant);
      expect(anon.status).toBe(401);
      expect(anon.text).not.toMatch(/title|Cost|cpuLoad|runs/);

      session = as('reader');
      expect((await get(load, '/api/x', params, tenant)).status).toBe(403);

      session = as('editor');
      expect((await get(load, '/api/x', params, tenant)).status).toBe(200);

      session = null;
      expect((await get(load, '/api/x', params, { ...tenant, authorization: 'Bearer test-cron-secret' })).status).toBe(200);
    });
  }
});
