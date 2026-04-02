import { NextRequest, NextResponse } from 'next/server';

/**
 * Verify that a cron request carries the correct CRON_SECRET bearer token.
 * Returns null if authorized, or a 401 NextResponse if not.
 *
 * Usage in cron routes:
 *   const authError = verifyCronAuth(request);
 *   if (authError) return authError;
 */
export function verifyCronAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
    }
    // Development mode — allow without secret
    return null;
  }

  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${secret}`) {
    return null;
  }

  return NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401 }
  );
}
