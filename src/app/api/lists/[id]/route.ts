/**
 * Single-list API
 *
 * GET   /api/lists/[id] — list + enriched items. Owner always; anyone if the
 *   list is public. A private list 404s (not 403) to non-owners so its
 *   existence isn't confirmable, matching /api/embassy/threads/[id].
 * PATCH /api/lists/[id] — owner edits { title?, description?, visibility? }.
 *   Absent field = leave alone; present empty description = clear it
 *   (session-flags-and-forms.md).
 * POST  /api/lists/[id] with { action: 'delete' } — owner deletes the list and
 *   its items. POST-based because src/proxy.ts blocks DELETE globally.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import {
  LIST_DESCRIPTION_MAX,
  LIST_TITLE_MAX,
  enrichListItems,
  isValidVisibility,
  serializeList,
} from '@/lib/user-lists';
import type { UserList, UserListItem } from '@/lib/types/lists';

const PRIVATE_CACHE = { 'Cache-Control': 'private, no-store' };

async function callerOwnerId(request: NextRequest, bodyVisitorId?: unknown): Promise<string | null> {
  const session = await auth();
  if (session?.user?.id) return session.user.id;
  if (typeof bodyVisitorId === 'string' && bodyVisitorId) return bodyVisitorId;
  const { searchParams } = new URL(request.url);
  return searchParams.get('visitor_id');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const list = await db.collection('user_lists').findOne({ id });
    if (!list) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const ownerId = await callerOwnerId(request);
    const isOwner = !!ownerId && list.owner_id === ownerId;
    if (list.visibility !== 'public' && !isOwner) {
      // 404, not 403 — don't confirm a private list exists
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const rawItems = await db.collection('user_list_items')
      .find({ list_id: id })
      .sort({ added_at: -1 })
      .toArray();
    const items = await enrichListItems(db, rawItems as unknown as UserListItem[]);

    return NextResponse.json({
      list: serializeList(list as unknown as UserList, isOwner),
      items,
    }, { headers: PRIVATE_CACHE });
  } catch (error) {
    console.error('[lists/:id] GET error:', error);
    return NextResponse.json({ error: 'Failed to load list' }, { status: 500 });
  }
}

async function requireOwnedList(request: NextRequest, id: string, bodyVisitorId?: unknown) {
  const db = await getDb();
  const list = await db.collection('user_lists').findOne({ id });
  if (!list) return { db, list: null, error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  const ownerId = await callerOwnerId(request, bodyVisitorId);
  if (!ownerId || list.owner_id !== ownerId) {
    // Same 404-shape as GET for non-owners of private lists; owners of public
    // lists are the only callers who could see a 403, and hiding intent there
    // buys nothing — keep it uniform.
    return { db, list: null, error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  return { db, list, error: null };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { db, list, error } = await requireOwnedList(request, id, body.visitor_id);
    if (!list) return error;

    const update: Record<string, unknown> = { updated_at: new Date() };

    // Absent = leave alone; present = set (empty description clears).
    if ('title' in body) {
      const title = String(body.title || '').trim().slice(0, LIST_TITLE_MAX);
      if (!title) {
        return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
      }
      update.title = title;
    }
    if ('description' in body) {
      update.description = String(body.description || '').trim().slice(0, LIST_DESCRIPTION_MAX);
    }
    if ('visibility' in body) {
      if (!isValidVisibility(body.visibility)) {
        return NextResponse.json({ error: 'visibility must be private or public' }, { status: 400 });
      }
      update.visibility = body.visibility;
    }

    await db.collection('user_lists').updateOne({ id }, { $set: update });
    const fresh = await db.collection('user_lists').findOne({ id });
    return NextResponse.json({ success: true, list: serializeList(fresh as unknown as UserList, true) }, { headers: PRIVATE_CACHE });
  } catch (error) {
    console.error('[lists/:id] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update list' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (body?.action !== 'delete') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

    const { db, list, error } = await requireOwnedList(request, id, body.visitor_id);
    if (!list) return error;

    await db.collection('user_list_items').deleteMany({ list_id: id });
    await db.collection('user_lists').deleteOne({ id });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[lists/:id] POST error:', error);
    return NextResponse.json({ error: 'Failed to delete list' }, { status: 500 });
  }
}
