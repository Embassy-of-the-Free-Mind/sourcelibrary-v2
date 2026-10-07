/**
 * Word-form recall of the keyword search lanes (#5517), on this checkout's code
 * against production data. For each query in queries.json it records what each
 * keyword lane finds for the form the reader typed, and what the same lane
 * finds for the other forms of that word (the yardstick).
 *
 * PRIOR ART: scripts/eval/search-recall/local/route.harness.ts — runs
 * /api/search for 30 names and concepts and is scored for book recall against
 * page counts; it has no word-form pairs and does not read the lanes one by
 * one. scripts/eval/search-quality-eval.mjs — pass/fail assertions on prod.
 *
 *   OUT=/tmp/before.json node --env-file=.env.production.local node_modules/.bin/vitest run \
 *     --config scripts/eval/search-word-forms/vitest.config.mts
 *   node scripts/eval/search-word-forms/compare.mjs before.json after.json
 *
 * Lanes read:
 *   book        searchBookIds (Supabase books_catalog), limit 1000: ids
 *   pages       Atlas `pages_search`, the stage buildPageSearchStage builds:
 *               pages matched (lower bound, capped at 100,000) and the books of
 *               the 25 best pages
 *   search      the real /api/search handler, limit 50: book rows, passage rows
 *   unified     the real /api/search/unified handler: books, collections, artworks
 * Env: OUT (required), ONLY (substring of a query id), ROUTES=0 to skip the two
 * route calls. Reads prod Mongo and Supabase; calls the embedding API once per
 * route call. Writes nothing to any store.
 */
import { vi, test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api-auth', () => ({ withApiAuth: (h: any) => (req: any, ctx: any) => h(req, ctx, null) }));
vi.mock('@/lib/anon-gate', () => ({ anonSearchGate: async () => ({ allowed: true }), ANON_SEARCHES_PER_HOUR: 10, SIGNIN_URL: '' }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ allowed: true }), getClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/search-log', () => ({ logSearchQuery: () => {} }));
vi.mock('@/lib/search-event-log', () => ({ logSearchEvent: () => {} }));

test('word-form lanes', async () => {
  if (!process.env.OUT) throw new Error('set OUT=<file>');
  const { searchBookIds } = await import('@/lib/books-catalog');
  const { buildPageSearchStage, NON_CONTENT_PAGE_TYPES } = await import('@/lib/atlas-search');
  const { getReadDb } = await import('@/lib/mongodb');
  const db = await getReadDb();
  const routes = process.env.ROUTES !== '0';
  const search = routes ? (await import('@/app/api/search/route')).GET as any : null;
  const unified = routes ? (await import('@/app/api/search/unified/route')).GET as any : null;
  const call = async (handler: any, path: string) =>
    (await handler(new NextRequest(`http://localhost${path}`), { params: Promise.resolve({}) })).json();

  const bookLane = async (q: string) => {
    try { return await searchBookIds(q, { limit: 1000 }); } catch (e) { return { error: String(e) }; }
  };
  const pageLane = async (q: string) => {
    const stage = buildPageSearchStage(q) as any;
    const { highlight: _h, ...operator } = stage.$search;
    try {
      const [meta, top] = await Promise.all([
        db.collection('pages').aggregate([{ $searchMeta: { ...operator, count: { type: 'lowerBound', threshold: 100000 } } }], { maxTimeMS: 20000 }).toArray(),
        db.collection('pages').aggregate([
          { $search: operator },
          { $match: { page_number: { $gt: 0 }, page_type: { $nin: NON_CONTENT_PAGE_TYPES } } },
          { $limit: 25 }, { $project: { _id: 0, book_id: 1 } },
        ], { maxTimeMS: 20000 }).toArray(),
      ]);
      return { pages: meta[0]?.count?.lowerBound ?? meta[0]?.count?.total ?? 0, top25_books: [...new Set(top.map(p => p.book_id))] };
    } catch (e) { return { error: String(e) }; }
  };

  const { queries } = JSON.parse(readFileSync('scripts/eval/search-word-forms/queries.json', 'utf8'));
  const out: Record<string, unknown> = {};
  for (const q of queries) {
    if (process.env.ONLY && !q.id.includes(process.env.ONLY)) continue;
    const enc = encodeURIComponent(q.query);
    const family: Record<string, unknown> = {};
    for (const form of q.family) {
      family[form] = { book: await bookLane(form), pages: (await pageLane(form) as any).pages };
    }
    const row: Record<string, unknown> = { query: q.query, kind: q.kind, book: await bookLane(q.query), page: await pageLane(q.query), family };
    if (routes) {
      const s = await call(search, `/api/search?q=${enc}&limit=50`);
      const rows = (s.results || []) as any[];
      row.search = {
        total: s.total, degraded: s.degraded_lanes || [],
        books: rows.filter(r => r.type === 'book').map(r => r.book_id),
        passages: rows.filter(r => r.type === 'page').map(r => `${r.book_id}:${r.page_number}`),
      };
      const u = await call(unified, `/api/search/unified?q=${enc}`);
      row.unified = {
        books: (u.books?.results || []).map((b: any) => b.id), books_total: u.books?.total ?? null,
        collections: (u.collections?.results || []).map((c: any) => c.slug),
        artworks: u.artworks?.total ?? (u.artworks?.results || []).length,
        index: u.index?.total ?? null,
      };
    }
    out[q.id] = row;
  }
  writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
});
