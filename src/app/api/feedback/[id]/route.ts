import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { sendFeedbackReplyEmail } from '@/lib/feedback-reply-email';

// PATCH /api/feedback/[id] — update lifecycle state (admin only)
// Body: { read?, addressed?, addressed_action?, addressed_link?, reply_message? }
// When an item is newly marked addressed and the submitter left an email, we
// auto-send them a "we read your feedback and made a change" note (once).
export const PATCH = withAdminAuth(async (request: NextRequest, _session, context) => {
  try {
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const body = await request.json();
    const update: Record<string, unknown> = { updated_at: new Date() };

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
      update.addressed_by = _session.user?.email || 'admin';
      if (typeof body.addressed_action === 'string') update.addressed_action = body.addressed_action.slice(0, 1000);
      if (typeof body.addressed_link === 'string') update.addressed_link = body.addressed_link.slice(0, 500);
      if (typeof body.reply_message === 'string' && body.reply_message.trim()) {
        replyMessage = body.reply_message.trim().slice(0, 1000);
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

    const db = await getDb();
    // Read first so we have the submitter's email + original message, and can
    // tell whether they've already been notified.
    const existing = await db.collection('feedback').findOne({ _id: new ObjectId(id) });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await db.collection('feedback').updateOne(
      { _id: new ObjectId(id) },
      { $set: update },
    );

    // Auto-reply: newly addressed + submitter left an email + not already notified.
    let replied = false;
    if (
      body.addressed === true &&
      typeof existing.email === 'string' && existing.email.includes('@') &&
      !existing.reply_sent_at
    ) {
      replied = await sendFeedbackReplyEmail({
        to: existing.email,
        name: existing.name,
        originalMessage: existing.message || '',
        replyBody: replyMessage || (typeof body.addressed_action === 'string' ? body.addressed_action : null),
        link: typeof body.addressed_link === 'string' ? body.addressed_link : null,
      });
      if (replied) {
        await db.collection('feedback').updateOne(
          { _id: new ObjectId(id) },
          { $set: { reply_sent_at: new Date(), reply_recipient: existing.email } },
        );
      }
    }

    return NextResponse.json({ ok: true, replied });
  } catch (error) {
    console.error('Feedback PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update feedback' }, { status: 500 });
  }
});
