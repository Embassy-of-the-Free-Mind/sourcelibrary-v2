import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getMembership } from '@/lib/membership';
import { getDb } from '@/lib/mongodb';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ active: false, plan: null, joined: false });
  }

  const [membership, db] = await Promise.all([
    getMembership(session.user.id),
    getDb(),
  ]);

  // Check if they've joined the Society (free) — separate from financial contribution
  const user = await db.collection('users').findOne(
    { _id: session.user.id as any },
    { projection: { 'membership.joined': 1, 'membership.joinedAt': 1 } }
  );

  return NextResponse.json({
    ...membership,
    joined: !!(user?.membership?.joined || membership.active),
    joinedAt: user?.membership?.joinedAt || null,
  });
}
