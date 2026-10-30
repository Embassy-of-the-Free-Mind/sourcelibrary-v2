import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { sendFeedbackReplyEmail } from '@/lib/feedback-reply-email';

const MAX_NOTE = 2000;

// PATCH /api/feedback/[id] — update a feedback row (admin only)
// Body (every field optional):
//   read            true | false
//   addressed       true (done) | false (reopen)
//   addressed_action, addressed_link   what was done, shown on the card
//   notify          with addressed:true — email the submitter (default true, once)
//   reply_message   with addressed:true — the note that email carries
//   add_note        an internal note: never emailed; read by the team and by the
//                   triage script, so it is how you tell the next job what to do (#7678)
//   reply_draft     a saved, unsent message to the submitter ('' clears it)
//   send_reply      { message, link? } — email the submitter now without closing the
//                   item; recorded in replies[] (#7678)
export const PATCH = withAdminAuth(async (request: NextRequest, _session, context) => {
  try {
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const body = await request.json();
    const by = _session.user?.email || 'admin';
    const update: Record<string, unknown> = { updated_at: new Date() };
    const push: Record<string, unknown> = {};

    if (body.read === true) {
      update.read = true;
      update.read_at = new Date();
    } else if (body.read === false) {
      update.read = false;
      update.read_at = null;
    }

    let replyMessage: string | null = null;
    if (body.addressed === true) {
      update.read = true;
      update.read_at = update.read_at ?? new Date();
      update.addressed = true;
      update.addressed_at = new Date();
      update.addressed_by = by;
      if (typeof body.addressed_action === 'string') update.addressed_action = body.addressed_action.slice(0, 1000);
      if (typeof body.addressed_link === 'string') update.addressed_link = body.addressed_link.slice(0, 500);
      if (typeof body.reply_message === 'string' && body.reply_message.trim()) {
        replyMessage = body.reply_message.trim().slice(0, MAX_NOTE);
        update.reply_message = replyMessage;
      }
    } else if (body.addressed === false) {
      update.addressed = false;
      update.addressed_at = null;
      update.addressed_by = null;
      update.addressed_action = null;
      update.addressed_link = null;
      // Note: reply_sent_at is intentionally NOT cleared, so re-addressing an
      // item never re-emails a submitter who was already notified.
    }

    if (typeof body.add_note === 'string' && body.add_note.trim()) {
      push.notes = { text: body.add_note.trim().slice(0, MAX_NOTE), by, at: new Date() };
      update.read = update.read ?? true;
    }
    if (typeof body.reply_draft === 'string') {
      update.reply_draft = body.reply_draft.trim() ? body.reply_draft.slice(0, MAX_NOTE) : null;
    }

    const sendReply = body.send_reply && typeof body.send_reply.message === 'string' && body.send_reply.message.trim()
      ? { message: body.send_reply.message.trim().slice(0, MAX_NOTE), link: typeof body.send_reply.link === 'string' ? body.send_reply.link.trim().slice(0, 500) : '' }
      : null;

    const db = await getDb();
    // Read first so we have the submitter's email + original message, and can
    // tell whether they've already been notified.
    const existing = await db.collection('feedback').findOne({ _id: new ObjectId(id) });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const email = typeof existing.email === 'string' && existing.email.includes('@') ? existing.email : null;
    if (sendReply && !email) {
      return NextResponse.json({ error: 'This submitter left no email' }, { status: 400 });
    }

    await db.collection('feedback').updateOne(
      { _id: new ObjectId(id) },
      (Object.keys(push).length ? { $set: update, $push: push } : { $set: update }) as Record<string, unknown>,
    );

    // An explicit reply: sent every time it is asked for (the admin confirms in the UI).
    let replied = false;
    if (sendReply && email) {
      replied = await sendFeedbackReplyEmail({
        to: email,
        name: existing.name,
        originalMessage: existing.message || '',
        replyBody: sendReply.message,
        link: sendReply.link || null,
        kind: 'reply',
      });
      if (replied) {
        await db.collection('feedback').updateOne(
          { _id: new ObjectId(id) },
          {
            $set: { reply_sent_at: new Date(), reply_recipient: email, reply_draft: null, read: true },
            $push: { replies: { message: sendReply.message, link: sendReply.link || null, to: email, by, at: new Date() } },
          } as Record<string, unknown>,
        );
      }
    }

    // Done-email: newly addressed + submitter left an email + not already notified
    // + the admin did not opt out with notify:false.
    if (
      body.addressed === true && body.notify !== false && !sendReply &&
      email && !existing.reply_sent_at
    ) {
      replied = await sendFeedbackReplyEmail({
        to: email,
        name: existing.name,
        originalMessage: existing.message || '',
        replyBody: replyMessage || (typeof body.addressed_action === 'string' ? body.addressed_action : null),
        link: typeof body.addressed_link === 'string' ? body.addressed_link : null,
      });
      if (replied) {
        await db.collection('feedback').updateOne(
          { _id: new ObjectId(id) },
          {
            $set: { reply_sent_at: new Date(), reply_recipient: email, reply_draft: null },
            $push: { replies: { message: replyMessage || body.addressed_action || null, link: body.addressed_link || null, to: email, by, at: new Date(), kind: 'addressed' } },
          } as Record<string, unknown>,
        );
      }
    }

    return NextResponse.json({ ok: true, replied });
  } catch (error) {
    console.error('Feedback PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update feedback' }, { status: 500 });
  }
});
