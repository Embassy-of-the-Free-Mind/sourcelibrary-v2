import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { randomUUID } from 'crypto';

export const GET = withAdminAuth(async (request: NextRequest) => {
  const db = await getDb();
  const status = request.nextUrl.searchParams.get('status');

  const filter: Record<string, any> = {};
  if (status) filter.status = status;

  const drafts = await db.collection('email_drafts')
    .find(filter)
    .sort({ updated_at: -1 })
    .limit(50)
    .toArray();

  return NextResponse.json({
    drafts: drafts.map(d => ({ ...d, id: d.id || d._id?.toString(), _id: undefined })),
  });
});

export const POST = withAdminAuth(async (request: NextRequest) => {
  const body = await request.json();
  const { subject, html, preview_text } = body;

  if (!subject || !html) {
    return NextResponse.json({ error: 'Subject and HTML are required' }, { status: 400 });
  }

  const db = await getDb();
  const now = new Date();
  const draft = {
    id: randomUUID(),
    type: 'manual' as const,
    status: 'draft' as const,
    subject,
    html,
    preview_text: preview_text || '',
    created_at: now,
    updated_at: now,
  };

  await db.collection('email_drafts').insertOne(draft);

  return NextResponse.json({ draft: { ...draft, _id: undefined } });
});
