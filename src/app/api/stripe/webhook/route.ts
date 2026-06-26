import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { activateMembership, deactivateMembership } from '@/lib/membership';
import { sendMembershipWelcomeEmail } from '@/lib/membership-email';
import { recordPurchase, PurchaseType } from '@/lib/purchases';
import Stripe from 'stripe';
import { getDb } from '@/lib/mongodb';
import { sendAdoptionThankYou } from '@/lib/adoption-email';

/**
 * Look up the Source Library userId from a Stripe customer ID.
 */
async function findUserByCustomerId(customerId: string): Promise<string | null> {
  const db = await getDb();
  const user = await db.collection('users').findOne(
    { 'membership.stripeCustomerId': customerId },
    { projection: { _id: 1 } }
  );
  return user ? String(user._id) : null;
}

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

  try {
    switch (event.type) {
      // Checkout completed — activate membership
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        // Membership subscription checkout
        if (userId && customerId && subscriptionId) {
          const periodEnd = new Date();
          periodEnd.setFullYear(periodEnd.getFullYear() + 1);
          await activateMembership(userId, customerId, subscriptionId, periodEnd);
          console.log(`[stripe] Membership activated for user ${userId}, expires ${periodEnd.toISOString()}`);

          const email = session.customer_details?.email || session.customer_email;
          const name = session.customer_details?.name;
          if (email) {
            sendMembershipWelcomeEmail(email, name || undefined).catch(err =>
              console.error('[stripe] Failed to send welcome email:', err)
            );
          }
        }

        // Single-item purchase checkout
        const purchaseType = session.metadata?.purchaseType as PurchaseType | undefined;
        const purchaseItemId = session.metadata?.itemId;
        if (userId && purchaseType && purchaseItemId && session.payment_status === 'paid') {
          await recordPurchase(userId, purchaseType, purchaseItemId, session.payment_intent as string);
          console.log(`[stripe] Purchase recorded: ${purchaseType} ${purchaseItemId} for user ${userId}`);
        }

        // Adopt-a-book — record the adoption, attach the credit (or keep anonymous), email a certificate
        if (session.metadata?.kind === 'adopt_book' && session.payment_status === 'paid') {
          const adoptBookId = session.metadata.bookId;
          if (adoptBookId) {
            const db = await getDb();
            const creditField = session.custom_fields?.find((f) => f.key === 'creditname');
            // Blank = anonymous. Never publish the payer's card name as the public credit.
            const publicCredit = (creditField?.text?.value || '').trim();
            const payerName = session.customer_details?.name || null;
            const email = session.customer_details?.email || null;
            const now = new Date();

            const bookDoc = await db.collection('books').findOne(
              { id: adoptBookId },
              { projection: { title: 1, display_title: 1, slug: 1 } }
            );
            const bookTitle = (bookDoc?.display_title || bookDoc?.title || 'a book') as string;
            const bookSlug = (session.metadata.bookSlug || bookDoc?.slug || adoptBookId) as string;

            // Mark adopted (hides the CTA, even when anonymous); set the public credit only if given.
            const set: Record<string, unknown> = { digitization_adopted_at: now, updated_at: now };
            if (publicCredit) set.digitization_sponsor = publicCredit;
            await db.collection('books').updateOne({ id: adoptBookId }, { $set: set });

            await db.collection('book_adoptions').insertOne({
              bookId: adoptBookId,
              bookSlug,
              bookTitle,
              sponsor: publicCredit || null,
              anonymous: !publicCredit,
              payer_name: payerName,
              email,
              amount_total: session.amount_total,
              currency: session.currency,
              tier: session.metadata.tier || null,
              stripe_session_id: session.id,
              payment_intent: (session.payment_intent as string) || null,
              created_at: now,
            });
            console.log(`[stripe] Book adopted: ${adoptBookId} → "${publicCredit || 'anonymous'}" (${session.amount_total} ${session.currency})`);

            if (email) {
              const amountLabel = typeof session.amount_total === 'number'
                ? `€${Math.round(session.amount_total / 100).toLocaleString('en-IE')}`
                : undefined;
              sendAdoptionThankYou({
                to: email,
                payerName,
                publicCredit: publicCredit || null,
                bookTitle,
                bookPath: `/book/${bookSlug}`,
                sessionId: session.id,
                amountLabel,
              }).catch((e) => console.error('[stripe] adoption thank-you email failed:', e));
            }
          } else {
            console.warn(`[stripe] adopt_book session ${session.id} missing bookId`);
          }
        }
        break;
      }

      // Subscription renewed (annual payment succeeded)
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        // Skip the first invoice — handled by checkout.session.completed
        if (invoice.billing_reason === 'subscription_create') break;

        const userId = await findUserByCustomerId(customerId);
        if (userId) {
          // period_end on the invoice is the end of the billing period just paid for
          const periodEnd = new Date(invoice.period_end * 1000);
          const subId = (invoice.parent?.subscription_details?.subscription as string) || '';
          await activateMembership(userId, customerId, subId, periodEnd);
          console.log(`[stripe] Membership renewed for user ${userId}, new expiry ${periodEnd.toISOString()}`);
        }
        break;
      }

      // Subscription cancelled or expired
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const userId = subscription.metadata?.userId || await findUserByCustomerId(customerId);

        if (userId) {
          await deactivateMembership(userId);
          console.log(`[stripe] Membership deactivated for user ${userId}`);
        }
        break;
      }

      // Payment failed on renewal
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        console.warn(`[stripe] Payment failed for customer ${invoice.customer}, invoice ${invoice.id}`);
        break;
      }
    }
  } catch (error) {
    console.error(`[stripe] Error processing ${event.type}:`, error);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
