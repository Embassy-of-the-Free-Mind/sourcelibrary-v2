import { NextRequest, NextResponse } from 'next/server';
import { Session } from 'next-auth';
import { ObjectId } from 'mongodb';
import { withSuperadminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';

export const DELETE = withSuperadminAuth(async (_req: NextRequest, _session: Session, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;

  let objectId: ObjectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    return NextResponse.json({ error: 'Invalid membership ID' }, { status: 400 });
  }

  const db = await getDb();

  // Only allow soft-deleting platform-level memberships (tenantId: null)
  const membership = await db.collection('memberships').findOne({ _id: objectId });
  if (!membership) {
    return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
  }
  if (membership.tenantId !== null) {
    return NextResponse.json({ error: 'This endpoint only removes platform members' }, { status: 400 });
  }

  // Guard: must always have at least one active superadmin
  if (membership.status === 'active' && membership.role === 'superadmin') {
    const activeCount = await db.collection('memberships').countDocuments({
      tenantId: null,
      role: 'superadmin',
      status: 'active',
    });
    if (activeCount <= 1) {
      return NextResponse.json(
        { error: 'Cannot remove the last active superadmin. Add another superadmin first.' },
        { status: 400 }
      );
    }
  }

  await db.collection('memberships').updateOne(
    { _id: objectId },
    { $set: { status: 'deleted', deletedAt: new Date() } }
  );

  return NextResponse.json({ ok: true });
});
