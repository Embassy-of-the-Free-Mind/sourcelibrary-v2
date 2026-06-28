import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

// PATCH /api/share-findings/[id] — mark a submission read/unread (admin only)
export const PATCH = withAdminAuth(async (
  request: NextRequest,
  _session,
  context?: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await context!.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const body = await request.json();
    const read = body.read === true;

    const db = await getDb();
    const result = await db.collection('shared_findings').updateOne(
      { _id: new ObjectId(id) },
      { $set: { read, read_at: read ? new Date() : null } },
    );
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Share-findings patch error:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
});
