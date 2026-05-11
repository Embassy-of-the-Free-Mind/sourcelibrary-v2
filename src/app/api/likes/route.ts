/**
 * Likes API
 *
 * POST /api/likes - Toggle a like
 * GET /api/likes - Get like counts and check if visitor has liked
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { LikeTargetType } from '@/lib/types';

/**
 * Resolve the tenantId that a like for this target should be filed under.
 *
 * Toggle requests come in from many surfaces: tenant subdomains, /[tenant]/...
 * paths, and (most often) global URLs like /book/{slug}, /favorites, and
 * /gallery/image/{id}. The proxy can only attach a tenant header for the first
 * two. For the rest, we fall back to looking up the target's own tenantId —
 * books, pages, and gallery images all carry one. This keeps likes correctly
 * scoped without relying on the request path.
 */
async function resolveTargetTenantId(
  db: Awaited<ReturnType<typeof getDb>>,
  targetType: LikeTargetType,
  targetId: string
): Promise<string | null> {
  try {
    if (targetType === 'book') {
      const book = await db.collection('books').findOne(
        { $or: [{ id: targetId }, { slug: targetId }] },
        { projection: { tenantId: 1 } }
      );
      return (book?.tenantId as string) || null;
    }
    if (targetType === 'page') {
      const page = await db.collection('pages').findOne(
        { id: targetId },
        { projection: { tenantId: 1 } }
      );
      return (page?.tenantId as string) || null;
    }
    if (targetType === 'image') {
      // Image targetIds are `{pageId}:{detectionIndex}` — the tenant lives on
      // the parent page.
      const pageId = targetId.split(':')[0] || targetId.split('-').slice(0, -1).join('-');
      if (!pageId) return null;
      const page = await db.collection('pages').findOne(
        { id: pageId },
        { projection: { tenantId: 1 } }
      );
      return (page?.tenantId as string) || null;
    }
  } catch {
    // Lookup failures fall through to null — the caller decides what to do.
  }
  return null;
}

/**
 * POST /api/likes
 *
 * Toggle a like for a target. If already liked, removes it. If not, adds it.
 *
 * Body:
 *   - target_type: 'image' | 'page' | 'book'
 *   - target_id: string
 *   - visitor_id: string (from localStorage)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { target_type, target_id, visitor_id } = body;

    if (!target_type || !target_id || !visitor_id) {
      return NextResponse.json(
        { error: 'target_type, target_id, and visitor_id are required' },
        { status: 400 }
      );
    }

    if (!['image', 'page', 'book'].includes(target_type)) {
      return NextResponse.json(
        { error: 'target_type must be image, page, or book' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Prefer the tenant header attached by the proxy; fall back to the
    // target's own tenantId for likes initiated from non-tenant URLs.
    let tenantId = getTenantContextFromRequest(request).id;
    if (!tenantId) {
      tenantId = await resolveTargetTenantId(db, target_type as LikeTargetType, target_id);
    }
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Target not found' },
        { status: 404 }
      );
    }

    const filter = { target_type, target_id, visitor_id, tenantId };

    // Atomic toggle: try to delete first — if nothing was deleted, insert
    const deleted = await db.collection('likes').deleteOne(filter);
    const liked = deleted.deletedCount === 0;

    if (liked) {
      await db.collection('likes').insertOne({ ...filter, created_at: new Date() });
    }

    const count = await db.collection('likes').countDocuments({
      target_type,
      target_id,
      tenantId,
    });

    // Cascade: liking a page also likes the parent book
    let cascade: { book_id: string; book_liked: boolean; book_count: number } | undefined;
    if (target_type === 'page' && liked) {
      try {
        const page = await db.collection('pages').findOne(
          { id: target_id, tenantId },
          { projection: { book_id: 1 } }
        );
        if (page?.book_id) {
          // Idempotent: unique index prevents duplicates
          try {
            await db.collection('likes').insertOne({
              target_type: 'book',
              target_id: page.book_id,
              visitor_id,
              tenantId,
              created_at: new Date(),
            });
          } catch (e: unknown) {
            // Duplicate key = already liked, which is fine
            if (!(e instanceof Error) || !e.message.includes('duplicate key')) throw e;
          }
          const bookCount = await db.collection('likes').countDocuments({
            target_type: 'book',
            target_id: page.book_id,
            tenantId,
          });
          cascade = { book_id: page.book_id, book_liked: true, book_count: bookCount };
        }
      } catch (e) {
        // Non-critical — don't fail the page like
        console.error('Cascade book like failed:', e);
      }
    }

    return NextResponse.json({
      success: true,
      liked,
      count,
      ...(cascade && { cascade }),
    });
  } catch (error) {
    console.error('Error toggling like:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to toggle like' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/likes
 *
 * Get like counts and check if visitor has liked.
 *
 * Query params:
 *   - targets: JSON array of {type, id} objects
 *   - visitor_id: string (optional, to check if liked)
 *
 * Example: /api/likes?targets=[{"type":"image","id":"abc:0"}]&visitor_id=xyz
 *
 * Tenant scoping: when the request carries a tenant header (subdomain or
 * /[tenant]/ route), counts are scoped to that tenant. Without a tenant
 * header — the common case for likes initiated from /book/{slug},
 * /favorites, etc. — we count across all tenants. Target IDs are globally
 * unique so the cross-tenant count is the correct one.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const targetsJson = searchParams.get('targets');
    const visitorId = searchParams.get('visitor_id');

    if (!targetsJson) {
      return NextResponse.json(
        { error: 'targets parameter is required' },
        { status: 400 }
      );
    }

    let targets: Array<{ type: LikeTargetType; id: string }>;
    try {
      targets = JSON.parse(targetsJson);
    } catch {
      return NextResponse.json(
        { error: 'Invalid targets JSON' },
        { status: 400 }
      );
    }

    if (!Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json({ results: {} });
    }

    // Limit to 100 targets per request
    if (targets.length > 100) {
      targets = targets.slice(0, 100);
    }

    const { id: tenantId } = getTenantContextFromRequest(request);
    const tenantFilter = tenantId ? { tenantId } : {};

    const db = await getDb();

    // Build aggregation to get counts
    const countPipeline = [
      {
        $match: {
          ...tenantFilter,
          $or: targets.map(t => ({
            target_type: t.type,
            target_id: t.id,
          })),
        },
      },
      {
        $group: {
          _id: { type: '$target_type', id: '$target_id' },
          count: { $sum: 1 },
        },
      },
    ];

    const counts = await db.collection('likes').aggregate(countPipeline).toArray();

    // Build results map
    const results: Record<string, { count: number; liked: boolean }> = {};

    // Initialize all targets with 0
    for (const target of targets) {
      const key = `${target.type}:${target.id}`;
      results[key] = { count: 0, liked: false };
    }

    // Fill in counts
    for (const c of counts) {
      const key = `${c._id.type}:${c._id.id}`;
      if (results[key]) {
        results[key].count = c.count;
      }
    }

    // Check if visitor has liked (if visitor_id provided)
    if (visitorId) {
      const visitorLikes = await db.collection('likes').find({
        ...tenantFilter,
        visitor_id: visitorId,
        $or: targets.map(t => ({
          target_type: t.type,
          target_id: t.id,
        })),
      }).toArray();

      for (const like of visitorLikes) {
        const key = `${like.target_type}:${like.target_id}`;
        if (results[key]) {
          results[key].liked = true;
        }
      }
    }

    return NextResponse.json({ results }, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    console.error('Error getting likes:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get likes' },
      { status: 500 }
    );
  }
}
