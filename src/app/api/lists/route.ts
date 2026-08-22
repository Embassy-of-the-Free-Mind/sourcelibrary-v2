/**
 * User lists API
 *
 * GET  /api/lists — the caller's own lists, newest-updated first.
 *   Query: visitor_id (anonymous identity fallback),
 *          containing=<type>:<id> (optional — adds a `contains` flag per list,
 *          for the add-to-list modal), covers=true (optional — adds up to 4
 *          item thumbnails per list, for the /lists page).
 * POST /api/lists — create a list. Body: { title, description?, visibility?,
 *   visitor_id? }. Visibility DEFAULTS TO 'private' (safe-defaults.md — a
 *   default that publishes must be opt-in; here nothing publishes unless the
 *   owner flips it).
 *
 * Identity mirrors /api/likes: authenticated user id wins, anonymous callers
 * use their localStorage visitor id. Owner-only data (this whole surface) is
 * therefore never cacheable — every response is Cache-Control: private.
 *
 * Deliberately NO /api/[tenant]/lists twin: lists link to global /book and
 * /gallery URLs, which are leaks on partner subdomains (tenant-lockdown.md
 * invariant 6). The lists UI is only mounted on non-embed surfaces.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import {
  LIST_DESCRIPTION_MAX,
  LIST_TARGET_TYPES,
  LIST_TITLE_MAX,
  MAX_LISTS_PER_OWNER,
  isValidVisibility,
  newListId,
  serializeList,
} from '@/lib/user-lists';
import type { ListTargetType, UserList } from '@/lib/types/lists';

const PRIVATE_CACHE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const { searchParams } = new URL(request.url);
    const ownerId = session?.user?.id || searchParams.get('visitor_id');
    if (!ownerId) {
      return NextResponse.json({ lists: [] }, { headers: PRIVATE_CACHE });
    }

    const db = await getDb();
    const lists = await db.collection('user_lists')
      .find({ owner_id: ownerId })
      .sort({ updated_at: -1 })
      .limit(MAX_LISTS_PER_OWNER)
      .toArray();

    const listIds = lists.map(l => l.id as string);

    // contains flag for the add-to-list modal
    let containsSet: Set<string> | null = null;
    const containing = searchParams.get('containing');
    if (containing && listIds.length) {
      const sep = containing.indexOf(':');
      const type = containing.slice(0, sep);
      const id = containing.slice(sep + 1);
      if (LIST_TARGET_TYPES.includes(type as ListTargetType) && id) {
        const rows = await db.collection('user_list_items')
          .find(
            { list_id: { $in: listIds }, target_type: type, target_id: id },
            { projection: { list_id: 1 } }
          ).toArray();
        containsSet = new Set(rows.map(r => r.list_id as string));
      }
    }

    // Up to 4 cover thumbnails per list for the /lists grid
    let coversMap: Map<string, string[]> | null = null;
    if (searchParams.get('covers') === 'true' && listIds.length) {
      const { enrichListItems } = await import('@/lib/user-lists');
      const grouped = await db.collection('user_list_items').aggregate([
        { $match: { list_id: { $in: listIds } } },
        { $sort: { added_at: 1 } },
        { $group: { _id: '$list_id', items: { $push: { target_type: '$target_type', target_id: '$target_id', added_at: '$added_at' } } } },
        { $project: { items: { $slice: ['$items', 4] } } },
      ]).toArray();
      // One enrichment pass across every list's sample items, then partition —
      // avoids a query set per list.
      const allItems = grouped.flatMap(g => g.items as Array<{ target_type: ListTargetType; target_id: string; added_at: Date }>);
      const enriched = await enrichListItems(db, allItems);
      const thumbByTarget = new Map(enriched.map(e => [`${e.target_type}:${e.target_id}`, e.thumbnail]));
      coversMap = new Map();
      for (const g of grouped) {
        const covers = (g.items as Array<{ target_type: string; target_id: string }>)
          .map(i => thumbByTarget.get(`${i.target_type}:${i.target_id}`))
          .filter((t): t is string => !!t)
          .slice(0, 4);
        coversMap.set(g._id as string, covers);
      }
    }

    return NextResponse.json({
      lists: lists.map(l => ({
        ...serializeList(l as unknown as UserList, true),
        ...(containsSet ? { contains: containsSet.has(l.id as string) } : {}),
        ...(coversMap ? { covers: coversMap.get(l.id as string) || [] } : {}),
      })),
    }, { headers: PRIVATE_CACHE });
  } catch (error) {
    console.error('[lists] GET error:', error);
    return NextResponse.json({ error: 'Failed to load lists' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const body = await request.json().catch(() => ({}));
    const ownerId: string | undefined = session?.user?.id || body.visitor_id;
    if (!ownerId) {
      return NextResponse.json({ error: 'visitor_id required when not signed in' }, { status: 400 });
    }

    const title = String(body.title || '').trim().slice(0, LIST_TITLE_MAX);
    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }
    const description = String(body.description || '').trim().slice(0, LIST_DESCRIPTION_MAX);
    const visibility = isValidVisibility(body.visibility) ? body.visibility : 'private';

    const db = await getDb();
    const count = await db.collection('user_lists').countDocuments({ owner_id: ownerId });
    if (count >= MAX_LISTS_PER_OWNER) {
      return NextResponse.json({ error: `You can have at most ${MAX_LISTS_PER_OWNER} lists` }, { status: 400 });
    }

    const now = new Date();
    const list: UserList = {
      id: newListId(),
      owner_id: ownerId,
      title,
      description,
      visibility,
      items_count: 0,
      created_at: now,
      updated_at: now,
    };
    await db.collection('user_lists').insertOne(list as never);

    return NextResponse.json({ success: true, list: serializeList(list, true) }, { headers: PRIVATE_CACHE });
  } catch (error) {
    console.error('[lists] POST error:', error);
    return NextResponse.json({ error: 'Failed to create list' }, { status: 500 });
  }
}
