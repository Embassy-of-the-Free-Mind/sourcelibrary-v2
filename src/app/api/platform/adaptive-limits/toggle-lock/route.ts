import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const POST = withAdminAuth(async (_req: NextRequest) => {
  try {
    const db = await getDb();
    const doc = await db.collection('system_config').findOne({ _id: 'adaptive_limits' });
    const newLocked = !doc?.locked;

    await db.collection('system_config').updateOne(
      { _id: 'adaptive_limits' },
      {
        $set: {
          locked: newLocked,
          updated_at: new Date(),
          updated_by: 'admin',
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ locked: newLocked });
  } catch (error) {
    console.error('[toggle-lock]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to toggle' },
      { status: 500 }
    );
  }
});
