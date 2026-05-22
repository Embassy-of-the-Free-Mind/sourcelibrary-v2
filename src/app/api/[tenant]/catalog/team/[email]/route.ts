import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { ROLE_LEVEL, type Role } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

/**
 * PATCH /api/[tenant]/catalog/team/[email]
 *   Body: { role: 'contributor' | 'editor' }
 *   Editors can demote/promote contributors. Admin+ can change editor roles.
 *
 * DELETE /api/[tenant]/catalog/team/[email]
 *   Removes a membership row. Self-removal is blocked to avoid lockout.
 *
 * Both endpoints are editor-gated; the per-target role escalation rule is
 * enforced inside.
 */

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

export const PATCH = withAuth(
  async (request: NextRequest, session, ctx) => {
    const params = await (ctx?.params as Promise<{ tenant: string; email: string }>);
    const { tenant, email: rawEmail } = params;
    if (tenant !== 'bph') return NextResponse.json({ error: 'Unsupported tenant' }, { status: 404 });

    const targetEmail = decodeURIComponent(rawEmail).toLowerCase();
    const editorEmail = session.user?.email;
    if (!editorEmail) return NextResponse.json({ error: 'Session missing email' }, { status: 400 });
    if (targetEmail === editorEmail.toLowerCase()) {
      return NextResponse.json({ error: 'Cannot change your own role here' }, { status: 400 });
    }

    let body: { role?: string };
    try {
      body = (await request.json()) as { role?: string };
    } catch {
      return NextResponse.json({ error: 'Body is not valid JSON' }, { status: 400 });
    }
    const newRole = body.role;
    if (newRole !== 'contributor' && newRole !== 'editor') {
      return NextResponse.json({ error: 'role must be "contributor" or "editor"' }, { status: 400 });
    }

    const db = await getDb();
    const tenantDoc = await db.collection('tenants').findOne({ slug: tenant, status: { $ne: 'deleted' } });
    if (!tenantDoc) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    const platformRole = normalizeRoleLocal((session.user as { role?: unknown }).role);
    const editorRole = await effectiveRoleFor(editorEmail, String(tenantDoc.id), platformRole);

    // Read the current target row so we know whether we're crossing the
    // editor threshold (which requires admin+).
    const current = await db.collection('memberships').findOne({ email: targetEmail, tenantId: tenantDoc.id });
    if (!current) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    const currentRole = normalizeRoleLocal(current.role);

    // Editors can change contributor ↔ contributor only. Promoting to editor
    // (or demoting an editor) requires admin+.
    const crossesEditor = currentRole === 'editor' || newRole === 'editor';
    if (crossesEditor && ROLE_LEVEL[editorRole] < ROLE_LEVEL['admin']) {
      return NextResponse.json(
        { error: 'Only admins can promote to / demote from editor' },
        { status: 403 },
      );
    }

    await db.collection('memberships').updateOne(
      { email: targetEmail, tenantId: tenantDoc.id },
      { $set: { role: newRole } },
    );
    return NextResponse.json({ ok: true });
  },
  { minRole: 'editor' },
);

export const DELETE = withAuth(
  async (request: NextRequest, session, ctx) => {
    const params = await (ctx?.params as Promise<{ tenant: string; email: string }>);
    const { tenant, email: rawEmail } = params;
    void request;
    if (tenant !== 'bph') return NextResponse.json({ error: 'Unsupported tenant' }, { status: 404 });

    const targetEmail = decodeURIComponent(rawEmail).toLowerCase();
    const editorEmail = session.user?.email;
    if (!editorEmail) return NextResponse.json({ error: 'Session missing email' }, { status: 400 });
    if (targetEmail === editorEmail.toLowerCase()) {
      return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 });
    }

    const db = await getDb();
    const tenantDoc = await db.collection('tenants').findOne({ slug: tenant, status: { $ne: 'deleted' } });
    if (!tenantDoc) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    const platformRole = normalizeRoleLocal((session.user as { role?: unknown }).role);
    const editorRole = await effectiveRoleFor(editorEmail, String(tenantDoc.id), platformRole);

    const current = await db.collection('memberships').findOne({ email: targetEmail, tenantId: tenantDoc.id });
    if (!current) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    const currentRole = normalizeRoleLocal(current.role);

    // Editors can remove contributors only. Removing an editor or above
    // requires admin+. (Removing yourself is already blocked above.)
    if (currentRole !== 'contributor' && ROLE_LEVEL[editorRole] < ROLE_LEVEL['admin']) {
      return NextResponse.json(
        { error: 'Only admins can remove editors and admins' },
        { status: 403 },
      );
    }

    await db.collection('memberships').deleteOne({ email: targetEmail, tenantId: tenantDoc.id });
    return NextResponse.json({ ok: true });
  },
  { minRole: 'editor' },
);
