import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

// PATCH /api/feedback/[id] — update lifecycle state (admin only)
// Body: { read?: boolean, addressed?: boolean, addressed_action?: string, addressed_link?: string }
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

    if (body.addressed === true) {
      update.read = true;
      update.read_at = update.read_at ?? new Date();
      update.addressed = true;
      update.addressed_at = new Date();
      update.addressed_by = _session.user?.email || 'admin';
      if (typeof body.addressed_action === 'string') update.addressed_action = body.addressed_action.slice(0, 1000);
      if (typeof body.addressed_link === 'string') update.addressed_link = body.addressed_link.slice(0, 500);
    } else if (body.addressed === false) {
      update.addressed = false;
      update.addressed_at = null;
      update.addressed_by = null;
      update.addressed_action = null;
      update.addressed_link = null;
    }

    const db = await getDb();
    const r = await db.collection('feedback').updateOne(
      { _id: new ObjectId(id) },
      { $set: update },
    );
    if (r.matchedCount === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Feedback PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update feedback' }, { status: 500 });
  }
});
