import { getDb } from '@/lib/mongodb';
import { ROLE_LEVEL, type Role } from '@/lib/auth';

/**
 * Who is allowed to edit a partner catalogue, resolved once.
 *
 * This calculation had been copied into every catalogue surface that needed it
 * — the entry page, the create page, the workspace — and each copy was subtly
 * its own thing (one fell back to 'reader', another to the platform role). A
 * permission check that drifts between surfaces is how an editor ends up
 * seeing a button on one page and not on another, so it lives here now.
 *
 * Identity is shared across subdomains but permission is not: a platform role
 * of editor+ carries everywhere, while anything less has to be earned per
 * tenant through an active `memberships` row. See the auth notes in CLAUDE.md.
 */

/** Map legacy/loose role strings onto the canonical set. */
export function normalizeCatalogRole(role: unknown): Role {
  if (
    role === 'superadmin' || role === 'admin' || role === 'editor' ||
    role === 'contributor' || role === 'reader'
  ) return role;
  if (role === 'inner_circle' || role === 'curator') return 'editor';
  return 'reader';
}

/**
 * The role this person effectively holds over `tenantSlug`'s catalogue —
 * the higher of their platform role and their membership in that tenant.
 *
 * Fails closed to `platformRole` (never upward) if the membership lookup
 * errors, so a database blip cannot grant editing rights.
 */
export async function effectiveCatalogRole(
  email: string | null | undefined,
  platformRole: Role,
  tenantSlug: string,
): Promise<Role> {
  if (!email) return platformRole;
  // Already editor+ platform-wide; a tenant membership cannot lower that.
  if (ROLE_LEVEL[platformRole] >= ROLE_LEVEL['editor']) return platformRole;
  try {
    const db = await getDb();
    const tenant = await db.collection('tenants').findOne({ slug: tenantSlug, status: { $ne: 'deleted' } });
    if (!tenant) return platformRole;
    const membership = await db.collection('memberships').findOne({
      email: email.toLowerCase(),
      tenantId: tenant.id,
      status: 'active',
    });
    const tenantRole = normalizeCatalogRole(membership?.role);
    return ROLE_LEVEL[tenantRole] >= ROLE_LEVEL[platformRole] ? tenantRole : platformRole;
  } catch {
    return platformRole;
  }
}

export const canEditCatalog = (role: Role) => ROLE_LEVEL[role] >= ROLE_LEVEL['contributor'];
export const canReviewCatalog = (role: Role) => ROLE_LEVEL[role] >= ROLE_LEVEL['editor'];
