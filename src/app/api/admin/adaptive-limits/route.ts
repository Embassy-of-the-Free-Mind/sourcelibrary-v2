import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { setAdaptiveLimits, LIMIT_RANGES, type LimitKey, type AdaptiveLimits } from '@/lib/adaptive-limits';

export const maxDuration = 10;

/**
 * GET /api/admin/adaptive-limits
 * Return current limits + health state
 */
export const GET = withAdminAuth(async () => {
  const db = await getDb();
  const doc = await db.collection('system_config').findOne({ _id: 'adaptive_limits' as any });

  if (!doc) {
    return NextResponse.json({
      seeded: false,
      message: 'No adaptive limits document yet. Will be created on next pipeline cron run.',
      ranges: LIMIT_RANGES,
    });
  }

  return NextResponse.json({
    limits: doc.limits,
    health: doc.health,
    locked: doc.locked ?? false,
    updated_at: doc.updated_at,
    updated_by: doc.updated_by,
    ranges: LIMIT_RANGES,
  });
});

/**
 * PATCH /api/admin/adaptive-limits
 * Admin override: set specific limits and/or lock adaptive adjustments
 *
 * Body: { limits?: Partial<AdaptiveLimits>, locked?: boolean }
 */
export const PATCH = withAdminAuth(async (request: NextRequest) => {
  const db = await getDb();
  const body = await request.json();

  // Validate limit keys
  if (body.limits) {
    const invalidKeys = Object.keys(body.limits).filter(k => !(k in LIMIT_RANGES));
    if (invalidKeys.length > 0) {
      return NextResponse.json(
        { error: `Invalid limit keys: ${invalidKeys.join(', ')}. Valid: ${Object.keys(LIMIT_RANGES).join(', ')}` },
        { status: 400 }
      );
    }

    // Validate types
    for (const [key, val] of Object.entries(body.limits)) {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        return NextResponse.json(
          { error: `Limit ${key} must be a finite number, got ${typeof val}` },
          { status: 400 }
        );
      }
    }
  }

  const result = await setAdaptiveLimits(
    db,
    body.limits as Partial<AdaptiveLimits> | undefined,
    body.locked as boolean | undefined
  );

  return NextResponse.json({
    limits: result.limits,
    health: result.health,
    locked: result.locked,
    updated_at: result.updated_at,
    updated_by: result.updated_by,
  });
});

/**
 * POST /api/admin/adaptive-limits (with ?reset=true)
 * Reset to defaults and unlock
 */
export const POST = withAdminAuth(async (request: NextRequest) => {
  const db = await getDb();
  const url = new URL(request.url);

  if (url.searchParams.get('reset') !== 'true') {
    return NextResponse.json(
      { error: 'POST requires ?reset=true query parameter' },
      { status: 400 }
    );
  }

  const defaults: Partial<AdaptiveLimits> = {};
  for (const [key, range] of Object.entries(LIMIT_RANGES)) {
    defaults[key as LimitKey] = range.default;
  }

  const result = await setAdaptiveLimits(db, defaults, false);

  return NextResponse.json({
    reset: true,
    limits: result.limits,
    locked: result.locked,
    updated_at: result.updated_at,
  });
});
