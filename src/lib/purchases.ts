import { getDb } from './mongodb';

export const PRICES = {
  book: { amount: 500, label: '$5' },   // cents
  image: { amount: 200, label: '$2' },
} as const;

export type PurchaseType = keyof typeof PRICES;

export interface Purchase {
  userId: string;
  type: PurchaseType;
  itemId: string;
  purchasedAt: Date;
  stripePaymentId?: string;
}

/**
 * Check if a user has purchased a specific item.
 */
export async function hasPurchased(userId: string, type: PurchaseType, itemId: string): Promise<boolean> {
  const db = await getDb();
  const purchase = await db.collection('purchases').findOne({
    userId,
    type,
    itemId,
  });
  return !!purchase;
}

/**
 * Record a purchase after successful payment.
 */
export async function recordPurchase(
  userId: string,
  type: PurchaseType,
  itemId: string,
  stripePaymentId?: string,
): Promise<void> {
  const db = await getDb();
  await db.collection('purchases').updateOne(
    { userId, type, itemId },
    {
      $setOnInsert: {
        userId,
        type,
        itemId,
        purchasedAt: new Date(),
        stripePaymentId,
      },
    },
    { upsert: true },
  );
}

/**
 * Check if a user can download an item (member OR purchased).
 */
export async function canDownload(userId: string | null, type: PurchaseType, itemId: string): Promise<boolean> {
  if (!userId) return false;

  const db = await getDb();

  // Check membership first (fast path)
  const user = await db.collection('users').findOne(
    { _id: userId as any },
    { projection: { 'membership.active': 1 } }
  );
  if (user?.membership?.active) return true;

  // Check individual purchase
  return hasPurchased(userId, type, itemId);
}
