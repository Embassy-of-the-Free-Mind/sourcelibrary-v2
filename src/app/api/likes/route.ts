/**
 * Likes API
 *
 * POST /api/likes - Toggle a like
 * GET /api/likes - Get like counts and check if visitor has liked
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { LikeTargetType } from '@/lib/types';

/**
 * Resolve the like target: does it exist, and which tenantId (if any) should
 * the like be filed under?
 *
 * Toggle requests come in from many surfaces: tenant subdomains, /[tenant]/...
 * paths, and (most often) global URLs like /book/{slug}, /favorites, and
 * /gallery/image/{id}. The proxy can only attach a tenant header for the first
 * two. For the rest, we look up the target's own tenantId. Most books and
 * pages have NO tenantId (only tenant-promoted content gets backfilled), so a
 * missing tenantId is normal — the like is stored with `tenantId: null` and
 * still counts on global surfaces. Only a target that doesn't exist at all is
 * rejected.
 */
async function resolveTarget(
  db: Awaited<ReturnType<typeof getDb>>,
  targetType: LikeTargetType,
  targetId: string
): Promise<{ found: boolean; tenantId: string | null }> {
  try {
    if (targetType === 'book') {
      const book = await db.collection('books').findOne(
        { $or: [{ id: targetId }, { slug: targetId }] },
        { projection: { tenantId: 1 } }
      );
      return { found: !!book, tenantId: (book?.tenantId as string) || null };
    }
    if (targetType === 'collection') {
      // Collections are liked by slug (the id a reader sees in the URL).
      const coll = await db.collection('collections').findOne(
        { slug: targetId },
        { projection: { tenantId: 1 } }
      );
      return { found: !!coll, tenantId: (coll?.tenantId as string) || null };
    }
    if (targetType === 'page' || targetType === 'image') {
      // Image targetIds are `{pageId}-{detectionIndex}` (current UI) or
      // legacy `{pageId}:{detectionIndex}` — the tenant lives on the parent
      // page either way.
      const pageId = targetType === 'page'
        ? targetId
        : targetId.includes(':')
          ? targetId.split(':')[0]
          : targetId.replace(/-\d+$/, '');
      if (!pageId) return { found: false, tenantId: null };
      const page = await db.collection('pages').findOne(
        { id: pageId },
        { projection: { tenantId: 1 } }
      );
      return { found: !!page, tenantId: (page?.tenantId as string) || null };
    }
  } catch {
    // Lookup failures fall through — the caller decides what to do.
  }
  return { found: false, tenantId: null };
}

/**
 * POST /api/likes
 *
 * Toggle a like for a target. If already liked, removes it. If not, adds it.
 *
 * Body:
 *   - target_type: 'image' | 'page' | 'book' | 'collection'
 *   - target_id: string
 *   - visitor_id: string (from localStorage)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const body = await request.json();
    const { target_type, target_id } = body;

    // Prefer the authenticated user id; fall back to client-supplied
    // visitor_id for anonymous visitors. This is what keeps likes attached to
    // the user account across devices and survives the client-side session
    // hydration race that previously stranded authenticated likes under
    // anonymous v_… ids.
    const visitor_id: string | undefined = session?.user?.id || body.visitor_id;

    if (!target_type || !target_id || !visitor_id) {
      return NextResponse.json(
        { error: 'target_type, target_id, and visitor_id are required' },
        { status: 400 }
      );
    }

    if (!['image', 'page', 'book', 'collection'].includes(target_type)) {
      return NextResponse.json(
        { error: 'target_type must be image, page, book, or collection' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Prefer the tenant header attached by the proxy; fall back to the
    // target's own tenantId for likes initiated from non-tenant URLs. A
    // target without a tenantId is the common case (most books/pages aren't
    // tenant-promoted) — the like is stored with tenantId: null. Only reject
    // when the target doesn't exist at all.
    const requestTenantId = getTenantContextFromRequest(request).id;
    let tenantId: string | null = requestTenantId;
    if (!tenantId) {
      const target = await resolveTarget(db, target_type as LikeTargetType, target_id);
      if (!target.found) {
        return NextResponse.json(
          { error: 'Target not found' },
          { status: 404 }
        );
      }
      tenantId = target.tenantId;
    }

    // Toggle key matches the unique index (target_type, target_id,
    // visitor_id) — tenantId is scoping metadata, not part of the identity of
    // a like, so un-liking works regardless of which surface filed the like.
    const filter = { target_type, target_id, visitor_id };

    // Atomic toggle: try to delete first — if nothing was deleted, insert
    const deleted = await db.collection('likes').deleteOne(filter);
    const liked = deleted.deletedCount === 0;

    if (liked) {
      await db.collection('likes').insertOne({ ...filter, tenantId, created_at: new Date() });
    }

    // Count semantics mirror GET: scope to the tenant only when the request
    // itself carries a tenant header; global surfaces count across tenants.
    const count = await db.collection('likes').countDocuments({
      target_type,
      target_id,
      ...(requestTenantId ? { tenantId: requestTenantId } : {}),
    });

    // Cascade: liking a page also likes the parent book
    let cascade: { book_id: string; book_liked: boolean; book_count: number } | undefined;
    if (target_type === 'page' && liked) {
      try {
        const page = await db.collection('pages').findOne(
          { id: target_id },
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
            ...(requestTenantId ? { tenantId: requestTenantId } : {}),
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
    const session = await auth();
    const { searchParams } = new URL(request.url);
    const targetsJson = searchParams.get('targets');
    // Authenticated session takes precedence over the query param so the
    // "liked" lookup hits the same id the POST now files under.
    const visitorId = session?.user?.id || searchParams.get('visitor_id');

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

    // Public cache is only safe when the response is keyed purely by URL.
    // Once we mix in the NextAuth cookie to compute `liked`, we must mark it
    // private so a CDN doesn't serve one user's state to another.
    const cacheControl = session?.user?.id
      ? 'private, max-age=30'
      : 'public, max-age=60, stale-while-revalidate=300';
    return NextResponse.json({ results }, {
      headers: { 'Cache-Control': cacheControl },
    });
  } catch (error) {
    console.error('Error getting likes:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get likes' },
      { status: 500 }
    );
  }
}
