import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { activateMembership } from '@/lib/membership';
import Stripe from 'stripe';

export async function POST(request: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: 'Payments not configured' }, { status: 503 });
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature or webhook secret' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe] Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;

    if (userId && session.payment_status === 'paid') {
      try {
        await activateMembership(userId, session.customer as string);
        console.log(`[stripe] Membership activated for user ${userId}`);
      } catch (error) {
        console.error('[stripe] Failed to activate membership:', error);
        return NextResponse.json({ error: 'Activation failed' }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ received: true });
}
