import { Db, Document } from 'mongodb';
import { findBookByIdOrSlug, BookLookupResult } from '@/lib/book-lookup';
import { resolveTenantId } from '@/lib/tenant-context';

/**
 * Resolve a tenant slug to tenantId and enforce tenant-scoped book lookup.
 *
 * Subdomain tenants (bph / kloss-collection / bhutan): strict — book must
 * carry that exact tenantId UUID. Closed-system invariant ("Tenant Subdomain
 * Lockdown" in CLAUDE.md).
 *
 * Default tenant: main-site lookup. After PR #2071 + the tenantId-cleanup
 * sweep, untagged books (`tenantId` missing) ARE the main library. Allow
 * them through alongside any book explicitly tagged with the default-tenant
 * UUID. Without this, per-page routes 404'd on every untagged book — see
 * the 404 incident on 2026-05-27.
 *
 * Returns null when the tenant does not exist or the book is not in scope.
 */
export async function findTenantBookByIdOrSlug(
  db: Db,
  tenantSlug: string,
  idOrSlug: string,
  projection?: Document
): Promise<BookLookupResult | null> {
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return null;

  const scoped = await findBookByIdOrSlug(db, idOrSlug, projection, tenantId);
  if (scoped) return scoped;

  if (tenantSlug === 'default') {
    const unscoped = await findBookByIdOrSlug(db, idOrSlug, projection);
    if (unscoped && !(unscoped.book as Record<string, unknown>).tenantId) {
      return unscoped;
    }
  }

  return null;
}
