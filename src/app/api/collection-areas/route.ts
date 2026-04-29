/**
 * GET /api/collection-areas
 * 
 * Returns list of collection areas (thematic domains) for a tenant
 * with book counts specific to that tenant.
 * 
 * Requires tenant context from headers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { getReadDb } from '@/lib/mongodb';
import { LIBRARY_CATEGORIES } from '@/app/api/categories/route';

export async function GET(request: NextRequest) {
  try {
    const { id: tenantId } = getTenantContextFromRequest(request.headers);

    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant context required' },
        { status: 400 }
      );
    }

    const db = await getReadDb();
    
    // Get category counts for books in this tenant
    const counts = await db.collection('books').aggregate([
      { $match: { tenantId, visible: true, pages_translated: { $gt: 0 } } },
      { $unwind: '$categories' },
      { $group: { _id: '$categories', count: { $sum: 1 } } },
    ]).toArray() as Array<{ _id: string; count: number }>;

    const countMap = new Map<string, number>();
    counts.forEach(({ _id, count }) => {
      countMap.set(_id, count);
    });

    // Build response with only areas that have books
    const areas = LIBRARY_CATEGORIES
      .map(cat => ({
        id: cat.id,
        name: cat.name,
        description: cat.description,
        icon: cat.icon,
        count: countMap.get(cat.id) || 0,
      }))
      .filter(a => a.count > 0)
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      areas,
      total: areas.length,
      tenant_id: tenantId,
    });
  } catch (error) {
    console.error('Collection areas API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch collection areas' },
      { status: 500 }
    );
  }
}
