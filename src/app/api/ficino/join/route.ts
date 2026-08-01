import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { sendSocietyWelcomeEmail } from '@/lib/membership-email';
import { toUserId } from '@/lib/user-id';

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

  // Check if already joined
  const user = await db.collection('users').findOne(
    { _id: toUserId(session.user.id) as any },
    { projection: { 'membership.joined': 1 } }
  );

  if (user?.membership?.joined) {
    return NextResponse.json({ joined: true });
  }

  await db.collection('users').updateOne(
    { _id: toUserId(session.user.id) as any },
    {
      $set: {
        'membership.joined': true,
        'membership.joinedAt': now,
      },
    },
  );

  // Send welcome email (non-blocking)
  sendSocietyWelcomeEmail(session.user.email, session.user.name || undefined).catch(() => {});

  return NextResponse.json({ joined: true });
}
