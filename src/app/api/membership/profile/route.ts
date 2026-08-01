import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { toUserId } from '@/lib/user-id';

/**
 * GET: Fetch the current user's member profile.
 * PATCH: Update display name and bio for the members page.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const db = await getDb();
  const user = await db.collection('users').findOne(
    { _id: toUserId(session.user.id) as any },
    { projection: { 'membership.profile': 1 } }
  );

  return NextResponse.json(user?.membership?.profile || { displayName: '', bio: '', visible: true });
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const body = await request.json();
  const displayName = (body.displayName || '').trim().slice(0, 100);
  const bio = (body.bio || '').trim().slice(0, 200);
  const visible = body.visible !== false; // default to visible

  const db = await getDb();
  await db.collection('users').updateOne(
    { _id: toUserId(session.user.id) as any },
    {
      $set: {
        'membership.profile': { displayName, bio, visible },
      },
    },
  );

  return NextResponse.json({ displayName, bio, visible });
}
