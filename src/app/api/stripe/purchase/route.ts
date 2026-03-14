import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { stripe } from '@/lib/stripe';
import { PRICES, PurchaseType } from '@/lib/purchases';
import { getDb } from '@/lib/mongodb';

/**
 * Create a Stripe Checkout session for a single-item purchase (book or image).
 */
export async function POST(request: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: 'Payments not configured' }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const type = body?.type as PurchaseType;
  const itemId = body?.itemId as string;
  const itemName = body?.itemName as string;
  const returnUrl = body?.returnUrl as string;

  if (!type || !itemId || !PRICES[type]) {
    return NextResponse.json({ error: 'Invalid purchase type or item' }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://sourcelibrary.org';
  const price = PRICES[type];

  // Reuse Stripe customer if we have one
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
    await db.collection('users').updateOne(
      { _id: session.user.id as any },
      { $set: { 'membership.stripeCustomerId': customerId } }
    );
  }

  const successUrl = returnUrl && returnUrl.startsWith('/')
    ? `${baseUrl}${returnUrl}?purchased=true`
    : `${baseUrl}?purchased=true`;

  const cancelUrl = returnUrl && returnUrl.startsWith('/')
    ? `${baseUrl}${returnUrl}`
    : baseUrl;

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      metadata: {
        userId: session.user.id,
        purchaseType: type,
        itemId,
      },
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: type === 'book'
                ? `Book Download: ${itemName || itemId}`
                : `Image Download: ${itemName || itemId}`,
              description: type === 'book'
                ? 'PDF/EPUB download — all formats included'
                : 'High-resolution image download',
            },
            unit_amount: price.amount,
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    console.error('[stripe] Purchase checkout error:', error);
    return NextResponse.json({ error: 'Failed to create checkout' }, { status: 500 });
  }
}
