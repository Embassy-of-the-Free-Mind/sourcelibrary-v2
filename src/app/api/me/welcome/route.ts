import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { auth, RESEND_AUDIENCE_ID } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { toUserId } from '@/lib/user-id';
import { buildProfileUpdate } from '@/lib/welcome-profile-update';

// GET /api/me/welcome — the same four fields back, so the reader profile editor
// on /account can prefill them. The welcome page promises this information can be
// changed later; without a read path that promise is only half true.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDb();
    const user = await db.collection('users').findOne(
      { _id: toUserId(session.user.id) as any },
      { projection: { name: 1, profile: 1 } }
    );

    return NextResponse.json({
      name: user?.name || '',
      about_you: user?.profile?.aboutYou || '',
      preferred_language: user?.profile?.preferredLanguage || '',
      help_description: user?.profile?.helpDescription || '',
    });
  } catch (error) {
    console.error('[welcome] read error:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

// POST /api/me/welcome — captures the first-fill of the user profile (name, who
// they are and what draws them here, how they'd like to help) and marks the
// welcome step done. Also serves later edits from /account, where a field the
// reader empties means "remove this", not "didn't answer" — which is why the
// volunteers mirror below has to handle the all-blank case.
//
// Body: { name?: string, about_you?: string, help_description?: string, skip?: boolean }
// Skipping still sets welcomedAt so the gate doesn't fire again.
//
// This is the ONLY place we ask for a name. Google sign-ins arrive with one from
// the OAuth profile; magic-link sign-ins never do, which is why 46% of user docs
// had users.name null when this was written.
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

    // Free text, deliberately — a fixed list can only offer the languages we
    // already thought of, and the point of asking is to learn the ones we
    // didn't. Stored raw for display plus a lowercased key so demand can be
    // grouped without a cleanup pass later.
    const preferredLanguage = typeof body?.preferred_language === 'string'
      ? body.preferred_language.trim().replace(/\s+/g, ' ').slice(0, 60)
      : '';

    const name = typeof body?.name === 'string'
      ? body.name.trim().replace(/\s+/g, ' ').slice(0, 100)
      : '';

    const db = await getDb();
    const email = session.user.email.toLowerCase();
    const now = new Date();

    const userUpdate: Record<string, unknown> = {
      welcomedAt: now,
    };
    if (!skip) {
      // An ABSENT key means "leave this alone"; a present empty string means the
      // reader cleared the box. The distinction is load-bearing — when the two
      // were conflated, a form that rendered blank wrote those blanks over real
      // answers, and two readers lost theirs on 2026-07-30. Callers that cannot
      // show the reader their current value must omit the key. Rule lives in
      // src/lib/welcome-profile-update.ts so a test can reach it.
      Object.assign(userUpdate, buildProfileUpdate(body, now));
      // Only ever set a name, never clear one: a blank field here means "didn't
      // answer", not "remove the name Google gave me".
      if (name) userUpdate.name = name;
    }

    await db.collection('users').updateOne(
      { _id: toUserId(session.user.id) as any },
      { $set: userUpdate }
    );

    // Mirror into volunteers when the user shared anything — keeps the outreach
    // list usable without joining against users.
    //
    // Same absent-vs-empty rule as above, and it matters more here: this mirror
    // is the only reason the two blanked profiles were recoverable at all, so a
    // field nobody sent must never overwrite the copy of record.
    const mirror: Record<string, unknown> = {
      email,
      name: name || session.user.name || null,
      updated_at: now,
    };
    if ('about_you' in (body || {})) mirror.about_you = aboutYou;
    if ('help_description' in (body || {})) mirror.help_description = helpDescription;
    if ('preferred_language' in (body || {})) mirror.preferred_language = preferredLanguage;

    if (!skip && (aboutYou || helpDescription || preferredLanguage)) {
      await db.collection('volunteers').updateOne(
        { email },
        {
          $set: mirror,
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
    } else if (!skip && ('about_you' in (body || {}) || 'help_description' in (body || {}) || 'preferred_language' in (body || {}))) {
      // Everything the caller sent was explicitly cleared. Don't create a row for
      // a reader who never volunteered anything, but do clear the fields they
      // actually cleared on one that exists — otherwise the outreach list keeps
      // quoting prose they deleted. Fields they did NOT send stay untouched.
      await db.collection('volunteers').updateOne({ email }, { $set: mirror });
    }

    // Backfill the Resend contact. It was created at sign-up (events.createUser
    // in src/lib/auth.ts), when a magic-link user had no name to give it — this
    // is the first moment we know one. Best-effort: the profile is already
    // saved, so a mailing-list hiccup must not fail the request.
    if (name && process.env.RESEND_API_KEY) {
      try {
        const parts = name.split(' ');
        await new Resend(process.env.RESEND_API_KEY).contacts.update({
          audienceId: RESEND_AUDIENCE_ID,
          email,
          firstName: parts[0],
          lastName: parts.slice(1).join(' ') || null,
        });
      } catch (error) {
        console.error('[welcome] Resend contact name sync failed:', error);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[welcome] save error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
