import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/mongodb';
import { purgeCloudflareUrls } from '@/lib/cloudflare-cache';

export const maxDuration = 300;
export const preferredRegion = 'fra1';

/**
 * Post-deploy cache warmer. Warms static pages + top books after each deployment.
 *
 * Trigger options:
 *   1. Vercel Deploy Hook (webhook) → POST to this endpoint
 *   2. Manual: curl -X POST https://sourcelibrary.org/api/deploy-warm -H "Authorization: Bearer $CRON_SECRET"
 *
 * Warms in order of priority:
 *   - Static navigation pages (/, /collections, /browse, etc.)
 *   - All visible collection pages
 *   - Top 100 books (by translation completeness + page count, i.e. most content)
 *   - Browse index pages (A-Z)
 */

const STATIC_PAGES = [
  '/',
  '/collections',
  '/browse',
  '/browse/authors/A',
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
];

const BROWSE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const API_ENDPOINTS = [
  '/api/search/unified?q=test&limit=1',
  '/api/books/search?q=test&limit=1',
];

interface WarmResult {
  path: string;
  status: number;
  ms: number;
  cache: string; // x-vercel-cache header: HIT, MISS, STALE, PRERENDER, etc.
}

async function warmUrl(
  baseUrl: string,
  path: string,
  timeout = 25_000
): Promise<WarmResult> {
  const t = Date.now();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { 'X-Warm-Ping': '1' },
      signal: AbortSignal.timeout(timeout),
    });
    const cache = res.headers.get('x-vercel-cache') || res.headers.get('cf-cache-status') || '';
    return { path, status: res.status, ms: Date.now() - t, cache };
  } catch {
    return { path, status: 0, ms: Date.now() - t, cache: '' };
  }
}

async function warmBatch(
  baseUrl: string,
  paths: string[],
  concurrency: number,
  timeout?: number
): Promise<WarmResult[]> {
  const results: WarmResult[] = [];
  for (let i = 0; i < paths.length; i += concurrency) {
    const batch = paths.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(p => warmUrl(baseUrl, p, timeout))
    );
    results.push(...batchResults);
  }
  return results;
}

export async function POST(request: NextRequest) {
  // Auth: accept CRON_SECRET or Vercel's deploy hook (which sends a deployment payload)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    const isVercelHook = request.headers.get('x-vercel-signature');
    if (!isVercelHook && auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const baseUrl = 'https://sourcelibrary.org';
  const started = Date.now();

  // 0. Purge Cloudflare for static pages + all collections on deploy.
  //    Books are purged daily via /api/cron/warm (not on every deploy).
  const cfPurgePaths = [...STATIC_PAGES];

  // Add all collection paths to the purge list
  let collectionSlugsForPurge: string[] = [];
  try {
    const db = await getDb();
    const collections = await db.collection('collections')
      .find({ visible: { $ne: false } }, { projection: { slug: 1 }, maxTimeMS: 5000 })
      .toArray();
    collectionSlugsForPurge = collections.map(c => c.slug as string).filter(Boolean);
    cfPurgePaths.push(...collectionSlugsForPurge.map(s => `/collections/${s}`));
  } catch { /* proceed with static-only purge */ }

  await purgeCloudflareUrls(cfPurgePaths);
  const cfPurged = cfPurgePaths.length;

  // 1. Collect all paths we'll warm (need them for revalidation first)
  let collectionSlugs: string[] = [];
  try {
    const db = await getDb();
    const collections = await db.collection('collections')
      .find({ visible: { $ne: false } }, { projection: { slug: 1 }, maxTimeMS: 5000 })
      .toArray();
    collectionSlugs = collections.map(c => c.slug as string).filter(Boolean);
  } catch {
    collectionSlugs = [
      'alchemy', 'classical-philosophy', 'hermetica', 'kabbalah',
      'rosicrucianism', 'sacred-texts', 'astrology', 'natural-philosophy',
    ];
  }

  let bookPaths: string[] = [];
  try {
    const db = await getDb();
    const topBooks = await db.collection('books').find(
      {
        hidden: { $ne: true },
        pages_count: { $gt: 0 },
        pages_translated: { $gt: 0 },
      },
      {
        projection: { slug: 1, id: 1 },
        sort: { pages_translated: -1 },
        limit: 100,
        maxTimeMS: 10000,
      }
    ).toArray();
    bookPaths = topBooks.map(b => `/book/${b.slug || b.id}`);
  } catch {
    // Skip book warming on DB failure — static pages are the priority
  }

  const collectionPaths = collectionSlugs.map(s => `/collections/${s}`);
  const browsePaths = BROWSE_LETTERS.flatMap(l => [
    `/browse/titles/${l}`,
    `/browse/authors/${l}`,
  ]);
  const allContentPaths = [...STATIC_PAGES, ...collectionPaths, ...bookPaths, ...browsePaths];

  // 2. Revalidate all ISR-cached pages so Next.js drops stale HTML
  //    Without this, warming re-caches old HTML that references deleted JS chunks,
  //    causing raw RSC payload to render instead of the page.
  for (const path of allContentPaths) {
    revalidatePath(path);
  }

  // 3. Warm APIs (keep serverless hot)
  const apiResults = await warmBatch(baseUrl, API_ENDPOINTS, 3, 10_000);

  // 4. Warm static pages (now regenerated with current deployment chunks)
  const staticResults = await warmBatch(baseUrl, STATIC_PAGES, 5);

  // 5. Warm collection pages
  const collectionResults = await warmBatch(baseUrl, collectionPaths, 3);

  // 6. Warm top 100 books
  const bookResults = await warmBatch(baseUrl, bookPaths, 5, 30_000);

  // 7. Warm browse A-Z pages
  const browseResults = await warmBatch(baseUrl, browsePaths, 4);

  const allResults = [...apiResults, ...staticResults, ...collectionResults, ...bookResults, ...browseResults];
  const failed = allResults.filter(r => r.status === 0 || r.status >= 400);

  // Cache warmth summary
  const cacheStats = allResults.reduce((acc, r) => {
    const key = r.cache || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return NextResponse.json({
    cf_purged: cfPurged,
    revalidated: allContentPaths.length,
    warmed: allResults.length,
    failed: failed.length,
    cache_warmth: cacheStats,
    books: bookPaths.length,
    collections: collectionSlugs.length,
    duration_ms: Date.now() - started,
    failures: failed.length > 0 ? failed : undefined,
  });
}

// Also support GET for easy testing / manual trigger
export async function GET(request: NextRequest) {
  return POST(request);
}
