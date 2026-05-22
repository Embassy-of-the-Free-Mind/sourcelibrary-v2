import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { ROLE_LEVEL, type Role } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { inviteMember, type MembershipRole } from '@/lib/memberships';

/**
 * POST /api/[tenant]/catalog/team/invite
 *
 * Editor-only. Editors can invite contributors. Admin+ can also invite
 * editors. Invitations use the existing inviteMember helper which inserts
 * a pending row in `memberships` and emails a magic-link invite via Resend.
 *
 * Body: { email: string, role: 'contributor' | 'editor' }
 */

interface InvitePayload {
  email?: string;
  role?: string;
}

function normalizeRoleLocal(role: unknown): Role {
  if (
    role === 'superadmin' ||
    role === 'admin' ||
    role === 'editor' ||
    role === 'contributor' ||
    role === 'reader'
  ) {
    return role;
  }
  if (role === 'inner_circle' || role === 'curator') return 'editor';
  return 'reader';
}

async function effectiveRoleFor(email: string, tenantId: string, platformRole: Role): Promise<Role> {
  if (ROLE_LEVEL[platformRole] >= ROLE_LEVEL['editor']) return platformRole;
  try {
    const db = await getDb();
    const m = await db.collection('memberships').findOne({
      email: email.toLowerCase(),
      tenantId,
      status: 'active',
    });
    const r = normalizeRoleLocal(m?.role);
    return ROLE_LEVEL[r] >= ROLE_LEVEL[platformRole] ? r : platformRole;
  } catch {
    return platformRole;
  }
}

export const POST = withAuth(
  async (request: NextRequest, session, ctx) => {
    const params = await (ctx?.params as Promise<{ tenant: string }>);
    const { tenant } = params;
    if (tenant !== 'bph') {
      return NextResponse.json({ error: 'Unsupported tenant' }, { status: 404 });
    }

    const inviterEmail = session.user?.email;
    if (!inviterEmail) {
      return NextResponse.json({ error: 'Session missing email' }, { status: 400 });
    }

    let payload: InvitePayload;
    try {
      payload = (await request.json()) as InvitePayload;
    } catch {
      return NextResponse.json({ error: 'Body is not valid JSON' }, { status: 400 });
    }

    const email = (payload.email || '').trim().toLowerCase();
    const requestedRole = payload.role;
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }
    if (requestedRole !== 'contributor' && requestedRole !== 'editor') {
      return NextResponse.json(
        { error: 'role must be "contributor" or "editor"' },
        { status: 400 },
      );
    }

    const db = await getDb();
    const tenantDoc = await db.collection('tenants').findOne({ slug: tenant, status: { $ne: 'deleted' } });
    if (!tenantDoc) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Permission check: editor can invite contributor; admin+ can invite either.
    const platformRole = normalizeRoleLocal((session.user as { role?: unknown }).role);
    const inviterRole = await effectiveRoleFor(inviterEmail, String(tenantDoc.id), platformRole);
    if (requestedRole === 'editor' && ROLE_LEVEL[inviterRole] < ROLE_LEVEL['admin']) {
      return NextResponse.json(
        { error: 'Only admins can invite editors' },
        { status: 403 },
      );
    }

    // Avoid downgrading an existing higher role accidentally. If the invitee
    // already has a membership at a higher level, return a clear error.
    const existing = await db.collection('memberships').findOne({
      email,
      tenantId: tenantDoc.id,
    });
    if (existing && ROLE_LEVEL[normalizeRoleLocal(existing.role)] > ROLE_LEVEL[requestedRole as Role]) {
      return NextResponse.json(
        {
          error: `${email} is already a ${existing.role}. Use the role controls on the team page to change instead of re-inviting.`,
        },
        { status: 409 },
      );
    }

    const tenantName = (tenantDoc.name as string) || tenant;
    const requestUrl = new URL(request.url);
    const loginUrl = `${requestUrl.protocol}//${requestUrl.host}/${tenant}/login?callbackUrl=/catalog`;

    try {
      await inviteMember({
        db,
        email,
        role: requestedRole as MembershipRole,
        tenantId: String(tenantDoc.id),
        tenantName,
        invitedBy: inviterEmail,
        loginUrl,
      });
    } catch (err) {
      console.error('[catalog/team/invite] failed:', err);
      return NextResponse.json({ error: 'Failed to send invitation' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  },
  { minRole: 'editor' },
);
