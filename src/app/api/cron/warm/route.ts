import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { purgeCloudflareUrls } from '@/lib/cloudflare-cache';

export const maxDuration = 300;
export const preferredRegion = 'fra1';

/**
 * Warm up critical Vercel serverless functions and ISR page caches.
 * Fetches collection slugs from DB so new collections are auto-warmed.
 * Runs daily via Vercel cron (ISR is 24h).
 *
 * Also warms top 50 books and browse A-Z pages to minimize cold starts.
 */

const API_ENDPOINTS = [
  '/api/search/unified?q=test&limit=1',
  '/api/books/search?q=test&limit=1',
  '/api/search?q=test&limit=1',
];

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

async function warmUrl(
  baseUrl: string,
  path: string,
  timeout = 25_000
): Promise<{ endpoint: string; status: number; ms: number }> {
  const t = Date.now();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { 'X-Warm-Ping': '1' },
      signal: AbortSignal.timeout(timeout),
    });
    return { endpoint: path, status: res.status, ms: Date.now() - t };
  } catch {
    return { endpoint: path, status: 0, ms: Date.now() - t };
  }
}

async function warmBatch(
  baseUrl: string,
  paths: string[],
  concurrency: number,
  timeout?: number
): Promise<{ endpoint: string; status: number; ms: number }[]> {
  const results: { endpoint: string; status: number; ms: number }[] = [];
  for (let i = 0; i < paths.length; i += concurrency) {
    const batch = paths.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(p => warmUrl(baseUrl, p, timeout))
    );
    results.push(...batchResults);
  }
  return results;
}

export async function GET() {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://sourcelibrary.org';

  // 1. Warm API endpoints (fast, keeps serverless hot)
  const apiResults = await warmBatch(baseUrl, API_ENDPOINTS, 3, 10_000);

  // 2. Warm static pages
  const staticResults = await warmBatch(baseUrl, STATIC_PAGES, 5);

  // 3. Warm all visible collection pages
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
      'theurgy', 'early-science', 'natural-magic', 'contemplative-traditions',
    ];
  }
  const collectionResults = await warmBatch(
    baseUrl,
    collectionSlugs.map(s => `/collections/${s}`),
    3
  );

  // 4. Warm top 50 books (most-translated = most likely to be visited)
  //    Daily cron also purges book pages from Cloudflare so users see fresh content
  //    after pipeline updates (OCR, translations, enrichment).
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
        limit: 50,
        maxTimeMS: 10000,
      }
    ).toArray();
    bookPaths = topBooks.map(b => `/book/${b.slug || b.id}`);
  } catch {
    // Skip book warming on DB failure
  }

  // No CF purge needed — stale-while-revalidate=1y means CF serves cached
  // content while fetching fresh in background. Warming Vercel ISR is enough.
  const bookResults = await warmBatch(baseUrl, bookPaths, 5, 30_000);

  // 5. Warm browse A-Z pages
  const browseResults = await warmBatch(
    baseUrl,
    BROWSE_LETTERS.flatMap(l => [`/browse/titles/${l}`, `/browse/authors/${l}`]),
    4
  );

  const results = [...apiResults, ...staticResults, ...collectionResults, ...bookResults, ...browseResults];
  const failed = results.filter((r) => r.status === 0 || r.status >= 400);

  return NextResponse.json({
    warmed: results.length,
    failed: failed.length,
    collections: collectionSlugs.length,
    books: bookPaths.length,
    results,
  });
}
