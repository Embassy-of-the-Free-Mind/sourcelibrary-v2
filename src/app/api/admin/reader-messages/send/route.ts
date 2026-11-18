import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { READER_MESSAGES, sendReaderMessage, type ReaderMessage } from '@/lib/reader-messages';

export const maxDuration = 60;

/** Messages per click, sent one at a time with a pause to stay under Resend's rate limit. */
const MAX_PER_CALL = 40;
const PAUSE_MS = 600;

/**
 * POST /api/admin/reader-messages/send  { ids?: string[] }
 * Sends the given ids (queued or failed), or the oldest MAX_PER_CALL queued
 * messages in the outbox. Reports what went and what is left, so the
 * button can say "12 left" rather than pretend the outbox is empty.
 */
export const POST = withAdminAuth(async (request: NextRequest) => {
  const { ids } = (await request.json().catch(() => ({}))) as { ids?: string[] };
  // The outbox button sends `queued` only, so a message that keeps failing is
  // not retried on every click; a failed one goes again when named by id.
  const named = Array.isArray(ids) && ids.length > 0;
  const filter: Record<string, unknown> = named
    ? { status: { $in: ['queued', 'failed'] }, _id: { $in: ids.filter(i => ObjectId.isValid(i)).map(i => new ObjectId(i)) } }
    : { status: 'queued' };
  const db = await getDb();
  const col = db.collection<ReaderMessage>(READER_MESSAGES);
  const batch = await col.find(filter).sort({ created_at: 1 }).limit(MAX_PER_CALL).toArray();

  let sent = 0;
  let failed = 0;
  for (const [i, msg] of batch.entries()) {
    if (i > 0) await new Promise(r => setTimeout(r, PAUSE_MS));
    if (await sendReaderMessage(db, msg)) sent++;
    else failed++;
  }
  const remaining = await col.countDocuments({ status: 'queued' });
  return NextResponse.json({ ok: true, sent, failed, remaining });
});
