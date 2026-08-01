import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { stripe } from '@/lib/stripe';
import { getDb } from '@/lib/mongodb';
import { toUserId } from '@/lib/user-id';

/**
 * Creates a Stripe Billing Portal session for the current user.
 * Members can manage their subscription, update payment, or cancel.
 */
export async function POST() {
  if (!stripe) {
    return NextResponse.json({ error: 'Payments not configured' }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const db = await getDb();
  const user = await db.collection('users').findOne(
    { _id: toUserId(session.user.id) as any },
    { projection: { 'membership.stripeCustomerId': 1 } }
  );

  const customerId = user?.membership?.stripeCustomerId;
  if (!customerId) {
    return NextResponse.json({ error: 'No membership found' }, { status: 404 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://sourcelibrary.org';

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/account`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    console.error('[stripe] Portal error:', error);
    return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 });
  }
}
