import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { z } from 'zod';

const profileSchema = z.object({
  displayName: z.string().max(100).optional(),
  bio: z.string().max(10000).optional(), // Markdown — the whole point
  interests: z.array(z.string().max(100)).max(20).optional(),
  languages: z.array(z.string().max(50)).max(10).optional(),
  visible: z.boolean().optional(),
});

/**
 * GET /api/embassy/profile — Get your own Embassy profile
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const db = await getDb();
  const profile = await db.collection('embassy_profiles').findOne(
    { userId: session.user.id },
  );

  if (!profile) {
    // Return defaults from the user record
    const user = await db.collection('users').findOne(
      { _id: session.user.id as any },
      { projection: { name: 1, image: 1, 'membership.profile': 1 } },
    );
    return NextResponse.json({
      displayName: user?.membership?.profile?.displayName || user?.name || '',
      bio: user?.membership?.profile?.bio || '',
      interests: [],
      languages: [],
      visible: true,
      image: user?.image || null,
    });
  }

  return NextResponse.json({
    displayName: profile.displayName,
    bio: profile.bio,
    interests: profile.interests || [],
    languages: profile.languages || [],
    visible: profile.visible !== false,
    image: profile.image || null,
    updatedAt: profile.updatedAt,
  });
}

/**
 * PUT /api/embassy/profile — Create or update your Embassy profile
 */
export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid profile', details: parsed.error.flatten() }, { status: 400 });
  }

  const db = await getDb();
  const user = await db.collection('users').findOne(
    { _id: session.user.id as any },
    { projection: { name: 1, image: 1 } },
  );

  const now = new Date();
  const profileData = {
    userId: session.user.id,
    displayName: parsed.data.displayName || user?.name || 'A visitor',
    bio: parsed.data.bio || '',
    interests: parsed.data.interests || [],
    languages: parsed.data.languages || [],
    visible: parsed.data.visible !== false,
    image: user?.image || null,
    updatedAt: now,
  };

  await db.collection('embassy_profiles').updateOne(
    { userId: session.user.id },
    { $set: profileData, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );

  // Also sync displayName back to the membership profile (for discussions etc.)
  await db.collection('users').updateOne(
    { _id: session.user.id as any },
    { $set: { 'membership.profile.displayName': profileData.displayName } },
  );

  return NextResponse.json(profileData);
}
