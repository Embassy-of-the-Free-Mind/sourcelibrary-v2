import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/embassy/profile/[id] — View someone's public Embassy profile
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = await getDb();

  const profile = await db.collection('embassy_profiles').findOne(
    { userId: id, visible: { $ne: false } },
  );

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: profile.userId,
    displayName: profile.displayName,
    bio: profile.bio,
    interests: profile.interests || [],
    languages: profile.languages || [],
    image: profile.image || null,
  });
}
