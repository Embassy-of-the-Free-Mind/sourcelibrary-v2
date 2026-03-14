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
    return { active: false, plan: null, expiresAt: null, stripeCustomerId: null };
  }

  // Check expiry
  if (m.expiresAt && new Date(m.expiresAt) < new Date()) {
    // Expired — mark inactive
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
 * Activate membership for a user after successful payment.
 */
export async function activateMembership(
  userId: string,
  stripeCustomerId: string,
  stripeSubscriptionId?: string,
): Promise<void> {
  const db = await getDb();
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  await db.collection('users').updateOne(
    { _id: userId as any },
    {
      $set: {
        membership: {
          active: true,
          plan: 'ficino',
          activatedAt: new Date(),
          expiresAt,
          stripeCustomerId,
          stripeSubscriptionId: stripeSubscriptionId || null,
        },
      },
    }
  );
}
