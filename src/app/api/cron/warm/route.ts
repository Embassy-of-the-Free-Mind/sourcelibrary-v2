import { NextResponse } from 'next/server';

export const maxDuration = 15;
export const preferredRegion = 'fra1';

/**
 * Warm up critical Vercel serverless functions by calling them.
 * Prevents cold-start delays for user-facing search and API routes.
 * Runs every 5 minutes via Vercel cron.
 */
export async function GET() {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://sourcelibrary.org';

  const endpoints = [
    '/api/search/unified?q=test&limit=1',
    '/api/books/search?q=test&limit=1',
    '/api/search?q=test&limit=1',
  ];

  const results: { endpoint: string; status: number; ms: number }[] = [];

  for (const endpoint of endpoints) {
    const t = Date.now();
    try {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        headers: { 'X-Warm-Ping': '1' },
        signal: AbortSignal.timeout(10000),
      });
      results.push({ endpoint, status: res.status, ms: Date.now() - t });
    } catch {
      results.push({ endpoint, status: 0, ms: Date.now() - t });
    }
  }

  return NextResponse.json({ warmed: results.length, results });
}
