import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';

const RESEND_AUDIENCE_ID = '62145526-c584-4230-81f1-a62387c49055';

export const POST = withAdminAuth(async (request: NextRequest) => {
  const body = await request.json();
  const { draft_id } = body;

  if (!draft_id) {
    return NextResponse.json({ error: 'draft_id is required' }, { status: 400 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
  }

  const db = await getDb();
  const draft = await db.collection('email_drafts').findOne({ id: draft_id });

  if (!draft) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }

  if (draft.status !== 'draft') {
    return NextResponse.json({ error: `Draft is already ${draft.status}` }, { status: 400 });
  }

  // Mark as sending
  await db.collection('email_drafts').updateOne(
    { id: draft_id },
    { $set: { status: 'sending', updated_at: new Date() } }
  );

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    // Create and send broadcast
    const broadcast = await resend.broadcasts.create({
      audienceId: RESEND_AUDIENCE_ID,
      from: process.env.EMAIL_FROM || 'Source Library <noreply@sourcelibrary.org>',
      subject: draft.subject,
      html: draft.html,
    });

    if (!broadcast.data?.id) {
      throw new Error('No broadcast ID returned from Resend');
    }

    // Send the broadcast
    await resend.broadcasts.send(broadcast.data.id);

    // Get subscriber count for record
    const subscriberCount = await db.collection('beta_subscribers').countDocuments();

    // Mark as sent
    await db.collection('email_drafts').updateOne(
      { id: draft_id },
      {
        $set: {
          status: 'sent',
          resend_broadcast_id: broadcast.data.id,
          sent_at: new Date(),
          recipients_count: subscriberCount,
          updated_at: new Date(),
        },
      }
    );

    return NextResponse.json({
      success: true,
      broadcast_id: broadcast.data.id,
      recipients_count: subscriberCount,
    });
  } catch (error) {
    console.error('[email/send] Error:', error);

    // Mark as failed
    await db.collection('email_drafts').updateOne(
      { id: draft_id },
      {
        $set: {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Send failed',
          updated_at: new Date(),
        },
      }
    );

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Send failed' },
      { status: 500 }
    );
  }
});
