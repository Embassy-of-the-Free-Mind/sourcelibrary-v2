/**
 * List items API
 *
 * POST /api/lists/[id]/items — add or remove one item, owner only.
 *   Body: { action: 'add' | 'remove', target_type, target_id, visitor_id? }
 *
 * Add validates the target actually exists (same lookup the likes toggle
 * does), enforces the per-list cap, and is idempotent — re-adding an item the
 * list already holds succeeds without duplicating (unique index on
 * list_id + target_type + target_id backstops the race).
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { LIST_TARGET_TYPES, MAX_ITEMS_PER_LIST, targetExists } from '@/lib/user-lists';
import type { ListTargetType } from '@/lib/types/lists';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await auth();
    const body = await request.json().catch(() => ({}));
    const ownerId: string | undefined = session?.user?.id || body.visitor_id;
    const { action, target_type, target_id } = body;

    if (!ownerId) {
      return NextResponse.json({ error: 'visitor_id required when not signed in' }, { status: 400 });
    }
    if (action !== 'add' && action !== 'remove') {
      return NextResponse.json({ error: "action must be 'add' or 'remove'" }, { status: 400 });
    }
    if (!LIST_TARGET_TYPES.includes(target_type) || !target_id || typeof target_id !== 'string') {
      return NextResponse.json({ error: 'target_type and target_id are required' }, { status: 400 });
    }

    const db = await getDb();
    const list = await db.collection('user_lists').findOne({ id });
    if (!list || list.owner_id !== ownerId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const itemFilter = { list_id: id, target_type: target_type as ListTargetType, target_id };

    if (action === 'add') {
      if ((list.items_count || 0) >= MAX_ITEMS_PER_LIST) {
        return NextResponse.json({ error: `Lists hold at most ${MAX_ITEMS_PER_LIST} items` }, { status: 400 });
      }
      if (!(await targetExists(db, target_type, target_id))) {
        return NextResponse.json({ error: 'Target not found' }, { status: 404 });
      }
      try {
        const res = await db.collection('user_list_items').updateOne(
          itemFilter,
          { $setOnInsert: { ...itemFilter, added_at: new Date() } },
          { upsert: true }
        );
        if (res.upsertedCount === 0) {
          // Already in the list — idempotent success
          return NextResponse.json({ success: true, in_list: true, items_count: list.items_count || 0 });
        }
      } catch (e: unknown) {
        if (!(e instanceof Error) || !e.message.includes('duplicate key')) throw e;
        return NextResponse.json({ success: true, in_list: true, items_count: list.items_count || 0 });
      }
    } else {
      const res = await db.collection('user_list_items').deleteOne(itemFilter);
      if (res.deletedCount === 0) {
        return NextResponse.json({ success: true, in_list: false, items_count: list.items_count || 0 });
      }
    }

    // Recount rather than $inc — self-healing if a write ever bypasses this
    // route, and cheap at ≤500 items on the unique index.
    const itemsCount = await db.collection('user_list_items').countDocuments({ list_id: id });
    await db.collection('user_lists').updateOne(
      { id },
      { $set: { items_count: itemsCount, updated_at: new Date() } }
    );

    return NextResponse.json({ success: true, in_list: action === 'add', items_count: itemsCount });
  } catch (error) {
    console.error('[lists/:id/items] error:', error);
    return NextResponse.json({ error: 'Failed to update list' }, { status: 500 });
  }
}
