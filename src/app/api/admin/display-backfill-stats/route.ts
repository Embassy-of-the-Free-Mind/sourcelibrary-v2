import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// SSH to Hetzner would be ideal but we can't from Vercel.
// Instead, parse the log files that the backfill writes to cron_runs collection.
// For now, this endpoint serves data from the cron_runs + cpu log via a simple
// fetch to the Hetzner monitoring endpoint (or falls back to DB).

import { getDb } from '@/lib/mongodb';

export async function GET() {
  try {
    const db = await getDb();

    // Get backfill run history from cron_runs (if the script logs there)
    // For now, parse from the backfill stats stored in system_config
    const stats = await db.collection('system_config').findOne(
      { _id: 'display_backfill_stats' } as any  // eslint-disable-line @typescript-eslint/no-explicit-any
    );

    // Get page counts
    const [withDisplay, totalArchived] = await Promise.all([
      db.collection('pages').countDocuments(
        { display_photo: { $exists: true } },
        { maxTimeMS: 10000 }
      ).catch(() => stats?.totalPages || 0),
      stats?.totalArchived || 2500000,
    ]);

    // Parse CPU load from system_config (updated by a simple cron)
    const cpuData = stats?.cpuLoad || [];
    const runs = stats?.runs || [];

    return NextResponse.json({
      totalPages: withDisplay,
      totalArchived,
      lastRate: runs[runs.length - 1]?.rate || null,
      lastRunAt: runs[runs.length - 1]?.completedAt || null,
      totalGB: runs.reduce((sum: number, r: { gb?: number }) => sum + (r.gb || 0), 0),
      runs,
      cpuLoad: cpuData,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
