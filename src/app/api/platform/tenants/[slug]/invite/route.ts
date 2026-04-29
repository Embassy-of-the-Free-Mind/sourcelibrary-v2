import { NextRequest, NextResponse } from 'next/server';
import { Session } from 'next-auth';
import { withSuperadminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { inviteMember, type MembershipRole } from '@/lib/memberships';

const VALID_ROLES: MembershipRole[] = ['admin', 'editor', 'reader'];

export const POST = withSuperadminAuth(async (req: NextRequest, session: Session, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const { email, role = 'admin' } = await req.json();

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const db = await getDb();
  const tenant = await db.collection('tenants').findOne({ slug });
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const loginUrl = `${process.env.NEXTAUTH_URL || 'https://sourcelibrary.org'}/auth/signin`;

  await inviteMember({
    db,
    email,
    role,
    tenantId: tenant.id,
    tenantName: tenant.name,
    invitedBy: (session.user as any).id || null,
    loginUrl,
  });

  return NextResponse.json({ ok: true });
});
