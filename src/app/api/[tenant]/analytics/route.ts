import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { resolveTenantId } from '@/lib/tenant-context';
import { getTrafficData } from '@/lib/analytics-traffic';

export const maxDuration = 30;

// In-memory cache (10 minutes — traffic data changes slowly)
let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

// Pageviews are global (no per-tenant field on the doc), so the data is the
// same regardless of tenant. We still require a valid tenant + auth to reach
// it. Reads MongoDB directly — see src/lib/analytics-traffic.ts for why.
export const GET = withAuth(async (_request, _session, context) => {
  try {
    const { tenant } = await context.params;
    const tenantId = await resolveTenantId(tenant);
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
      return NextResponse.json(cache.data);
    }

    const data = await getTrafficData(30);
    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (error) {
    console.error('Analytics API error:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
});
