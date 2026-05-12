import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

// POST /api/me/welcome — captures first-run survey + marks user welcomed.
// Body: { languages?: string[], interests?: string[], message?: string, skip?: boolean }
// Skipping still sets welcomedAt so the gate doesn't fire again.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const skip = body?.skip === true;
    const languages = Array.isArray(body?.languages)
      ? body.languages.filter((l: unknown) => typeof l === 'string' && l.trim().length > 0).slice(0, 20)
      : [];
    const interests = Array.isArray(body?.interests)
      ? body.interests.filter((i: unknown) => typeof i === 'string' && i.trim().length > 0).slice(0, 20)
      : [];
    const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 2000) : '';

    const db = await getDb();
    const userId = session.user.id;
    const email = session.user.email.toLowerCase();

    // Always mark welcomed (skip or submit — either way, don't re-prompt).
    let userObjectId: ObjectId | string = userId;
    try { userObjectId = new ObjectId(userId); } catch { /* keep string id */ }

    await db.collection('users').updateOne(
      { _id: userObjectId as any },
      { $set: { welcomedAt: new Date() } }
    );

    // Only create/update volunteer record if they actually selected something.
    if (!skip && (languages.length > 0 || interests.length > 0 || message)) {
      await db.collection('volunteers').updateOne(
        { email },
        {
          $set: {
            email,
            name: session.user.name || null,
            languages,
            interests,
            updated_at: new Date(),
          },
          $setOnInsert: {
            source: 'welcome',
            created_at: new Date(),
            contacted: false,
          },
          $push: {
            signals: {
              type: 'welcome',
              message: message || null,
              at: new Date(),
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
