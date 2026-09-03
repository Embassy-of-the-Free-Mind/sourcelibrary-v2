/**
 * Tenant Likes API
 *
 * POST /api/[tenant]/likes - Toggle a like
 * GET /api/[tenant]/likes - Get like counts and visitor like state
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { resolveTenantId } from '@/lib/tenant-context';
import { LikeTargetType } from '@/lib/types';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string }> }
) {
  try {
    const { tenant } = await params;
    const tenantId = await resolveTenantId(tenant);

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const session = await auth();
    const body = await request.json();
    const { target_type, target_id } = body;
    // Prefer authenticated user id over client-supplied visitor_id so likes
    // stay attached to the account regardless of client-side hydration state.
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
    // Toggle key matches the unique index (target_type, target_id,
    // visitor_id) — tenantId is scoping metadata, not part of a like's
    // identity. Including it in the delete filter would miss a like the same
    // visitor filed from a global URL (tenantId: null) and then hit a
    // duplicate-key error on insert.
    const filter = { target_type, target_id, visitor_id };

    // Atomic toggle: try delete first. If no deletion occurred, insert new like.
    const deleted = await db.collection('likes').deleteOne(filter);
    const liked = deleted.deletedCount === 0;

    if (liked) {
      await db.collection('likes').insertOne({ ...filter, tenantId, created_at: new Date() });
    }

    const count = await db.collection('likes').countDocuments({
      target_type,
      target_id,
      tenantId,
    });

    // Cascade: liking a page also likes the parent book.
    let cascade: { book_id: string; book_liked: boolean; book_count: number } | undefined;
    if (target_type === 'page' && liked) {
      try {
        const page = await db.collection('pages').findOne(
          { id: target_id, tenantId },
          { projection: { book_id: 1 } }
        );
        if (page?.book_id) {
          try {
            await db.collection('likes').insertOne({
              target_type: 'book',
              target_id: page.book_id,
              visitor_id,
              tenantId,
              created_at: new Date(),
            });
          } catch (e: unknown) {
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
        // Non-critical failure; keep primary page-like success.
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string }> }
) {
  try {
    const { tenant } = await params;
    const tenantId = await resolveTenantId(tenant);

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const session = await auth();
    const { searchParams } = new URL(request.url);
    const targetsJson = searchParams.get('targets');
    const visitorId = session?.user?.id || searchParams.get('visitor_id');

    if (!targetsJson) {
      return NextResponse.json({ error: 'targets parameter is required' }, { status: 400 });
    }

    let targets: Array<{ type: LikeTargetType; id: string }>;
    try {
      targets = JSON.parse(targetsJson);
    } catch {
      return NextResponse.json({ error: 'Invalid targets JSON' }, { status: 400 });
    }

    if (!Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json({ results: {} });
    }

    if (targets.length > 100) {
      targets = targets.slice(0, 100);
    }

    const db = await getDb();

    const countPipeline = [
      {
        $match: {
          tenantId,
          $or: targets.map(t => ({ target_type: t.type, target_id: t.id })),
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

    const results: Record<string, { count: number; liked: boolean }> = {};

    for (const target of targets) {
      const key = `${target.type}:${target.id}`;
      results[key] = { count: 0, liked: false };
    }

    for (const c of counts) {
      const key = `${c._id.type}:${c._id.id}`;
      if (results[key]) {
        results[key].count = c.count;
      }
    }

    if (visitorId) {
      const visitorLikes = await db.collection('likes').find({
        tenantId,
        visitor_id: visitorId,
        $or: targets.map(t => ({ target_type: t.type, target_id: t.id })),
      }).toArray();

      for (const like of visitorLikes) {
        const key = `${like.target_type}:${like.target_id}`;
        if (results[key]) {
          results[key].liked = true;
        }
      }
    }

    const cacheControl = session?.user?.id
      ? 'private, max-age=30'
      : 'public, max-age=60, stale-while-revalidate=300';
    return NextResponse.json(
      { results },
      { headers: { 'Cache-Control': cacheControl } }
    );
  } catch (error) {
    console.error('Error getting likes:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get likes' },
      { status: 500 }
    );
  }
}
