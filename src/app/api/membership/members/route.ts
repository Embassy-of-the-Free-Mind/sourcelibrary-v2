import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Public endpoint: returns all visible Ficino Society members.
 * Only shows members who have opted in (visible: true, the default).
 */
export async function GET() {
  const db = await getDb();

  const members = await db.collection('users').find(
    {
      'membership.active': true,
      'membership.profile.visible': { $ne: false },
    },
    {
      projection: {
        'membership.profile.displayName': 1,
        'membership.profile.bio': 1,
        'membership.activatedAt': 1,
        name: 1,
      },
      sort: { 'membership.activatedAt': 1 }, // founding members first
    }
  ).toArray();

  const result = members.map(m => ({
    name: m.membership?.profile?.displayName || m.name || 'Anonymous',
    bio: m.membership?.profile?.bio || null,
    since: m.membership?.activatedAt || null,
  }));

  return NextResponse.json({ members: result, count: result.length });
}
