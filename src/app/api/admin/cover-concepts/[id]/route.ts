import { NextRequest, NextResponse } from 'next/server';

// mongodb requires the Node.js runtime (never edge).
export const runtime = 'nodejs';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

/**
 * One concept cover. Admin only.
 *
 * DELETE is soft: it stamps `deleted_at` so the concept drops out of every
 * list but its layers stay in the collection and can be restored by clearing
 * the field.
 */

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAdminAuth(async (_req: NextRequest, _session, context: Ctx) => {
  const { id } = await context.params;
  const db = await getDb();
  const concept = await db.collection('cover_concepts').findOne({ id }, { projection: { _id: 0 } });
  if (!concept) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ concept });
});

export const DELETE = withAdminAuth(async (_req: NextRequest, session, context: Ctx) => {
  const { id } = await context.params;
  const db = await getDb();
  const r = await db.collection('cover_concepts').updateOne(
    { id, deleted_at: null },
    { $set: { deleted_at: new Date(), deleted_by: session.user?.email || null } },
  );
  return NextResponse.json({ ok: r.matchedCount > 0 });
});
