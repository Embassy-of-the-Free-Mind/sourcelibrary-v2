import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getAdaptiveLimits, setAdaptiveLimits } from '@/lib/adaptive-limits';
import { withAdminAuth } from '@/lib/auth-helpers';

export const GET = withAdminAuth(async (_req: NextRequest) => {
  try {
    const db = await getDb();
    const limitsWithHealth = await getAdaptiveLimits(db);
    const adaptiveDoc = await db.collection('system_config').findOne({ _id: 'adaptive_limits' as any });

    const { _health, ...limits } = limitsWithHealth;
    return NextResponse.json({
      limits,
      health: _health,
      locked: Boolean(adaptiveDoc?.locked),
    });
  } catch (error) {
    console.error('[adaptive-limits GET]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch' },
      { status: 500 }
    );
  }
});

export const PATCH = withAdminAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { overrides } = body;

    if (!overrides || typeof overrides !== 'object') {
      return NextResponse.json(
        { error: 'overrides must be an object' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const limits = await setAdaptiveLimits(db, overrides);
    return NextResponse.json(limits);
  } catch (error) {
    console.error('[adaptive-limits PATCH]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update' },
      { status: 500 }
    );
  }
});
