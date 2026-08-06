import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/mongodb';
import { purgeCloudflareUrls } from '@/lib/cloudflare-cache';

export const dynamic = 'force-dynamic';
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
  '/librarian',
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

  // ?check mode: skip revalidation + CF purge, just warm and report cache status
  const url = new URL(request.url);
  const checkOnly = url.searchParams.has('check');

  // Cloudflare is NOT purged on deploy. All pages have
  // stale-while-revalidate=1y so CF always serves cached content
  // (possibly stale briefly) while fetching fresh in the background.
  // No visitor ever sees a cold page.
  //
  // To force-refresh specific pages:
  //   POST /api/admin/revalidate { paths: ["/collections/alchemy"] }
  // Books are refreshed daily at 4am UTC via /api/cron/warm.
  const cfPurged = 0;

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

  // 2. Revalidate the static pages we are about to warm, so they pick up the
  //    current deployment's chunks.
  //
  //    We deliberately do NOT revalidate the /book, /collections and /browse
  //    route segments wholesale any more. That existed to stop cached HTML
  //    referencing deleted JS chunks — but Vercel Skew Protection now keeps a
  //    prior deployment's assets resolvable for 48h, which is longer than the
  //    24h `CDN-Cache-Control: max-age=86400` we set on those routes in
  //    next.config.ts. Stale HTML therefore resolves against assets that still
  //    exist, and no invalidation is needed to prevent it.
  //
  //    The window sizing is load-bearing: skew max-age MUST stay > the CDN TTL.
  //    It was 12h against a 24h TTL, and that 12h gap is what produced the
  //    recurring "page renders fully unstyled after a deploy" reports.
  //
  //    Cost, for context: invalidating three whole subtrees on every deploy
  //    (106 deploys/30d) meant the ISR cache was emptied faster than it could
  //    be read — 54.6M ISR writes against 16.8M reads in Jul 2026, $282 of
  //    writes buying $8 of reads, plus the full-render CPU and origin transfer
  //    behind them. See #3645.
  //
  //    Content freshness is unaffected: edits revalidate through their own
  //    paths (/api/books/[id], /api/admin/revalidate*, collections publish),
  //    and anything else refreshes on its normal `revalidate` window.
  //
  //    Skip in ?check mode — just report current warmth without invalidating.
  if (!checkOnly) {
    for (const path of STATIC_PAGES) {
      revalidatePath(path);
    }
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
    mode: checkOnly ? 'check' : 'deploy',
    cf_purged: cfPurged,
    revalidated: checkOnly ? 0 : allContentPaths.length,
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
