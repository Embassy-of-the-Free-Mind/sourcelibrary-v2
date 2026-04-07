import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const PROBE_PATHS = [
  '/',
  '/collections',
  '/browse',
  '/book/the-man-in-the-moone-godwin',
  '/book/utriusque-cosmi-historia-fludd',
  '/book/de-revolutionibus-orbium-coelestium-copernicus',
  '/book/the-anatomy-of-melancholy-burton',
  '/book/novum-organum-bacon',
  '/book/monas-hieroglyphica-dee',
  '/book/atalanta-fugiens-maier',
  '/book/corpus-hermeticum',
  '/book/de-occulta-philosophia-agrippa',
  '/book/chemical-wedding-of-christian-rosenkreutz',
  '/gallery',
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

/**
 * POST /api/admin/cache-probe — Run a fresh cache probe
 * GET /api/admin/cache-probe — Return latest stored results
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
  const results: ProbeResult[] = [];

  // Probe pages in parallel (batches of 5 to avoid self-DoS)
  for (let i = 0; i < PROBE_PATHS.length; i += 5) {
    const batch = PROBE_PATHS.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(async (path) => {
        const url = `${BASE_URL}${path}`;
        const t = Date.now();
        try {
          const res = await fetch(url, {
            method: 'HEAD',
            headers: {
              'User-Agent': 'SourceLibrary-CacheProbe/1.0',
            },
            signal: AbortSignal.timeout(8000),
          });
          return {
            path,
            cache: res.headers.get('x-vercel-cache'),
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

  // Compute summary
  const hits = results.filter(r => r.cache === 'HIT').length;
  const misses = results.filter(r => r.cache === 'MISS').length;
  const stale = results.filter(r => r.cache === 'STALE').length;
  const revalidated = results.filter(r => r.cache === 'REVALIDATED').length;
  const total = results.length;

  const data = {
    probed_at: new Date().toISOString(),
    total,
    hits,
    misses,
    stale,
    revalidated,
    hit_rate: total > 0 ? Math.round((hits / total) * 100) / 100 : 0,
    pages: results,
  };

  // Store in system_config
  const db = await getDb();
  await db.collection('system_config').updateOne(
    { _id: 'cache_probe' as any },
    { $set: { data, updated_at: new Date() } },
    { upsert: true }
  );

  return NextResponse.json(data);
});
