/**
 * One reading room (#5266).
 *
 * GET    /api/rooms/[slug] — public summary (no owner id, no origins); the
 *                            owner also gets allowed_origins.
 * PATCH  /api/rooms/[slug] — owner only. Any subset of the create body.
 *                            Renaming the slug moves the room's URL.
 * DELETE /api/rooms/[slug] — owner only. Soft: status → 'deleted'. The books
 *                            are untouched; only the room record is retired
 *                            (preservation-policy.md: nothing here deletes
 *                            content, and a deleted room's slug is reusable).
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import {
  READING_ROOMS_COLLECTION,
  getRoomBySlug,
  serializeRoom,
  validateRoomInput,
} from '@/lib/reading-rooms';
import { sourceIsUsable } from '../route';

const PRIVATE_CACHE = { 'Cache-Control': 'private, no-store' };

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { slug } = await params;
    const db = await getDb();
    const room = await getRoomBySlug(db, slug);
    if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE_CACHE });
    const session = await auth();
    const isOwner = !!session?.user?.id && session.user.id === room.owner_id;
    return NextResponse.json({ room: serializeRoom(room, isOwner) }, { headers: PRIVATE_CACHE });
  } catch (err) {
    console.error('[rooms] GET one failed:', err);
    return NextResponse.json({ error: 'Could not load the room' }, { status: 500, headers: PRIVATE_CACHE });
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { slug } = await params;
    const session = await auth();
    const ownerId = session?.user?.id;
    if (!ownerId) return NextResponse.json({ error: 'Sign in' }, { status: 401, headers: PRIVATE_CACHE });

    const db = await getDb();
    const room = await getRoomBySlug(db, slug);
    // 404 for non-owners too — do not confirm a room exists to someone who cannot edit it.
    if (!room || room.owner_id !== ownerId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE_CACHE });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: PRIVATE_CACHE });
    }

    const validated = validateRoomInput(body, { partial: true });
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400, headers: PRIVATE_CACHE });
    const v = validated.value;

    if (v.source) {
      const problem = await sourceIsUsable(db, v.source, ownerId);
      if (problem) return NextResponse.json({ error: problem }, { status: 400, headers: PRIVATE_CACHE });
    }
    if (v.slug && v.slug !== room.slug) {
      const taken = await db.collection(READING_ROOMS_COLLECTION).findOne(
        { slug: v.slug, status: 'active' },
        { projection: { _id: 1 } },
      );
      if (taken) return NextResponse.json({ error: 'That URL name is taken. Pick another.' }, { status: 409, headers: PRIVATE_CACHE });
    }

    const $set: Record<string, unknown> = { updated_at: new Date() };
    for (const key of ['slug', 'name', 'tagline', 'source', 'theme', 'allowed_origins'] as const) {
      if (v[key] !== undefined) $set[key] = v[key];
    }

    try {
      await db.collection(READING_ROOMS_COLLECTION).updateOne({ id: room.id }, { $set });
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        return NextResponse.json({ error: 'That URL name is taken. Pick another.' }, { status: 409, headers: PRIVATE_CACHE });
      }
      throw err;
    }

    const updated = await db.collection(READING_ROOMS_COLLECTION).findOne({ id: room.id }, { projection: { _id: 0 } });
    return NextResponse.json({ room: serializeRoom(updated as unknown as typeof room, true) }, { headers: PRIVATE_CACHE });
  } catch (err) {
    console.error('[rooms] PATCH failed:', err);
    return NextResponse.json({ error: 'Could not save the room' }, { status: 500, headers: PRIVATE_CACHE });
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const { slug } = await params;
    const session = await auth();
    const ownerId = session?.user?.id;
    if (!ownerId) return NextResponse.json({ error: 'Sign in' }, { status: 401, headers: PRIVATE_CACHE });

    const db = await getDb();
    const room = await getRoomBySlug(db, slug);
    if (!room || room.owner_id !== ownerId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE_CACHE });
    }
    await db.collection(READING_ROOMS_COLLECTION).updateOne(
      { id: room.id },
      { $set: { status: 'deleted', deleted_at: new Date(), updated_at: new Date() } },
    );
    return NextResponse.json({ ok: true }, { headers: PRIVATE_CACHE });
  } catch (err) {
    console.error('[rooms] DELETE failed:', err);
    return NextResponse.json({ error: 'Could not delete the room' }, { status: 500, headers: PRIVATE_CACHE });
  }
}
