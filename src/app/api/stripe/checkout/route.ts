import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { stripe, MEMBERSHIP_PRICE, MEMBERSHIP_CURRENCY, MEMBERSHIP_NAME, MEMBERSHIP_DESCRIPTION } from '@/lib/stripe';
import { getDb } from '@/lib/mongodb';

export async function POST() {
  if (!stripe) {
    return NextResponse.json({ error: 'Payments not configured' }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://sourcelibrary.org';

  try {
    // Reuse existing Stripe customer if we have one, otherwise create
    const db = await getDb();
    const user = await db.collection('users').findOne(
      { _id: session.user.id as any },
      { projection: { 'membership.stripeCustomerId': 1 } }
    );

    let customerId = user?.membership?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: session.user.email,
        name: session.user.name || undefined,
        metadata: { userId: session.user.id },
      });
      customerId = customer.id;

      // Store the customer ID even before checkout completes
      await db.collection('users').updateOne(
        { _id: session.user.id as any },
        { $set: { 'membership.stripeCustomerId': customerId } }
      );
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      metadata: {
        userId: session.user.id,
      },
      subscription_data: {
        metadata: { userId: session.user.id },
      },
      line_items: [
        {
          price_data: {
            currency: MEMBERSHIP_CURRENCY,
            product_data: {
              name: MEMBERSHIP_NAME,
              description: MEMBERSHIP_DESCRIPTION,
            },
            unit_amount: MEMBERSHIP_PRICE,
            recurring: { interval: 'year' },
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/ficino-society?success=true`,
      cancel_url: `${baseUrl}/ficino-society`,
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    console.error('[stripe] Checkout error:', error);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
