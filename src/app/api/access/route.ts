import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { canDownload, classifyImageAccess, PurchaseType } from '@/lib/purchases';

/**
 * Check if the current user can download a specific item.
 *
 * Returns:
 *  - { allowed: true, reason: 'member' | 'purchased' | 'free' }
 *  - { allowed: false, reason: 'signin' | 'purchase' }
 *
 * Also returns `imageAccess` ('open' | 'nc-free' | 'blocked') for book items so
 * the UI can render NC-licensed image options as "Free with sign-in" without
 * routing the user through Stripe.
 *
 * All downloads require sign-in — anonymous users always get allowed:false.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') as PurchaseType;
  const itemId = searchParams.get('itemId');

  if (!type || !itemId) {
    return NextResponse.json({ error: 'Missing type or itemId' }, { status: 400 });
  }

  const userId = session?.user?.id || null;
  const isMember = (session?.user as any)?.membership != null;

  const imageAccess = type === 'book' ? await classifyImageAccess(itemId) : 'open';

  // Sign-in is the floor for all downloads
  if (!userId) {
    return NextResponse.json({ allowed: false, reason: 'signin', imageAccess });
  }

  // Stripe disabled → signed-in is sufficient
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ allowed: true, reason: 'free', imageAccess });
  }

  if (isMember) {
    return NextResponse.json({ allowed: true, reason: 'member', imageAccess });
  }

  const allowed = await canDownload(userId, type, itemId);
  return NextResponse.json({
    allowed,
    reason: allowed ? 'purchased' : 'purchase',
    imageAccess,
  });
}
