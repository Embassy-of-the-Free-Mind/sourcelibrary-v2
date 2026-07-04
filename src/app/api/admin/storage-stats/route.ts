import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

/**
 * Latest library storage snapshot (written nightly by /api/cron/storage-stats).
 * Image bytes are exact (Cloudflare R2 analytics); text bytes are a
 * seed-calibrated estimate — see issue #2972.
 */
export const GET = withAdminAuth(async () => {
  try {
    const db = await getDb();
    const stats = await db
      .collection('system_config')
      .findOne({ _id: 'storage_stats' } as object);
    if (!stats) {
      return NextResponse.json(
        { error: 'No snapshot yet — run /api/cron/storage-stats once' },
        { status: 404 },
      );
    }
    return NextResponse.json(stats);
  } catch (error) {
    console.error('storage-stats read error:', error);
    return NextResponse.json({ error: 'Failed to read storage stats' }, { status: 500 });
  }
});
