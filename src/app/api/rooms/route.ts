/**
 * Reading rooms API (#5266).
 *
 * GET  /api/rooms — the caller's own rooms. Signed-in only.
 * POST /api/rooms — create a room. Body: { name, slug?, tagline?, source,
 *                   theme?, allowed_origins? }. Signed-in only, capped at
 *                   MAX_ROOMS_PER_OWNER. The source must be a published
 *                   collection or a list the CALLER owns — a room publishes
 *                   its books, so it can only be built on books the owner
 *                   already chose (a private list becomes public through the
 *                   room; that is the owner's explicit act, safe-defaults.md).
 *
 * Owner-only responses are never cacheable (Cache-Control: private).
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import {
  MAX_ROOMS_PER_OWNER,
  READING_ROOMS_COLLECTION,
  getRoomsForOwner,
  newRoomId,
  serializeRoom,
  validateRoomInput,
  type ReadingRoom,
  type RoomSource,
} from '@/lib/reading-rooms';

const PRIVATE_CACHE = { 'Cache-Control': 'private, no-store' };

/** A collection that may back a room: exists, and is not an unpublished curated one. */
export async function sourceIsUsable(
  db: Awaited<ReturnType<typeof getDb>>,
  source: RoomSource,
  ownerId: string,
): Promise<string | null> {
  if (source.type === 'collection') {
    const col = await db.collection('collections').findOne(
      { slug: source.slug, $or: [{ type: { $ne: 'curated' } }, { type: 'curated', published: true }] },
      { projection: { _id: 1 } },
    );
    return col ? null : 'That collection does not exist or is not published.';
  }
  const list = await db.collection('user_lists').findOne(
    { id: source.id, owner_id: ownerId },
    { projection: { _id: 1 } },
  );
  return list ? null : 'That list does not exist or is not yours.';
}

export async function GET() {
  try {
    const session = await auth();
    const ownerId = session?.user?.id;
    if (!ownerId) {
      return NextResponse.json({ error: 'Sign in to make a reading room' }, { status: 401, headers: PRIVATE_CACHE });
    }
    const db = await getDb();
    const rooms = await getRoomsForOwner(db, ownerId);
    return NextResponse.json(
      { rooms: rooms.map(r => serializeRoom(r, true)), max: MAX_ROOMS_PER_OWNER },
      { headers: PRIVATE_CACHE },
    );
  } catch (err) {
    console.error('[rooms] GET failed:', err);
    return NextResponse.json({ error: 'Could not load rooms' }, { status: 500, headers: PRIVATE_CACHE });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const ownerId = session?.user?.id;
    if (!ownerId) {
      return NextResponse.json({ error: 'Sign in to make a reading room' }, { status: 401, headers: PRIVATE_CACHE });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: PRIVATE_CACHE });
    }

    const validated = validateRoomInput(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400, headers: PRIVATE_CACHE });
    }
    const v = validated.value;

    const db = await getDb();

    const existing = await db.collection(READING_ROOMS_COLLECTION)
      .countDocuments({ owner_id: ownerId, status: 'active' });
    if (existing >= MAX_ROOMS_PER_OWNER) {
      return NextResponse.json(
        { error: `You can have up to ${MAX_ROOMS_PER_OWNER} reading rooms. Delete one to make another.` },
        { status: 409, headers: PRIVATE_CACHE },
      );
    }

    const sourceProblem = await sourceIsUsable(db, v.source!, ownerId);
    if (sourceProblem) {
      return NextResponse.json({ error: sourceProblem }, { status: 400, headers: PRIVATE_CACHE });
    }

    const taken = await db.collection(READING_ROOMS_COLLECTION).findOne(
      { slug: v.slug, status: 'active' },
      { projection: { _id: 1 } },
    );
    if (taken) {
      return NextResponse.json({ error: 'That URL name is taken. Pick another.' }, { status: 409, headers: PRIVATE_CACHE });
    }

    const now = new Date();
    const room: ReadingRoom = {
      id: newRoomId(),
      slug: v.slug!,
      owner_id: ownerId,
      name: v.name!,
      tagline: v.tagline ?? '',
      source: v.source!,
      theme: v.theme ?? { logo_url: null, accent_hex: null, home_url: null, home_label: null },
      allowed_origins: v.allowed_origins ?? [],
      status: 'active',
      created_at: now,
      updated_at: now,
    };

    try {
      await db.collection(READING_ROOMS_COLLECTION).insertOne({ ...room });
    } catch (err) {
      // Partial unique index on active slugs backstops the check-then-insert race.
      if ((err as { code?: number })?.code === 11000) {
        return NextResponse.json({ error: 'That URL name is taken. Pick another.' }, { status: 409, headers: PRIVATE_CACHE });
      }
      throw err;
    }

    return NextResponse.json({ room: serializeRoom(room, true) }, { status: 201, headers: PRIVATE_CACHE });
  } catch (err) {
    console.error('[rooms] POST failed:', err);
    return NextResponse.json({ error: 'Could not create the room' }, { status: 500, headers: PRIVATE_CACHE });
  }
}
