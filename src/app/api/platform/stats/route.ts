import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { withAdminAuth, withSuperadminAuth } from '@/lib/auth-helpers';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Per-tenant cache keyed by tenantId
const tenantStatsCache = new Map<string, { data: Record<string, unknown>; timestamp: number }>();

// Global stats cache (superadmin only)
let globalStatsCache: { data: Record<string, unknown>; timestamp: number } | null = null;

/**
 * GET /api/platform/stats
 *
 * Tenant-scoped (tenant admin — no ?global param):
 *   Returns stats for the calling tenant only.
 *   - totalItems: total visible books with pages
 *   - translatedTexts: books with at least one translated page
 *   - languageCount / languages: distinct source languages
 *   - pagesTranslated: sum of pages_translated across tenant books
 *
 * Global (platform superadmin — pass ?global=true):
 *   Returns platform-wide aggregates across all tenants plus per-tenant breakdown.
 *
 * Cache: 5 minutes in-memory per tenant / global.
 */

// Tenant-scoped handler — tenant admin role required
const handleTenant = withAdminAuth(async (request: NextRequest) => {
  const { id: tenantId } = getTenantContextFromRequest(request);

  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
  }

  try {
    const cached = tenantStatsCache.get(tenantId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(cached.data, { headers: { 'Cache-Control': 'private, max-age=60' } });
    }

    const db = await getReadDb();
    const [bookStats] = await db.collection('books').aggregate([
      { $match: { tenantId, visible: true, pages_count: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          translatedTexts: {
            $sum: { $cond: [{ $gt: [{ $ifNull: ['$pages_translated', 0] }, 0] }, 1, 0] },
          },
          pagesTranslated: { $sum: { $ifNull: ['$pages_translated', 0] } },
          languages: { $addToSet: '$language' },
        },
      },
    ]).toArray();

    const uniqueLanguages = ((bookStats?.languages as string[]) ?? []).filter(Boolean);

    const data = {
      scope: 'tenant',
      tenantId,
      totalItems: bookStats?.totalItems ?? 0,
      translatedTexts: bookStats?.translatedTexts ?? 0,
      languageCount: uniqueLanguages.length,
      languages: uniqueLanguages.sort(),
      pagesTranslated: bookStats?.pagesTranslated ?? 0,
    };

    tenantStatsCache.set(tenantId, { data, timestamp: Date.now() });
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    console.error('Platform stats (tenant) error:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
});

// Global handler — superadmin only
const handleGlobal = withSuperadminAuth(async (_request: NextRequest) => {
  try {
    if (globalStatsCache && Date.now() - globalStatsCache.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(globalStatsCache.data, { headers: { 'Cache-Control': 'private, max-age=60' } });
    }

    const db = await getReadDb();
    const [bookStats, perTenantBreakdown] = await Promise.all([
      db.collection('books').aggregate([
        { $match: { visible: true, pages_count: { $gt: 0 } } },
        {
          $group: {
            _id: null,
            totalItems: { $sum: 1 },
            translatedTexts: {
              $sum: { $cond: [{ $gt: [{ $ifNull: ['$pages_translated', 0] }, 0] }, 1, 0] },
            },
            pagesTranslated: { $sum: { $ifNull: ['$pages_translated', 0] } },
            languages: { $addToSet: '$language' },
          },
        },
      ]).toArray(),
      db.collection('books').aggregate([
        { $match: { visible: true, pages_count: { $gt: 0 } } },
        {
          $group: {
            _id: '$tenantId',
            totalItems: { $sum: 1 },
            translatedTexts: {
              $sum: { $cond: [{ $gt: [{ $ifNull: ['$pages_translated', 0] }, 0] }, 1, 0] },
            },
            pagesTranslated: { $sum: { $ifNull: ['$pages_translated', 0] } },
            languages: { $addToSet: '$language' },
          },
        },
        { $sort: { totalItems: -1 } },
      ]).toArray(),
    ]);

    const agg = bookStats[0] ?? {};
    const uniqueLanguages = ((agg.languages as string[]) ?? []).filter(Boolean);

    const data = {
      scope: 'global',
      totalItems: agg.totalItems ?? 0,
      translatedTexts: agg.translatedTexts ?? 0,
      languageCount: uniqueLanguages.length,
      languages: uniqueLanguages.sort(),
      pagesTranslated: agg.pagesTranslated ?? 0,
      perTenant: perTenantBreakdown.map((t) => ({
        tenantId: t._id,
        totalItems: t.totalItems,
        translatedTexts: t.translatedTexts,
        pagesTranslated: t.pagesTranslated,
        languageCount: (t.languages as string[]).filter(Boolean).length,
      })),
    };

    globalStatsCache = { data, timestamp: Date.now() };
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    console.error('Platform stats (global) error:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
});

export function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('global') === 'true') {
    return handleGlobal(request);
  }
  return handleTenant(request);
}
