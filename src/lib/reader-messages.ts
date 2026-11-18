/**
 * reader_messages — one record per message we write to a reader (v3#405).
 *
 * PRIOR ART: src/lib/feedback-reply-email.ts (the email template, reused here
 * with an 'introduction' wording) and the feedback row's own `replies[]` log
 * (src/app/api/feedback/[id]/route.ts), which records sent feedback replies on
 * the feedback document itself. That shape cannot hold a reply that has not
 * been sent yet, and introductions live on `users.profile`, which should not
 * grow a mail log. Hence one collection for both screens.
 *
 * The point: an admin reading /admin/introductions writes the reply on the
 * card and it is KEPT (status `queued`), whether or not it goes out now.
 * Sending is a separate, explicit act: "Send now" on one message, or
 * "Send queued" over the outbox. Nothing here runs on a schedule.
 *
 * Status: queued → sent | failed. A failed message stays in the outbox and can
 * be sent again. A sent message is never edited or deleted (it is the record
 * of what the reader received).
 *
 * A sent message reaches the reader twice: by email, and as a note on the site
 * the next time they are signed in (src/components/auth/ReaderNotes.tsx via
 * /api/me/notes), which records `read_at` when they dismiss it.
 */
import { ObjectId, type Db } from 'mongodb';
import { sendFeedbackReplyEmail } from '@/lib/feedback-reply-email';

export const READER_MESSAGES = 'reader_messages';
export const MAX_MESSAGE = 4000;

export type ReaderMessageSourceKind = 'introduction';
export type ReaderMessageStatus = 'queued' | 'sent' | 'failed';

export interface ReaderMessage {
  _id?: ObjectId;
  source: { kind: ReaderMessageSourceKind; id: string };
  to_email: string;
  to_user_id: string | null;
  to_name: string | null;
  /** What the reader wrote, quoted back in the email. Captured at write time. */
  quoted: string;
  body: string;
  by: string;
  status: ReaderMessageStatus;
  created_at: Date;
  updated_at: Date;
  sent_at: Date | null;
  error: string | null;
  attempts: number;
  /**
   * When the reader saw it as a note on the site (/api/me/notes). Absent and
   * null both mean unseen; Mongo's `{ read_at: null }` matches either.
   */
  read_at?: Date | null;
}

/** What an introduction says, as the email quotes it. */
export function introductionQuote(profile: Record<string, unknown> | undefined): string {
  const about = String(profile?.aboutYou ?? '').trim();
  const help = String(profile?.helpDescription ?? '').trim();
  return [about, help && `Would help by: ${help}`].filter(Boolean).join('\n\n');
}

/**
 * Send one message and record the outcome on its row. When it is an answer
 * to an introduction from a volunteer, the volunteer is marked contacted,
 * because that flag means exactly "we have written back".
 */
export async function sendReaderMessage(db: Db, msg: ReaderMessage): Promise<boolean> {
  const ok = await sendFeedbackReplyEmail({
    to: msg.to_email,
    name: msg.to_name,
    originalMessage: msg.quoted,
    replyBody: msg.body,
    kind: 'introduction',
  });
  const now = new Date();
  await db.collection(READER_MESSAGES).updateOne(
    { _id: msg._id },
    ok
      ? { $set: { status: 'sent', sent_at: now, updated_at: now, error: null }, $inc: { attempts: 1 } }
      : { $set: { status: 'failed', updated_at: now, error: 'email not accepted (see function logs)' }, $inc: { attempts: 1 } },
  );
  if (ok) {
    await db.collection('volunteers').updateOne(
      { email: msg.to_email.trim().toLowerCase() },
      { $set: { contacted: true, contacted_at: now } },
    );
  }
  return ok;
}
