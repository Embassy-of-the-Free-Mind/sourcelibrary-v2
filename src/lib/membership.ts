import { getDb } from './mongodb';

export interface MembershipInfo {
  active: boolean;
  plan: 'ficino' | null;
  expiresAt: Date | null;
  stripeCustomerId: string | null;
}

/**
 * Check if a user has an active Ficino Society membership.
 */
export async function getMembership(userId: string): Promise<MembershipInfo> {
  const db = await getDb();
  const user = await db.collection('users').findOne(
    { _id: userId as any },
    { projection: { membership: 1 } }
  );

  const m = user?.membership;
  if (!m || !m.active) {
    return { active: false, plan: null, expiresAt: null, stripeCustomerId: m?.stripeCustomerId || null };
  }

  // Check expiry — but with subscriptions, Stripe handles this via webhooks.
  // This is a safety net in case the cancellation webhook was missed.
  if (m.expiresAt && new Date(m.expiresAt) < new Date()) {
    await db.collection('users').updateOne(
      { _id: userId as any },
      { $set: { 'membership.active': false } }
    );
    return { active: false, plan: m.plan, expiresAt: new Date(m.expiresAt), stripeCustomerId: m.stripeCustomerId };
  }

  return {
    active: true,
    plan: m.plan || 'ficino',
    expiresAt: m.expiresAt ? new Date(m.expiresAt) : null,
    stripeCustomerId: m.stripeCustomerId || null,
  };
}

/**
 * Activate or renew membership after successful payment.
 * Called from Stripe webhook on invoice.paid.
 */
export async function activateMembership(
  userId: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
  periodEnd: Date,
): Promise<void> {
  const db = await getDb();

  await db.collection('users').updateOne(
    { _id: userId as any },
    {
      $set: {
        'membership.active': true,
        'membership.plan': 'ficino',
        'membership.expiresAt': periodEnd,
        'membership.stripeCustomerId': stripeCustomerId,
        'membership.stripeSubscriptionId': stripeSubscriptionId,
      },
      $setOnInsert: {
        'membership.activatedAt': new Date(),
      },
    },
  );
}

/**
 * Deactivate membership after subscription cancellation.
 * Called from Stripe webhook on customer.subscription.deleted.
 */
export async function deactivateMembership(userId: string): Promise<void> {
  const db = await getDb();

  await db.collection('users').updateOne(
    { _id: userId as any },
    {
      $set: {
        'membership.active': false,
        'membership.cancelledAt': new Date(),
      },
    },
  );
}
