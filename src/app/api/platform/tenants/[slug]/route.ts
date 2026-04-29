import { NextRequest, NextResponse } from 'next/server';
import { Session } from 'next-auth';
import { withSuperadminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import type { RecordStatus } from '@/lib/types/status';

const VALID_STATUSES: RecordStatus[] = ['active', 'suspended', 'deleted'];

export const PATCH = withSuperadminAuth(async (req: NextRequest, _session: Session, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const body = await req.json();

  const db = await getDb();
  const tenant = await db.collection('tenants').findOne({ slug });
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    }
    update.name = body.name.trim();
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    // Deletion requires explicit confirmation word from the caller
    if (body.status === 'deleted') {
      if (body.confirmationWord !== 'delete') {
        return NextResponse.json({ error: 'Confirmation required: send confirmationWord = "delete"' }, { status: 400 });
      }
    }
    update.status = body.status;
  }

  if (body.settings !== undefined) {
    if (typeof body.settings.publicBrowsing === 'boolean') {
      update['settings.publicBrowsing'] = body.settings.publicBrowsing;
    }
    if (typeof body.settings.allowSignup === 'boolean') {
      update['settings.allowSignup'] = body.settings.allowSignup;
    }
  }

  if (body.pipeline !== undefined) {
    const quota = body.pipeline.geminiQuota;
    if (quota !== undefined) {
      if (typeof quota !== 'number' || quota < 1) {
        return NextResponse.json({ error: 'geminiQuota must be a positive number' }, { status: 400 });
      }
      update['pipeline.geminiQuota'] = quota;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  await db.collection('tenants').updateOne({ slug }, { $set: update });
  const updated = await db.collection('tenants').findOne({ slug });
  return NextResponse.json({ tenant: updated });
});
