/**
 * Warm up the production site before running tests.
 *
 * Real users hit a warm site — ISR caches are populated, Vercel functions
 * are running, and MongoDB connections are pooled. This setup replicates
 * that by hitting every route the test suite will touch, so the actual
 * tests measure user-realistic latency, not cold-start latency.
 */
import { request } from '@playwright/test';
import { BOOK, PAGE, SEARCH } from './fixtures';

const ROUTES = [
  '/',
  '/collections',
  '/gallery',
  '/libraries',
  '/timeline',
  '/collections/alchemy',
  '/collections/classical-philosophy',
  '/collections/sacred-texts',
  '/collections/corpus-hermeticum',
  '/collections/hermetica',
  '/collections/kabbalah',
  `/book/${BOOK.slug}`,
  `/book/${BOOK.slug}/page/${PAGE.id}`,
  `/search?q=${SEARCH.query}`,
  '/api/books/search?q=alchemy&limit=1',
  '/api/collections',
  '/api/books/timeline?era=renaissance&limit=1',
];

export default async function globalSetup() {
  const baseURL = process.env.BASE_URL || 'https://sourcelibrary-v2.vercel.app';
  const ctx = await request.newContext({
    baseURL,
    extraHTTPHeaders: { 'X-E2E-Test': 'sourcelibrary-warmup' },
  });

  console.log(`Warming up ${ROUTES.length} routes on ${baseURL}...`);

  // Hit routes in batches of 4 to warm without hammering
  for (let i = 0; i < ROUTES.length; i += 4) {
    const batch = ROUTES.slice(i, i + 4);
    await Promise.all(
      batch.map(async (route) => {
        try {
          const res = await ctx.get(route, { timeout: 45_000 });
          const status = res.status();
          if (status >= 500) {
            console.warn(`  WARN: ${route} → ${status}`);
          }
        } catch (e: any) {
          console.warn(`  WARN: ${route} → ${e.message?.slice(0, 80)}`);
        }
      })
    );
  }

  console.log('Warm-up complete.');
  await ctx.dispose();
}
