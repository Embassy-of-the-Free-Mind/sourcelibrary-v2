import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

// POST /api/me/welcome — captures the first-fill of the user profile (languages,
// interests, how they'd like to help) and marks the welcome step done.
//
// Body: { languages?: string[], interests?: string, help_description?: string, skip?: boolean }
// Skipping still sets welcomedAt so the gate doesn't fire again.
//
// The profile is the durable record — saved to users.profile. A snapshot is also
// upserted into the `volunteers` collection so we can scan and reach out without
// touching user docs.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const skip = body?.skip === true;

    const aboutYou = typeof body?.about_you === 'string'
      ? body.about_you.trim().slice(0, 4000)
      : '';

    const helpDescription = typeof body?.help_description === 'string'
      ? body.help_description.trim().slice(0, 2000)
      : '';

    const db = await getDb();
    const userId = session.user.id;
    const email = session.user.email.toLowerCase();
    const now = new Date();

    let userObjectId: ObjectId | string = userId;
    try { userObjectId = new ObjectId(userId); } catch { /* keep string id */ }

    const userUpdate: Record<string, unknown> = {
      welcomedAt: now,
    };
    if (!skip) {
      userUpdate['profile.aboutYou'] = aboutYou;
      userUpdate['profile.helpDescription'] = helpDescription;
      userUpdate['profile.updatedAt'] = now;
    }

    await db.collection('users').updateOne(
      { _id: userObjectId as any },
      { $set: userUpdate }
    );

    // Mirror into volunteers when the user shared anything — keeps the outreach
    // list usable without joining against users.
    if (!skip && (aboutYou || helpDescription)) {
      await db.collection('volunteers').updateOne(
        { email },
        {
          $set: {
            email,
            name: session.user.name || null,
            about_you: aboutYou,
            help_description: helpDescription,
            updated_at: now,
          },
          $setOnInsert: {
            source: 'welcome',
            created_at: now,
            contacted: false,
          },
          $push: {
            signals: {
              type: 'welcome',
              at: now,
            },
          },
        } as Record<string, unknown>,
        { upsert: true }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[welcome] save error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
