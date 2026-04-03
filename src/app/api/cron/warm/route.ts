import { NextResponse } from 'next/server';

export const maxDuration = 60;
export const preferredRegion = 'fra1';

/**
 * Warm up critical Vercel serverless functions and ISR page caches.
 * Prevents cold-start delays for user-facing routes after deploys.
 * Runs every 5 minutes via Vercel cron.
 */

const API_ENDPOINTS = [
  '/api/search/unified?q=test&limit=1',
  '/api/books/search?q=test&limit=1',
  '/api/search?q=test&limit=1',
];

// High-traffic ISR pages that should always be warm
const ISR_PAGES = [
  '/',
  '/collections',
  '/collections/alchemy',
  '/collections/classical-philosophy',
  '/collections/hermetica',
  '/collections/kabbalah',
  '/collections/rosicrucianism',
  '/collections/sacred-texts',
  '/collections/astrology',
  '/collections/natural-philosophy',
  '/collections/theurgy',
  '/browse',
  '/browse/authors',
  '/gallery',
  '/libraries',
  '/languages',
  '/search',
  '/timeline',
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

  // Warm API endpoints first (fast, keeps serverless hot)
  const apiResults = await Promise.all(
    API_ENDPOINTS.map((ep) => warmUrl(baseUrl, ep, 10_000))
  );

  // Warm ISR pages in batches of 5 to avoid overwhelming Atlas
  const isrResults: { endpoint: string; status: number; ms: number }[] = [];
  for (let i = 0; i < ISR_PAGES.length; i += 5) {
    const batch = ISR_PAGES.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map((p) => warmUrl(baseUrl, p))
    );
    isrResults.push(...batchResults);
  }

  const results = [...apiResults, ...isrResults];
  const failed = results.filter((r) => r.status === 0 || r.status >= 400);

  return NextResponse.json({
    warmed: results.length,
    failed: failed.length,
    results,
  });
}
