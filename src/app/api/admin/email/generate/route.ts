import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { generateDigest } from '@/lib/email-digest-generator';
import { randomUUID } from 'crypto';

export const maxDuration = 30;

export const POST = withAdminAuth(async (request: NextRequest) => {
  try {
    const body = await request.json().catch(() => ({}));
    const periodDays = body.period_days || 14;

    const { html, subject, context, model } = await generateDigest(periodDays);

    const db = await getDb();
    const now = new Date();
    const draft = {
      id: randomUUID(),
      type: 'digest' as const,
      status: 'draft' as const,
      subject,
      html,
      preview_text: '',
      generated_by: {
        model,
        generated_at: now.toISOString(),
        prompt_context: {
          book_count: context.new_books.length,
          image_count: context.gallery_image_count,
          period_days: periodDays,
        },
      },
      created_at: now,
      updated_at: now,
    };

    await db.collection('email_drafts').insertOne(draft);

    return NextResponse.json({ draft: { ...draft, _id: undefined } });
  } catch (error) {
    console.error('[email/generate] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Generation failed' },
      { status: 500 }
    );
  }
});
