import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const STATIC_PAGES = [
  '/',
  '/collections',
  '/browse',
  '/gallery',
  '/libraries',
  '/languages',
  '/search',
  '/about',
  '/reading-room',
  '/blog',
  '/artwork',
  '/encyclopedia',
  '/explore',
  '/categories',
  '/topics',
  '/timeline',
  '/browse/authors',
  '/taxonomy',
];

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sourcelibrary.org';

interface ProbeResult {
  path: string;
  cache: string | null;
  latency_ms: number;
  status: number;
  error?: string;
}

interface CategoryStats {
  hit: number;
  miss: number;
  stale: number;
  total: number;
}

async function probePaths(paths: string[]): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  // Batches of 8 to balance speed vs self-DoS
  for (let i = 0; i < paths.length; i += 8) {
    const batch = paths.slice(i, i + 8);
    const batchResults = await Promise.all(
      batch.map(async (path) => {
        const t = Date.now();
        try {
          // GET not HEAD — Vercel only returns accurate x-vercel-cache on GET
          const res = await fetch(`${BASE_URL}${path}`, {
            headers: { 'User-Agent': 'SourceLibrary-CacheProbe/1.0' },
            signal: AbortSignal.timeout(15_000),
          });
          return {
            path,
            cache: res.headers.get('cf-cache-status') || res.headers.get('x-vercel-cache'),
            latency_ms: Date.now() - t,
            status: res.status,
          };
        } catch (e) {
          return {
            path,
            cache: null,
            latency_ms: Date.now() - t,
            status: 0,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      })
    );
    results.push(...batchResults);
  }
  return results;
}

function summarizeCategory(results: ProbeResult[]): CategoryStats {
  // HIT, PRERENDER, STALE, REVALIDATED are all "warm" — served fast without cold render
  return {
    hit: results.filter(r => ['HIT', 'PRERENDER', 'STALE', 'REVALIDATED'].includes(r.cache || '')).length,
    miss: results.filter(r => r.cache === 'MISS' || !r.cache).length,
    stale: 0,
    total: results.length,
  };
}

/**
 * GET /api/admin/cache-probe — Return latest stored results
 * POST /api/admin/cache-probe — Run a fresh probe across the whole site
 *
 * Returns a warmth score (0-100) measuring ISR cache coverage.
 */
export const GET = withAdminAuth(async () => {
  const db = await getDb();
  const stored = await db.collection('system_config').findOne(
    { _id: 'cache_probe' as any },
    { maxTimeMS: 5000 }
  );
  if (!stored) {
    return NextResponse.json({ error: 'No probe results yet. POST to run a probe.' }, { status: 404 });
  }
  return NextResponse.json(stored.data);
});

export const POST = withAdminAuth(async () => {
  const db = await getDb();
  const started = Date.now();

  // 1. Static pages
  const staticResults = await probePaths(STATIC_PAGES);

  // 2. All visible collections
  let collectionSlugs: string[] = [];
  try {
    const collections = await db.collection('collections')
      .find(
        { visible: { $ne: false }, parent: { $exists: false } },
        { projection: { slug: 1 }, maxTimeMS: 5000 }
      )
      .toArray();
    collectionSlugs = collections.map(c => c.slug as string).filter(Boolean);
  } catch { /* skip on DB failure */ }
  const collectionResults = await probePaths(
    collectionSlugs.map(s => `/collections/${s}`)
  );

  // 3. All visible sub-collections
  let subSlugs: string[] = [];
  try {
    const subs = await db.collection('collections')
      .find(
        { visible: { $ne: false }, parent: { $exists: true } },
        { projection: { slug: 1 }, maxTimeMS: 5000 }
      )
      .toArray();
    subSlugs = subs.map(c => c.slug as string).filter(Boolean);
  } catch { /* skip */ }
  const subResults = await probePaths(
    subSlugs.map(s => `/collections/${s}`)
  );

  // 4. Top 25 books by translation completeness
  let bookResults: ProbeResult[] = [];
  try {
    const topBooks = await db.collection('books').find(
      {
        hidden: { $ne: true },
        pages_count: { $gt: 0 },
        pages_translated: { $gt: 0 },
      },
      {
        projection: { slug: 1, id: 1 },
        sort: { pages_translated: -1 },
        limit: 25,
        maxTimeMS: 10000,
      }
    ).toArray();
    const bookPaths = topBooks.map(b => `/book/${b.slug || b.id}`);
    bookResults = await probePaths(bookPaths);
  } catch { /* skip */ }

  // Aggregate
  const allResults = [...staticResults, ...collectionResults, ...subResults, ...bookResults];
  const hits = allResults.filter(r => ['HIT', 'PRERENDER', 'STALE', 'REVALIDATED'].includes(r.cache || '')).length;
  const total = allResults.length;
  const warmth = total > 0 ? Math.round((hits / total) * 100) : 0;

  const data = {
    probed_at: new Date().toISOString(),
    warmth,
    total,
    hits,
    misses: allResults.filter(r => r.cache === 'MISS' || !r.cache).length,
    stale: allResults.filter(r => r.cache === 'STALE' || r.cache === 'REVALIDATED').length,
    errors: allResults.filter(r => r.status === 0 || r.status >= 400).length,
    by_category: {
      static: summarizeCategory(staticResults),
      collections: summarizeCategory(collectionResults),
      subcollections: summarizeCategory(subResults),
      books_top25: summarizeCategory(bookResults),
    },
    slowest: allResults
      .filter(r => !r.error)
      .sort((a, b) => b.latency_ms - a.latency_ms)
      .slice(0, 10)
      .map(r => ({ path: r.path, ms: r.latency_ms, cache: r.cache })),
    failed: allResults
      .filter(r => r.status === 0 || r.status >= 400)
      .map(r => ({ path: r.path, status: r.status, error: r.error })),
    duration_ms: Date.now() - started,
  };

  // Store for GET retrieval
  await db.collection('system_config').updateOne(
    { _id: 'cache_probe' as any },
    { $set: { data, updated_at: new Date() } },
    { upsert: true }
  );

  return NextResponse.json(data);
});
