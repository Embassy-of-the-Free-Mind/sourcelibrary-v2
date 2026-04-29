import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { LIMIT_RANGES } from '@/lib/adaptive-limits';

export const POST = withAdminAuth(async (_req: NextRequest) => {
  try {
    const db = await getDb();
    const systemConfig = db.collection<{ _id: string; locked?: boolean }>('system_config');

    // Build default limits from LIMIT_RANGES
    const defaultLimits = {} as Record<string, number>;
    for (const [key, range] of Object.entries(LIMIT_RANGES)) {
      defaultLimits[key] = (range as any).default;
    }

    await systemConfig.updateOne(
      { _id: 'adaptive_limits' },
      {
        $set: {
          limits: defaultLimits,
          locked: false,
          updated_at: new Date(),
          updated_by: 'admin',
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ limits: defaultLimits, locked: false });
  } catch (error) {
    console.error('[reset]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reset' },
      { status: 500 }
    );
  }
});
