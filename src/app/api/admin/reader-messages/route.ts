import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import {
  READER_MESSAGES, MAX_MESSAGE, introductionQuote, sendReaderMessage, type ReaderMessage,
} from '@/lib/reader-messages';

/**
 * GET /api/admin/reader-messages?kind=introduction
 *   Every message written to readers from that screen, newest first: the
 *   outbox (queued/failed) and the history shown on each card (v3#405).
 *
 * POST /api/admin/reader-messages
 *   { kind: 'introduction', source_id: <users._id>, body, send_now?: boolean }
 *   Writes a reply and keeps it. The recipient, name and quoted text come from
 *   the user record, never from the client. send_now sends it at once;
 *   otherwise it waits in the outbox.
 */
export const GET = withAdminAuth(async () => {
  const db = await getDb();
  const messages = await db.collection<ReaderMessage>(READER_MESSAGES)
    .find({ 'source.kind': 'introduction' })
    .sort({ created_at: -1 })
    .limit(5000)
    .toArray();
  return NextResponse.json({
    messages: messages.map(m => ({ ...m, _id: String(m._id) })),
  });
});

export const POST = withAdminAuth(async (request: NextRequest, session) => {
  let body: { kind?: string; source_id?: string; body?: string; send_now?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (body.kind !== 'introduction') {
    return NextResponse.json({ error: 'kind must be introduction' }, { status: 400 });
  }
  const text = String(body.body ?? '').trim();
  if (!text) return NextResponse.json({ error: 'body required' }, { status: 400 });
  if (!body.source_id || !ObjectId.isValid(body.source_id)) {
    return NextResponse.json({ error: 'source_id must be a user id' }, { status: 400 });
  }

  const db = await getDb();
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(body.source_id) },
    { projection: { name: 1, email: 1, profile: 1 } },
  );
  const email = typeof user?.email === 'string' && user.email.includes('@') ? user.email : null;
  if (!user || !email) {
    return NextResponse.json({ error: 'no reader with an email for that id' }, { status: 404 });
  }

  const now = new Date();
  const msg: ReaderMessage = {
    source: { kind: 'introduction', id: body.source_id },
    to_email: email,
    to_user_id: body.source_id,
    to_name: (user.name as string) || null,
    quoted: introductionQuote(user.profile as Record<string, unknown> | undefined),
    body: text.slice(0, MAX_MESSAGE),
    by: session.user?.email || 'admin',
    status: 'queued',
    created_at: now,
    updated_at: now,
    sent_at: null,
    error: null,
    attempts: 0,
  };
  const { insertedId } = await db.collection<ReaderMessage>(READER_MESSAGES).insertOne(msg);
  msg._id = insertedId;

  let sent: boolean | null = null;
  if (body.send_now === true) sent = await sendReaderMessage(db, msg);
  return NextResponse.json({ ok: true, id: String(insertedId), sent });
});
