import { NextRequest, NextResponse } from 'next/server';
import { withSuperadminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { inviteMember } from '@/lib/memberships';

export const GET = withSuperadminAuth(async () => {
  const db = await getDb();
  const members = await db
    .collection('memberships')
    .find({ tenantId: null })
    .sort({ addedAt: -1 })
    .toArray();
  return NextResponse.json({ members });
});

export const POST = withSuperadminAuth(async (req: NextRequest, session) => {
  const { email } = await req.json();

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const db = await getDb();
  const loginUrl = `${process.env.NEXTAUTH_URL || 'https://sourcelibrary.org'}/platform/login`;

  await inviteMember({
    db,
    email,
    role: 'superadmin',
    tenantId: null,
    tenantName: 'Source Library Platform',
    invitedBy: (session.user as any).id || null,
    loginUrl,
  });

  return NextResponse.json({ ok: true });
});
