import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 300;
export const preferredRegion = 'fra1';

/**
 * Warm up critical Vercel serverless functions and ISR page caches.
 * Fetches collection slugs from DB so new collections are auto-warmed.
 * Runs daily via Vercel cron (ISR is 24h).
 */

const API_ENDPOINTS = [
  '/api/search/unified?q=test&limit=1',
  '/api/books/search?q=test&limit=1',
  '/api/search?q=test&limit=1',
];

// Static pages that should always be warm
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
  '/embassy',
  '/blog',
  '/artwork',
  '/encyclopedia',
  '/explore',
  '/categories',
];

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

export async function GET() {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://sourcelibrary.org';

  // Fetch all visible collection slugs from DB
  let collectionSlugs: string[] = [];
  try {
    const db = await getDb();
    const collections = await db.collection('collections')
      .find({ visible: { $ne: false } }, { projection: { slug: 1 }, maxTimeMS: 5000 })
      .toArray();
    collectionSlugs = collections.map(c => c.slug as string).filter(Boolean);
  } catch {
    // Fallback to known collections if DB fails
    collectionSlugs = [
      'alchemy', 'classical-philosophy', 'hermetica', 'kabbalah',
      'rosicrucianism', 'sacred-texts', 'astrology', 'natural-philosophy',
      'theurgy', 'early-science', 'natural-magic', 'contemplative-traditions',
    ];
  }

  const collectionPages = collectionSlugs.map(s => `/collections/${s}`);

  // Warm API endpoints first (fast, keeps serverless hot)
  const apiResults = await Promise.all(
    API_ENDPOINTS.map((ep) => warmUrl(baseUrl, ep, 10_000))
  );

  // Warm static pages in batches of 5
  const pageResults: { endpoint: string; status: number; ms: number }[] = [];
  for (let i = 0; i < STATIC_PAGES.length; i += 5) {
    const batch = STATIC_PAGES.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map((p) => warmUrl(baseUrl, p))
    );
    pageResults.push(...batchResults);
  }

  // Warm all collection pages in batches of 3 (heavier queries)
  const collectionResults: { endpoint: string; status: number; ms: number }[] = [];
  for (let i = 0; i < collectionPages.length; i += 3) {
    const batch = collectionPages.slice(i, i + 3);
    const batchResults = await Promise.all(
      batch.map((p) => warmUrl(baseUrl, p))
    );
    collectionResults.push(...batchResults);
  }

  const results = [...apiResults, ...pageResults, ...collectionResults];
  const failed = results.filter((r) => r.status === 0 || r.status >= 400);

  return NextResponse.json({
    warmed: results.length,
    failed: failed.length,
    collections: collectionSlugs.length,
    results,
  });
}
