import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

/**
 * POST /api/ficino/join — Join the Ficino Society (free)
 * Sets membership.joined = true on the user document.
 * Separate from financial contribution (membership.active via Stripe).
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const db = await getDb();
  const now = new Date();

  await db.collection('users').updateOne(
    { _id: session.user.id as any },
    {
      $set: {
        'membership.joined': true,
      },
      $setOnInsert: {
        'membership.joinedAt': now,
      },
    },
  );

  // Also set joinedAt if it doesn't exist yet
  await db.collection('users').updateOne(
    { _id: session.user.id as any, 'membership.joinedAt': { $exists: false } },
    { $set: { 'membership.joinedAt': now } },
  );

  return NextResponse.json({ joined: true });
}
