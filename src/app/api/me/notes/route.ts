import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { READER_MESSAGES, type ReaderMessage } from '@/lib/reader-messages';

// GET /api/me/notes — replies we have sent this reader that they have not yet
// seen on the site (v3#405). The same message also went by email; this is the
// copy that cannot land in a spam folder.
//
// POST /api/me/notes { id } — the reader has seen it (pressed the button on
// the note). Recorded as read_at, which /admin/introductions shows on the card.
//
// Only `sent` messages are notes: a queued one is still a draft the admin may
// edit or discard.

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ notes: [] }, { status: 401 });
  const db = await getDb();
  const rows = await db.collection<ReaderMessage>(READER_MESSAGES)
    .find(
      { to_user_id: String(session.user.id), status: 'sent', read_at: null },
      { projection: { body: 1, sent_at: 1 } },
    )
    .sort({ sent_at: 1 })
    .limit(5)
    .toArray();
  return NextResponse.json(
    { notes: rows.map(r => ({ id: String(r._id), body: r.body, sent_at: r.sent_at })) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const db = await getDb();
  // Scoped to the signed-in reader, so nobody can mark someone else's note read.
  await db.collection(READER_MESSAGES).updateOne(
    { _id: new ObjectId(id), to_user_id: String(session.user.id), read_at: null },
    { $set: { read_at: new Date() } },
  );
  return NextResponse.json({ ok: true });
}
