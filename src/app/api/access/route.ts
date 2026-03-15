import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { canDownload, PurchaseType } from '@/lib/purchases';

/**
 * Check if the current user can download a specific item.
 * Returns { allowed: true } if they're a member or have purchased the item.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') as PurchaseType;
  const itemId = searchParams.get('itemId');

  if (!type || !itemId) {
    return NextResponse.json({ error: 'Missing type or itemId' }, { status: 400 });
  }

  // Payments not configured — everything is free
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ allowed: true, reason: 'free' });
  }

  const userId = session?.user?.id || null;
  const isMember = (session?.user as any)?.membership != null;

  // Members always have access
  if (isMember) {
    return NextResponse.json({ allowed: true, reason: 'member' });
  }

  // Check individual purchase
  if (userId) {
    const allowed = await canDownload(userId, type, itemId);
    return NextResponse.json({ allowed, reason: allowed ? 'purchased' : 'none' });
  }

  return NextResponse.json({ allowed: false, reason: 'none' });
}
