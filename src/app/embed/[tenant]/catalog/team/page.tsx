import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { ROLE_LEVEL, type Role } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import CatalogTeamClient from '@/components/catalog/CatalogTeamClient';
import CatalogEditorNav from '@/components/catalog/CatalogEditorNav';
import { getTenantContext } from '@/lib/tenant-context';
import { catalogBasePath, catalogIndexPath } from '@/lib/catalog-nav';

/**
 * BPH catalog team — invite contributors, change roles, remove members.
 *
 * Editor-only. Lives outside /admin (which is admin-gated) so tenant
 * editors can self-serve invitations without needing to also be platform
 * admins. Mirrors what the platform admin /admin/members UX would look
 * like, scoped to the tenant.
 *
 * Issue #1877 — Phase 1, PR-E.
 */

export const metadata: Metadata = {
  title: 'Catalogue team — BPH',
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ tenant: string }>;
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

interface MembershipRow {
  email: string;
  role: Role;
  status: string;
  addedAt: string | null;
  joinedAt: string | null;
  invitedBy: string | null;
  name: string | null;
}

export default async function CatalogTeamPage({ params }: Props) {
  const { tenant } = await params;
  if (tenant !== 'bph') notFound();

  const session = await auth();
  if (!session?.user) {
    redirect(`/${tenant}/login?callbackUrl=/catalog/team`);
  }

  const db = await getDb();
  const tenantDoc = await db.collection('tenants').findOne({ slug: tenant, status: { $ne: 'deleted' } });
  if (!tenantDoc) notFound();

  // Resolve effective role: platform role OR tenant membership, higher wins.
  const platformRole = normalizeRoleLocal((session.user as { role?: unknown }).role);
  const userMembership = session.user.email
    ? await db.collection('memberships').findOne({
        email: session.user.email.toLowerCase(),
        tenantId: tenantDoc.id,
        status: 'active',
      })
    : null;
  const tenantRole = normalizeRoleLocal(userMembership?.role);
  const effectiveRole = ROLE_LEVEL[platformRole] >= ROLE_LEVEL[tenantRole] ? platformRole : tenantRole;

  const tenantSource = (await getTenantContext())?.source ?? null;
  const catalogueIndexHref = catalogIndexPath(tenantSource, tenant);
  const navBasePath = catalogBasePath(tenantSource, tenant);

  if (ROLE_LEVEL[effectiveRole] < ROLE_LEVEL['editor']) {
    redirect(catalogueIndexHref);
  }

  // Pull all tenant memberships, plus user names from `users` so we can show
  // "Jose Bouman <jbouman@efm.amsterdam>" rather than just the email.
  const members = await db
    .collection('memberships')
    .find({ tenantId: tenantDoc.id })
    .project({ email: 1, role: 1, status: 1, addedAt: 1, joinedAt: 1, invitedBy: 1, _id: 0 })
    .toArray();

  const emails = members.map((m) => String(m.email)).filter(Boolean);
  const users = emails.length
    ? await db.collection('users').find({ email: { $in: emails } }, { projection: { email: 1, name: 1, _id: 0 } }).toArray()
    : [];
  const nameByEmail = new Map<string, string>();
  for (const u of users) {
    if (u.email && u.name) nameByEmail.set(String(u.email).toLowerCase(), String(u.name));
  }

  const rows: MembershipRow[] = members
    .map((m) => ({
      email: String(m.email || ''),
      role: normalizeRoleLocal(m.role),
      status: String(m.status || 'pending'),
      addedAt: m.addedAt ? new Date(m.addedAt).toISOString() : null,
      joinedAt: m.joinedAt ? new Date(m.joinedAt).toISOString() : null,
      invitedBy: m.invitedBy ? String(m.invitedBy) : null,
      name: nameByEmail.get(String(m.email).toLowerCase()) || null,
    }))
    .sort((a, b) => ROLE_LEVEL[b.role] - ROLE_LEVEL[a.role] || a.email.localeCompare(b.email));

  // Only admin/superadmin can invite an editor. An editor inviting promotes
  // to contributor at most.
  const canInviteEditor = ROLE_LEVEL[effectiveRole] >= ROLE_LEVEL['admin'];

  return (
    <div className="bg-cream min-h-screen">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <a
          href={catalogueIndexHref}
          className="inline-flex items-center text-sm text-muted hover:text-primary mb-4 transition-colors"
        >
          ← Catalogue
        </a>
        <CatalogEditorNav role={effectiveRole} current="team" basePath={navBasePath} />
        <h1 className="text-2xl sm:text-3xl text-primary font-display leading-tight mb-1">
          Catalogue team
        </h1>
        <p className="text-sm text-muted mb-6">
          Invite contributors to propose changes; invite editors to apply changes and review submissions. Signed in as {session.user.email}.
        </p>

        <CatalogTeamClient
          tenant={tenant}
          initialRows={rows}
          canInviteEditor={canInviteEditor}
          currentUserEmail={session.user.email || ''}
        />
      </div>
    </div>
  );
}
