import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';

export const GET = withAdminAuth(async (
  _request: NextRequest,
  _session,
  context: { params: Promise<{ id: string }> }
) => {
  const { id } = await context.params;
  const db = await getDb();
  const draft = await db.collection('email_drafts').findOne({ id });

  if (!draft) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }

  return NextResponse.json({ draft: { ...draft, _id: undefined } });
});

export const PATCH = withAdminAuth(async (
  request: NextRequest,
  _session,
  context: { params: Promise<{ id: string }> }
) => {
  const { id } = await context.params;
  const body = await request.json();
  const db = await getDb();

  const allowedFields = ['subject', 'html', 'preview_text'];
  const updates: Record<string, any> = { updated_at: new Date() };
  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  const result = await db.collection('email_drafts').findOneAndUpdate(
    { id, status: 'draft' },
    { $set: updates },
    { returnDocument: 'after' }
  );

  if (!result) {
    return NextResponse.json({ error: 'Draft not found or not editable' }, { status: 404 });
  }

  return NextResponse.json({ draft: { ...result, _id: undefined } });
});

export const DELETE = withAdminAuth(async (
  _request: NextRequest,
  _session,
  context: { params: Promise<{ id: string }> }
) => {
  const { id } = await context.params;
  const db = await getDb();

  const result = await db.collection('email_drafts').deleteOne({ id, status: 'draft' });

  if (result.deletedCount === 0) {
    return NextResponse.json({ error: 'Draft not found or already sent' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
});
