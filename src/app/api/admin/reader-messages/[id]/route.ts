import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { READER_MESSAGES, MAX_MESSAGE } from '@/lib/reader-messages';

/**
 * PATCH  /api/admin/reader-messages/[id]  { body } — edit an unsent message.
 * DELETE /api/admin/reader-messages/[id]           — discard an unsent message.
 * A sent message is the record of what the reader received, so both refuse it.
 */
const UNSENT = { $in: ['queued', 'failed'] };

export const PATCH = withAdminAuth(async (request: NextRequest, _session, context) => {
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const { body } = await request.json().catch(() => ({}));
  const text = String(body ?? '').trim();
  if (!text) return NextResponse.json({ error: 'body required' }, { status: 400 });
  const db = await getDb();
  const res = await db.collection(READER_MESSAGES).updateOne(
    { _id: new ObjectId(id), status: UNSENT },
    { $set: { body: text.slice(0, MAX_MESSAGE), updated_at: new Date() } },
  );
  if (!res.matchedCount) return NextResponse.json({ error: 'no unsent message with that id' }, { status: 404 });
  return NextResponse.json({ ok: true });
});

export const DELETE = withAdminAuth(async (_request: NextRequest, _session, context) => {
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const db = await getDb();
  const res = await db.collection(READER_MESSAGES).deleteOne({ _id: new ObjectId(id), status: UNSENT });
  if (!res.deletedCount) return NextResponse.json({ error: 'no unsent message with that id' }, { status: 404 });
  return NextResponse.json({ ok: true });
});
