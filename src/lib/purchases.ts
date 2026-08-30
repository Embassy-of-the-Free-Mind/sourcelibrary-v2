import { getDb } from './mongodb';
import { toUserId } from './user-id';

export const PRICES = {
  book: { amount: 500, label: '$5' },   // cents
  image: { amount: 200, label: '$2' },
} as const;

/** Licenses that prohibit commercial use of page images. */
const NC_LICENSE_PATTERNS = [
  /\bnc\b/i,        // NoC-NC, CC-BY-NC, CC-BY-NC-ND, CC-BY-NC-SA
  /non.?commercial/i,
];

export type ImageAccess =
  | 'open'      // No license concern — flows through the normal member-or-pay gate
  | 'nc-free'   // NC-licensed — free for any signed-in user, never enters the paid flow
  | 'blocked';  // Unknown license + no public-domain signal — withheld entirely

/**
 * Classify how a book's page images can be downloaded.
 *
 *  - 'open': public domain, CC-BY, BPH provider, or year_published < 1930.
 *           Flows through the normal canDownload() / Stripe gate.
 *  - 'nc-free': any NoC-NC / CC-BY-NC variant. We're a non-commercial scholarly
 *              platform, so redistribution is fine — but charging for an NC scan
 *              would cross the commercial line. So: free for any signed-in user.
 *  - 'blocked': unknown license, non-BPH, not pre-1930. Conservative default.
 */
export async function classifyImageAccess(bookId: string): Promise<ImageAccess> {
  const db = await getDb();
  const book = await db.collection('books').findOne(
    { $or: [{ id: bookId }, { _id: bookId as any }] },
    { projection: { 'image_source.license': 1, 'image_source.provider': 1, year: 1 } },
  );
  if (!book) return 'blocked';
  const license = book.image_source?.license;
  const provider = book.image_source?.provider;
  // `year` — NOT `year_published`, which no book has ever had (#4131). This
  // projected and read a nonexistent field, so the pre-1930 release below never
  // fired once and 4,840 public-domain library scans stayed blocked on an
  // `unknown` license. `books.published` is the free-text twin and must never be
  // parsed for this (#3718); `year` is the numeric one, on 49,959 books.
  const year = (book as { year?: number }).year;
  if (provider === 'bph') return 'open';
  if (typeof year === 'number' && year < 1930) return 'open';
  if (license && NC_LICENSE_PATTERNS.some(p => p.test(license))) return 'nc-free';
  if (!license || license === 'unknown') return 'blocked';
  return 'open';
}

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
    { _id: toUserId(userId) as any },
    { projection: { 'membership.active': 1 } }
  );
  if (user?.membership?.active) return true;

  // Check individual purchase
  return hasPurchased(userId, type, itemId);
}
